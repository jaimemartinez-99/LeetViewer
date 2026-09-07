import { test } from 'node:test';
import assert from 'node:assert/strict';
import problems from '../src/catalog.js';
import initSqlJs from 'sql.js';
import { createProblemDatabase, readResult } from '../src/sql-engine.js';
import { relationalTrace } from '../src/relational-trace.js';

const SQL = await initSqlJs();
const values = (table) => table.rows.map((r) => r.cells.map((c) => c.value));
function check(db, query) {
  const final = readResult(db, query);
  const trace = relationalTrace(db, query, final);
  assert.equal(trace.supported, true, `${query}: ${trace.diagnostic}`);
  assert.deepEqual(values(trace.stages.at(-1).tables[0]), final.values);
  for (const stage of trace.stages) {
    const ids = stage.tables.flatMap((t) =>
      t.rows.flatMap((r) => r.cells.map((c) => c.id)),
    );
    assert.equal(
      new Set(ids).size,
      ids.length,
      `Duplicate cell identity in ${stage.op}`,
    );
    for (const table of stage.tables)
      for (const row of table.rows)
        assert.equal(row.cells.length, table.columns.length);
  }
  return trace;
}

for (const problem of problems.filter((p) => p.mode !== 'delete'))
  test(`generic trace: ${problem.title}`, () => {
    const db = createProblemDatabase(SQL, problem);
    try {
      check(db, problem.query);
    } finally {
      db.close();
    }
  });

test('changed aliases, grouping threshold, and repeated projections preserve cell identity', () => {
  const db = createProblemDatabase(
    SQL,
    problems.find((p) => p.id === 570),
  );
  try {
    const trace = check(
      db,
      'SELECT boss.name AS first, boss.name AS second FROM Employee boss JOIN Employee report ON boss.id = report.managerId GROUP BY boss.id, boss.name HAVING COUNT(*) >= 2 ORDER BY boss.name DESC LIMIT 1',
    );
    assert.deepEqual(values(trace.stages.at(-1).tables[0]), [['Sara', 'Sara']]);
    assert.deepEqual(
      trace.stages
        .find((s) => s.op === 'group')
        .tables[0].groups.map((g) => g.count),
      [5, 2],
    );
    assert.ok(
      trace.stages
        .find((s) => s.op === 'select')
        .tables[0].rows.every((r) => r.cells.every((c) => c.origins.length)),
    );
  } finally {
    db.close();
  }
});

test('generic expressions, duplicate rows, NULL, CTE, windows, and empty aggregates', () => {
  const db = new SQL.Database();
  db.run(
    "CREATE TABLE items (id INTEGER, value TEXT); INSERT INTO items VALUES (1, 'A'), (2, 'a'), (3, NULL), (4, 'A')",
  );
  try {
    for (const query of [
      'SELECT id, id AS copy FROM items ORDER BY id DESC LIMIT 2 OFFSET 1',
      'SELECT DISTINCT value FROM items ORDER BY value',
      "SELECT SUM(CASE WHEN value = 'A' THEN 1 ELSE 0 END), SUM(CASE WHEN value = 'a' THEN 1 ELSE 0 END) FROM items",
      'SELECT COUNT(*), SUM(id) FROM items WHERE id < 0',
      'SELECT id FROM items WHERE id < 0',
      'WITH chosen AS (SELECT id, value FROM items WHERE id > 1) SELECT value FROM chosen ORDER BY id',
      'SELECT x.id FROM (SELECT id FROM items WHERE id > 2) x',
      'SELECT id, ROW_NUMBER() OVER (PARTITION BY 1 ORDER BY id) AS position FROM items',
      'SELECT 42 AS answer',
    ])
      check(db, query);
  } finally {
    db.close();
  }
});

test('unsupported or oversized traces keep final SQL results available', () => {
  const db = new SQL.Database();
  try {
    for (const query of [
      'SELECT 1 INTERSECT SELECT 2',
      'SELECT (SELECT 1)',
      'WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<42) SELECT n FROM nums',
    ]) {
      const final = readResult(db, query);
      const trace = relationalTrace(db, query, final);
      assert.equal(trace.supported, false);
      assert.deepEqual(trace.stages, []);
      assert.ok(trace.reason);
      assert.equal(final.truncated, false);
    }
    assert.equal(
      relationalTrace(db, 'SELECT 1', { truncated: true }).supported,
      false,
    );
  } finally {
    db.close();
  }
});
