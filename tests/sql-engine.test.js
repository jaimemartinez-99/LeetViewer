import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import {
  validateQuery,
  intermediateQueries,
  createProblemDatabase,
  getBaseTables,
  executePipeline,
  readResult,
} from '../src/sql-engine.js';

const problems = JSON.parse(
  await readFile(new URL('../src/problems.json', import.meta.url)),
);
const SQL = await initSqlJs();

test('all fixtures initialize and their starter queries execute', () => {
  const expectedCounts = [5, 2, 4, 3, 1, 1, 6];
  problems.forEach((problem, i) => {
    const db = createProblemDatabase(SQL, problem);
    try {
      assert.equal(getBaseTables(db, problem).length, problem.tables.length);
      const output = executePipeline(db, problem.query);
      assert.equal(
        output.final.values.length,
        expectedCounts[i],
        problem.title,
      );
      if ([550, 185].includes(problem.id))
        assert.equal(output.stages.length, 0);
    } finally {
      db.close();
    }
  });
});

test('LEFT JOIN preserves missing identifiers as NULL', () => {
  const db = createProblemDatabase(SQL, problems[0]);
  try {
    assert.deepEqual(executePipeline(db, problems[0].query).final.values, [
      [null, 'Alice'],
      [1, 'Jonathan'],
      [null, 'Bob'],
      [2, 'Meir'],
      [3, 'Winston'],
    ]);
  } finally {
    db.close();
  }
});

test('JOIN, WHERE and GROUP BY produce distinct real stages', () => {
  const problem = problems.find((p) => p.id === 1581);
  const db = createProblemDatabase(SQL, problem);
  try {
    const output = executePipeline(db, problem.query);
    assert.equal(output.stages[0].values.length, 9);
    assert.equal(output.stages[1].values.length, 4);
    assert.deepEqual(output.final.values, [
      [30, 1],
      [54, 2],
      [96, 1],
    ]);
  } finally {
    db.close();
  }
});

test('scanner respects literals, comments, quoted identifiers and semicolons', () => {
  const sql =
    "SELECT 'FROM; WHERE', name AS \"GROUP\" FROM Employees /* WHERE nope */ WHERE name != 'it''s; ORDER' ORDER BY id; -- end";
  const plan = intermediateQueries(validateQuery(sql));
  assert.equal(plan.stages.length, 2);
  assert.match(plan.stages[1].sql, /name != 'it''s; ORDER'$/);
  assert.throws(
    () => validateQuery('SELECT 1; DELETE FROM Employees;'),
    /una sola consulta/,
  );
  assert.throws(() => validateQuery('DELETE FROM Employees'), /SELECT/);
  assert.throws(() => validateQuery(' -- nothing'), /Escribe/);
  assert.throws(() => validateQuery("SELECT 'unfinished"), /sin cerrar/);
});

test('complex SQL executes without inventing intermediate results', () => {
  const db = createProblemDatabase(SQL, problems[0]);
  try {
    for (const query of [
      'SELECT * FROM (SELECT * FROM Employees)',
      'SELECT 1 UNION SELECT 2',
      'WITH x AS (SELECT 1 AS n) SELECT * FROM x',
    ]) {
      const output = executePipeline(db, query);
      assert.equal(output.stages.length, 0);
      assert.ok(output.final.values.length);
    }
    assert.equal(
      executePipeline(db, 'SELECT 42 AS answer').final.values[0][0],
      42,
    );
  } finally {
    db.close();
  }
});

test('read-only database survives invalid and mutating SQL', () => {
  const db = createProblemDatabase(SQL, problems[0]);
  try {
    assert.throws(() => executePipeline(db, 'SELECT missing FROM Employees'));
    assert.throws(
      () => executePipeline(db, 'WITH x AS (SELECT 1) DELETE FROM Employees'),
      /readonly/,
    );
    assert.equal(readResult(db, 'SELECT * FROM Employees').values.length, 5);
  } finally {
    db.close();
  }
});

test('results are bounded and empty results retain column names', () => {
  const db = createProblemDatabase(SQL, problems[0]);
  try {
    const output = executePipeline(
      db,
      'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<250) SELECT x FROM n',
    );
    assert.equal(output.final.values.length, 200);
    assert.equal(output.final.truncated, true);
    assert.deepEqual(readResult(db, 'SELECT name FROM Employees WHERE 0'), {
      columns: ['name'],
      values: [],
      truncated: false,
    });
  } finally {
    db.close();
  }
});
