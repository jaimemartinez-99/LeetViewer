import sqlite from 'node-sql-parser/build/sqlite.js';
import { readResult, validateQuery, tokenize } from './sql-engine.js';

const parser = new sqlite.Parser();
const dialect = { database: 'sqlite' };
const clone = (value) => structuredClone(value);
const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;
const exprSql = (expr) => parser.exprToSQL(expr, dialect);
// String literals are case-sensitive, even when identifiers are not.
const expressionKey = (expr) => exprSql(expr);
const astOf = (sql) => {
  // The SQLite parser lacks CROSS JOIN. Bare JOIN has the same logical
  // Cartesian-product semantics; tokenize so literals/comments stay untouched.
  const tokens = tokenize(sql);
  for (let i = tokens.length - 2; i >= 0; i--)
    if (tokens[i].word === 'CROSS' && tokens[i + 1].word === 'JOIN')
      sql = sql.slice(0, tokens[i].start) + sql.slice(tokens[i].end);
  const parsed = parser.astify(sql, dialect);
  return Array.isArray(parsed) ? parsed[0] : parsed;
};
const json = (value) => JSON.stringify(value);
const bag = (rows) => rows.map((row) => json(row)).sort();
const refExpr = (table, column) => ({ type: 'column_ref', table, column });
const walk = (value, visit) => {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => walk(item, visit));
    else if (child && typeof child === 'object') walk(child, visit);
  }
};
const collect = (value, predicate) => {
  const result = new Map();
  walk(value, (node) => {
    if (predicate(node)) result.set(expressionKey(node), node);
  });
  return [...result.values()];
};
class Unsupported extends Error {}
const stop = (message) => {
  throw new Unsupported(message);
};

/** Relational snapshots and cell provenance, independent of problem IDs.
 * SQLite computes every condition, group, aggregate and window expression.
 * The AST is used only to separate operations and construct diagnostic queries.
 */
export function relationalTrace(db, source, finalResult) {
  const stages = [];
  let scopeCounter = 0;
  const read = (sql) => {
    const result = readResult(db, sql);
    if (
      result.truncated ||
      result.values.length > 40 ||
      result.columns.length > 32
    )
      stop(
        'La animación admite hasta 40 filas y 24 columnas visibles por etapa. El resultado SQL sigue disponible.',
      );
    return result;
  };
  const emit = (op, title, sql, note, tables, context) => {
    if (stages.length >= 48)
      stop('La consulta necesita más de 48 etapas de animación.');
    if (tables.some((t) => t.columns.length > 24))
      stop('La animación admite hasta 24 columnas visibles por etapa.');
    stages.push({
      id: `stage-${stages.length}`,
      op,
      title,
      sql,
      note,
      context,
      tables,
    });
  };

  function select(ast, inherited, cteTables, context, depth = 0) {
    if (depth > 5)
      stop('La consulta supera los cinco niveles de anidación admitidos.');
    if (ast.type !== 'select')
      stop('Esta operación no es una consulta SELECT.');
    if (ast.window || ast.qualify)
      stop('Las ventanas con nombre y QUALIFY todavía no tienen animación.');
    const scope = `q${scopeCounter++}`;
    const withs = [...inherited];
    const named = new Map(cteTables);
    for (const cte of ast.with || []) {
      if (cte.recursive)
        stop('Las CTE recursivas todavía no tienen animación.');
      const name = cte.name.value;
      const table = select(
        cte.stmt.ast || cte.stmt,
        withs,
        named,
        `CTE ${name}`,
        depth + 1,
      );
      withs.push(cte);
      const materialized = { ...table, title: name };
      if (cte.columns)
        materialized.columns = table.columns.map((col, i) => ({
          ...col,
          label: cte.columns[i]?.value || cte.columns[i] || col.label,
        }));
      named.set(name.toLowerCase(), materialized);
      emit(
        'cte',
        `Guardar ${name}`,
        parser
          .sqlify({ ...astOf('SELECT 1'), with: [cte] }, dialect)
          .replace(/SELECT 1$/, ''),
        'Este resultado recibe un nombre y puede utilizarse como una tabla en las operaciones siguientes.',
        [materialized],
        context,
      );
    }
    if (ast._next) {
      const branches = [];
      const operators = [];
      for (let node = ast; node; node = node._next) {
        if (node.set_op) operators.push(node.set_op.toUpperCase());
        if (node.orderby || node.limit)
          stop(
            'Para animar ORDER BY o LIMIT sobre UNION, coloca la unión en una CTE y ordena su resultado.',
          );
        branches.push(
          select(
            { ...clone(node), with: null, _next: undefined, set_op: undefined },
            withs,
            named,
            `${context} · rama ${branches.length + 1}`,
            depth + 1,
          ),
        );
      }
      if (operators.some((op) => !['UNION', 'UNION ALL'].includes(op)))
        stop('INTERSECT y EXCEPT todavía no tienen animación.');
      const sql = parser.sqlify(
        { ...clone(ast), with: withs.length ? withs : null },
        dialect,
      );
      const result = read(sql);
      const pools = new Map();
      for (const branch of branches)
        for (const row of branch.rows) {
          const key = json(row.cells.map((c) => c.value));
          if (!pools.has(key)) pools.set(key, []);
          pools.get(key).push(row);
        }
      const columns = result.columns.map((label, i) => ({
        key: `${scope}:union:${i}`,
        label,
        expr: refExpr(null, label),
        role: 'selected',
      }));
      const output = {
        title: 'Resultado de la unión',
        columns,
        rows: result.values.map((values, r) => {
          const matches = pools.get(json(values));
          if (!matches?.length)
            stop('No se puede verificar la procedencia de la unión.');
          const origins = operators.every((op) => op === 'UNION ALL')
            ? [matches.shift()]
            : [...matches];
          return {
            id: `${scope}:union:row:${r}`,
            cells: values.map((value, c) => ({
              id: `${scope}:union:row:${r}:cell:${c}`,
              value,
              origins: origins.map((row) => row.cells[c].id),
            })),
          };
        }),
      };
      emit(
        'branches',
        'Resultados de las ramas',
        operators.join(' · '),
        'Cada rama produce sus columnas de forma independiente. Se combinan por posición.',
        branches,
        context,
      );
      emit(
        'union',
        'Combinar los resultados',
        operators.join(' · '),
        'UNION ALL conserva las repeticiones; UNION elimina filas duplicadas. SQLite calcula el resultado combinado.',
        [output],
        context,
      );
      return output;
    }
    const from = ast.from || [];
    if (from.some((item) => item.using || /NATURAL/i.test(item.join || '')))
      stop(
        'Los JOIN con USING o NATURAL todavía no tienen animación; utiliza una condición ON.',
      );
    const expressions = [
      ast.columns,
      ast.where,
      ast.groupby,
      ast.having,
      ast.orderby,
    ];
    let nested = false;
    walk(expressions, (node) => {
      if (node.ast?.type === 'select' || node.type === 'select') nested = true;
    });
    if (nested)
      stop(
        'Las subconsultas dentro de expresiones todavía no tienen animación. Las CTE y las subconsultas en FROM sí se admiten.',
      );
    const aggregates = collect(
      [ast.columns, ast.having, ast.orderby],
      (node) => node.type === 'aggr_func' && !node.over,
    );
    const windows = collect(ast.columns, (node) => Boolean(node.over));
    if (aggregates.length && windows.length)
      stop(
        'Combinar agregaciones y ventanas en el mismo SELECT todavía no tiene animación; sepáralas mediante una CTE.',
      );

    const sqlFor = (options) =>
      parser.sqlify(
        {
          ...clone(ast),
          with: withs.length ? withs : null,
          distinct: null,
          where: null,
          groupby: null,
          having: null,
          orderby: null,
          limit: null,
          ...options,
          from: options.from?.length === 0 ? null : (options.from ?? ast.from),
        },
        dialect,
      );
    const expressionColumn = (expr, as) => ({ expr, as });
    const sources = [];
    const wrapped = [];
    const metadata = [];
    const rawAlias = [];
    for (const [index, item] of from.entries()) {
      let previous;
      if (item.expr?.ast)
        previous = select(
          item.expr.ast,
          withs,
          named,
          `Subconsulta ${item.as || index + 1}`,
          depth + 1,
        );
      else previous = named.get(String(item.table).toLowerCase());
      const alias = item.as || item.table;
      if (!alias || item.db)
        stop(
          'Usa alias para las subconsultas; los nombres de base de datos calificados todavía no tienen animación.',
        );
      const standalone = sqlFor({
        from: [{ ...item, join: undefined, on: undefined }],
        columns: [
          { expr: { type: 'column_ref', table: null, column: '*' }, as: null },
        ],
      });
      const values = read(standalone);
      if (
        new Set(values.columns.map((c) => c.toLowerCase())).size !==
        values.columns.length
      )
        stop(
          'Una tabla derivada contiene nombres de columna duplicados. Asigna alias diferentes para animarla.',
        );
      let hidden = `__leetviewer_row_${index}`;
      while (values.columns.some((c) => c.toLowerCase() === hidden))
        hidden += '_';
      const inner = clone(
        astOf(
          'SELECT *, ROW_NUMBER() OVER (PARTITION BY 1) AS placeholder FROM placeholder',
        ),
      );
      inner.columns[1].as = hidden;
      inner.from = [{ ...item, as: undefined, join: undefined, on: undefined }];
      if (item.expr) inner.from[0].as = alias;
      const wrapper = astOf(
        `SELECT * FROM (${parser.sqlify(inner, dialect)}) AS ${quote(alias)}`,
      ).from[0];
      wrapped.push({ ...wrapper, join: item.join, on: item.on });
      rawAlias.push({ alias, hidden });
      const columns = values.columns.map((name, c) => ({
        key: `${scope}:${alias}.${name}`,
        label: `${alias}.${name}`,
        expr: refExpr(alias, name),
        alias,
        sourceIndex: c,
        role: 'source',
      }));
      metadata.push(...columns);
      const oldByValue = new Map();
      for (const row of previous?.rows || []) {
        const key = json(row.cells.map((c) => c.value));
        if (!oldByValue.has(key)) oldByValue.set(key, []);
        oldByValue.get(key).push(row);
      }
      sources.push({
        title: item.as ? `${item.table || 'Subconsulta'} AS ${alias}` : alias,
        columns,
        rows: values.values.map((row, r) => {
          const refs = { [alias]: r + 1 };
          const id = `${scope}:${alias}:${r + 1}`;
          const origin = oldByValue.get(json(row))?.shift();
          return {
            id,
            refs,
            cells: row.map((value, c) => ({
              id: `${id}:${columns[c].key}`,
              value,
              origins: origin ? [origin.cells[c].id] : [],
            })),
          };
        }),
      });
    }
    const resolve = (expr) => {
      if (!expr) return expr;
      const copy = clone(expr);
      const replace = (node) => {
        if (
          node.type === 'column_ref' &&
          !node.table &&
          !metadata.some(
            (c) =>
              c.expr.column.toLowerCase() === String(node.column).toLowerCase(),
          )
        ) {
          const selected = ast.columns.find(
            (c) => c.as?.toLowerCase() === String(node.column).toLowerCase(),
          );
          if (selected) return clone(selected.expr);
        }
        if (Array.isArray(node)) return node.map(replace);
        if (node && typeof node === 'object')
          return Object.fromEntries(
            Object.entries(node).map(([k, v]) => [
              k,
              v && typeof v === 'object' ? replace(v) : v,
            ]),
          );
        return node;
      };
      return replace(copy);
    };
    const matchingColumns = (expr) => {
      const refs = collect(
        expr,
        (node) => node.type === 'column_ref' && node.column !== '*',
      );
      return metadata.filter((col) =>
        refs.some(
          (ref) =>
            String(ref.column).toLowerCase() ===
              col.expr.column.toLowerCase() &&
            (!ref.table || ref.table.toLowerCase() === col.alias.toLowerCase()),
        ),
      );
    };
    const usedKeys = (expr) => matchingColumns(expr).map((c) => c.key);
    const selectedKeys = usedKeys(ast.columns);
    const joinKeys = usedKeys(from.map((f) => f.on));
    const filterKeys = usedKeys(ast.where);
    for (const column of metadata)
      column.role = selectedKeys.includes(column.key)
        ? 'selected'
        : joinKeys.includes(column.key)
          ? 'key'
          : filterKeys.includes(column.key)
            ? 'filter'
            : 'source';
    const provenanceExpr = rawAlias.length
      ? {
          type: 'function',
          name: { name: [{ type: 'default', value: 'json_array' }] },
          args: {
            type: 'expr_list',
            value: rawAlias.map(({ alias, hidden }) => refExpr(alias, hidden)),
          },
        }
      : astOf("SELECT '[]'").columns[0].expr;
    const provenanceSql = exprSql(provenanceExpr);
    const groupedProvenance = astOf(`SELECT json_group_array(${provenanceSql})`)
      .columns[0].expr;
    const tupleOf = (refs) =>
      json(rawAlias.map(({ alias }) => refs[alias] ?? null));
    const rawSelect = (count, predicate = null, extra = [], order = null) => {
      const cols = metadata.filter((c) =>
        rawAlias.slice(0, count).some((r) => r.alias === c.alias),
      );
      const ids = rawAlias.slice(0, count);
      const query = sqlFor({
        from: wrapped.slice(0, count),
        where: predicate,
        orderby: order,
        columns: [
          ...cols.map((c, i) => expressionColumn(c.expr, `c${i}`)),
          ...extra.map((c, i) => expressionColumn(c.expr, `x${i}`)),
          ...ids.map((r, i) =>
            expressionColumn(refExpr(r.alias, r.hidden), `r${i}`),
          ),
        ],
      });
      if (!count && !extra.length)
        return {
          table: {
            title: 'Fila implícita',
            columns: [],
            rows: [{ id: `${scope}:implicit`, refs: {}, cells: [] }],
          },
          sql: 'SELECT',
        };
      const result = read(query);
      const columns = [...cols, ...extra];
      const rows = result.values.map((values) => {
        const refs = Object.fromEntries(
          ids.map((r, i) => [r.alias, values[columns.length + i]]),
        );
        const id = `${scope}:row:${json(ids.map((r) => refs[r.alias]))}`;
        return {
          id,
          refs,
          cells: columns.map((col, i) => ({
            id: `${id}:${col.key}`,
            value: values[i],
            origins: [],
          })),
        };
      });
      return {
        table: { title: 'Filas de trabajo', columns, rows },
        sql: query,
      };
    };
    let current = sources[0] || {
      title: 'Fila implícita',
      columns: [],
      rows: [{ id: `${scope}:implicit`, refs: {}, cells: [] }],
    };
    if (sources.length)
      emit(
        'from',
        'Tablas de origen',
        from
          .map((f) =>
            f.as ? `${f.table || '(subconsulta)'} AS ${f.as}` : f.table,
          )
          .join('\n'),
        'Cada tabla conserva su identidad. Los alias permiten usar la misma tabla en varios papeles.',
        sources,
        context,
      );
    for (let index = 1; index < from.length; index++) {
      const next = rawSelect(index + 1);
      for (const row of next.table.rows)
        for (const [c, col] of next.table.columns.entries()) {
          const previous =
            col.alias === rawAlias[index].alias ? sources[index] : current;
          const origin = previous.rows.find((r) =>
            Object.entries(r.refs).every(
              ([alias, id]) => row.refs[alias] === id,
            ),
          );
          const colIndex = previous.columns.findIndex(
            (column) => column.key === col.key,
          );
          if (origin && colIndex >= 0)
            row.cells[c].origins = [origin.cells[colIndex].id];
        }
      const leftKeys = matchingColumns(from[index].on).filter(
        (c) => c.alias !== rawAlias[index].alias,
      );
      const rightKeys = matchingColumns(from[index].on).filter(
        (c) => c.alias === rawAlias[index].alias,
      );
      const links = new Map();
      for (const row of next.table.rows) {
        const left = current.rows.find((r) =>
          Object.entries(r.refs).every(([alias, id]) => row.refs[alias] === id),
        );
        const right = sources[index].rows.find(
          (r) =>
            r.refs[rawAlias[index].alias] === row.refs[rawAlias[index].alias],
        );
        if (!left || !right) continue;
        const li = Math.max(
          0,
          current.columns.findIndex((c) =>
            leftKeys.some((k) => k.key === c.key),
          ),
        );
        const ri = Math.max(
          0,
          sources[index].columns.findIndex((c) =>
            rightKeys.some((k) => k.key === c.key),
          ),
        );
        if (left.cells[li] && right.cells[ri]) {
          const link = { from: left.cells[li].id, to: right.cells[ri].id };
          links.set(json(link), link);
        }
      }
      emit(
        'match',
        'Conectar las filas',
        from[index].on ? `ON ${exprSql(from[index].on)}` : 'CROSS JOIN',
        'Las líneas conectan las filas que cumplen la condición completa de la unión.',
        [current, ...sources.slice(index)],
        context,
      );
      stages.at(-1).links = [...links.values()];
      current = next.table;
      emit(
        'join',
        from[index].on ? from[index].join || 'JOIN' : 'CROSS JOIN',
        from[index].on
          ? `ON ${exprSql(from[index].on)}`
          : 'Todas las combinaciones',
        'Cada coincidencia combina celdas de ambas tablas. En una unión externa, las celdas sin correspondencia se rellenan con NULL.',
        [current, ...sources.slice(index + 1)],
        context,
      );
    }
    // Normalize source row IDs before any predicate or computed expression.
    if (from.length === 1) {
      const normalized = rawSelect(1).table;
      normalized.rows.forEach((row, i) =>
        row.cells.forEach((cell, c) => {
          cell.origins = [current.rows[i].cells[c].id];
        }),
      );
      // Keep the original visible IDs so WHERE immediately moves the same cells.
      normalized.rows.forEach((row, i) =>
        row.cells.forEach((cell, c) => {
          current.rows[i].refs = row.refs;
          cell.id = current.rows[i].cells[c].id;
        }),
      );
      current = { ...normalized, title: current.title };
    }
    const transfer = (next) => {
      for (const row of next.rows) {
        const old = current.rows.find(
          (r) => tupleOf(r.refs) === tupleOf(row.refs),
        );
        for (const [i, col] of next.columns.entries()) {
          const at = current.columns.findIndex((c) => c.key === col.key);
          if (old && at >= 0)
            row.cells[i] = {
              ...row.cells[i],
              id: old.cells[at].id,
              origins: [old.cells[at].id],
            };
          else if (old)
            row.cells[i].origins = matchingColumns(col.expr).flatMap((c) => {
              const n = current.columns.findIndex((x) => x.key === c.key);
              return n < 0 ? [] : [old.cells[n].id];
            });
        }
      }
      return next;
    };
    const predicate = resolve(ast.where);
    if (ast.where) {
      const next = rawSelect(from.length, predicate);
      const prior = current.rows.length;
      current = transfer(next.table);
      emit(
        'where',
        'Filtrar filas',
        `WHERE ${exprSql(ast.where)}`,
        `${current.rows.length} de ${prior} filas cumplen la condición. Las demás se apartan antes de agrupar.`,
        [current],
        context,
      );
    }
    const groupExprs = (ast.groupby?.columns || []).map((expr) =>
      resolve(
        expr.type === 'number'
          ? ast.columns[Number(expr.value) - 1]?.expr || expr
          : expr,
      ),
    );
    const grouping = groupExprs.length > 0 || aggregates.length > 0;
    const groupby = groupExprs.length ? { columns: groupExprs } : null;
    const calculated = collect(
      aggregates.map((a) => a.args?.expr),
      (node) => node.type === 'case',
    );
    const extras = calculated.map((expr) => ({
      key: `${scope}:calc:${expressionKey(expr)}`,
      label: exprSql(expr),
      expr,
      role: 'computed',
    }));
    if (extras.length) {
      current = transfer(rawSelect(from.length, predicate, extras).table);
      emit(
        'calculate',
        'Evaluar expresiones',
        extras.map((c) => c.label).join('\n'),
        'Cada expresión se evalúa por fila. Estos valores se utilizarán al calcular la agregación.',
        [current],
        context,
      );
    }
    let groupRows = [];
    let aggregateColumns = [];
    let aggregateSQL;
    const groupQueries = (having) =>
      sqlFor({
        from: wrapped,
        where: predicate,
        groupby,
        having: resolve(having),
        columns: [
          ...groupExprs.map((expr, i) => expressionColumn(expr, `g${i}`)),
          ...aggregates.map((expr, i) => expressionColumn(expr, `a${i}`)),
          expressionColumn(groupedProvenance, 'lineage'),
        ],
      });
    if (grouping) {
      aggregateSQL = groupQueries(null);
      const rawGroups = read(aggregateSQL);
      const rowsByTuple = new Map(
        current.rows.map((row) => [tupleOf(row.refs), row]),
      );
      groupRows = rawGroups.values.map((values, i) => {
        const tuples = JSON.parse(values.at(-1));
        const members = tuples
          .map((tuple) => rowsByTuple.get(json(tuple)))
          .filter(Boolean);
        const id = `${scope}:group:${json(tuples.map(json).sort())}`;
        return {
          id,
          values,
          members,
          label: groupExprs.length
            ? values
                .slice(0, groupExprs.length)
                .map(
                  (v, n) =>
                    `${exprSql(groupExprs[n])} = ${v === null ? 'NULL' : v}`,
                )
                .join(' · ')
            : 'Todas las filas',
          index: i,
        };
      });
      const groupedTable = {
        ...current,
        title: 'Filas agrupadas',
        rows: groupRows.flatMap((group) =>
          group.members.map((row) => ({ ...row, group: group.id })),
        ),
        groups: groupRows.map((g) => ({
          id: g.id,
          label: g.label,
          count: g.members.length,
        })),
      };
      current = groupedTable;
      emit(
        'group',
        'Reunir los grupos',
        groupExprs.length
          ? `GROUP BY ${groupExprs.map(exprSql).join(', ')}`
          : 'Agregación sobre todas las filas',
        `${groupRows.length} grupos. Las filas se reúnen por sus claves antes de calcular los valores de cada grupo.`,
        [current],
        context,
      );
      aggregateColumns = [
        ...groupExprs.map((expr) => ({
          key: `${scope}:groupkey:${expressionKey(expr)}`,
          label: exprSql(expr),
          expr,
          role: 'key',
        })),
        ...aggregates.map((expr) => ({
          key: `${scope}:aggregate:${expressionKey(expr)}`,
          label: exprSql(expr),
          expr,
          role: 'computed',
        })),
      ];
      const makeAggregateRow = (group) => ({
        id: group.id,
        group: undefined,
        cells: aggregateColumns.map((column, c) => {
          const computed = extras.find(
            (e) =>
              expressionKey(e.expr) ===
              expressionKey(column.expr.args?.expr || column.expr),
          );
          const keys = computed ? [computed.key] : usedKeys(column.expr);
          const origins = group.members.flatMap((row) => {
            const indexes = keys.length
              ? current.columns
                  .map((col, i) => (keys.includes(col.key) ? i : -1))
                  .filter((i) => i >= 0)
              : row.cells.length
                ? [0]
                : [];
            return indexes.map((i) => row.cells[i].id);
          });
          return {
            id: `${group.id}:${column.key}`,
            value: group.values[c],
            origins,
          };
        }),
      });
      current = {
        title: 'Un resultado por grupo',
        columns: aggregateColumns,
        rows: groupRows.map(makeAggregateRow),
      };
      emit(
        'aggregate',
        'Calcular por grupo',
        aggregates.length
          ? aggregates.map(exprSql).join('\n')
          : 'Una fila por clave de agrupación',
        'Las celdas de cada grupo se condensan. COUNT cuenta filas o valores; SUM, AVG, MIN y MAX se calculan en SQLite.',
        [current],
        context,
      );
      if (ast.having) {
        const kept = new Set(
          read(groupQueries(ast.having)).values.map((row) =>
            json(JSON.parse(row.at(-1)).map(json).sort()),
          ),
        );
        current = {
          ...current,
          rows: current.rows.filter((row) =>
            kept.has(row.id.slice(`${scope}:group:`.length)),
          ),
        };
        emit(
          'having',
          'Filtrar grupos',
          `HAVING ${exprSql(ast.having)}`,
          `${current.rows.length} de ${groupRows.length} grupos superan el filtro. Se descartan grupos completos.`,
          [current],
          context,
        );
      }
    }
    if (windows.length) {
      const first = windows[0].over;
      if (windows.some((w) => json(w.over) !== json(first)))
        stop(
          'Las ventanas con distintas particiones en un mismo SELECT todavía no tienen animación.',
        );
      const partitions = (first.partitionby || []).map((p) => p.expr);
      const order = [
        ...partitions.map((expr) => ({ expr, type: 'ASC' })),
        ...(first.orderby || []),
      ];
      const windowExtras = windows.map((expr) => ({
        key: `${scope}:window:${expressionKey(expr)}`,
        label: exprSql(expr),
        expr,
        role: 'computed',
      }));
      const partitionExpr = partitions.length
        ? astOf(
            `SELECT DENSE_RANK() OVER (PARTITION BY 1 ORDER BY ${partitions.map(exprSql).join(',')})`,
          ).columns[0].expr
        : { type: 'number', value: 1 };
      const marker = {
        key: `${scope}:partition`,
        label: 'Partición',
        expr: partitionExpr,
        role: 'key',
      };
      const evaluated = transfer(
        rawSelect(
          from.length,
          predicate,
          [...windowExtras, marker],
          order.length ? order : null,
        ).table,
      );
      const markerIndex = evaluated.columns.length - 1;
      const windowGroups = new Map();
      for (const row of evaluated.rows) {
        row.group = `${scope}:partition:${row.cells[markerIndex].value}`;
        if (!windowGroups.has(row.group))
          windowGroups.set(row.group, {
            id: row.group,
            label: `Partición ${row.cells[markerIndex].value}`,
            count: 0,
          });
        windowGroups.get(row.group).count++;
      }
      const partitioned = {
        ...evaluated,
        columns: current.columns,
        rows: evaluated.rows.map((row) => ({
          ...row,
          cells: row.cells.slice(0, current.columns.length),
        })),
        groups: [...windowGroups.values()],
      };
      emit(
        'partition',
        'Ordenar las particiones',
        `${partitions.length ? 'PARTITION BY ' + partitions.map(exprSql).join(', ') : 'Una única partición'}\n${first.orderby?.length ? 'ORDER BY ' + first.orderby.map((o) => `${exprSql(o.expr)} ${o.type}`).join(', ') : ''}`,
        'Las ventanas conservan todas las filas. El orden dentro de cada partición determina el cálculo de la ventana, no necesariamente el orden final.',
        [partitioned],
        context,
      );
      for (const row of evaluated.rows)
        for (let c = current.columns.length; c < markerIndex; c++) {
          const keys = usedKeys(windows[c - current.columns.length]);
          row.cells[c].origins = partitioned.rows
            .filter((r) => r.group === row.group)
            .flatMap((r) =>
              partitioned.columns.flatMap((col, i) =>
                keys.includes(col.key) ? [r.cells[i].id] : [],
              ),
            );
        }
      current = {
        ...evaluated,
        columns: evaluated.columns.slice(0, -1),
        rows: evaluated.rows.map((row) => ({
          ...row,
          cells: row.cells.slice(0, -1),
        })),
        groups: [...windowGroups.values()],
      };
      emit(
        'window',
        'Calcular la ventana',
        windows.map(exprSql).join('\n'),
        'Cada fila recibe el valor de su función de ventana. La partición y el orden determinan qué filas participan; no se condensan como en GROUP BY.',
        [current],
        context,
      );
    }
    const projection = [];
    for (const column of ast.columns) {
      if (column.expr.type === 'column_ref' && column.expr.column === '*') {
        projection.push(
          ...metadata
            .filter(
              (c) =>
                !column.expr.table ||
                c.alias.toLowerCase() === column.expr.table.toLowerCase(),
            )
            .map((c) => ({ expr: c.expr, as: null })),
        );
      } else projection.push(column);
    }
    if (grouping) {
      for (const column of projection) {
        const bare = clone(column.expr);
        const strip = (node) => {
          if (!node || typeof node !== 'object') return node;
          if (node.type === 'aggr_func') return { type: 'number', value: 0 };
          if (
            groupExprs.some((g) => expressionKey(g) === expressionKeySafe(node))
          )
            return { type: 'number', value: 0 };
          return Array.isArray(node)
            ? node.map(strip)
            : Object.fromEntries(
                Object.entries(node).map(([k, v]) => [k, strip(v)]),
              );
        };
        if (collect(strip(bare), (n) => n.type === 'column_ref').length)
          stop(
            'La consulta selecciona columnas que no están agrupadas ni agregadas. SQLite permite algunos casos, pero su procedencia no se anima de forma inequívoca.',
          );
      }
    }
    const extraProvenance = grouping ? groupedProvenance : provenanceExpr;
    const projectedSQL = sqlFor({
      from: wrapped,
      where: predicate,
      groupby,
      having: resolve(ast.having),
      columns: [...projection, expressionColumn(extraProvenance, '__lineage')],
    });
    const projected = read(projectedSQL);
    const outputColumns = projection.map((col, i) => {
      const direct = current.columns.find(
        (c) =>
          expressionKey(c.expr) === expressionKey(col.expr) ||
          (col.expr.type === 'column_ref' &&
            !col.expr.table &&
            c.expr.type === 'column_ref' &&
            c.expr.column.toLowerCase() ===
              String(col.expr.column).toLowerCase()),
      );
      return {
        key: `${scope}:output:${i}`,
        sourceKey: direct?.key,
        label: col.as || projected.columns[i],
        expr: col.expr,
        role: 'selected',
      };
    });
    const output = {
      title: 'Columnas seleccionadas',
      columns: outputColumns,
      rows: projected.values.map((values, r) => {
        const lineage = JSON.parse(values.at(-1));
        const old = grouping
          ? current.rows.find(
              (row) =>
                row.id === `${scope}:group:${json(lineage.map(json).sort())}`,
            )
          : current.rows.find((row) => tupleOf(row.refs) === json(lineage));
        const id = old?.id || `${scope}:output:${r}`;
        return {
          id,
          refs: old?.refs,
          cells: outputColumns.map((column, c) => {
            const direct = current.columns.findIndex(
              (col) => col.key === column.sourceKey,
            );
            const aggregateRefs = collect(
              projection[c].expr,
              (node) => node.type === 'aggr_func' || Boolean(node.over),
            ).map(expressionKey);
            const keys = usedKeys(projection[c].expr);
            const origins = old
              ? current.columns.flatMap((col, i) =>
                  keys.includes(col.key) ||
                  aggregateRefs.includes(expressionKey(col.expr)) ||
                  direct === i
                    ? [old.cells[i].id]
                    : [],
                )
              : [];
            return {
              id: `${id}:${column.key}`,
              value: values[c],
              origins,
            };
          }),
        };
      }),
    };
    current = output;
    emit(
      'select',
      'Elegir las columnas',
      `SELECT ${projection.map((c) => `${exprSql(c.expr)}${c.as ? ' AS ' + quote(c.as) : ''}`).join(', ')}`,
      'Las columnas solicitadas se desplazan al resultado. Las demás se retiran; las expresiones calculadas reciben una celda nueva.',
      [current],
      context,
    );
    const actualSQL = (options) =>
      parser.sqlify(
        { ...clone(ast), with: withs.length ? withs : null, ...options },
        dialect,
      );
    const align = (values) => {
      const pools = new Map();
      current.rows.forEach((row) => {
        const key = json(row.cells.map((c) => c.value));
        if (!pools.has(key)) pools.set(key, []);
        pools.get(key).push(row);
      });
      return values.map((value) => {
        const row = pools.get(json(value))?.shift();
        if (!row)
          stop(
            'No se ha podido verificar la procedencia de todas las filas. Se conserva el resultado SQL sin animación.',
          );
        return row;
      });
    };
    if (ast.distinct) {
      const result = read(actualSQL({ orderby: null, limit: null }));
      current = { ...current, rows: align(result.values) };
      emit(
        'distinct',
        'Quitar duplicados',
        'DISTINCT',
        'Las filas con los mismos valores de salida se reducen a una sola.',
        [current],
        context,
      );
    }
    if (ast.orderby?.length) {
      const result = read(actualSQL({ limit: null }));
      current = { ...current, rows: align(result.values) };
      emit(
        'order',
        'Ordenar el resultado',
        `ORDER BY ${ast.orderby.map((o) => `${exprSql(o.expr)} ${o.type}`).join(', ')}`,
        'Las mismas filas cambian de posición según las expresiones y direcciones indicadas.',
        [current],
        context,
      );
    }
    if (ast.limit) {
      const result = read(actualSQL({}));
      current = { ...current, rows: align(result.values) };
      emit(
        'limit',
        'Recortar el resultado',
        parser
          .sqlify({ ...astOf('SELECT 1'), limit: ast.limit }, dialect)
          .replace('SELECT 1', '')
          .trim(),
        'LIMIT y OFFSET conservan únicamente el tramo solicitado de filas.',
        [current],
        context,
      );
    }
    const expected = read(actualSQL({}));
    if (
      json(bag(current.rows.map((r) => r.cells.map((c) => c.value)))) !==
      json(bag(expected.values))
    )
      stop(
        'El desglose no coincide con el resultado de SQLite. Se muestra el resultado sin animación.',
      );
    // Use SQLite's output labels, including expression names and aliases.
    current.columns.forEach((col, i) => {
      col.label = expected.columns[i];
    });
    return current;
  }
  try {
    if (finalResult?.truncated)
      stop(
        'El resultado está truncado. La animación solo se genera para resultados completos.',
      );
    const ast = astOf(validateQuery(source));
    const output = select(ast, [], new Map(), 'Consulta principal');
    if (
      finalResult &&
      json(bag(output.rows.map((r) => r.cells.map((c) => c.value)))) !==
        json(bag(finalResult.values))
    )
      stop(
        'La reescritura no coincide con el resultado original; se omite la animación.',
      );
    return { supported: true, stages, outputRows: output.rows.length };
  } catch (error) {
    return {
      supported: false,
      stages: [],
      reason:
        error instanceof Unsupported
          ? error.message
          : 'Esta estructura SQL todavía no puede desglosarse con seguridad. El resultado real permanece disponible.',
      diagnostic: error.message,
    };
  }
}

function expressionKeySafe(value) {
  try {
    return expressionKey(value);
  } catch {
    return null;
  }
}
