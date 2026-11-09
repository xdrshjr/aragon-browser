# Index Configuration

> Configuration for project-indexer. Edit this file to customize index generation.

## Excluded Directories

Directories to skip during indexing:

- node_modules
- .git
- dist
- dist2
- build
- coverage
- artifacts
- image
- .cache
- __pycache__
- .venv
- venv
- vendor
- .next
- .nuxt
- target
- obj

**Overrides of the skill defaults for this project:**

- `bin/` is **NOT** excluded. In this repo `bin/` is shipped source of truth for the published
  CLI (`bin/aragon-browser.cjs`, generated from `src/cli/index.js`, plus `bin/skill-body/`).
  Excluding it would hide the CLI entry point.
- `dist2/` added — a second electron-builder output dir used by `test/smoke/run-packaged.mjs`,
  git-ignored.
- `artifacts/` and `image/` added — icon-generation exploration output, git-ignored.

Also excluded as file-level noise: `package-lock.json` (141 KB), `docs/images/*.png`,
`build/icon.png`, `src/renderer/brand.png` (binary assets, listed by name only).

## Priority Directories

Directories to index in detail (kernel -> cli -> main, everything else at standard depth):

- `src/kernel/` — engine boundary: CDP, AX snapshot, refs, locators, actions, waits, learning
- `src/cli/` — agent-facing script host and transport client
- `src/main/` — Electron lifecycle, IPC boundary, window/space scoping, installation
- `src/shared/` — pure contracts used by all of the above and by tests
- `src/renderer/`, `src/preload/` — UI chrome and the contextBridge
- `test/` — 13 `node --test` suites + the real-app smoke harness
- `scripts/`, `skills/aragon-browser/` — build/release tooling and the shipped agent skill

## Tech Stack

- **Frontend:** vanilla JS renderer (`src/renderer/ui.js` + `index.html` + `styles.css`), no framework
- **Backend:** Electron 45 main process (Node 22 ESM) — no HTTP server except the loopback
  NDJSON runtime transport and the test fixture server
- **Language:** JavaScript 100% (ESM, `"type": "module"`; one CJS bundle for the CLI)
- **Database:** none — Electron `session` partitions for state, JSON files for runtime coordinates
- **Other:** esbuild (CLI bundle), electron-builder (NSIS + portable, Windows x64),
  `node --test` (no test framework dependency)

## Index Settings

- Generated: 2026-11-08 21:55:32
- Project Root: F:\TMP-PROJECTS\aragon-browser
- Index Version: 1.1.0
- Total Files Indexed: 68 source files (~16,575 lines)
- Total Symbols Extracted: ~120 exported functions/classes/constants (mechanical `^export` scan)
- Environments Configured: No

## Custom Rules

### Additional Exclusions

```
package-lock.json
docs/images/*.png
build/icon.png
src/renderer/brand.png
```

### File Type Overrides

```
bin/aragon-browser.cjs -> generated (esbuild output of src/cli/index.js); list it, do not trace symbols
src/renderer/styles.css -> section comments only, no symbol extraction
src/renderer/index.html -> DOM/IPC surface only
test/smoke/*.js      -> scripts driven through the CLI, not importable modules
```

## Regeneration Notes

- Run `npm run test` and (for anything touching the engine boundary) `npm run smoke` before
  trusting an index refresh — the smoke suite is what proves the boundary still works.
- `src/kernel/browser-kernel.js` (1,256 lines) is the hub; if it moves, most of the Feature Map
  needs re-reading rather than patching.
- `bin/aragon-browser.cjs` (1,964 lines) is machine-generated; regenerate it with
  `npm run build:cli` instead of indexing its symbols.
- Large binary assets and the 141 KB lockfile are deliberately out of scope.

## Clean Code Settings

- Enabled: Yes
- Preset: strict
- MAX_FILE_LINES: 1000
- MAX_METHOD_LINES: 60
- MAX_FUNCTION_PARAMS: 5
- MAX_CYCLOMATIC: 10
- MAX_LINE_LENGTH: 100
- MAX_NESTING_DEPTH: 4
