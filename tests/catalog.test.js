import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import problems, { sections } from '../src/catalog.js';
import { createProblemDatabase, readResult } from '../src/sql-engine.js';
import { executeProblemQuery } from '../src/execute-problem.js';
const SQL = await initSqlJs();
const bag = (rows) => rows.map((row) => JSON.stringify(row)).sort();

test('the catalogue contains exactly the SQL 50 exercise IDs, once each', () => {
  const ids = [
    1757, 584, 595, 1148, 1683, 1378, 1068, 1581, 197, 1661, 577, 1280, 570,
    1934, 620, 1251, 1075, 1633, 1211, 1193, 1174, 550, 2356, 1141, 1070, 596,
    1729, 619, 1045, 1731, 1789, 610, 180, 1164, 1204, 1907, 1978, 626, 1341,
    1321, 602, 585, 185, 1667, 1527, 196, 176, 1484, 1327, 1517,
  ];
  assert.equal(problems.length, 50);
  assert.deepEqual(
    problems.map((p) => p.id).sort((a, b) => a - b),
    [...ids].sort((a, b) => a - b),
  );
  assert.deepEqual(
    sections.flatMap(([, values]) => values),
    ids,
  );
  for (const p of problems) {
    assert.ok(p.description && p.hint && p.section && p.solutionSource);
    assert.match(
      p.sourceUrl,
      /^https:\/\/leetcode.com\/problems\/[a-z0-9-]+\/$/,
    );
    assert.ok(Array.isArray(p.expected));
  }
});

for (const problem of problems)
  test(`verified SQLite solution and animation: ${problem.id}`, () => {
    const db = createProblemDatabase(SQL, problem);
    try {
      const result = executeProblemQuery(SQL, db, problem, problem.query);
      assert.deepEqual(
        bag(result.final.values),
        bag(problem.expected),
        problem.title,
      );
      assert.equal(result.animation?.supported, true, result.animationReason);
      assert.deepEqual(
        result.animation.stages
          .at(-1)
          .tables[0].rows.map((r) => r.cells.map((c) => c.value)),
        result.final.values,
      );
    } finally {
      db.close();
    }
  });

test('DELETE is repeatable, isolated, single-statement and limited to the exercise table', () => {
  const problem = problems.find((p) => p.id === 196);
  const db = createProblemDatabase(SQL, problem);
  try {
    const original = readResult(db, 'SELECT * FROM Person');
    for (let n = 0; n < 2; n++)
      assert.deepEqual(
        executeProblemQuery(SQL, db, problem, problem.query).final.values,
        problem.expected,
      );
    assert.deepEqual(
      executeProblemQuery(SQL, db, problem, 'DELETE FROM Person').final.values,
      [],
    );
    for (const query of [
      'DELETE FROM Person; DELETE FROM Person',
      'DELETE FROM Person; DROP TABLE Person',
      'DELETE FROM missing',
      'UPDATE Person SET email = NULL',
      'DELETE FROM Person RETURNING *',
    ])
      assert.throws(() => executeProblemQuery(SQL, db, problem, query));
    assert.deepEqual(readResult(db, 'SELECT * FROM Person'), original);
    assert.throws(() =>
      executeProblemQuery(
        SQL,
        db,
        { ...problem, mode: undefined },
        'DELETE FROM Person',
      ),
    );
    assert.throws(() => db.run('DELETE FROM Person'));
  } finally {
    db.close();
  }
});

test('reference solutions handle missing ranks, boundaries, ties and exact text matching', () => {
  const cases = [
    [
      176,
      'CREATE TABLE Employee(id INTEGER, salary INTEGER); INSERT INTO Employee VALUES(1,100),(2,100);',
      [[null]],
    ],
    [
      619,
      'CREATE TABLE MyNumbers(num INTEGER); INSERT INTO MyNumbers VALUES(1),(1),(2),(2);',
      [[null]],
    ],
    [
      1907,
      'CREATE TABLE Accounts(account_id INTEGER, income INTEGER); INSERT INTO Accounts VALUES(1,19999),(2,20000),(3,50000),(4,50001);',
      [
        ['Low Salary', 1],
        ['Average Salary', 2],
        ['High Salary', 1],
      ],
    ],
    [
      1907,
      'CREATE TABLE Accounts(account_id INTEGER, income INTEGER);',
      [
        ['Low Salary', 0],
        ['Average Salary', 0],
        ['High Salary', 0],
      ],
    ],
    [
      1517,
      "CREATE TABLE Users(user_id INTEGER, name TEXT, mail TEXT); INSERT INTO Users VALUES(1,'A','A_1.z-@leetcode.com'),(2,'B','1b@leetcode.com'),(3,'C','c@leetcode.com' || char(10)),(4,'D','d@@leetcode.com'),(5,'E','e@LEETCODE.COM'),(6,'F','é@leetcode.com');",
      [[1, 'A', 'A_1.z-@leetcode.com']],
    ],
    [
      1484,
      "CREATE TABLE Activities(sell_date TEXT, product TEXT); INSERT INTO Activities VALUES('2020-01-01','Z'),('2020-01-01','A'),('2020-01-01','AB'),('2020-01-01','A');",
      [['2020-01-01', 3, 'A,AB,Z']],
    ],
    [
      1341,
      "CREATE TABLE Movies(movie_id INTEGER, title TEXT); CREATE TABLE Users(user_id INTEGER, name TEXT); CREATE TABLE MovieRating(movie_id INTEGER, user_id INTEGER, rating INTEGER, created_at TEXT); INSERT INTO Movies VALUES(1,'Ada'),(2,'Zed'); INSERT INTO Users VALUES(1,'Ada'),(2,'Zed'); INSERT INTO MovieRating VALUES(1,1,4,'2020-02-01'),(2,1,4,'2020-02-29'),(1,2,4,'2020-02-02'),(2,2,4,'2020-02-03');",
      [['Ada'], ['Ada']],
    ],
  ];
  for (const [id, setup, expected] of cases) {
    const problem = { ...problems.find((p) => p.id === id), setup };
    const db = createProblemDatabase(SQL, problem);
    try {
      const result = executeProblemQuery(SQL, db, problem, problem.query);
      assert.deepEqual(
        bag(result.final.values),
        bag(expected),
        `Problem ${String(id)}`,
      );
      assert.equal(
        result.animation?.supported,
        true,
        `${String(id)}: ${result.animationReason}`,
      );
    } finally {
      db.close();
    }
  }
});

test('UNION ALL preserves duplicates and UNION removes them with verifiable cells', () => {
  const problem = problems[0];
  const db = createProblemDatabase(SQL, problem);
  try {
    for (const [query, expected] of [
      ['SELECT 1 AS n UNION ALL SELECT 1 UNION ALL SELECT 2', [[1], [1], [2]]],
      ['SELECT 1 AS n UNION SELECT 1 UNION SELECT 2', [[1], [2]]],
      ['SELECT NULL AS n UNION SELECT NULL', [[null]]],
      ['SELECT 1 AS n UNION SELECT 1 UNION ALL SELECT 1', [[1], [1]]],
    ]) {
      const result = executeProblemQuery(SQL, db, problem, query);
      assert.deepEqual(result.final.values, expected);
      assert.equal(result.animation?.supported, true, result.animationReason);
      const output = result.animation.stages.at(-1).tables[0];
      assert.deepEqual(
        output.rows.map((r) => r.cells.map((c) => c.value)),
        expected,
      );
      assert.ok(
        output.rows.every((r) => r.cells.every((c) => c.origins.length > 0)),
      );
    }
  } finally {
    db.close();
  }
});
