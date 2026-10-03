# qa-pilot fase 1 · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Núcleo estándar de qa-pilot (formato `qa/`, CLI con router, preset de Playwright, adaptadores, workflow), probado sobre una app de ejemplo y sobre un proyecto piloto, con la bandeja de escalamientos en Forge.

**Architecture:** Monorepo pnpm con dos paquetes: `qa-pilot` (CLI y lógica pura: config, diff, router, ingestores, publish, run) y `@qa-pilot/playwright` (preset, globalSetup, fixtures, reporter). La lógica es pura y se prueba con fixtures; los efectos (git, procesos, GitHub) se inyectan. GitHub es la fuente de verdad; Forge y el proyecto piloto son consumidores.

**Tech Stack:** Node ≥ 22, TypeScript strict ESM, pnpm, Vitest, `yaml`, `ajv`, `picomatch`, `fast-xml-parser`, `@playwright/test`, `@axe-core/playwright`. GitHub REST vía `fetch` (sin Octokit).

**Spec:** `docs/specs/2026-10-02-qa-pilot-fase-1-design.md`

## Global Constraints

- Node ≥ 22; TypeScript `strict`, ESM (`"type": "module"`), imports con extensión `.js`.
- Licencia MIT. Sin publicar en GitHub ni npm sin aprobación del dueño.
- Forge: ramas en worktree `feat/mod-qa-escalations`; convenciones del repo (Preact, UnoCSS, Vitest). Proyecto piloto: rama `feat/qa-pilot`. Sin push.
- El router falla cerrado: cualquier error de config o resultado faltante → `escalate` con gate `ERR`.
- La IA solo puede añadir escalamientos.
- Parámetros de acciones de Forge nunca se interpolan en el comando: van como `FORGE_PARAM_<NOMBRE>`.
- Etiquetas: `qa:auto`, `qa:needs-human`, `qa:blocked`, `qa:approved`. Status: `qa-pilot/decision`. Marcador: `<!-- qa-pilot:decision` … `-->`.

## Review Focus

- Glob de `protected-paths` con `**` y rutas con paréntesis/corchetes de Next (`app/(app)/celdas/[slug]`) → deben coincidir literalmente; test en Task 2.
- Archivo renombrado desde una ruta protegida (status `R`) → el origen también cuenta para G1; test en Task 2.
- `approve-check` con aprobación de un actor fuera de `approvers` o con SHA viejo → no aprueba; test en Task 5.
- Comentario de decisión editado a mano con JSON inválido → `approve-check` no aprueba y lo explica; test en Task 5.
- `run` con un check que cuelga o falla → igual apaga entorno y app; test en Task 6.

---

### Task 1: Scaffold, schema y carga de configuración

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `LICENSE`, `README.md`, `.gitignore`
- Create: `spec/qa-pilot.schema.json`
- Create: `packages/cli/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `packages/cli/src/config.ts`, `packages/cli/src/types.ts`
- Test: `packages/cli/src/config.test.ts`, fixtures en `packages/cli/test/fixtures/`

**Interfaces — Produces:**
```ts
// types.ts
export type Role = { email: string; password_env?: string; expect?: 'rejected' }
export type QaConfig = {
  app: { env: 'supabase-local'|'docker-compose'|'command'; dir: string; setup?: string; start?: string;
         url: string; ready_timeout_s: number; seed?: string; compose_file?: string; env_map?: Record<string,string> }
  auth: { adapter: 'supabase-magiclink'|'form'|'none'; callback?: string; login_url?: string;
          fields?: { email: string; password: string; submit: string } }
  roles: Record<string, Role>
  checks: { unit?: string; e2e?: string; security?: Array<'semgrep'|'gitleaks'> }
  router: { auto_max_lines: number; visual_diff: 'warn'|'escalate'; flaky_in_journey: 'warn'|'escalate' }
  approvers: string[]
}
export type Journey = { id: string; name: string }
export type QaContract = { root: string; config: QaConfig; protectedPaths: string[]; journeys: Journey[] }
// config.ts
export function loadContract(root: string): QaContract          // lanza ConfigError con mensaje claro
export class ConfigError extends Error {}
export function parseProtectedPaths(text: string): string[]     // ignora vacías y # comentarios (también inline)
export function parseJourneys(md: string): Journey[]           // "## J3 · Editar memoria" → {id:'J3', name:'Editar memoria'}
```
Defaults: `app.dir='.'`, `ready_timeout_s=120`, `router={auto_max_lines:200, visual_diff:'warn', flaky_in_journey:'escalate'}`, `auth.adapter='none'`, `approvers=[]`. `extends` es ruta relativa a `qa/`; se mezcla en profundidad con el archivo local encima.

- [ ] Tests: config válida con defaults; `extends` mezcla (local gana); schema inválido (`app.env: 'foo'`) → `ConfigError` que nombra la ruta del campo; falta `qa/qa-pilot.yaml` → `ConfigError`; `parseProtectedPaths` con comentarios inline; `parseJourneys` con `·` y con `-` como separador.
- [ ] Implementar, correr `pnpm -C packages/cli test`, commit `feat(cli): contrato qa/ y schema`.

### Task 2: Diff, gates y router

**Files:**
- Create: `packages/cli/src/diff.ts`, `packages/cli/src/router.ts`
- Test: `packages/cli/src/router.test.ts`, `packages/cli/src/diff.test.ts`

**Interfaces — Consumes:** `QaContract`. **Produces:**
```ts
export type DiffFile = { path: string; from?: string; status: 'A'|'M'|'D'|'R'; added: number; removed: number }
export type Diff = { files: DiffFile[] }
export function parseDiff(nameStatus: string, numstat: string): Diff
export function gitDiff(root: string, base: string): Diff        // usa execFileSync('git', ...)
export type Finding = { kind: 'test-failed'|'flaky'|'visual-diff'|'a11y'|'security'|'error'; message: string;
  journey?: string; file?: string; severity?: 'low'|'medium'|'high'|'critical'; artifact?: string }
export type CheckResult = { check: string; status: 'pass'|'fail'|'warn'; findings: Finding[] }
export type Gate = { id: 'G1'|'G3'|'G4'|'G5'|'SEC'|'AI'|'ERR'; reason: string }
export type Decision = { version: 1; decision: 'auto'|'escalate'|'blocked'; sha: string; gates: Gate[];
  diff: { files: number; added: number; removed: number }; checks: Record<string, CheckResult['status']>;
  findings: Array<Finding & { check: string }> }
export function route(input: { contract: QaContract; results: CheckResult[]; diff: Diff; sha: string;
  expectedChecks: string[] }): Decision
export function readResults(dir: string): { results: CheckResult[]; errors: string[] }
```
Reglas: oráculo (G3) = `qa/**`, `**/*.spec.{ts,js}`, `**/*.test.{ts,js}` bajo carpetas `e2e/`, `**/*-snapshots/**`. Globs con `picomatch` (`{dot:true}`). En `protected-paths`, `(`, `)`, `[`, `]` son literales (rutas de Next como `app/(app)/celdas/[slug]`): se escapan en el glob antes de compilarlo. Para `R`, evaluar `path` y `from`. G4: finding `visual-diff` con `journey` → escala si siempre; `flaky` con journey → según `router.flaky_in_journey`; `visual-diff` sin journey → escala solo si `router.visual_diff==='escalate'`. `blocked` si algún check `fail`. Check esperado sin resultado → gate `ERR`.

- [ ] Tests: fixture #41 (2 archivos web, +18 −9, todo pass, visual-diff sin journey) → `auto`; fixture #42 (migración + `app/(app)/celdas/[slug]/memoria/actions.ts`, visual-diff J3) → `escalate` con G1 y G4; e2e `fail` → `blocked`; renombrado desde ruta protegida → G1; edición de `e2e/x.spec.ts` → G3; >200 líneas → G5; semgrep con finding → SEC; `ai-review` warn → AI; check esperado faltante → ERR; resultado JSON ilegible → ERR.
- [ ] Implementar, tests verdes, commit `feat(cli): router de riesgo`.

### Task 3: Ingestores

**Files:** Create `packages/cli/src/ingest.ts`; Test `packages/cli/src/ingest.test.ts` con fixtures `test/fixtures/ingest/{junit.xml,semgrep.json,gitleaks.json}`.

**Produces:** `export function ingest(tool: 'junit'|'semgrep'|'gitleaks', raw: string, check?: string): CheckResult`
- junit: `<failure>`/`<error>` → `test-failed`; ninguno → pass. check = `check ?? 'unit'`.
- semgrep (`--json`): cada `results[]` → `security` con severity por `extra.severity` (ERROR→high, WARNING→medium, INFO→low); status `warn` si hay findings (no `fail`: seguridad escala, no bloquea).
- gitleaks (`--report-format json`): cada entrada → `security` severity `critical`, status `warn`.
- [ ] Tests por formato (vacío y con hallazgos), implementar, commit `feat(cli): ingestores junit, semgrep y gitleaks`.

### Task 4: CLI

**Files:** Create `packages/cli/src/cli.ts`, `packages/cli/bin/qa-pilot.js`; Test `packages/cli/src/cli.test.ts`.

Subcomandos (parser propio con `node:util` `parseArgs`):
- `qa-pilot config get <ruta.punteada>` → imprime el valor (para el workflow).
- `qa-pilot ingest <tool> <archivo> [--check nombre] [--out qa-results]`
- `qa-pilot route [--base origin/main] [--root .] [--out qa-results]` → escribe `decision.json`, imprime resumen, exit 0 (la decisión no es error), exit 2 solo si no hay repo git.
- `qa-pilot run`, `publish`, `approve-check`, `baselines` (implementados en Tasks 5, 6, 8).
- [ ] Tests: `config get router.auto_max_lines` sobre fixture; `route` sobre repo git temporal (crear con `git init` en tmp, commit base, cambio protegido) produce `decision.json` con `escalate`.
- [ ] Commit `feat(cli): comandos config, ingest y route`.

### Task 5: Publicación y aprobación en GitHub

**Files:** Create `packages/cli/src/github.ts`, `packages/cli/src/comment.ts`, `packages/cli/src/publish.ts`; Tests `publish.test.ts`, `comment.test.ts`.

**Produces:**
```ts
export interface GitHub {            // implementación real con fetch + GITHUB_TOKEN; en tests, un fake en memoria
  getPr(n: number): Promise<{ number: number; headSha: string; labels: string[]; nodeId: string }>
  setLabels(n: number, add: string[], remove: string[]): Promise<void>
  upsertComment(n: number, marker: string, body: string): Promise<void>
  findComment(n: number, marker: string): Promise<string | null>
  setStatus(sha: string, state: 'success'|'pending'|'failure', description: string): Promise<void>
  enableAutoMerge(pr: { number: number; nodeId: string; sha: string }): Promise<void>  // GraphQL enablePullRequestAutoMerge, SQUASH; si el PR ya está listo, PUT /merge con ese sha
}
export function renderComment(d: Decision): string          // resumen + JSON entre marcadores
export function extractDecision(body: string): Decision | null
export async function publish(gh: GitHub, pr: number, d: Decision): Promise<void>
export type ApprovalEvent = { action: 'labeled'|'created'; actor: string; label?: string; comment?: string }
export async function approveCheck(gh: GitHub, pr: number, ev: ApprovalEvent, approvers: string[]):
  Promise<{ approved: boolean; reason: string }>
```
`publish`: etiqueta según decisión, quita las otras dos; cada corrida nueva quita `qa:approved` (una aprobación vale solo para el SHA que se vio); status; auto-merge si `auto`. `approveCheck`: acepta label `qa:approved` o comentario que empieza con `/qa approve`; exige actor ∈ approvers, comentario con JSON válido, `decision==='escalate'` y `sha===headSha`.
CLI: `publish` lee `GITHUB_REPOSITORY`, `GITHUB_TOKEN`, PR de `GITHUB_EVENT_PATH`; `approve-check` lee el evento y los approvers de la config.
- [ ] Tests con fake: auto → label qa:auto, status success, auto-merge; escalate → qa:needs-human, pending; re-publicación quita qa:approved; approve válido → success + auto-merge; actor no autorizado → no; SHA viejo → no; comentario con JSON roto → no, reason menciona el comentario; `extractDecision(renderComment(d))` ida y vuelta.
- [ ] Commit `feat(cli): publicar decisión y aprobar en GitHub`.

### Task 6: Orquestador `qa-pilot run`

**Files:** Create `packages/cli/src/run.ts`, `packages/cli/src/env-adapters.ts`, `packages/cli/src/proc.ts`; Test `run.test.ts`.

**Produces:**
```ts
export type Proc = { sh(cmd: string, opts: { cwd: string; env: Record<string,string>; timeoutS?: number }): Promise<{ code: number; out: string }>;
  spawnBg(cmd: string, opts: { cwd: string; env: Record<string,string> }): { stop(): Promise<void> } }
export interface EnvAdapter { up(ctx): Promise<Record<string,string>>; down(ctx): Promise<void> }
export function envAdapter(kind: QaConfig['app']['env']): EnvAdapter
export async function run(opts: { root: string; base: string; out: string; proc: Proc; fetchUrl?: (u: string) => Promise<boolean> }): Promise<Decision>
```
Flujo del spec §9. `checks.e2e` corre con env `QA_PILOT_ROOT`, `QA_PILOT_OUT`. `checks.unit` debe dejar JUnit en `<out>/raw/unit.xml`; si existe se ingiere. `security`: `semgrep scan --config auto --json -o <out>/raw/semgrep.json` y `gitleaks detect --no-git -s . -f json -r <out>/raw/gitleaks.json` (si la herramienta no está → resultado `fail` con `error` "semgrep no instalado"). `finally`: stop app, `down` del entorno.
supabase-local: `npx supabase start`, `npx supabase db reset`, `npx supabase status -o env` → parsear `KEY="value"` y mapear por `env_map`.
- [ ] Tests con Proc falso: orden de llamadas; check que lanza → igual se llaman stop y down; parseo de `supabase status -o env`; timeout esperando la URL → decisión `blocked` con finding `error`.
- [ ] Commit `feat(cli): qa-pilot run con adaptadores de entorno`.

### Task 7: Preset de Playwright

**Files:** Create `packages/playwright/{package.json,tsconfig.json}`, `src/config.ts`, `src/global-setup.ts`, `src/auth/{supabase-magiclink.ts,form.ts}`, `src/fixtures.ts`, `src/reporter.ts`, `src/index.ts`; Test `src/reporter.test.ts`, `src/config.test.ts`.

**Produces:**
```ts
export function defineQaConfig(overrides?: PlaywrightTestConfig): PlaywrightTestConfig
export const test: TestType<{ qa: { role: string; snap(page, name: string, o?: { mask?: Locator[] }): Promise<void>; a11y(page): Promise<void> } }>
export { expect } from '@playwright/test'
// reporter: default export class QaReporter implements Reporter → escribe <QA_PILOT_OUT|qa-results>/e2e.json (CheckResult)
```
Proyectos: `setup` (globalSetup corre login por rol), y por cada rol × viewport `{name: '<rol>-<viewport>', use: {storageState, viewport}, dependencies: []}`; rol con `expect: rejected` sin storageState. `testDir` default `e2e`. `snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}'`. `qa.snap` toma screenshot en `light` y `dark` (`page.emulateMedia({colorScheme})`), `animations:'disabled'`, `caret:'hide'`. Reporter: journey = primer tag `@J\d+`; `result.retry>0 && status passed` → flaky; error con `toHaveScreenshot` → visual-diff (copiar attachments `*-diff.png` a artifacts); `qa.a11y` falla con mensaje que empieza por `a11y:` → kind `a11y`.
- [ ] Tests: `defineQaConfig` genera proyectos esperados desde una config fixture; reporter mapea resultados simulados a findings (flaky, visual-diff con journey, a11y, test-failed).
- [ ] Commit `feat(playwright): preset, login por rol, fixtures y reporter`.

### Task 8: Workflow reutilizable y `baselines`

**Files:** Create `workflow/qa.yml`, `packages/cli/src/baselines.ts`; docs en `README.md`.
- `qa.yml` (`on: workflow_call`): job `checks` si `github.event_name == 'pull_request'` (checkout `fetch-depth: 0`, setup-node 22, `npm i -g qa-pilot@${{ inputs.version }}` o `npx`, Playwright deps, `qa-pilot run --base origin/${{ github.base_ref }}`, `qa-pilot publish`, `actions/upload-artifact` de `qa-results`); job `approval` si evento `pull_request` con `action == 'labeled'` o `issue_comment` sobre PR. Permisos: `contents: write, pull-requests: write, statuses: write, issues: write`. Todas las Actions fijadas por SHA.
- `qa-pilot baselines`: `docker run --rm -v $PWD:/work -w /work mcr.microsoft.com/playwright:v<versión instalada>-noble npx playwright test --update-snapshots`.
- [ ] Validar YAML con `actionlint` si está instalado (si no, `node -e` parse YAML). Commit `feat: workflow reutilizable y baselines`.

### Task 9: App de ejemplo `examples/notes`

**Files:** `examples/notes/{package.json,server.js,views/*.html,Dockerfile,docker-compose.yml,playwright.config.ts}`, `examples/notes/qa/{qa-pilot.yaml,protected-paths,critical-journeys.md}`, `examples/notes/e2e/{j1-entrar.spec.ts,j2-borrar.spec.ts}`, `examples/notes/test/*.test.js`.
App Express mínima: `/login` (form), `/notes` (lista), `POST /notes/:id/delete` (solo admin; user → 403). Usuarios fijos `admin@notes.test` / `user@notes.test` con contraseñas de env. `qa/protected-paths`: `auth.js` (la lógica de login y roles vive ahí). Config: `env: docker-compose`, `auth.adapter: form`.
- [ ] `qa-pilot run --base HEAD` en el ejemplo → `auto`. Crear rama tmp tocando `auth.js` → `escalate` G1. Commit `feat(examples): app notes para probar el estándar`.

### Task 10: Forge · acciones con parámetros

**Files (worktree Forge):** Modify `packages/sdk/src/types.ts` (`ActionDef.params?: Record<string, { pattern: string }>`), `packages/core/src/server.ts` (`resolveAction` valida `body.params`), runner `exec` acepta `env`; Test `packages/core/src/action-params.test.ts`.
`validateParams(def, params): { env: Record<string,string> } | { error: string }` — cada param declarado requerido, string, coincide con `^(?:pattern)$`; no declarados → error; env `FORGE_PARAM_<NOMBRE_EN_MAYÚSCULAS>`.
- [ ] Tests: válido; falta; no coincide; extra no declarado; valor con `; rm -rf` rechazado por patrón `\d+`. Endpoint devuelve 400 con mensaje. Commit `feat(core): parámetros validados en acciones de módulos`.

### Task 11: Forge · `mod-qa` Escalamientos

**Files (worktree Forge):** Rewrite `modules/mod-qa/forge-module.json`, `modules/mod-qa/panels/{index.ts,Escalations.tsx}`, Create `modules/mod-qa/lib/decision.ts`; Delete paneles viejos; Update `tests/integration/mod-qa.test.ts`; Test `modules/mod-qa/lib/decision.test.ts`.
Acciones: `list-escalations` (`gh pr list --label qa:needs-human --state open --json number,title,url,updatedAt,author --limit 50`), `get-decision` (params `PR`: `gh pr view "$FORGE_PARAM_PR" --json comments,headRefOid`), `week-stats` (`gh pr list --state all --search "updated:>=$(date -v-7d +%F)" --json number,labels --limit 200`), `approve` (params PR: `gh pr edit "$FORGE_PARAM_PR" --add-label qa:approved`), `request-changes` (params PR, MSG patrón restringido: `gh pr comment ...`).
`lib/decision.ts`: `extractDecision(body)`, `latestDecision(comments)`, `weekStats(prs) → {total, auto, escalated, blocked}`, `isStale(decision, headSha)`.
Panel: lista + detalle (gates como chips, checks, findings), KPIs, botones; estados vacío y error de `gh` con texto "Ejecuta `gh auth login`".
- [ ] Tests de `lib/decision.ts`; actualizar test de integración del manifest; `pnpm test` del repo verde; commit `feat(mod-qa): bandeja de escalamientos de qa-pilot`.

### Task 12: Proyecto piloto · contrato y journeys

**Files (repo del proyecto piloto):** Create `qa/{qa-pilot.yaml,protected-paths,critical-journeys.md}`, `web/e2e/{seed-e2e.ts,j1-entrar.spec.ts,j2-crear-proyecto.spec.ts,j3-memoria.spec.ts}`, `web/playwright.config.ts`, `.github/workflows/qa.yml` (`uses: avarajar/qa-pilot/workflow/qa.yml@main`; funcionará cuando el repo se publique), devDeps en `web/package.json`.
Antes de escribir tests: leer rutas reales (`web/src/app/(app)/...`), la ruta `auth/dev-login`, cómo se decide cada rol y el esquema de las tablas que necesita el seed.
- [ ] `qa-pilot run` local (Docker + Supabase local) → decisión `auto` en la rama limpia. Cambio de prueba en una migración → `escalate` G1. Commit `feat(qa): contrato qa-pilot y journeys críticos`.
