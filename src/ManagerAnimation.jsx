/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role -- The scrollable diagram needs keyboard focus; inline SVG needs its image role and accessible description. */
import { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  MoveRight,
} from 'lucide-react';
import './manager-animation.css';

const stages = [
  'Tablas y columnas',
  'Conectar las claves',
  'Construir el JOIN',
  'Agrupar las filas',
  'Filtrar los grupos',
  'Elegir la columna',
];
const rowY = (i) => 133 + i * 32;
const initial = {
  managerName: [26, 132],
  department: [158, 125],
  managerId: [283, 78],
  reportsTo: [630, 118],
  employeeName: [748, 132],
  employeeDepartment: [880, 130],
};
const joinedColumns = {
  managerId: [160, 110],
  managerName: [270, 190],
  reportsTo: [460, 180],
  employeeName: [640, 205],
};

function Cell({ x, y, width, value, tone = '', opacity = 1, header = false }) {
  return (
    <g
      className={`motion-cell ${tone} ${header ? 'cell-header' : ''}`}
      style={{ transform: `translate(${x}px, ${y}px)`, opacity }}
    >
      <rect width={width - 3} height={30} rx={4} />
      <text x={11} y={20}>
        {value === null ? 'NULL' : value}
      </text>
    </g>
  );
}

export default function ManagerAnimation({ trace, stale }) {
  const [reduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const [speed, setSpeed] = useState(1);
  const [selectedGroup, setSelectedGroup] = useState(trace.groups[0]?.id);
  const container = useRef(null);
  const { employees, matches, groups, threshold } = trace;
  const passing = groups.filter((g) => g.passes);
  const selected = groups.find((g) => g.id === selectedGroup);
  const phaseSql = [
    'FROM Employee AS m\nJOIN Employee AS e',
    'ON e.managerId = m.id',
    'FROM Employee AS m\nJOIN Employee AS e ON e.managerId = m.id',
    'GROUP BY m.id, m.name\nCOUNT(*)',
    `HAVING COUNT(*) >= ${threshold}`,
    'SELECT m.name',
  ][phase];
  const descriptions = [
    'Una sola tabla, dos papeles: m representa al responsable y e a quien reporta. Amarillo identifica las claves; verde sigue la columna que SELECT devolverá. Los nombres de los reportes ayudan a seguir cada fila.',
    `La clave m.id se compara con e.managerId. ${selected ? `${selected.name} tiene ${selected.count} coincidencias: cada línea creará una fila del JOIN.` : 'Solo se unen las claves que coinciden.'}`,
    `Cada coincidencia crea una fila nueva: las celdas del responsable se repiten junto a las de cada reporte. Se obtienen ${matches.length} filas; las filas sin coincidencia no pasan al INNER JOIN.`,
    `Las filas con el mismo m.id y m.name se reúnen en ${groups.length} grupos. COUNT(*) cuenta filas del JOIN, no departamentos ni nombres distintos.`,
    `Se evalúa COUNT(*) >= ${threshold} en cada grupo. Pasan ${passing.length} de ${groups.length} grupos; los demás se descartan completos.`,
    'SELECT conserva únicamente m.name, una vez por grupo que ha superado HAVING. Las claves y el contador han servido para calcular el resultado, pero no se devuelven.',
  ][phase];

  useEffect(() => {
    container.current?.scrollIntoView({
      behavior: reduced ? 'instant' : 'smooth',
      block: 'start',
    });
  }, [reduced]);
  useEffect(() => {
    if (!playing || stale) return;
    const timer = setTimeout(() => {
      if (phase === stages.length - 1) setPlaying(false);
      else setPhase((p) => p + 1);
    }, 3600 / speed);
    return () => clearTimeout(timer);
  }, [phase, playing, speed, stale]);

  function go(next) {
    setPlaying(false);
    setPhase(next);
  }
  const groupY = (id) => {
    let y = 130;
    for (const g of groups) {
      if (g.id === id) return y;
      y += g.count * 32 + 60;
    }
    return y;
  };
  const height = Math.max(
    490,
    150 + employees.length * 32,
    150 + matches.length * 32 + groups.length * 60,
  );
  const sourceVisible = phase < 2;

  return (
    <section
      className="manager-animation"
      ref={container}
      aria-label="Animación del JOIN y la agrupación"
    >
      <div className="animation-title">
        <div>
          <span className="animation-eyebrow">SQL EN MOVIMIENTO</span>
          <h3>De empleados a responsables</h3>
        </div>
        <span className="animation-counter">
          {phase + 1} / {stages.length}
        </span>
      </div>
      <div className="animation-timeline" aria-label="Etapas de la animación">
        {stages.map((name, index) => (
          <button
            key={name}
            aria-current={phase === index ? 'step' : undefined}
            className={
              phase === index ? 'current' : phase > index ? 'done' : ''
            }
            onClick={() => go(index)}
          >
            <span>{index + 1}</span>
            {name}
          </button>
        ))}
      </div>
      <div className="animation-explanation">
        <pre>{phaseSql}</pre>
        <p aria-live="polite">{descriptions}</p>
      </div>
      <div className="animation-legend">
        <span className="legend-key">Clave de unión / agrupación</span>
        <span className="legend-name">Columna de salida</span>
        <span className="legend-report">Datos del reporte</span>
        <span className="legend-unused">Columna no utilizada</span>
      </div>
      {phase === 1 && (
        <div
          className="match-picker"
          aria-label="Responsable cuyas coincidencias se muestran"
        >
          {groups.map((g) => (
            <button
              key={g.id}
              aria-pressed={selectedGroup === g.id}
              onClick={() => {
                setSelectedGroup(g.id);
                setPlaying(false);
              }}
            >
              {g.name}
              <span>{g.count} coincidencias</span>
            </button>
          ))}
        </div>
      )}
      {/* This scroll region needs keyboard focus on narrow screens. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div
        className="animation-scroll"
        tabIndex={0}
        aria-label="Diagrama SQL; desplaza horizontalmente en pantallas pequeñas"
      >
        <svg
          className="sql-motion-board"
          viewBox={`0 0 1040 ${height}`}
          role="img"
          aria-labelledby="motion-title motion-description"
        >
          <title id="motion-title">{stages[phase]}</title>
          <desc id="motion-description">
            {descriptions}{' '}
            {groups
              .map(
                (g) =>
                  `${g.name}: ${g.count} reportes${phase >= 4 ? (g.passes ? ', grupo conservado' : ', grupo descartado') : ''}.`,
              )
              .join(' ')}
          </desc>
          <g
            className="motion-layer"
            style={{ opacity: sourceVisible ? 1 : 0 }}
          >
            <text className="board-caption" x={26} y={51}>
              Employee <tspan className="svg-name">AS m</tspan>
            </text>
            <text className="board-caption" x={630} y={51}>
              Employee <tspan className="svg-report">AS e</tspan>
            </text>
            <text className="board-subcaption" x={26} y={74}>
              Posibles responsables
            </text>
            <text className="board-subcaption" x={630} y={74}>
              Posibles reportes · misma tabla
            </text>
          </g>
          {groups.flatMap((group) =>
            matches
              .filter((m) => m.managerId === group.id)
              .map((m) => {
                const a = employees.findIndex((e) => e.id === group.id),
                  b = employees.findIndex((e) => e.id === m.employeeId);
                return (
                  <path
                    key={`${group.id}-${m.employeeId}`}
                    className="join-connector"
                    d={`M 361 ${rowY(a) + 15} C 490 ${rowY(a) + 15}, 500 ${rowY(b) + 15}, 629 ${rowY(b) + 15}`}
                    style={{
                      opacity:
                        phase === 1 && group.id === selectedGroup ? 1 : 0,
                      strokeDashoffset:
                        phase === 1 && group.id === selectedGroup ? 0 : 700,
                    }}
                  />
                );
              }),
          )}
          {sourceVisible && phase === 1 && (
            <g>
              <rect
                x={412}
                y={38}
                width={170}
                height={43}
                rx={8}
                fill="#29291b"
                stroke="#8c7741"
              />
              <text className="svg-equation" x={497} y={64} textAnchor="middle">
                m.id = e.managerId
              </text>
            </g>
          )}
          {Object.entries(initial).map(([field, [x, width]]) => (
            <Cell
              key={`source-header-${field}`}
              x={x}
              y={99}
              width={width}
              value={
                {
                  managerName: 'm.name',
                  department: 'department',
                  managerId: 'm.id',
                  reportsTo: 'e.managerId',
                  employeeName: 'e.name',
                  employeeDepartment: 'department',
                }[field]
              }
              opacity={sourceVisible ? 1 : 0}
              tone={
                field === 'managerName'
                  ? 'name'
                  : ['managerId', 'reportsTo'].includes(field)
                    ? 'key'
                    : field === 'employeeName'
                      ? 'report'
                      : 'unused'
              }
              header
            />
          ))}
          {employees.flatMap((employee, i) =>
            Object.entries(initial).map(([field, [x, width]]) => {
              const value = {
                managerName: employee.name,
                department: employee.department,
                managerId: employee.id,
                reportsTo: employee.managerId,
                employeeName: employee.name,
                employeeDepartment: employee.department,
              }[field];
              const highlighted =
                phase === 1 &&
                (['managerName', 'managerId'].includes(field)
                  ? employee.id === selectedGroup
                  : ['reportsTo', 'employeeName'].includes(field) &&
                    employee.managerId === selectedGroup);
              return (
                <Cell
                  key={`source-${employee.id}-${field}`}
                  x={x}
                  y={rowY(i)}
                  width={width}
                  value={value}
                  opacity={
                    !sourceVisible ? 0 : phase === 1 && !highlighted ? 0.25 : 1
                  }
                  tone={
                    field === 'managerName'
                      ? 'name'
                      : ['managerId', 'reportsTo'].includes(field)
                        ? 'key'
                        : field === 'employeeName'
                          ? 'report'
                          : 'unused'
                  }
                />
              );
            }),
          )}
          <g className="motion-layer" style={{ opacity: phase >= 2 ? 1 : 0 }}>
            <text className="board-caption" x={phase === 5 ? 410 : 160} y={51}>
              {phase === 5
                ? 'Resultado final'
                : phase === 2
                  ? `${matches.length} coincidencias → ${matches.length} filas`
                  : `${groups.length} grupos por responsable`}
            </text>
            <text
              className="board-subcaption"
              x={phase === 5 ? 410 : 160}
              y={74}
            >
              {phase === 5
                ? `${passing.length} fila${passing.length === 1 ? '' : 's'} · solo la columna solicitada`
                : 'Cada fila conserva su origen durante el movimiento'}
            </text>
          </g>
          {Object.entries(joinedColumns).map(([field, [x, width]]) => (
            <Cell
              key={`join-header-${field}`}
              x={phase === 5 && field === 'managerName' ? 410 : x}
              y={phase >= 3 && phase < 5 ? 91 : 99}
              width={phase === 5 && field === 'managerName' ? 220 : width}
              value={
                phase === 5 && field === 'managerName'
                  ? 'name'
                  : {
                      managerId: 'm.id',
                      managerName: 'm.name',
                      reportsTo: 'e.managerId',
                      employeeName: 'e.name',
                    }[field]
              }
              opacity={
                phase < 2 || (phase === 5 && field !== 'managerName') ? 0 : 1
              }
              tone={
                field === 'managerName'
                  ? 'name'
                  : field === 'employeeName'
                    ? 'report'
                    : 'key'
              }
              header
            />
          ))}
          {groups.map((g) => (
            <g
              key={`bucket-${g.id}`}
              className="motion-layer"
              style={{
                opacity:
                  phase >= 3 && phase < 5
                    ? phase === 4 && !g.passes
                      ? 0.4
                      : 1
                    : 0,
                transform: `translate(${phase === 4 && !g.passes ? 40 : 0}px, 0px)`,
              }}
            >
              <rect
                className={`group-bucket ${phase === 4 && !g.passes ? 'rejected' : ''}`}
                x={145}
                y={groupY(g.id)}
                width={730}
                height={g.count * 32 + 40}
                rx={9}
              />
              <text className="group-caption" x={160} y={groupY(g.id) + 24}>
                {g.name} · m.id = {g.id}
              </text>
              <text
                className={
                  phase === 4 && !g.passes ? 'svg-rejected' : 'svg-name'
                }
                x={864}
                y={groupY(g.id) + 24}
                textAnchor="end"
              >
                COUNT(*) = {g.count}
                {phase === 4 ? (g.passes ? ' · PASA' : ' · DESCARTADO') : ''}
              </text>
            </g>
          ))}
          {matches.flatMap((match, i) =>
            Object.entries(joinedColumns).map(([field, [x, width]]) => {
              const managerIndex = employees.findIndex(
                  (e) => e.id === match.managerId,
                ),
                employeeIndex = employees.findIndex(
                  (e) => e.id === match.employeeId,
                );
              const g = groups.find((group) => group.id === match.managerId);
              const inGroup = matches
                .filter((m) => m.managerId === match.managerId)
                .findIndex((m) => m.employeeId === match.employeeId);
              const projected =
                phase === 5 &&
                field === 'managerName' &&
                inGroup === 0 &&
                g.passes;
              const from = initial[field];
              const targetX =
                phase < 2
                  ? from[0]
                  : projected
                    ? 410
                    : x + (phase >= 4 && !g.passes ? 40 : 0);
              const targetY =
                phase < 2
                  ? rowY(
                      field.startsWith('manager')
                        ? managerIndex
                        : employeeIndex,
                    )
                  : projected
                    ? rowY(passing.findIndex((p) => p.id === g.id))
                    : phase >= 3
                      ? groupY(g.id) + 34 + inGroup * 32
                      : rowY(i);
              return (
                <Cell
                  key={`match-${match.managerId}-${match.employeeId}-${field}`}
                  x={targetX}
                  y={targetY}
                  width={phase < 2 ? from[1] : projected ? 220 : width}
                  value={match[field]}
                  tone={
                    field === 'managerName'
                      ? 'name'
                      : field === 'employeeName'
                        ? 'report'
                        : 'key'
                  }
                  opacity={
                    phase < 2
                      ? 0
                      : phase === 5
                        ? projected
                          ? 1
                          : 0
                        : phase === 4 && !g.passes
                          ? 0.15
                          : 1
                  }
                />
              );
            }),
          )}
          {phase === 5 && passing.length === 0 && (
            <text
              className="board-subcaption"
              x={520}
              y={165}
              textAnchor="middle"
            >
              Ningún grupo cumple la condición.
            </text>
          )}
          <text className="board-footnote" x={26} y={height - 20}>
            {phase < 2
              ? 'Las dos copias contienen exactamente los mismos empleados.'
              : phase === 5
                ? 'Las demás columnas se han retirado de la salida.'
                : 'm.name mantiene el color verde desde su tabla de origen hasta el resultado.'}
          </text>
        </svg>
      </div>
      <div className="animation-controls">
        <div>
          <button
            className="icon-button"
            aria-label="Reiniciar animación"
            onClick={() => go(0)}
          >
            <RotateCcw size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Paso anterior"
            disabled={phase === 0}
            onClick={() => go(phase - 1)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="animation-play"
            disabled={stale}
            onClick={() => {
              if (phase === 5) setPhase(0);
              setPlaying(!playing);
            }}
          >
            {playing && !stale ? <Pause size={16} /> : <Play size={16} />}{' '}
            {playing && !stale
              ? 'Pausar'
              : phase === 5
                ? 'Repetir'
                : 'Reproducir'}
          </button>
          <button
            className="icon-button"
            aria-label="Paso siguiente"
            disabled={phase === 5}
            onClick={() => go(phase + 1)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <label>
          Velocidad
          <select
            aria-label="Velocidad de reproducción"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={0.5}>0,5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
      </div>
      <div className="animation-summary">
        <MoveRight size={15} />
        <span>
          {employees.length} empleados → {matches.length} filas del JOIN →{' '}
          {groups.length} grupos → {passing.length} fila
          {passing.length === 1 ? '' : 's'} de salida
        </span>
      </div>
    </section>
  );
}
