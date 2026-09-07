import original from './problems.json' with { type: 'json' };
import extra from './sql50-extra.js';

export const sections = [
  ['Selección', [1757, 584, 595, 1148, 1683]],
  ['Uniones básicas', [1378, 1068, 1581, 197, 1661, 577, 1280, 570, 1934]],
  ['Agregaciones básicas', [620, 1251, 1075, 1633, 1211, 1193, 1174, 550]],
  ['Ordenación y agrupación', [2356, 1141, 1070, 596, 1729, 619, 1045]],
  ['Selección y uniones avanzadas', [1731, 1789, 610, 180, 1164, 1204, 1907]],
  ['Subconsultas', [1978, 626, 1341, 1321, 602, 585, 185]],
  ['Texto y expresiones regulares', [1667, 1527, 196, 176, 1484, 1327, 1517]],
];
const originalMetadata = {
  1378: [
    'replace-employee-id-with-the-unique-identifier',
    [
      [null, 'Alice'],
      [1, 'Jonathan'],
      [null, 'Bob'],
      [2, 'Meir'],
      [3, 'Winston'],
    ],
  ],
  1757: ['recyclable-and-low-fat-products', [[1], [3]]],
  584: ['find-customer-referee', [['Will'], ['Jane'], ['Bill'], ['Zack']]],
  1581: [
    'customer-who-visited-but-did-not-make-any-transactions',
    [
      [30, 1],
      [54, 2],
      [96, 1],
    ],
  ],
  570: ['managers-with-at-least-5-direct-reports', [['John']]],
  550: ['game-play-analysis-iv', [[0.33]]],
  185: [
    'department-top-three-salaries',
    [
      ['IT', 'Max', 90000],
      ['IT', 'Joe', 85000],
      ['IT', 'Randy', 85000],
      ['IT', 'Will', 70000],
      ['Sales', 'Henry', 80000],
      ['Sales', 'Sam', 60000],
    ],
  ],
};
// Preserve existing fixture order for callers; navigation uses the plan sections.
export default [...original, ...extra].map((problem) => {
  const [slug, expected] = originalMetadata[problem.id] || [
    problem.slug,
    problem.expected,
  ];
  return {
    ...problem,
    slug,
    expected,
    section: sections.find(([, ids]) => ids.includes(problem.id))[0],
    sourceUrl: `https://leetcode.com/problems/${slug}/`,
    solutionSource: 'Solución de referencia propia · SQLite',
  };
});
