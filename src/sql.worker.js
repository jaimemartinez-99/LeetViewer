import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import {
  createProblemDatabase,
  getBaseTables,
  executePipeline,
} from './sql-engine.js';

const ready = initSqlJs({ locateFile: () => wasmUrl });
let db;
self.onmessage = async ({ data }) => {
  const { id, type, problem, sql } = data;
  try {
    const SQL = await ready;
    if (type === 'init') {
      db?.close();
      db = createProblemDatabase(SQL, problem);
      self.postMessage({ id, result: getBaseTables(db, problem) });
    } else {
      if (!db) throw new Error('La base de datos todavía no está preparada.');
      self.postMessage({ id, result: executePipeline(db, sql) });
    }
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
};
