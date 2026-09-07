import sqlite from 'node-sql-parser/build/sqlite.js';
import {
  createProblemDatabase,
  executePipeline,
  readResult,
  tokenize,
} from './sql-engine.js';
import { relationalTrace } from './relational-trace.js';

const parser = new sqlite.Parser();
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

// Each DELETE runs on fresh exercise data. The shared read-only database remains
// intact, even after syntax errors, a broad DELETE, or repeated executions.
function executeDelete(SQL, problem, source) {
  if (source.length > 30000)
    throw new Error('La consulta supera los 30.000 caracteres.');
  const tokens = tokenize(source);
  const separators = tokens.filter((t) => t.word === ';');
  if (
    separators.length &&
    (separators.length !== 1 || separators[0] !== tokens.at(-1))
  )
    throw new Error('Ejecuta una sola consulta cada vez.');
  const parsed = parser.astify(source, { database: 'sqlite' });
  const ast = Array.isArray(parsed) ? parsed[0] : parsed;
  if (
    ast.type !== 'delete' ||
    ast.from?.length !== 1 ||
    ast.table?.length !== 1 ||
    ast.from[0].db ||
    ast.from[0].table?.toLowerCase() !== problem.resultTable.toLowerCase() ||
    ast.returning
  )
    throw new Error(
      `Este ejercicio admite un DELETE sobre ${problem.resultTable}, sin RETURNING.`,
    );
  const start = performance.now();
  const copy = createProblemDatabase(SQL, problem);
  try {
    const snapshotSQL = `SELECT * FROM ${quote(problem.resultTable)} ORDER BY id`;
    const before = readResult(copy, snapshotSQL);
    copy.run('PRAGMA query_only = OFF');
    copy.run(source);
    const final = readResult(copy, snapshotSQL);
    const columns = before.columns.map((label, c) => ({
      key: `delete:column:${c}`,
      label,
      role: 'selected',
    }));
    const rows = before.values.map((values, r) => ({
      id: `delete:row:${r}`,
      cells: values.map((value, c) => ({
        id: `delete:row:${r}:${c}`,
        value,
        origins: [],
      })),
    }));
    const remaining = new Set(final.values.map((row) => JSON.stringify(row)));
    const table = { title: problem.resultTable, columns, rows };
    const supported =
      !before.truncated &&
      !final.truncated &&
      rows.length <= 40 &&
      columns.length <= 24;
    const stages = [
      {
        id: 'delete:before',
        op: 'from',
        title: 'Tabla antes del borrado',
        sql: `FROM ${quote(problem.resultTable)}`,
        note: 'Cada ejecución empieza con una copia de las tablas originales.',
        context: 'Consulta principal',
        tables: [table],
      },
      {
        id: 'delete:after',
        op: 'delete',
        title: 'Eliminar las filas seleccionadas',
        sql: source,
        note: `${before.values.length - final.values.length} filas eliminadas. Se muestra la tabla que queda después de ejecutar DELETE en SQLite.`,
        context: 'Consulta principal',
        tables: [
          {
            ...table,
            rows: rows.filter((row) =>
              remaining.has(JSON.stringify(row.cells.map((c) => c.value))),
            ),
          },
        ],
      },
    ];
    return {
      sql: source,
      final,
      stages: [],
      duration: performance.now() - start,
      note: 'Resultado de DELETE sobre una copia temporal; las tablas de entrada se conservan.',
      animation: supported
        ? { supported: true, stages, outputRows: final.values.length }
        : null,
      animationReason: supported
        ? null
        : 'El borrado se ha ejecutado, pero sus tablas superan el límite de animación.',
    };
  } finally {
    copy.close();
  }
}

export function executeProblemQuery(SQL, db, problem, source) {
  if (problem.mode === 'delete' && tokenize(source)[0]?.word === 'DELETE')
    return executeDelete(SQL, problem, source);
  const result = executePipeline(db, source);
  const trace = relationalTrace(db, source, result.final);
  result.animation = trace.supported ? trace : null;
  result.animationReason = trace.supported ? null : trace.reason;
  return result;
}
