import sqlite from 'node-sql-parser/build/sqlite.js';
import { readFile } from 'node:fs/promises';
const parser = new sqlite.Parser();
const problems = JSON.parse(await readFile(new URL('../src/problems.json', import.meta.url)));
for (const p of problems) {
  try {
    const ast = parser.astify(p.query, { database: 'sqlite' });
    console.log(p.id, parser.sqlify(ast, {database:'sqlite'}));
    if ([550,185,570].includes(p.id)) console.log(JSON.stringify(ast));
  } catch(e) { console.log(p.id, 'FAIL', e.message); }
}
