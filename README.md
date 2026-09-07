# LeetViewer

Visualiza paso a paso la transformación de datos de los 50 ejercicios del [plan SQL 50 de LeetCode](https://leetcode.com/studyplan/top-sql-50/).

Aplicación React con SQLite real (`sql.js` / WebAssembly) en un Web Worker. Todo el cálculo ocurre en el navegador, sin backend ni cuenta de usuario.

## Arrancar

Con Node.js 22.13 o superior:

```sh
npm ci
npm run dev
```

Abre la dirección que imprime Vite. Selecciona un ejercicio, edita su consulta y pulsa **Visualizar ejecución paso a paso** o **Ctrl+Enter**. El resultado intermedio contiene la animación, con controles de reproducción, etapas y velocidad.

## Qué incluye

- Los 50 ejercicios organizados en siete bloques y filtrables por dificultad.
- Resúmenes en español, pistas, enlaces al enunciado original y soluciones de referencia propias adaptadas a SQLite.
- Tablas de entrada y resultados calculados por SQLite, con tratamiento visible de NULL.
- Animaciones independientes del ejercicio: JOIN, filtros, agrupaciones, agregaciones, CTE, ventanas compatibles y UNION/UNION ALL.
- Ejecución de DELETE en una copia temporal para el ejercicio de correos duplicados; las tablas originales se conservan.
- Cancelación de consultas, límites de ejecución y avisos de resultados desactualizados.

Las soluciones y resúmenes no son editoriales oficiales de LeetCode. Los datos son ejemplos de práctica locales; la aplicación no es un juez de soluciones ni se conecta a LeetCode durante la ejecución.

## Verificación y compilación

```sh
npm test
npm run lint
npm run build
node tests/bundle-smoke.js
npm start
```

Las pruebas verifican los resultados esperados y las animaciones de los 50 ejercicios, además de casos límite y el aislamiento de DELETE. La prueba del worker compilado comprueba también el WebAssembly local. No sustituye una revisión visual en navegador.

`npm run build` genera `dist/`, que se puede servir con cualquier servidor estático. Todos los recursos de SQLite se incluyen en la compilación. Sirve la aplicación por HTTP; no abras `index.html` mediante `file://`.

## Estructura

- `src/catalog.js`: catálogo, secciones y enlaces originales.
- `src/problems.json` y `src/sql50-extra.js`: enunciados resumidos, datos, consultas, pistas y resultados esperados.
- `src/sql-engine.js`: validación, bases de datos y resultados SQLite.
- `src/execute-problem.js`: ejecución y aislamiento del ejercicio DELETE.
- `src/relational-trace.js`: etapas lógicas y procedencia de las celdas.
- `src/SQLAnimation.jsx`: representación y reproducción de las trazas.
- `src/sql.worker.js`: ejecución fuera del hilo de la interfaz.
- `tests/`: pruebas del motor, catálogo y worker compilado.

## Límites

Se utiliza el dialecto SQLite, no MySQL. Las visualizaciones muestran operaciones lógicas, no el plan físico del optimizador.

La animación admite hasta 40 filas y 24 columnas visibles por etapa, 48 etapas y cinco niveles de anidación. Algunas consultas alternativas —por ejemplo, CTE recursivas, INTERSECT/EXCEPT, subconsultas en expresiones SELECT y ciertos marcos de ventana— conservan el resultado real, pero muestran un aviso en lugar de una animación. Para ordenar una UNION, úsala dentro de una CTE y ordena el SELECT exterior.

Los resultados se limitan a 200 filas visibles y las consultas se cancelan tras cinco segundos. Las consultas SELECT usan una base de solo lectura. Solo el ejercicio 196 permite DELETE sobre Person, siempre en una copia temporal nueva.
