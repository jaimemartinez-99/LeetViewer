import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { managerTrace } from './manager-trace.js';
import {
  createProblemDatabase,
  getBaseTables,
  executePipeline,
} from './sql-engine.js';

const ready = initSqlJs({ locateFile: () => wasmUrl });
let db;
let activeProblemId;
self.onmessage = async ({ data }) => {
  const { id, type, problem, sql } = data;
  try {
    const SQL = await ready;
    if (type === 'init') {
      db?.close();
      db = createProblemDatabase(SQL, problem);
      activeProblemId = problem.id;
      self.postMessage({ id, result: getBaseTables(db, problem) });
    } else {
      if (!db) throw new Error('La base de datos todavía no está preparada.');
      const result = executePipeline(db, sql);
      result.animation = managerTrace(db, activeProblemId, sql);
      self.postMessage({ id, result });
    }
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
};
