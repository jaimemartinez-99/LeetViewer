import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { executeProblemQuery } from './execute-problem.js';
import { createProblemDatabase, getBaseTables } from './sql-engine.js';

const ready = initSqlJs({ locateFile: () => wasmUrl });
let db;
let activeProblem;
self.onmessage = async ({ data }) => {
  const { id, type, problem, sql } = data;
  try {
    const SQL = await ready;
    if (type === 'init') {
      db?.close();
      db = createProblemDatabase(SQL, problem);
      activeProblem = problem;
      self.postMessage({ id, result: getBaseTables(db, problem) });
    } else {
      if (!db) throw new Error('La base de datos todavía no está preparada.');
      const result = executeProblemQuery(SQL, db, activeProblem, sql);
      self.postMessage({ id, result });
    }
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
};
