/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Scrollable tables must be focusable for keyboard scrolling. */
import { useEffect, useRef, useState } from 'react';
import {
  Database,
  Code2,
  Play,
  RotateCcw,
  ChevronRight,
  Table2,
  Layers,
  ArrowRight,
  Check,
  CircleHelp,
  LoaderCircle,
  Square,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import problems from './problems.json';

function Markdown({ text }) {
  return (
    <p>
      {text
        .split(/(\*\*.*?\*\*)/g)
        .map((part, i) =>
          part.startsWith('**') ? (
            <strong key={i}>{part.slice(2, -2)}</strong>
          ) : (
            part
          ),
        )}
    </p>
  );
}

function DataTable({ data, title, previous }) {
  const [selected, setSelected] = useState(null);
  const counts = new Map();
  if (previous)
    for (const row of data.values) {
      const key = JSON.stringify(row);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  const removed = previous
    ? previous.values.filter((row) => {
        const key = JSON.stringify(row),
          count = counts.get(key) || 0;
        if (count) {
          counts.set(key, count - 1);
          return false;
        }
        return true;
      })
    : [];
  return (
    <div className="data-card">
      <div className="table-heading">
        <span>
          <Table2 size={15} />
          {title}
        </span>
        <span className="muted">
          {data.values.length}
          {data.truncated ? '+' : ''} filas
        </span>
      </div>
      <section
        className="table-scroll"
        tabIndex={0}
        aria-label={`Tabla ${title}`}
      >
        <table>
          <thead>
            <tr>
              <th className="row-index">#</th>
              {data.columns.map((col, i) => (
                <th key={i} scope="col">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.values.map((row, r) => (
              <tr key={r} className={selected === r ? 'selected-row' : ''}>
                {
                  <td className="row-index">
                    <button
                      aria-label={`Resaltar fila ${r + 1} de ${title}`}
                      aria-pressed={selected === r}
                      onClick={() => setSelected(selected === r ? null : r)}
                    >
                      {r + 1}
                    </button>
                  </td>
                }
                {row.map((cell, c) => (
                  <td key={c}>
                    {cell === null ? (
                      <span className="null-cell">NULL</span>
                    ) : (
                      String(cell)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!data.values.length && (
          <p className="empty-table">La consulta no devuelve filas.</p>
        )}
      </section>
      {data.truncated && (
        <p className="table-note">Vista limitada a las primeras 200 filas.</p>
      )}
      {previous && !previous.truncated && !data.truncated && (
        <details className="removed-details">
          <summary>{removed.length} filas descartadas por WHERE</summary>
          {removed.length > 0 ? (
            <div className="removed-rows">
              {removed.map((row, i) => (
                <div key={i}>
                  {row
                    .map((v) => (v === null ? 'NULL' : String(v)))
                    .join(' · ')}
                </div>
              ))}
            </div>
          ) : (
            <p>Todas las filas cumplen la condición.</p>
          )}
        </details>
      )}
      {previous && (previous.truncated || data.truncated) && (
        <p className="table-note">
          La comparación de filas no está disponible con resultados truncados.
        </p>
      )}
    </div>
  );
}

export default function App() {
  const [problemId, setProblemId] = useState(problems[0].id);
  const [filter, setFilter] = useState('Todos');
  const [sql, setSql] = useState(problems[0].query);
  const [base, setBase] = useState([]);
  const [result, setResult] = useState(null);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState('loading');
  const [engineReady, setEngineReady] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [sidebar, setSidebar] = useState(true);
  const [hint, setHint] = useState(false);
  const worker = useRef(null);
  const pending = useRef(new Map());
  const sequence = useRef(0);
  const problem = problems.find((p) => p.id === problemId);
  const busy = status === 'loading' || status === 'running';
  const stale = result && result.sql !== sql;

  function request(type, payload) {
    return new Promise((resolve, reject) => {
      const id = ++sequence.current;
      const timer = setTimeout(
        () => {
          worker.current?.terminate();
          worker.current = null;
          setEngineReady(false);
          for (const item of pending.current.values()) {
            clearTimeout(item.timer);
            item.reject(
              new Error(
                'Se agotó el tiempo de ejecución. Recarga las tablas para volver a intentarlo.',
              ),
            );
          }
          pending.current.clear();
        },
        type === 'init' ? 15000 : 5000,
      );
      pending.current.set(id, { resolve, reject, timer });
      worker.current.postMessage({ id, type, ...payload });
    });
  }

  useEffect(() => {
    let active = true;
    const requests = pending.current;
    // Synchronize UI with replacement of the external worker and database.
    // eslint-disable-next-line react/react-compiler
    setStatus('loading');
    setBase([]);
    setResult(null);
    setStep(0);
    setError('');
    const instance = new Worker(new URL('./sql.worker.js', import.meta.url), {
      type: 'module',
    });
    worker.current = instance;
    instance.onmessage = ({ data }) => {
      const item = pending.current.get(data.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.current.delete(data.id);
      if (data.error) item.reject(new Error(data.error));
      else item.resolve(data.result);
    };
    instance.onerror = () => {
      for (const item of pending.current.values()) {
        clearTimeout(item.timer);
        item.reject(
          new Error(
            'No se pudo cargar el motor SQL. Recarga las tablas para reintentar.',
          ),
        );
      }
      pending.current.clear();
      instance.terminate();
      worker.current = null;
      setEngineReady(false);
    };
    request('init', { problem })
      .then((tables) => {
        if (active) {
          setBase(tables);
          setStatus('ready');
          setEngineReady(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setStatus('error');
          setEngineReady(false);
        }
      });
    return () => {
      active = false;
      instance.terminate();
      for (const item of requests.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('Ejecución cancelada.'));
      }
      requests.clear();
      worker.current = null;
    };
  }, [problem, retry]);

  function selectProblem(next) {
    if (next.id === problemId) return;
    setProblemId(next.id);
    setSql(next.query);
    setHint(false);
  }

  async function run(query = sql) {
    if (busy || !worker.current) return;
    const currentWorker = worker.current;
    setStatus('running');
    setError('');
    setResult(null);
    try {
      const value = await request('run', { sql: query });
      if (worker.current !== currentWorker) return;
      setResult(value);
      setStep(1);
      setStatus('ready');
      return {
        columns: value.final.columns,
        rows: value.final.values,
        truncated: value.final.truncated,
      };
    } catch (e) {
      if (worker.current === currentWorker || !worker.current) {
        setError(e.message);
        setStatus('error');
      }
      throw e;
    }
  }

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: 'execute_sql',
            title: 'Ejecutar consulta SQL',
            description:
              'Ejecuta una consulta de lectura sobre el problema seleccionado y muestra sus pasos y resultado.',
            inputSchema: {
              type: 'object',
              properties: {
                sql: { type: 'string', minLength: 1, maxLength: 30000 },
              },
              required: ['sql'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            async execute(input) {
              if (
                !input ||
                typeof input.sql !== 'string' ||
                !input.sql.trim() ||
                input.sql.length > 30000
              )
                throw new Error(
                  'Se requiere una consulta SQL de entre 1 y 30.000 caracteres.',
                );
              const output = await runRef.current(input.sql);
              if (!output)
                throw new Error('El motor no está disponible o está ocupado.');
              setSql(input.sql);
              return output;
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional API; the visible editor remains available. */
    }
    return () => lifecycle.abort();
  }, []);

  const visible = problems.filter(
    (p) => filter === 'Todos' || p.difficulty === filter,
  );
  const steps = [
    { label: 'Tablas base', sub: 'Datos originales', icon: Database },
    { label: 'Resultado intermedio', sub: 'FROM · JOIN · WHERE', icon: Layers },
    { label: 'Resultado final', sub: 'SELECT · GROUP BY', icon: Table2 },
  ];

  return (
    <div className={`app-shell ${sidebar ? '' : 'sidebar-hidden'}`}>
      {sidebar && (
        <aside className="sidebar">
          <a className="brand" href="#workspace">
            <span className="brand-icon">
              <Database size={22} />
            </span>
            <span>
              Leet<span className="brand-light">Viewer</span>
              <small>SQL WORKSPACE</small>
            </span>
          </a>
          <div className="collection-title">
            <span>COLECCIÓN DE PRÁCTICA</span>
            <span>{problems.length}</span>
          </div>
          <h2>Problemas SQL</h2>
          <div className="filters" aria-label="Filtrar por dificultad">
            {['Todos', 'Easy', 'Medium', 'Hard'].map((f) => (
              <button
                className={filter === f ? 'active' : ''}
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
              >
                {f}
              </button>
            ))}
          </div>
          <nav aria-label="Problemas SQL">
            {visible.map((p) => (
              <button
                key={p.id}
                className={`problem-item ${p.id === problemId ? 'active' : ''}`}
                aria-current={p.id === problemId ? 'page' : undefined}
                onClick={() => selectProblem(p)}
              >
                <div>
                  <span className="problem-number">{p.id}</span>
                  <span className={`difficulty ${p.difficulty.toLowerCase()}`}>
                    {p.difficulty}
                  </span>
                </div>
                <span className="problem-title">{p.title}</span>
                <small>{p.topic}</small>
                {p.id === problemId && (
                  <ChevronRight className="problem-chevron" size={16} />
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="status-dot" />
            SQL en tu navegador
            <p>
              Datos de ejemplo locales.
              <br />
              Sin cuenta ni servidor.
            </p>
          </div>
        </aside>
      )}
      <div className="main-shell" id="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button"
              aria-label={
                sidebar
                  ? 'Ocultar lista de problemas'
                  : 'Mostrar lista de problemas'
              }
              onClick={() => setSidebar(!sidebar)}
            >
              {sidebar ? (
                <PanelLeftClose size={19} />
              ) : (
                <PanelLeftOpen size={19} />
              )}
            </button>
            <span>SQL Lab</span>
            <ChevronRight size={14} />
            <span className="muted">Problema {problem.id}</span>
          </div>
          <span className="engine-badge">
            <span className={`status-dot ${busy ? 'pending' : ''}`} />
            SQLite · WebAssembly
          </span>
        </header>
        <main>
          <section className="problem-intro" aria-labelledby="problem-title">
            <div className="eyebrow">EXPLORA. EJECUTA. ENTIENDE.</div>
            <div className="title-row">
              <h1 id="problem-title">{problem.title}</h1>
              <span
                className={`difficulty ${problem.difficulty.toLowerCase()}`}
              >
                {problem.difficulty}
              </span>
            </div>
            <Markdown text={problem.description} />
            <button
              className="hint-button"
              onClick={() => setHint(!hint)}
              aria-expanded={hint}
            >
              <CircleHelp size={15} />
              {hint ? 'Ocultar pista' : 'Ver una pista'}
            </button>
            {hint && <div className="hint-box">{problem.hint}</div>}
          </section>

          <section className="input-section" aria-labelledby="inputs-title">
            <div className="section-heading">
              <h2 id="inputs-title">
                <Database size={17} />
                Tablas de entrada{' '}
                <span className="muted regular">/ Input Tables</span>
              </h2>
              <span className="muted">{base.length} tablas</span>
            </div>
            {status === 'loading' ? (
              <div className="loading">
                <LoaderCircle className="spin" size={20} />
                Preparando las tablas y el motor SQL…
              </div>
            ) : (
              <div className="input-tables">
                {base.map((t) => (
                  <DataTable
                    key={`${problemId}-${t.name}`}
                    title={t.name}
                    data={t}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="editor-section" aria-labelledby="editor-title">
            <div className="editor-header">
              <h2 id="editor-title">
                <Code2 size={18} />
                Consulta SQL
              </h2>
              <div>
                <span className="muted">SQLite</span>
                <span className="vertical-rule" />
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setSql(problem.query);
                    setError('');
                  }}
                >
                  <RotateCcw size={14} />
                  Restablecer
                </button>
              </div>
            </div>
            <div className="code-area">
              <div className="line-numbers" aria-hidden="true">
                {sql.split('\n').map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <textarea
                aria-label="Editor de consulta SQL"
                value={sql}
                maxLength={30000}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    run().catch(() => {});
                  }
                }}
                style={{
                  minHeight: `${Math.max(7, Math.min(sql.split('\n').length, 17)) * 24}px`,
                }}
              />
            </div>
            <div className="editor-footer">
              <span className="muted">
                Una consulta, paso a paso.<kbd>Ctrl ↵</kbd>
              </span>
              {status === 'running' ? (
                <button
                  className="run-button"
                  onClick={() => setRetry((v) => v + 1)}
                >
                  <Square size={15} />
                  Cancelar ejecución
                </button>
              ) : (
                <button
                  className="run-button"
                  disabled={busy || !engineReady}
                  onClick={() => run().catch(() => {})}
                >
                  <Play size={16} fill="currentColor" />
                  Visualizar ejecución paso a paso
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          </section>

          {error && (
            <div className="error-box" role="alert">
              <strong>No se pudo ejecutar</strong>
              <p>{error}</p>
              <button
                className="text-button"
                onClick={() => setRetry((v) => v + 1)}
              >
                Recargar tablas
              </button>
            </div>
          )}

          <section className="pipeline" aria-labelledby="pipeline-title">
            <div className="section-heading">
              <h2 id="pipeline-title">
                <Layers size={18} />
                Flujo de ejecución
              </h2>
              <span className="muted" aria-live="polite">
                {status === 'running' ? (
                  'Ejecutando…'
                ) : result ? (
                  <>
                    <Check size={14} />
                    {result.duration.toFixed(1)} ms
                  </>
                ) : (
                  'Empieza por los datos'
                )}
              </span>
            </div>
            <div
              className="steps"
              role="tablist"
              aria-label="Pasos de ejecución"
            >
              {steps.map((s, i) => (
                <button
                  key={s.label}
                  id={`step-${i}`}
                  role="tab"
                  aria-selected={step === i}
                  aria-controls={`panel-${i}`}
                  tabIndex={step === i ? 0 : -1}
                  className={`step ${step === i ? 'active' : ''}`}
                  onClick={() => setStep(i)}
                  onKeyDown={(e) => {
                    let next;
                    if (e.key === 'ArrowRight') next = (i + 1) % 3;
                    if (e.key === 'ArrowLeft') next = (i + 2) % 3;
                    if (e.key === 'Home') next = 0;
                    if (e.key === 'End') next = 2;
                    if (next !== undefined) {
                      e.preventDefault();
                      setStep(next);
                      document.getElementById(`step-${next}`)?.focus();
                    }
                  }}
                >
                  <span className="step-number">0{i + 1}</span>
                  <span>
                    <strong>{s.label}</strong>
                    <small>{s.sub}</small>
                  </span>
                  <s.icon size={18} />
                </button>
              ))}
            </div>
            {stale && (
              <output className="stale-notice">
                Has modificado la consulta. Vuelve a ejecutarla para actualizar
                estos resultados.
              </output>
            )}
            <div
              role="tabpanel"
              id={`panel-${step}`}
              aria-labelledby={`step-${step}`}
              className="step-content"
            >
              {step === 0 && (
                <>
                  <p className="step-description">
                    El punto de partida: las tablas cargadas en la base de
                    datos.
                  </p>
                  <div className="input-tables">
                    {base.map((t) => (
                      <DataTable
                        key={`${problemId}-${t.name}`}
                        title={t.name}
                        data={t}
                      />
                    ))}
                  </div>
                </>
              )}
              {step > 0 && !result && (
                <div className="empty-state">
                  <Code2 size={25} />
                  <h3>
                    {status === 'running'
                      ? 'Ejecutando tu consulta…'
                      : 'Tu consulta tiene una historia'}
                  </h3>
                  <p>
                    Usa «Visualizar ejecución paso a paso» para ver cómo se
                    transforman los datos.
                  </p>
                </div>
              )}
              {step === 1 && result && (
                <>
                  <p className="step-description">{result.note}</p>
                  {result.stages.map((s, i) => (
                    <div className="intermediate-stage" key={i}>
                      <pre>{s.sql}</pre>
                      <DataTable
                        key={`${result.sql}-${i}`}
                        data={s}
                        title={s.title}
                        previous={i > 0 ? result.stages[i - 1] : null}
                      />
                    </div>
                  ))}
                  {!result.stages.length && (
                    <button className="text-button" onClick={() => setStep(2)}>
                      Ver resultado final
                      <ArrowRight size={16} />
                    </button>
                  )}
                </>
              )}
              {step === 2 && result && (
                <>
                  <p className="step-description">
                    Resultado real de tu consulta, con la selección de columnas,
                    agrupaciones y orden que hayas indicado.
                  </p>
                  <DataTable
                    key={result.sql}
                    title="Resultado"
                    data={result.final}
                  />
                </>
              )}
            </div>
            <footer className="pipeline-footer">
              <span>
                <span className="null-cell">NULL</span> Valor ausente
              </span>
              <span>Haz clic en el número de una fila para resaltarla.</span>
            </footer>
          </section>
          <footer className="page-footer">
            <span>
              LeetViewer{' '}
              <span className="muted">/ Aprende viendo los datos</span>
            </span>
            <span>
              Ejercicios de práctica inspirados en SQL 50 · Dialecto SQLite
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
