/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role -- Keyboard-scrollable inline SVG with an accessible image description. */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import './sql-animation.css';

const short = (value, length = 23) => {
  const text = value === null ? 'NULL' : String(value);
  return text.length > length ? text.slice(0, length - 1) + '…' : text;
};
const opNames = {
  from: 'FROM',
  match: 'ON',
  join: 'JOIN',
  where: 'WHERE',
  calculate: 'Expresión',
  group: 'GROUP BY',
  aggregate: 'Agregación',
  having: 'HAVING',
  partition: 'PARTITION',
  window: 'Ventana',
  select: 'SELECT',
  distinct: 'DISTINCT',
  order: 'ORDER BY',
  limit: 'LIMIT',
  cte: 'CTE',
  branches: 'Ramas',
  union: 'UNION',
  delete: 'DELETE',
};

export function layoutStage(stage) {
  const cells = new Map(),
    headers = [],
    tables = [],
    groups = [];
  let x = 28,
    height = 320;
  for (const [ti, table] of stage.tables.entries()) {
    const widths = table.columns.map((col) =>
      Math.max(106, Math.min(188, String(col.label).length * 7 + 24)),
    );
    const width = Math.max(
      220,
      widths.reduce((sum, n) => sum + n, 0),
    );
    let y = 110,
      lastGroup;
    const starts = new Map();
    table.columns.forEach((col, c) =>
      headers.push({
        id: `${ti}:${col.key}`,
        key: col.key,
        label: col.label,
        x: x + widths.slice(0, c).reduce((sum, w) => sum + w, 0),
        y: 72,
        width: widths[c],
        role: col.role,
      }),
    );
    for (const row of table.rows) {
      if (row.group && row.group !== lastGroup) {
        if (lastGroup) y += 14;
        starts.set(row.group, y);
        y += 34;
        lastGroup = row.group;
      }
      let cx = x;
      row.cells.forEach((cell, c) => {
        cells.set(cell.id, {
          ...cell,
          x: cx,
          y,
          width: widths[c],
          role: table.columns[c].role,
          label: table.columns[c].label,
        });
        cx += widths[c];
      });
      y += 34;
    }
    for (const group of table.groups || []) {
      const start = starts.get(group.id);
      if (start !== undefined)
        groups.push({
          ...group,
          x: x - 8,
          y: start,
          width: width + 16,
          height: 34 + group.count * 34 + 5,
        });
    }
    tables.push({
      title: table.title,
      x,
      width,
      rows: table.rows.length,
      empty: !table.rows.length,
    });
    height = Math.max(height, y + 45);
    x += width + 90;
  }
  return {
    cells,
    headers,
    tables,
    groups,
    width: Math.max(940, x - 62),
    height,
  };
}

function Sprite({ cell, from, retiring = false, trail = false, delay = 0 }) {
  const sx = from?.x ?? cell.x,
    sy = from?.y ?? cell.y;
  return (
    <g
      className={`trace-cell ${cell.role || 'source'} ${cell.value === null ? 'null-value' : ''} ${retiring ? 'retiring' : trail ? 'merging' : 'arriving'}`}
      style={{
        '--sx': `${sx}px`,
        '--sy': `${sy}px`,
        '--tx': `${cell.x + (retiring ? 65 : 0)}px`,
        '--ty': `${cell.y}px`,
        '--start-opacity': from ? 1 : 0,
        animationDelay: `${delay}ms`,
      }}
    >
      <title>
        {cell.label}: {cell.value === null ? 'NULL' : String(cell.value)}
      </title>
      <rect width={cell.width - 3} height={31} rx={4} />
      <text x={10} y={21}>
        {short(cell.value, Math.floor((cell.width - 20) / 7.6))}
      </text>
    </g>
  );
}

function Board({ stage, previous }) {
  const target = useMemo(() => layoutStage(stage), [stage]);
  const start = useMemo(
    () =>
      previous ? layoutStage(previous) : { cells: new Map(), headers: [] },
    [previous],
  );
  const used = new Set();
  const sprites = [];
  const trails = [];
  for (const cell of target.cells.values()) {
    const sources = [...new Set([cell.id, ...cell.origins])]
      .map((id) => start.cells.get(id))
      .filter(Boolean);
    let origin = sources[0];
    if (!origin)
      origin = [...start.cells.values()].find((c) =>
        c.origins.includes(cell.id),
      );
    sources.forEach((s) => used.add(s.id));
    if (origin) used.add(origin.id);
    sprites.push(<Sprite key={cell.id} cell={cell} from={origin} />);
    if (
      ['aggregate', 'window', 'calculate', 'select', 'distinct'].includes(
        stage.op,
      )
    ) {
      for (const [i, source] of sources.slice(1, 25).entries())
        trails.push(
          <Sprite
            key={`${cell.id}:trail:${source.id}`}
            cell={{ ...source, x: cell.x, y: cell.y, width: cell.width }}
            from={source}
            trail
            delay={Math.min(i * 16, 180)}
          />,
        );
    }
  }
  const retiring = [...start.cells.values()].filter(
    (c) => !used.has(c.id) && !target.cells.has(c.id),
  );
  const height = Math.max(
    target.height,
    previous ? layoutStage(previous).height : 0,
  );
  const width = Math.max(
    target.width,
    previous ? layoutStage(previous).width : 0,
  );
  return (
    <div
      className="trace-scroll"
      tabIndex={0}
      aria-label="Diagrama de celdas; se puede desplazar horizontalmente"
    >
      <svg
        className="trace-board"
        viewBox={`0 0 ${width} ${height}`}
        style={{ minWidth: `${width}px` }}
        role="img"
        aria-labelledby="trace-svg-title trace-svg-desc"
      >
        <title id="trace-svg-title">{stage.title}</title>
        <desc id="trace-svg-desc">
          {stage.note}{' '}
          {stage.tables
            .map(
              (t) =>
                `${t.title}: ${t.rows.length} filas, columnas ${t.columns.map((c) => c.label).join(', ')}.`,
            )
            .join(' ')}
        </desc>
        {target.groups.map((g) => (
          <g key={g.id}>
            <rect
              className="trace-group"
              x={g.x}
              y={g.y}
              width={g.width}
              height={g.height}
              rx={8}
            />
            <text className="trace-group-label" x={g.x + 12} y={g.y + 22}>
              {short(g.label, Math.floor((g.width - 125) / 7))}
            </text>
            <text
              className="trace-group-count"
              x={g.x + g.width - 12}
              y={g.y + 22}
              textAnchor="end"
            >
              {g.count} filas
            </text>
          </g>
        ))}
        {(stage.links || []).map((link, i) => {
          const a = target.cells.get(link.from),
            b = target.cells.get(link.to);
          if (!a || !b) return null;
          return (
            <path
              className="trace-link"
              key={i}
              d={`M${a.x + a.width - 3},${a.y + 16} C${a.x + a.width + 40},${a.y + 16} ${b.x - 40},${b.y + 16} ${b.x},${b.y + 16}`}
            />
          );
        })}
        {target.tables.map((table, i) => (
          <g key={i}>
            <text className="trace-table-title" x={table.x} y={32}>
              {short(table.title, 50)}
            </text>
            <text className="trace-table-count" x={table.x} y={53}>
              {table.rows} filas
            </text>
            {table.empty && (
              <text className="trace-table-count" x={table.x} y={141}>
                No hay filas en esta etapa.
              </text>
            )}
          </g>
        ))}
        {target.headers.map((header) => {
          const old = start.headers.find((h) => h.key === header.key);
          return (
            <g
              key={header.id}
              className={`trace-header ${header.role}`}
              style={{
                '--sx': `${old?.x ?? header.x}px`,
                '--sy': `${old?.y ?? header.y}px`,
                '--tx': `${header.x}px`,
                '--ty': `${header.y}px`,
                '--start-opacity': old ? 1 : 0,
              }}
            >
              <title>{header.label}</title>
              <rect width={header.width - 3} height={31} rx={4} />
              <text x={10} y={21}>
                {short(header.label, Math.floor((header.width - 20) / 7.6))}
              </text>
            </g>
          );
        })}
        {retiring.map((cell) => (
          <Sprite key={`retire:${cell.id}`} cell={cell} from={cell} retiring />
        ))}
        {sprites}
        {trails}
      </svg>
    </div>
  );
}

export default function SQLAnimation({ trace, stale }) {
  const [reduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [cursor, setCursor] = useState({ index: 0, from: null, revision: 0 });
  const [playing, setPlaying] = useState(!reduced);
  const [speed, setSpeed] = useState(1);
  const container = useRef(null);
  const stage = trace.stages[cursor.index];
  const previous = cursor.from === null ? null : trace.stages[cursor.from];
  useEffect(() => {
    container.current?.scrollIntoView({
      behavior: reduced ? 'instant' : 'smooth',
      block: 'start',
    });
  }, [reduced]);
  useEffect(() => {
    if (!playing || stale) return;
    const timer = setTimeout(() => {
      if (cursor.index === trace.stages.length - 1) setPlaying(false);
      else
        setCursor((c) => ({
          index: c.index + 1,
          from: c.index,
          revision: c.revision + 1,
        }));
    }, 3400 / speed);
    return () => clearTimeout(timer);
  }, [cursor.index, playing, speed, stale, trace.stages.length]);
  function go(index) {
    setPlaying(false);
    setCursor((c) => ({ index, from: c.index, revision: c.revision + 1 }));
  }
  return (
    <section
      className="sql-animation"
      style={{ '--trace-duration': `${1050 / speed}ms` }}
      ref={container}
      aria-label="Animación de operaciones SQL"
    >
      <header className="trace-heading">
        <div>
          <span className="trace-eyebrow">SQL EN MOVIMIENTO</span>
          <h3>{stage.title}</h3>
        </div>
        <span className="trace-counter">
          {cursor.index + 1} / {trace.stages.length}
        </span>
      </header>
      <nav className="trace-timeline" aria-label="Operaciones de la consulta">
        {trace.stages.map((s, i) => (
          <button
            key={s.id}
            className={
              i === cursor.index ? 'current' : i < cursor.index ? 'done' : ''
            }
            aria-current={i === cursor.index ? 'step' : undefined}
            onClick={() => go(i)}
            title={`${s.context} · ${s.title}`}
          >
            <span>{i + 1}</span>
            {opNames[s.op] || s.op}
            {s.context !== 'Consulta principal' && <small>{s.context}</small>}
          </button>
        ))}
      </nav>
      <div className="trace-explanation">
        <div>
          <span className="trace-context">{stage.context}</span>
          <pre>{stage.sql}</pre>
        </div>
        <p aria-live="polite">{stage.note}</p>
      </div>
      <div className="trace-legend">
        <span className="selected">Columnas elegidas</span>
        <span className="key">Claves de unión</span>
        <span className="computed">Valores calculados</span>
        <span className="removed">Filas o columnas retiradas</span>
        <span className="null">NULL · sin valor</span>
      </div>
      <Board key={cursor.revision} stage={stage} previous={previous} />
      <div className="trace-controls">
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
            disabled={cursor.index === 0}
            onClick={() => go(cursor.index - 1)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="trace-play"
            disabled={stale}
            onClick={() => {
              if (cursor.index === trace.stages.length - 1) {
                setCursor((c) => ({
                  index: 0,
                  from: c.index,
                  revision: c.revision + 1,
                }));
                setPlaying(true);
              } else setPlaying(!playing);
            }}
          >
            {playing && !stale ? <Pause size={16} /> : <Play size={16} />}{' '}
            {playing && !stale
              ? 'Pausar'
              : cursor.index === trace.stages.length - 1
                ? 'Repetir'
                : 'Reproducir'}
          </button>
          <button
            className="icon-button"
            aria-label="Paso siguiente"
            disabled={cursor.index === trace.stages.length - 1}
            onClick={() => go(cursor.index + 1)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <label>
          Velocidad
          <select
            aria-label="Velocidad de animación"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={0.5}>0,5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
      </div>
      <footer className="trace-footnote">
        <ArrowRight size={15} />
        <span>
          {trace.stages.length} etapas · {trace.outputRows} filas finales ·
          Valores calculados en SQLite
        </span>
      </footer>
    </section>
  );
}
