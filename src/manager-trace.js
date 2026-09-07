import { readResult, tokenize, validateQuery } from './sql-engine.js';

// A deliberately bounded teaching scene. Never animate a different query as if
// it were the submitted SQL. Whitespace, comments, casing and the threshold may vary.
export function managerTrace(db, problemId, source) {
  if (problemId !== 570) return null;
  const sql = validateQuery(source);
  const signature = tokenize(sql)
    .map((t) => t.word || sql.slice(t.start, t.end))
    .join('');
  const match = signature.match(
    /^SELECTM\.NAMEFROMEMPLOYEEASMJOINEMPLOYEEASEONE\.MANAGERID=M\.IDGROUPBYM\.ID,M\.NAMEHAVINGCOUNT\(\*\)>=([0-9]+)$/,
  );
  if (!match) return null;
  const threshold = Number(match[1]);
  if (!Number.isSafeInteger(threshold)) return null;
  const employees = readResult(
    db,
    'SELECT id, name, department, managerId FROM Employee ORDER BY id',
  ).values.map(([id, name, department, managerId]) => ({
    id,
    name,
    department,
    managerId,
  }));
  const relation =
    'FROM Employee AS m JOIN Employee AS e ON e.managerId = m.id';
  const joined = readResult(
    db,
    `SELECT m.id, m.name, e.id, e.name, e.managerId ${relation} ORDER BY e.name, e.id`,
  );
  const grouped = readResult(
    db,
    `SELECT m.id, m.name, COUNT(*) ${relation} GROUP BY m.id, m.name ORDER BY m.id`,
  );
  const passed = readResult(
    db,
    `SELECT m.id ${relation} GROUP BY m.id, m.name HAVING COUNT(*) >= ${threshold}`,
  );
  if (
    employees.length > 12 ||
    joined.truncated ||
    grouped.truncated ||
    passed.truncated
  )
    return null;
  const matches = joined.values.map(
    ([managerId, managerName, employeeId, employeeName, reportsTo]) => ({
      managerId,
      managerName,
      employeeId,
      employeeName,
      reportsTo,
    }),
  );
  if (matches.length > 12) return null;
  const groups = grouped.values.map(([id, name, count]) => ({
    id,
    name,
    count,
    passes: passed.values.some(([passedId]) => passedId === id),
  }));
  return { employees, matches, groups, threshold };
}
