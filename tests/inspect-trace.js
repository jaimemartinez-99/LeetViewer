import initSqlJs from 'sql.js';
import {readFile} from 'node:fs/promises';
import {createProblemDatabase,executePipeline} from '../src/sql-engine.js';
import {relationalTrace} from '../src/relational-trace.js';
const SQL=await initSqlJs();
const problems=JSON.parse(await readFile(new URL('../src/problems.json',import.meta.url)));
for(const p of problems){
 const db=createProblemDatabase(SQL,p);
 const result=relationalTrace(db,p.query,executePipeline(db,p.query).final);
 console.log(p.id,result.supported,result.diagnostic||result.stages.map(s=>s.op+':'+s.tables.map(t=>t.rows.length).join('+')).join(' → '));
 if(result.supported) console.log(JSON.stringify(result.stages.at(-1).tables[0].rows.map(r=>r.cells.map(c=>c.value))));
 db.close();
}
