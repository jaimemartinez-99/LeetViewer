export const MAX_ROWS = 200;

// Scan SQL without confusing keywords in literals, comments or subqueries.
export function tokenize(sql) {
  const tokens = [];
  let depth = 0;
  for (let i = 0; i < sql.length;) {
    const start = i;
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Comentario SQL sin cerrar.');
      i = end + 2;
      continue;
    }
    if (['"', "'", '`', '['].includes(c)) {
      const end = c === '[' ? ']' : c;
      let closed = false;
      i++;
      while (i < sql.length) {
        if (sql[i++] === end) {
          if (sql[i] === end && c !== '[') {
            i++;
            continue;
          }
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error('Texto o identificador SQL sin cerrar.');
      tokens.push({ word: '', start, end: i, depth });
      continue;
    }
    if (c === '(') {
      tokens.push({ word: c, start, end: ++i, depth });
      depth++;
      continue;
    }
    if (c === ')') {
      depth--;
      if (depth < 0) throw new Error('Paréntesis sin pareja.');
    }
    if (/[a-zA-Z_]/.test(c)) {
      while (i < sql.length && /[a-zA-Z_0-9$]/.test(sql[i])) i++;
    } else i++;
    tokens.push({
      word: sql.slice(start, i).toUpperCase(),
      start,
      end: i,
      depth,
    });
  }
  if (depth !== 0) throw new Error('Paréntesis sin cerrar.');
  return tokens;
}

export function validateQuery(source) {
  if (source.length > 30000)
    throw new Error('La consulta supera los 30.000 caracteres.');
  const tokens = tokenize(source);
  if (!tokens.length)
    throw new Error('Escribe una consulta SELECT para empezar.');
  if (!['SELECT', 'WITH'].includes(tokens[0].word))
    throw new Error(
      'Usa una consulta SELECT o WITH. Las tablas de entrada son de solo lectura.',
    );
  const semicolons = tokens.filter((t) => t.word === ';');
  if (
    semicolons.length &&
    (semicolons.length > 1 || tokens.at(-1) !== semicolons[0])
  ) {
    throw new Error('Ejecuta una sola consulta cada vez.');
  }
  return semicolons.length
    ? source.slice(0, semicolons[0].start).trim()
    : source.trim();
}

export function intermediateQueries(sql) {
  const tokens = tokenize(sql);
  const top = tokens.filter((t) => t.depth === 0);
  const unsupported =
    top[0]?.word !== 'SELECT' ||
    tokens.some(
      (t) =>
        ['UNION', 'INTERSECT', 'EXCEPT', 'WINDOW'].includes(t.word) ||
        (t.word === 'SELECT' && t !== tokens[0]),
    );
  if (unsupported)
    return {
      stages: [],
      note: 'Esta consulta usa una CTE, subconsulta, ventana nombrada u operación de conjuntos. El resultado final se ejecuta en SQLite; el desglose intermedio no está disponible para esta estructura.',
    };
  const from = top.find((t) => t.word === 'FROM');
  if (!from)
    return {
      stages: [],
      note: 'La consulta no utiliza tablas en FROM; pasa directamente al resultado final.',
    };
  const boundary = top.find(
    (t) =>
      t.start > from.start &&
      ['GROUP', 'HAVING', 'ORDER', 'LIMIT'].includes(t.word),
  );
  const where = top.find(
    (t) =>
      t.word === 'WHERE' &&
      t.start > from.start &&
      (!boundary || t.start < boundary.start),
  );
  const end = boundary?.start ?? sql.length;
  const fromSql = sql.slice(from.start, where?.start ?? end).trim();
  const stages = [
    {
      title: /\bJOIN\b/i.test(fromSql)
        ? 'FROM + JOIN · filas combinadas'
        : 'FROM · filas de origen',
      sql: `SELECT *\n${fromSql}`,
    },
  ];
  if (where)
    stages.push({
      title: 'WHERE · filas que cumplen la condición',
      sql: `SELECT *\n${sql.slice(from.start, end).trim()}`,
    });
  return {
    stages,
    note: 'Vista lógica de FROM / JOIN / WHERE, antes de seleccionar columnas y aplicar agregaciones. No representa el plan físico del optimizador.',
  };
}

export function readResult(db, sql) {
  const statement = db.prepare(sql);
  try {
    const columns = statement.getColumnNames();
    const values = [];
    while (values.length < MAX_ROWS && statement.step())
      values.push(statement.get());
    const truncated = values.length === MAX_ROWS && statement.step();
    return { columns, values, truncated };
  } finally {
    statement.free();
  }
}

export function createProblemDatabase(SQL, problem) {
  const db = new SQL.Database();
  try {
    db.run(problem.setup);
    db.create_function('regexp', (pattern, value) => {
      if (value === null || pattern === null) return 0;
      const match = new RegExp(String(pattern)).exec(String(value));
      // Unlike JavaScript $, SQL exercise matching must reject a trailing newline.
      return Number(
        Boolean(match) &&
          (!String(pattern).endsWith('$') ||
            match.index + match[0].length === String(value).length),
      );
    });
    db.run('PRAGMA query_only = ON');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function getBaseTables(db, problem) {
  return problem.tables.map((name) => ({
    name,
    ...readResult(db, `SELECT * FROM "${name.replaceAll('"', '""')}"`),
  }));
}

export function executePipeline(db, source) {
  const sql = validateQuery(source);
  const start = performance.now();
  const final = readResult(db, sql);
  const plan = intermediateQueries(sql);
  let stages = [];
  let note = plan.note;
  try {
    stages = plan.stages.map((stage) => ({
      ...stage,
      ...readResult(db, stage.sql),
    }));
  } catch {
    note =
      'SQLite ejecutó la consulta final, pero no se puede desglosar esta estructura con fidelidad. Consulta el resultado final.';
  }
  return {
    sql: source,
    final,
    stages,
    note,
    duration: performance.now() - start,
  };
}
