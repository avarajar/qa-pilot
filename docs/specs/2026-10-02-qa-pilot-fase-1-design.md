# qa-pilot · Fase 1 · Diseño

Fecha: 2026-10-02 · Estado: aprobado en conversación, implementación en curso.

## 1. Propósito

QA automático para apps web donde el humano interviene solo en lo crítico. Las
máquinas verifican; un **router de riesgo** decide si un PR se aprueba solo o
escala a una persona con la evidencia armada.

Debe ser **estándar**: no atado a un stack, a un harness ni a una interfaz. Lo
de cada proyecto entra por contratos de configuración.

**Éxito de la fase 1:** una demo grabable de ~5 min (ver §11) que muestre:
un PR de bajo riesgo que se mergea sin humano, un PR que toca permisos y escala
a Forge con evidencia, y el mismo `qa-pilot` funcionando sobre un segundo stack
cambiando solo configuración.

## 2. Alcance

**Dentro:** formato `qa/` con JSON Schema · CLI (`run`, `ingest`, `route`,
`publish`, `approve-check`, `baselines`) · preset de Playwright (roles, viewports,
temas, axe, screenshots, reporter) · adaptadores de login y de entorno ·
workflow reutilizable de GitHub Actions · app de ejemplo de otro stack ·
integración en un proyecto piloto interno, Next.js + Supabase (`qa/` + 3 journeys) · `mod-qa` reescrito en Forge con
acciones parametrizadas.

**Fuera (fases 2–3):** matriz de permisos y pgTAP, Lighthouse, revisión
heurística de UX, pentest con agentes, micro-preguntas, `init` que deduce el
borrador, perfil del estudio leído desde un sistema central (en fase 1 `extends` se
resuelve contra un archivo local), plugin de Claude Code, SDK v1 de Forge,
Slack, otros harness.

## 3. Repos

| Qué | Dónde |
|---|---|
| Núcleo, preset, adaptadores, workflow, ejemplo | este repo (MIT, monorepo pnpm) |
| `qa/`, tests de journeys, workflow de una línea | el repo del proyecto piloto |
| `mod-qa` y acciones con parámetros | Forge, rama `feat/mod-qa-escalations` |

Publicar en GitHub y npm requiere aprobación explícita del dueño; mientras
tanto todo corre y se prueba en local con el mismo CLI que usa CI.

## 4. El contrato `qa/`

Cada proyecto tiene una carpeta `qa/` en la raíz:

- `protected-paths`: un glob por línea; `#` comenta. Un cambio que coincide
  activa G1.
- `critical-journeys.md`: secciones `## J<n> · <nombre>` con el comportamiento
  esperado en prosa. Los tests de Playwright se etiquetan con `@J<n>`.
- `qa-pilot.yaml`: configuración, validada contra `spec/qa-pilot.schema.json`.

```yaml
extends: ./studio.yaml            # opcional; se mezcla debajo de este archivo
app:
  env: supabase-local             # supabase-local | docker-compose | command
  dir: .                          # dónde corren los comandos
  setup: npm ci                   # opcional
  start: npm run build && npm start
  url: http://localhost:3000
  ready_timeout_s: 120
  seed: npx tsx e2e/seed.ts       # opcional
  compose_file: docker-compose.yml   # solo docker-compose
  env_map:                        # solo supabase-local: variable del proyecto ← valor de `supabase status`
    NEXT_PUBLIC_SUPABASE_URL: API_URL
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY
auth:
  adapter: supabase-magiclink     # supabase-magiclink | form | none
  callback: /auth/dev-login       # supabase-magiclink: ruta que acepta ?token_hash=
  login_url: /login               # form
  fields: { email: '#email', password: '#password', submit: 'button[type=submit]' }   # form
roles:
  owner:   { email: owner@example.com }
  member:  { email: member@example.com, password_env: QA_MEMBER_PASSWORD }
  outsider: { email: x@other.com, expect: rejected }
checks:
  unit: npm test -- --reporter=junit --outputFile=qa-results/raw/unit.xml   # opcional
  e2e: npx playwright test
  security: [semgrep, gitleaks]
router:
  auto_max_lines: 200
  visual_diff: warn               # warn | escalate  (fuera de journeys)
  flaky_in_journey: escalate
approvers: [avarajar]             # logins de GitHub que pueden aprobar
```

## 5. Resultados normalizados

Cada check escribe `qa-results/<check>.json` con la misma forma:

```ts
type CheckResult = {
  check: string                      // "e2e" | "unit" | "semgrep" | "gitleaks" | ...
  status: 'pass' | 'fail' | 'warn'
  findings: Finding[]
}
type Finding = {
  kind: 'test-failed' | 'flaky' | 'visual-diff' | 'a11y' | 'security' | 'error'
  message: string
  journey?: string                   // "J3", si el test lleva @J3
  file?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
  artifact?: string                  // ruta relativa a un screenshot/diff
}
```

- El reporter `@qa-pilot/playwright/reporter` escribe `e2e.json` directamente.
- `qa-pilot ingest <junit|semgrep|gitleaks> <archivo>` convierte salidas
  externas a `CheckResult`.
- Un comando de check que termina con código ≠ 0 y no produjo resultado se
  registra como `{status:'fail', findings:[{kind:'error'}]}`.

## 6. Router (`qa-pilot route`)

**Entradas:** `qa/`, `qa-results/*.json`, y el diff `git diff --numstat` y
`--name-status` entre `--base` y `HEAD`.

**Decisión:**

1. Algún check `fail` → `blocked` (vuelve al agente; no escala).
2. Si no, se evalúan gates; alguno activo → `escalate`.
3. Si no → `auto`.

| Gate | Se activa si |
|---|---|
| G1 · ruta protegida | un archivo del diff coincide con `protected-paths` |
| G2 · zona sensible del repo | cambia la config de CI (`.github/**`, `.gitlab-ci.yml`, `.circleci/**`, `.buildkite/**`) o, si el proyecto está en una subcarpeta, un archivo de la raíz del repo (lockfiles, `package.json` del workspace). Fijo: el proyecto no lo puede desactivar |
| G3 · oráculo | cambian archivos de tests e2e, imágenes base de screenshots (`*-snapshots/**`) o `qa/**` |
| G4 · journey crítico | hay un finding `visual-diff` o `flaky` con `journey` (según `router.*`) |
| G5 · tamaño | líneas añadidas + borradas > `auto_max_lines` |
| SEC · seguridad | algún finding `security` |
| AI · revisor | `qa-results/ai-review.json` tiene status `warn` o `fail` (opcional) |

**Principios:** falla cerrado (configuración inválida, resultado ilegible o
check esperado sin resultado → `escalate` con gate `ERR`); la IA solo puede
añadir escalamientos, nunca quitarlos.

**Salida** `qa-results/decision.json`:

```json
{
  "version": 1,
  "decision": "auto | escalate | blocked",
  "sha": "<HEAD>",
  "gates": [{ "id": "G1", "reason": "supabase/migrations/2026..._x.sql" }],
  "diff": { "files": 3, "added": 52, "removed": 12 },
  "checks": { "e2e": "pass", "unit": "pass", "semgrep": "pass" },
  "findings": [ ...Finding con check ]
}
```

## 7. Publicación y aprobación en GitHub

`qa-pilot publish` (con `GITHUB_TOKEN`):

- Etiqueta exactamente una de `qa:auto`, `qa:needs-human`, `qa:blocked`; quita
  `qa:approved` si el SHA cambió (aprobación vencida).
- Comentario único, actualizado en cada corrida, con resumen legible y el JSON
  entre `<!-- qa-pilot:decision` y `-->`.
- Status `qa-pilot/decision` sobre el SHA: `success` si `auto`, `pending` si
  `escalate`, `failure` si `blocked`.
- Si `auto`: activa auto-merge (`gh pr merge --auto --squash`). Si el PR ya se
  puede mergear (el status recién puesto era lo último que faltaba), GitHub no
  acepta auto-merge y se mergea directo, solo si el head sigue en el SHA evaluado.

`qa-pilot approve-check` (job `approval`, en eventos `labeled` e
`issue_comment`): lee el JSON del comentario; si `sha` = HEAD del PR y el actor
del evento está en `approvers` y aplicó `qa:approved` o comentó `/qa approve`,
pone el status en `success`, cambia la etiqueta a `qa:approved`, marca el
comentario de decisión como aprobado, reacciona 👍 al comentario y activa
auto-merge. Si no, responde en el PR con el motivo y reacciona 👎. Se usa etiqueta o comentario porque el agente abre los PRs
con el usuario del dev y GitHub no permite aprobar un PR propio.

Branch protection requiere `qa-pilot/decision`.

## 8. Preset de Playwright (`@qa-pilot/playwright`)

- `defineQaConfig(overrides?)`: lee `qa/qa-pilot.yaml`, crea un proyecto
  `setup` y un proyecto por rol × viewport (`mobile` 390×844, `desktop`
  1280×800). `outsider` (con `expect: rejected`) no recibe sesión. Activa
  `reducedMotion: 'reduce'`, `retries: 1`, el reporter de qa-pilot y
  `baseURL` = `app.url`.
- `globalSetup` de login por rol usando el adaptador de `auth`, guardando
  `qa-results/.auth/<rol>.json`.
- Fixtures: `qa.snap(page, name, {mask})` (toHaveScreenshot con animaciones
  apagadas, en tema claro y oscuro vía `emulateMedia`), `qa.a11y(page)` (axe;
  falla con violaciones `serious`/`critical`), `qa.role` (rol del proyecto).
- Reporter: mapea tags `@J<n>` a `journey`, distingue `flaky` (pasó al
  reintentar) y `visual-diff` (fallo de `toHaveScreenshot`), copia los diffs a
  `qa-results/artifacts/`.

## 9. Adaptadores

**Login** (`globalSetup`):
- `supabase-magiclink`: con `SUPABASE_SERVICE_ROLE_KEY` crea el usuario si no
  existe y genera un magic link; visita `callback?token_hash=…`. Se niega si la
  URL de Supabase no es local.
- `form`: abre `login_url`, llena `fields` con el email del rol y la contraseña
  de `password_env`.
- `none`: sin sesión.

**Entorno** (`qa-pilot run`):
- `supabase-local`: `npx supabase start`, `npx supabase db reset`, lee
  `npx supabase status -o env` y exporta según `env_map`.
- `docker-compose`: `docker compose -f <file> up -d --build`, al final `down`.
- `command`: solo `setup`/`start`.

`qa-pilot run`: entorno → `setup` → `seed` → `start` en segundo plano → espera a
`url` → corre `checks` → ingiere → `route` → apaga lo que levantó. Es el mismo
comando en CI y en local.

## 10. Integraciones de la fase 1

**Workflow reutilizable** `workflow/qa.yml` con dos jobs: `checks`
(`pull_request`: checkout con historia, Node, `npx qa-pilot run --base`,
`npx qa-pilot publish`, sube `qa-results` como artifact) y `approval`
(`pull_request` labeled e `issue_comment`: `npx qa-pilot approve-check`).

**App de ejemplo** `examples/notes`: Node + Express, sesión por cookie, login
por formulario, roles `admin` y `user`, servida con docker-compose. Journeys:
J1 entrar, J2 solo admin borra notas. Sin Supabase: prueba que el estándar es
general.

**Proyecto piloto** (Next.js + Supabase, interno): `qa/` con tres journeys
(entrar y rechazo de otro dominio; solo un rol crea recursos; lectura por
miembros), seed de E2E solo local, tests en el estilo del preset y workflow de
una línea. Excluye flujos que dependen de servicios externos.

**Forge** (rama `feat/mod-qa-escalations`):
- Acciones con parámetros: `ActionDef.params` declara nombre → regex; el
  servidor valida el cuerpo y pasa los valores como variables de entorno
  (`FORGE_PARAM_<NOMBRE>`), nunca interpolados en el comando.
- `mod-qa` reescrito: panel **Escalamientos** que lista PRs `qa:needs-human`
  (vía `gh`), muestra gates, checks y hallazgos del JSON de decisión, KPIs de la
  semana por etiquetas, y acciones *Aprobar* (`qa:approved`), *Pedir cambios*
  (comentario) y *Abrir el PR*. Se retiran las acciones de shell anteriores
  (incluida Lost Pixel, archivado). Relanzar el agente desde la tarjeta queda
  para después (depende de cómo CW recibe el hallazgo).

## 11. Guion de la demo

1. `qa/` del proyecto piloto: lo único que escribe el humano.
2. CW lanza dos issues; el agente abre dos PRs.
3. PR de estilos: `qa:auto`, auto-merge.
4. PR que toca una migración: `qa:needs-human`, aparece en Forge con la
   evidencia; se aprueba desde Forge y se mergea.
5. Mismo `qa-pilot` sobre `examples/notes`: cambia solo `qa/qa-pilot.yaml`.

## 12. Errores

- Router falla cerrado (§6).
- `publish`/`approve-check` sin token o sin PR: error claro, código ≠ 0.
- Forge sin `gh` autenticado: el panel muestra el error y el comando para
  arreglarlo; sin escalamientos muestra un estado vacío explicativo.
- `run` siempre apaga lo que levantó, incluso si un check falla.

## 13. Pruebas

- CLI: Vitest con fixtures (diff + resultados → decisión esperada), incluidos los
  casos #41 (auto) y #42 (escalate) del prototipo, configuración inválida,
  resultado faltante y SHA vencido en `approve-check`.
- Ingestores: fixtures de JUnit, Semgrep y gitleaks.
- Reporter de Playwright: pruebas unitarias sobre resultados simulados.
- `examples/notes`: `qa-pilot run` completo en local debe dar `auto` en `main`
  y `escalate` con un cambio en una ruta protegida.
- Forge: tests de validación de parámetros y del parser del panel con salidas de
  `gh` simuladas.

## 14. Riesgos

- Tiempo de CI (Supabase + build de Next): filtro por rutas en el workflow.
- Imágenes base de screenshots generadas en macOS difieren de Linux: se generan
  con `qa-pilot baselines`, que corre Playwright con `--update-snapshots` dentro
  de la imagen oficial `mcr.microsoft.com/playwright` (la misma que CI); el
  commit resultante activa G3.
- `supabase status -o env` cambia nombres de variables entre versiones de la
  CLI: `env_map` es explícito.
