import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { createProblemDatabase, executePipeline } from '../src/sql-engine.js';
import { managerTrace } from '../src/manager-trace.js';

const problems = JSON.parse(
  await readFile(new URL('../src/problems.json', import.meta.url)),
);
const problem = problems.find((p) => p.id === 570);
const SQL = await initSqlJs();

test('animation provenance comes from SQLite and represents JOIN, GROUP BY and HAVING', () => {
  const db = createProblemDatabase(SQL, problem);
  try {
    const trace = managerTrace(db, problem.id, problem.query);
    assert.equal(trace.employees.length, 9);
    assert.equal(trace.matches.length, 7);
    assert.deepEqual(trace.groups, [
      { id: 101, name: 'John', count: 5, passes: true },
      { id: 107, name: 'Sara', count: 2, passes: false },
    ]);
    for (const row of trace.matches) {
      assert.equal(row.managerId, row.reportsTo);
      assert.equal(
        trace.employees.find((e) => e.id === row.employeeId).managerId,
        row.managerId,
      );
      assert.equal(
        trace.employees.find((e) => e.id === row.managerId).name,
        row.managerName,
      );
    }
    assert.deepEqual(
      trace.groups.filter((g) => g.passes).map((g) => [g.name]),
      executePipeline(db, problem.query).final.values,
    );
  } finally {
    db.close();
  }
});

test('edited HAVING thresholds animate the submitted SQL, including empty output', () => {
  const db = createProblemDatabase(SQL, problem);
  try {
    for (const threshold of [0, 2, 5, 6, 10]) {
      const query = problem.query.replace('>= 5', `>= ${threshold}`);
      const trace = managerTrace(db, 570, query);
      assert.equal(trace.threshold, threshold);
      assert.deepEqual(
        trace.groups.filter((g) => g.passes).map((g) => [g.name]),
        executePipeline(db, query).final.values,
      );
    }
  } finally {
    db.close();
  }
});

test('formatting is accepted but unrelated SQL never receives this animation', () => {
  const db = createProblemDatabase(SQL, problem);
  try {
    assert.ok(
      managerTrace(
        db,
        570,
        `-- explanation\n${problem.query.toLowerCase()} -- end`,
      ),
    );
    assert.equal(
      managerTrace(
        db,
        570,
        problem.query.replace('SELECT m.name', 'SELECT m.id'),
      ),
      null,
    );
    assert.equal(
      managerTrace(db, 570, problem.query.replace('>= 5', '< 5')),
      null,
    );
    assert.equal(
      managerTrace(
        db,
        570,
        problem.query.replace('JOIN Employee', 'LEFT JOIN Employee'),
      ),
      null,
    );
    assert.equal(managerTrace(db, 185, problem.query), null);
  } finally {
    db.close();
  }
});
