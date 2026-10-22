# Video de QA por PR · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando un PR escala, se bloquea o lleva el label `qa-video`, qa-pilot genera un mp4 de ≤ 90 s con los journeys grabados, el guion de Claude y el veredicto, y lo enlaza en el comentario del PR.

**Architecture:**
- El preset de Playwright graba el proyecto elegido y el reporter escribe `timeline.json`.
- El CLI (`qa-pilot`, sin dependencias pesadas) arma el plan de segmentos, pide el guion a Claude y publica.
- Un paquete nuevo, `@qa-pilot/video`, renderiza con Remotion. El CLI lo carga con `import()` dinámico, así que quien no usa video no lo instala.
- En el workflow, guion, render y publicación van en tres jobs separados, para que el render no tenga secretos.

**Tech Stack:**
- TypeScript (NodeNext, ESM), pnpm workspace, vitest.
- Playwright ≥ 1.50.
- `@anthropic-ai/sdk`, ya presente en el CLI, y ajv.
- Remotion 4 (`remotion`, `@remotion/bundler`, `@remotion/renderer`) con React 19.
- GitHub Actions.

**Spec:** `docs/specs/2026-10-22-video-de-qa-design.md`. Léelo antes de empezar cualquier tarea.

## Global Constraints

- **El video nunca cambia ni atrasa la decisión.** El status `qa-pilot/decision`, los labels y el comentario se publican igual que hoy, y los jobs de video corren después de `publish`.
- **Viene apagado por defecto:** `video.enabled: false`, `video.max_seconds: 90`, y `video.project` es opcional.
- **`video.enabled` se lee del `qa-pilot.yaml` de la rama base, nunca del PR.**
- **Cuándo se genera:** decisión `escalate` o `blocked`, o el evento `labeled` con el label `qa-video`. El label vale solo al ponerlo.
- **Hechos y redacción van separados.** Estado de cada journey, compuertas, archivos y mensajes salen de `decision.json` o `timeline.json`. Claude solo redacta subtítulos, la portada y el cierre.
- **Sin Claude se usa plantilla.** Si no hay clave o Claude falla, el guion se arma por plantilla y el video sale igual.
- **Todo lo que viene de `qa-results/` lo controla el PR:** se valida su forma, se limita el largo de los textos y se escapa al renderizar el comentario.
- **Aislamiento:**
  - el job de render no tiene `ANTHROPIC_API_KEY` ni token con escritura;
  - el job con la clave no abre video ni Chrome;
  - el job con escritura solo valida y copia archivos.
- **Formato del video:** 1280×720, 30 fps, H.264; mp4 ≤ 15 MB, GIF ≤ 5 MB, clip de Playwright ≤ 20 MB.
- **Duraciones:** portada 3 s, veredicto 4 s, journey completo ≤ 15 s, parada en un hallazgo 5 s y resumen 2 s por journey.
- **Textos visibles en español**, como el resto del repo, con comentarios cortos en español.
- **Versiones de Remotion:** `remotion`, `@remotion/bundler` y `@remotion/renderer` en la misma versión exacta, la más nueva que tenga al menos dos semanas (`npm view remotion time`).

## Review Focus

1. **Approval antes de que termine el video.** Si `approveCheck` re-renderiza el comentario mientras el video se genera, la sección del video se mantiene. Si el video se publica después de una aprobación, el "Aprobado por @x" se mantiene. Lo prueban las tareas 6 y 7.
2. **Video viejo sobre una corrida nueva.** Si el comentario ya es de otro SHA, `video publish` no lo toca. Lo prueba la tarea 7.
3. **`timeline.json` malicioso o roto** (rutas con `../`, números no finitos, textos gigantes, JSON inválido). Se descarta la entrada o el archivo y no se cae nada. Lo prueba la tarea 3.
4. **PR sin journeys grabados** (el e2e no corrió o no hay tests con `@J`). El video sale con portada, resumen vacío y veredicto. No falla. Lo prueba la tarea 4.
5. **El job de render falla o se pasa del tiempo.** El comentario termina en "No se pudo generar el video" y no se queda en "generando…". Lo prueban las tareas 7 y 9.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `spec/qa-pilot.schema.json`, `packages/cli/src/config.ts`, `types.ts` | `video` en la configuración, `videoProject()`, prosa de los journeys |
| `packages/playwright/src/config.ts` | grabar solo el proyecto del video cuando `QA_PILOT_VIDEO=1` |
| `packages/cli/src/run.ts` | pasar `QA_PILOT_VIDEO` al contenedor del e2e |
| `packages/playwright/src/reporter.ts`, `timeline.ts` (nuevo) | escribir `timeline.json` y copiar los clips |
| `packages/cli/src/timeline.ts` (nuevo) | `parseTimeline()`: valida lo que viene del PR |
| `packages/cli/src/video-plan.ts` (nuevo) | `planVideo()`, `previewPlan()`: segmentos y presupuesto de tiempo |
| `packages/cli/src/video-script.ts` (nuevo) | `templateScript()`, `claudeScript()`, `validateScript()` |
| `packages/cli/src/comment.ts`, `publish.ts` | sección `### Video`, estado en `Decision`, `publishVideo()`, `wantsVideo()` |
| `packages/cli/src/github.ts` | `findArtifactRun()` |
| `packages/cli/src/video-commands.ts` (nuevo) | `qa-pilot video wanted / source / script / render / publish` |
| `packages/video/` (nuevo) | composición de Remotion y `render()` |
| `.github/workflows/qa.yml`, `README.md` | jobs `video-script`, `video-render`, `video-publish` y documentación |

## Tipos compartidos (en `packages/cli/src/types.ts`; los usan todas las tareas)

```ts
export type VideoConfig = { enabled: boolean; max_seconds: number; project?: string }
// QaConfig gana: video: VideoConfig
// Journey gana: description: string   (prosa bajo el "## J<n> · nombre", sin el encabezado)

export type TimelineEntry = {
  journey: string            // 'J1'
  title: string              // título del test, ≤ 120
  project: string            // 'admin-desktop'
  status: 'passed' | 'failed'
  video: string              // 'artifacts/video-<algo>.webm'
  durationMs: number
  steps: Array<{ title: string; atMs: number }>        // ≤ 50, title ≤ 120
  marks: Array<{ kind: 'snap' | 'failure'; name?: string; atMs: number }>  // name = stem de la captura, p. ej. 'notas-light'
}
export type Timeline = { version: 1; entries: TimelineEntry[] }

export type JourneyStatus = 'pass' | 'changed' | 'failed'
export type VideoSegment =
  | { kind: 'cover'; seconds: number }
  | { kind: 'clip'; journey: string; status: JourneyStatus; video: string; fromMs: number; toMs: number; playbackRate: number; seconds: number }
  | { kind: 'stop'; journey: string; images?: { before?: string; after?: string }; text: string; ai: boolean; seconds: number }
  | { kind: 'summary'; journeys: Array<{ journey: string; status: JourneyStatus }>; more: number; seconds: number }
  | { kind: 'verdict'; seconds: number }
export type VideoPlan = { version: 1; fps: 30; width: 1280; height: 720; segments: VideoSegment[]; totalSeconds: number }

export type VideoFacts = {
  pr: { number: number; title: string }
  decision: Decision['decision']
  gates: Gate[]
  journeys: Array<{ id: string; name: string; status: JourneyStatus }>
}
export type VideoScript = {
  cover: { title: string; subtitle: string }       // title lo pone el código: 'PR #<n> · <título>'
  captions: Record<string, string>                 // por journey: 'J1 · La persona entra y ve sus notas', ≤ 90
  closing: string                                  // ≤ 140
  ai: boolean
}

export type VideoState =
  | { state: 'pending' }
  | { state: 'ready'; mp4: string; gif: string; seconds: number }
  | { state: 'failed'; reason: string }
// Decision gana: video?: VideoState; approvedBy?: string
```

---

### Task 1: `video` en la configuración

**Files:**
- Modify: `spec/qa-pilot.schema.json`, `packages/cli/src/types.ts`, `packages/cli/src/config.ts`, `packages/cli/src/index.ts`
- Test: `packages/cli/src/config.test.ts`

**Interfaces:**
- Produces:
  - `videoProject(config: QaConfig): string`;
  - los tipos compartidos de arriba (todos, aunque los usen tareas posteriores);
  - `Journey.description`;
  - `index.ts` exporta `videoProject` y `parseJourneys`.

- [ ] **Step 1: Escribir los tests que fallan.** Van en `config.test.ts`:
  - `aplica defaults de video`: con `minimal`, `c.config.video` es `{ enabled: false, max_seconds: 90 }`.
  - `rechaza max_seconds fuera de rango`: `video: { max_seconds: 5 }` lanza `ConfigError`. El rango válido es 10–300.
  - `parseJourneys guarda la prosa`: para `## J1 · Entrar\nLínea a.\nLínea b.\n\n## J2 · Borrar\nX.`, da `[{ id: 'J1', name: 'Entrar', description: 'Línea a.\nLínea b.' }, { id: 'J2', name: 'Borrar', description: 'X.' }]`.
  - `videoProject`, con estos casos:
    - si `video.project: 'user-mobile'` está puesto → `'user-mobile'`;
    - con los roles `{ anon: { expect: 'rejected' }, admin: {}, user: {} }` → `'admin-desktop'`;
    - sin roles → `'desktop'`;
    - si todos los roles son `rejected` (`{ anon: rejected }`) → `'anon-desktop'`.
  - Ajustar los `toEqual` de `parseJourneys` que ya existen para que incluyan `description`.

- [ ] **Step 2:** `pnpm --filter qa-pilot test config` → FAIL.

- [ ] **Step 3: Implementar.**
  - En el schema, agregar `video` (`additionalProperties: false`):
    - `enabled`: boolean, default `false`;
    - `max_seconds`: integer entre 10 y 300, default `90`;
    - `project`: string.
  - En `readConfig`, agregar `data.video ??= {}` para que ajv aplique los defaults.
  - `parseJourneys` acumula las líneas hasta el siguiente `## ` y las recorta.
  - `videoProject` sigue la regla de nombres de `defineQaConfig` (`<rol>-<viewport>`).

- [ ] **Step 4:** `pnpm --filter qa-pilot test && pnpm --filter qa-pilot typecheck` → PASS.

- [ ] **Step 5: Commit.** `feat(config): opción video y prosa de los journeys`

### Task 2: Grabar solo el proyecto del video

**Files:**
- Modify: `packages/playwright/src/config.ts`, `packages/cli/src/run.ts:122`
- Test: `packages/playwright/src/config.test.ts`, `packages/cli/src/run.test.ts`

**Interfaces:**
- Consumes: `videoProject` (tarea 1).
- Produces: con `QA_PILOT_VIDEO=1`, el proyecto `videoProject(config)` lleva `use.video = { mode: 'on', size: { width: 1280, height: 720 } }`. Ningún otro proyecto graba.

- [ ] **Step 1: Escribir los tests que fallan.**
  - `graba solo el proyecto del video con QA_PILOT_VIDEO=1`: con los roles del ejemplo `notes`, solo `admin-desktop` tiene `use.video.mode === 'on'`.
  - `sin QA_PILOT_VIDEO no graba`: ningún proyecto tiene `use.video`.
  - En `run.test.ts`, `pasa QA_PILOT_VIDEO al contenedor`: el comando dockerizado incluye `QA_PILOT_VIDEO` en la lista de `env`.

- [ ] **Step 2:** `pnpm --filter @qa-pilot/playwright test config && pnpm --filter qa-pilot test run` → FAIL.

- [ ] **Step 3: Implementar.**
  - En `defineQaConfig`, después de armar `projects`, si `process.env.QA_PILOT_VIDEO === '1'` se agrega `video` al `use` del proyecto cuyo `name === videoProject(config)`.
  - En `run.ts`, se agrega `'QA_PILOT_VIDEO'` a la lista de `env` de `dockerize`.

- [ ] **Step 4:** Repetir el comando del paso 2 → PASS.

- [ ] **Step 5: Commit.** `feat(playwright): grabar video del proyecto elegido`

### Task 3: `timeline.json` desde el reporter y su validación

**Files:**
- Create: `packages/playwright/src/timeline.ts`, `packages/cli/src/timeline.ts`
- Modify: `packages/playwright/src/reporter.ts`, `packages/cli/src/index.ts`
- Test: `packages/playwright/src/reporter.test.ts`, `packages/cli/src/timeline.test.ts`

**Interfaces:**
- Consumes: `Timeline`, `TimelineEntry` (tarea 1), con `import type` desde `qa-pilot`.
- Produces:
  - `timelineEntry(test: TestCase, result: TestResult, copy: (src: string, name: string) => string | null): TimelineEntry | null`, en `playwright/src/timeline.ts`;
  - `qa-results/timeline.json`;
  - `parseTimeline(raw: unknown): Timeline`, en `cli/src/timeline.ts`, exportado desde `index.ts`.

- [ ] **Step 1: Escribir los tests que fallan.**
  - **Reporter:**
    - `test con @J1 y adjunto video → entrada con pasos y marcas`. Con un `TestResult` falso con `startTime`, dos `steps` (`{ title: 'page.goto(/notes)', startTime: +500ms }`, `{ title: 'expect.soft(page).toHaveScreenshot(notas-light.png)', startTime: +2000ms, category: 'expect' }`), `status: 'passed'`, `duration: 3000` y un adjunto `{ name: 'video', path }`, se espera que:
      - `steps` sea `[{ title: 'page.goto(/notes)', atMs: 500 }, …]`;
      - `marks` sea `[{ kind: 'snap', name: 'notas-light', atMs: 2000 }]`;
      - `video` sea `'artifacts/video-admin-desktop-j1-<n>.webm'`.
    - `test fallido → marca failure al final`: `marks` contiene `{ kind: 'failure', atMs: 3000 }`.
    - `sin adjunto video o sin @J → null`.
    - `clip de más de 20 MB → null`.
    - `onEnd escribe timeline.json` con `{ version: 1, entries }`, ordenado por número de journey. Solo se queda el último intento de cada test.
  - **`parseTimeline`:**
    - `acepta la forma que escribe el reporter`.
    - `descarta entradas con video fuera de artifacts/` (`../x.webm`, `artifacts/a/b.webm`, `artifacts/x.mp4`).
    - `descarta entradas con números no finitos o negativos`.
    - `recorta textos`: title a 120 y step titles a 120, con máximo 50 pasos y 20 marcas.
    - `version distinta o no-objeto → { version: 1, entries: [] }`.

- [ ] **Step 2:** `pnpm --filter @qa-pilot/playwright test reporter && pnpm --filter qa-pilot test timeline` → FAIL.

- [ ] **Step 3: Implementar.**
  - El nombre del clip es `video-<project>-<journey en minúscula>-<índice>.webm`, que cumple `/^artifacts\/[A-Za-z0-9._-]+\.webm$/`.
  - Los pasos se toman de `result.steps` de primer nivel, con categorías `test.step`, `pw:api` y `expect`.
  - Las marcas `snap` salen de los pasos cuyo título contiene `toHaveScreenshot(<stem>.png)`.
  - `QaReporter.onTestEnd` llama a `timelineEntry` con un `copy` que copia a `<outputDir>/artifacts/`. `onEnd` escribe `timeline.json` aunque quede vacío.

- [ ] **Step 4:** Repetir el comando del paso 2 → PASS. Correr además todo `pnpm -r test`.

- [ ] **Step 5: Commit.** `feat(reporter): timeline de los journeys grabados`

### Task 4: Plan de segmentos y presupuesto de tiempo

**Files:**
- Create: `packages/cli/src/video-plan.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/video-plan.test.ts`

**Interfaces:**
- Consumes: `Timeline`, `Decision`, `VideoPlan`, `JourneyStatus`.
- Produces:
  - `journeyStatuses(d: Decision, t: Timeline): Map<string, JourneyStatus>`;
  - `planVideo(input: { decision: Decision; timeline: Timeline; maxSeconds: number }): VideoPlan`;
  - `previewPlan(plan: VideoPlan): VideoPlan`.

  Las tres se exportan desde `index.ts`.

Reglas, tomadas de la sección 4 del spec y de las restricciones globales:

- **Estado de cada journey:**
  - `failed` si hay un hallazgo `test-failed`, `a11y` o `error` con ese `journey`, o si la entrada del timeline tiene `status: 'failed'`;
  - si no, `changed` si hay un `visual-diff`;
  - si no, `pass`.
- **Orden de los segmentos:** `cover`, después los journeys en orden numérico y al final `verdict`.
- **Un journey con hallazgo va completo,** como un `clip` desde 0 hasta la primera marca, seguido de un `stop` y luego un `clip` desde la marca hasta el final:
  - para un visual-diff, la marca es la `snap` cuyo `name` coincide con el stem de la captura del hallazgo;
  - para un fallo, es la marca `failure`;
  - si no hay marca, se usa el clip entero seguido del `stop`.
- **Velocidad de los clips:** `playbackRate = clamp(clipMs / 15000, 1, 4)` y `seconds = (toMs - fromMs) / 1000 / playbackRate`. La suma de los clips de un journey no pasa de 15 s.
- **Contenido del `stop`:**
  - para un visual-diff:
    - `images.before = expected`;
    - `images.after = marked ?? actual`;
    - `text = snap.ai ?? changeText` (el que ya existe en `comment.ts`, exportado), con `ai: !!snap.ai`.
  - para un fallo: `text = finding.message` y `ai: false`.
  - En los dos casos, `seconds: 5`.
- **Journeys sin hallazgo:** los que van seguidos se agrupan en un `summary` con 2 s por journey.
- **Si el total pasa de `maxSeconds`:**
  1. Se pasan journeys completos a resumen en este orden: `pass`, después `changed`, después `failed`; dentro de cada grupo, primero el de número más alto.
  2. Si con todo en resumen aún no cabe, se reparte `(maxSeconds - 7)` entre los journeys, con un mínimo de 0,5 s cada uno.
  3. Los que no quepan se cuentan en `more` del último `summary`.
- **`totalSeconds`** es la suma de los segmentos y siempre es ≤ `maxSeconds`.
- **`previewPlan`** devuelve `cover` + el primer `stop` (o el primer `clip` si no hay ninguno) + `verdict`, con `totalSeconds` ≤ 8.

- [ ] **Step 1: Escribir los tests que fallan.**
  - `escalado con un visual-diff en J2`: los segmentos son `cover, summary(J1), clip(J2 0→marca), stop(J2), clip(J2 marca→fin), summary(J3), verdict`.
  - `bloqueado por fallo en J1`: `stop` con el `message` y `ai: false`.
  - `clip de 60 s → playbackRate 4 y ≤ 15 s`.
  - `30 journeys fallidos con clips de 20 s → totalSeconds ≤ 90` y los completos que quedan son los de número más bajo.
  - `200 journeys → more > 0 y totalSeconds ≤ 90`.
  - `timeline vacío → [cover, verdict]`.
  - `previewPlan ≤ 8 s y empieza con cover`.

- [ ] **Step 2:** `pnpm --filter qa-pilot test video-plan` → FAIL.

- [ ] **Step 3:** Implementar en `video-plan.ts` y exportar `changeText` desde `comment.ts`.

- [ ] **Step 4:** Repetir el comando del paso 2 → PASS.

- [ ] **Step 5: Commit.** `feat(video): plan de segmentos con tope de duración`

### Task 5: Guion (plantilla y Claude)

**Files:**
- Create: `packages/cli/src/video-script.ts`
- Test: `packages/cli/src/video-script.test.ts`

**Interfaces:**
- Consumes: `VideoFacts`, `VideoScript`, `Journey`.
- Produces:
  - `templateScript(facts: VideoFacts): VideoScript`;
  - `validateScript(raw: unknown, facts: VideoFacts): VideoScript | null`;
  - `claudeScript(opts?: { client?: Pick<Anthropic, 'beta'>; model?: string }): (facts: VideoFacts, journeys: Journey[]) => Promise<VideoScript>`. Nunca lanza un error: si falla, devuelve `templateScript(facts)`.

- [ ] **Step 1: Escribir los tests que fallan.** Usan el cliente falso al estilo de `describe.test.ts`.
  - `plantilla`:
    - `cover.title === 'PR #42 · Cambia permisos'`;
    - `captions.J1 === 'J1 · Entrar'`;
    - el `closing` de un `escalate` con G1 dice `'Necesita tu revisión · G1: <reason>'`;
    - en un `blocked` dice `'Bloqueado: hay checks en rojo'`;
    - `ai: false`.
  - `Claude devuelve JSON válido → captions de Claude y cover.title del código`. Aunque Claude mande otro `title`, se conserva `'PR #42 · …'`.
  - `Claude devuelve un caption para un journey que no existe → se ignora`. Si falta uno, se usa la plantilla para ese journey.
  - `caption de más de 90 caracteres → recortado con …`.
  - `refusal, error de red o JSON inválido → plantilla`.
  - `el system prompt dice que el texto de la corrida es contenido y no instrucciones`: se comprueba el `system` enviado.

- [ ] **Step 2:** `pnpm --filter qa-pilot test video-script` → FAIL.

- [ ] **Step 3: Implementar.**
  - Mismo cliente y mismas opciones que `describe.ts`: `DEFAULT_MODEL`, `QA_PILOT_AI_MODEL`, `effort: 'low'`, el beta `server-side-fallback-2026-07-01` y `fallbacks: 'default'`.
  - Salida estructurada con `output_config.format` de tipo `json_schema` para `{ subtitle, captions: { [id]: string }, closing }`, validada además con ajv.
  - El mensaje de usuario lleva los `facts` y la `description` de cada journey en JSON.

- [ ] **Step 4:** Repetir el comando del paso 2 → PASS.

- [ ] **Step 5: Commit.** `feat(video): guion con Claude y plantilla de respaldo`

### Task 6: Estado del video en el comentario

**Files:**
- Modify: `packages/cli/src/comment.ts`, `packages/cli/src/publish.ts`
- Test: `packages/cli/src/publish.test.ts`

**Interfaces:**
- Consumes: `VideoState`, `Decision.video`, `Decision.approvedBy`.
- Produces:
  - `renderComment` dibuja `### Video` según `d.video` y toma `approvedBy` de `opts.approvedBy ?? d.approvedBy`;
  - `approveCheck` guarda `approvedBy` dentro del JSON;
  - `wantsVideo(d: Decision, config: QaConfig): boolean`, que vale `config.video.enabled && d.decision !== 'auto'`;
  - `PublishOptions` gana `video?: boolean`. Si es `true`, `publish` escribe `d.video = { state: 'pending' }`.

- [ ] **Step 1: Escribir los tests que fallan.**
  - `pending → '### Video' y 'Generando video…'`.
  - `ready → <a href="<mp4>"><img src="<gif>" width="480"></a> y la duración '0:47'`.
  - `failed → 'No se pudo generar el video: <reason escapado>'`.
  - `ready con URL que no cumple /^https:\/\/[^\s"'<>]+\/video\/(video\.mp4|preview\.gif)$/ → no dibuja imagen ni link`.
  - `approveCheck conserva la sección del video` (Review Focus 1): se publica con `video: true`, se aprueba y el comentario sigue teniendo `### Video`.
  - `extractDecision` recupera `approvedBy` después de aprobar.
  - `publish con video: true en auto no marca pending`.

- [ ] **Step 2:** `pnpm --filter qa-pilot test publish` → FAIL.

- [ ] **Step 3:** Implementar. La sección `### Video` va antes de `<details>Hallazgos`.

- [ ] **Step 4:** Repetir el comando del paso 2 → PASS.

- [ ] **Step 5: Commit.** `feat(comment): sección de video y aprobación persistente`

### Task 7: Publicar el video y encontrar la corrida anterior

**Files:**
- Modify: `packages/cli/src/publish.ts`, `packages/cli/src/github.ts`
- Test: `packages/cli/src/publish.test.ts`, `packages/cli/src/github.test.ts`

**Interfaces:**
- Consumes: `GitHub`, `uploadEvidence`, `extractDecision`, `renderComment`.
- Produces:
  - `publishVideo(gh: GitHub, pr: number, sha: string, files: { mp4: Buffer; gif: Buffer; seconds: number } | { failed: string }): Promise<'updated' | 'stale' | 'missing'>`;
  - `GitHub.findArtifactRun(name: string, headSha: string): Promise<number | null>`.

**Comportamiento de `publishVideo`:**
- Lee el comentario con `findComment` y `extractDecision`.
- Si no hay comentario, devuelve `'missing'`. Si `d.sha !== sha`, devuelve `'stale'` y no toca nada (Review Focus 2).
- Valida los archivos:
  - el mp4 tiene `ftyp` en los bytes 4–8 y pesa ≤ 15 MB;
  - el GIF empieza con `GIF8` y pesa ≤ 5 MB.

  Si no cumplen, cambia a `{ failed: 'el video no pasó la validación' }`.
- Sube los archivos con `uploadEvidence` a `pr-<n>/<sha7>/video/video.mp4` y `…/preview.gif`, y re-renderiza con `d.video = ready | failed`. Así se conserva `approvedBy` (Review Focus 1).

**Comportamiento de `findArtifactRun`:** llama a `GET /repos/{repo}/actions/artifacts?name=<name>&per_page=100`, filtra por `workflow_run.head_sha === headSha` y `expired === false`, y devuelve el `workflow_run.id` del más reciente.

- [ ] **Step 1: Escribir los tests que fallan.**
  - `ready`: sube 2 archivos y el comentario queda en `ready` con las URLs de la evidencia.
  - `stale`: con un comentario de otro SHA, no sube nada.
  - `failed`: el comentario queda en `failed`, sin subidas.
  - `mp4 inválido → failed`.
  - `uploadEvidence lanza → failed con 'no se pudo subir el video'`.
  - `después de approveCheck, publishVideo conserva 'Aprobado por @x'`.
  - `findArtifactRun`, con un `fetchFn` falso: elige el más reciente del SHA, ignora los vencidos y devuelve `null` si no hay.

- [ ] **Step 2:** `pnpm --filter qa-pilot test publish github` → FAIL.

- [ ] **Step 3:** Implementar. Agregar `findArtifactRun` también al `fakeGitHub` de los tests.

- [ ] **Step 4:** Repetir el comando del paso 2 → PASS.

- [ ] **Step 5: Commit.** `feat(publish): publicar el video en el comentario`

### Task 8: Paquete `@qa-pilot/video` (Remotion)

Antes de empezar esta tarea, carga el skill `remotion-best-practices`.

**Files:**
- Create:
  - `packages/video/package.json`, `tsconfig.json`, `vitest.config.ts`;
  - `src/index.ts`, `src/render.ts`;
  - `src/remotion/index.ts` (con `registerRoot`), `Root.tsx`, `QaVideo.tsx`;
  - `src/remotion/segments/{Cover,Clip,Stop,Summary,Verdict}.tsx`.
- Test: `packages/video/src/render.test.ts`, `packages/video/src/QaVideo.test.tsx`.

**Interfaces:**
- Consumes: `VideoPlan`, `VideoScript`, `VideoFacts`, `previewPlan`, desde `qa-pilot` (`workspace:*`).
- Produces:
  - `render(input: { out: string; plan: VideoPlan; script: VideoScript; facts: VideoFacts }): Promise<{ mp4: string; gif: string; seconds: number }>`;
  - escribe `<out>/video/video.mp4`, `<out>/video/preview.gif` y `<out>/video/video.json`.

**Decisiones fijas:**
- **Archivos para el bundle:** `bundle({ publicDir })` con un directorio temporal que tiene solo los clips e imágenes que referencia el plan, copiados desde `<out>/`. Los componentes los cargan con `staticFile()`. Las rutas ya vienen validadas por `parseTimeline` y `EVIDENCE_PATH`.
- **Composiciones:** `QaVideo` y `QaPreview` (la segunda usa `previewPlan`). `calculateMetadata` toma `durationInFrames = ceil(totalSeconds × 30)`.
- **Mp4:** `renderMedia({ codec: 'h264', crf: 28 })`.
- **GIF:** `renderMedia` con `codec: 'gif'`, `scale: 0.5` y `everyNthFrame: 3` sobre `QaPreview`.
- **Clips:** `Clip` usa `<OffthreadVideo>` con `startFrom`, `endAt` y `playbackRate` del segmento. Lleva el subtítulo `script.captions[journey]` abajo y una marca arriba: `✓` verde, `⚠ cambió` ámbar o `✗ falló` rojo.
- **Paradas:** `Stop` muestra el antes y el después lado a lado, rotulados "Antes" y "Después", con el `text`. Si `ai` es verdadero, agrega "(IA)".
- **Portada y veredicto:** `Cover` usa `script.cover`. `Verdict` muestra la decisión, las compuertas (`G1 · Ruta protegida: <reason>`, con los nombres de `GATE_NAMES`, que se exportan desde `comment.ts`) y `script.closing`.
- **Estilo:** sobrio, fondo `#0f172a`, texto claro, tipografía del sistema y transiciones de corte o fundido de 6 frames, sin más efectos.

Pasos:

- [ ] **Step 1: Escribir los tests que fallan.**
  - `QaVideo.test.tsx`, con `@testing-library/react` o un render directo de la composición con props: dibuja un `Sequence` por segmento con `from` acumulado, y `Verdict` muestra `G1`.
  - `render.test.ts`, con un plan de prueba (cover + clip de 2 s de un `.webm` de 64×36 generado en el test con ffmpeg de `@remotion/compositor` o un fixture chico en `test/fixtures/` + verdict): `mp4` existe, empieza con `ftyp` y `seconds ≈ totalSeconds`; el GIF empieza con `GIF8` y pesa < 5 MB. Este test se marca `it.runIf(process.env.QA_PILOT_RENDER_TEST)` porque descarga Chrome.

- [ ] **Step 2:** `pnpm --filter @qa-pilot/video test` → FAIL.

- [ ] **Step 3:** Implementar. Las versiones de Remotion siguen las restricciones globales, con `react` y `react-dom` en `^19.3.1`.

- [ ] **Step 4:** `pnpm --filter @qa-pilot/video test && QA_PILOT_RENDER_TEST=1 pnpm --filter @qa-pilot/video test render` → PASS. Abrir el mp4 generado y mirarlo.

- [ ] **Step 5: Commit.** `feat(video): composición y render con Remotion`

### Task 9: Comandos `qa-pilot video …`

**Files:**
- Create: `packages/cli/src/video-commands.ts`
- Modify: `packages/cli/src/index.ts` (import), `packages/cli/src/cli.ts` (USAGE, `publish` pasa `video` y acepta `--root`)
- Test: `packages/cli/src/video-commands.test.ts`

**Interfaces:**
- Consumes: todo lo anterior. `render` se carga con `await import('@qa-pilot/video')`.
- Produces los subcomandos de `qa-pilot video`. Todos aceptan `--root` y `--out`:

| Subcomando | Qué hace | Necesita |
|---|---|---|
| `wanted` | Imprime `true` o `false` con `wantsVideo(decision.json, loadContract(root).config)` | — |
| `source` | Para el evento `labeled`. Escribe `<out>/decision.json` desde el comentario solo si `d.sha === headSha` del PR, e imprime el `run_id` de `findArtifactRun('qa-results', headSha)`. Termina con 1 y un mensaje claro si no hay comentario, si el SHA es viejo o si no hay artifact | `GITHUB_TOKEN` |
| `script` | Lee `decision.json`, `timeline.json` (con `parseTimeline`; si falta, un timeline vacío), el contrato de `root` y el PR del evento (número y título). Escribe `<out>/video/plan.json`, `facts.json` y `script.json`. Usa Claude si hay `ANTHROPIC_API_KEY` y la plantilla si no | `ANTHROPIC_API_KEY` opcional |
| `render` | Lee esos tres JSON y llama a `render()`. Si `@qa-pilot/video` no está instalado, termina con 1 y el mensaje `instala @qa-pilot/video para generar videos` | — |
| `publish` | Si existen `video.mp4`, `preview.gif` y `video.json`, llama a `publishVideo` con los archivos. Si no, la llama con `{ failed: --reason o 'no se pudo generar el video' }`. El `sha` sale de `<out>/decision.json` si existe y, si no, del head del PR. Imprime el resultado (`updated`, `stale` o `missing`) y termina con 0 | `GITHUB_TOKEN` |

- [ ] **Step 1: Escribir los tests que fallan.** Usan `main([...], io)` y un `register` real, al estilo de `cli.test.ts`.
  - `wanted`: da `true` con escalate o blocked y video activado, y `false` con auto o con video apagado.
  - `script sin clave → script.json con ai: false y plan.json válido`.
  - `script con timeline.json corrupto → plan con [cover, verdict]`.
  - `render sin el paquete → 1 y el mensaje`. Se simula con un import que falla, inyectable.
  - `publish sin archivos → publishVideo con failed` (Review Focus 5).

- [ ] **Step 2:** `pnpm --filter qa-pilot test video-commands` → FAIL.

- [ ] **Step 3:** Implementar. El comando `publish` existente llama a `wantsVideo` con `loadContract(root)`, y pasa `video: true` cuando corresponde.

- [ ] **Step 4:** `pnpm -r test && pnpm -r typecheck` → PASS.

- [ ] **Step 5: Commit.** `feat(cli): comandos qa-pilot video`

### Task 10: Workflow, README y prueba de punta a punta

**Files:**
- Modify: `.github/workflows/qa.yml`, `README.md`, `examples/notes/qa/qa-pilot.yaml` (`video: { enabled: true }`), `.github/workflows/ci.yml` (compilar `packages/video`)

**Cambios en el workflow:**

- **`checks`**, antes de `qa-pilot run`, agrega un paso que lee el flag desde la rama base:
  ```bash
  git worktree add --detach "$RUNNER_TEMP/base" "$BASE_SHA"
  if [ "$(qa-pilot config get video.enabled --root "$RUNNER_TEMP/base/$ROOT")" = true ]; then echo QA_PILOT_VIDEO=1 >> "$GITHUB_ENV"; fi
  ```
  Además sube `qa-results/timeline.json` en el artifact.
- **`publish`:**
  - `qa-pilot publish --root "$ROOT" --out …`;
  - un paso con `id: video` que hace `echo "wanted=$(qa-pilot video wanted --root "$ROOT" --out "$ROOT/qa-results")" >> "$GITHUB_OUTPUT"`;
  - sube `decision.json` como artifact `qa-decision`.
  - Expone `outputs: { video: ${{ steps.video.outputs.wanted }} }`.
- **`video-script`:**
  - Corre si `needs.publish.outputs.video == 'true'`, o en el evento `labeled` con `qa-video`. En ese caso también necesita `video.enabled` de la base, que se lee como en `checks`.
  - Permisos: `contents: read` y `actions: read`. Recibe el secreto `anthropic-api-key`. No instala navegadores.
  - En el camino `labeled`, `qa-pilot video source` da el `run_id` y luego `download-artifact` con `run-id` y `github-token`.
  - Sube el artifact `qa-video-script` con `plan.json`, `facts.json`, `script.json` y los clips e imágenes que referencia el plan.
- **`video-render`:**
  - `needs: video-script`, en `container: mcr.microsoft.com/playwright:v<versión del preset>-noble`.
  - Permisos `contents: read`, **sin secretos** y con `timeout-minutes: 15`.
  - Instala qa-pilot y `@qa-pilot/video`, corre `qa-pilot video render` y sube el artifact `qa-video`.
- **`video-publish`:**
  - `needs: [video-script, video-render]`, con `if: always() && needs.video-script.result != 'skipped'`.
  - Permisos `contents: write`, `pull-requests: write` e `issues: write`.
  - Baja `qa-video` con `continue-on-error` y corre `qa-pilot video publish`. Le pasa `--reason` según lo que haya fallado:
    - si falló `video-script` en el camino `labeled`: `"no están los resultados de esa corrida (vencieron o llegó un commit nuevo)"`;
    - si `video-render` no terminó en `success`: `"el render falló o se pasó del tiempo"`.
- **Decisión de este plan:** en el camino `labeled` no se muestra "Generando video…", porque `video-script` no tiene permisos de escritura. El comentario pasa directo a listo o fallido.
- **Inputs:** un input nuevo documenta el label `qa-video`.

**README:** una sección "Video de QA" que explica:
- cuándo se genera y cómo activarlo;
- la licencia de Remotion, en el texto exacto del spec §6: gratis hasta 3 empleados; las empresas de 4 o más necesitan una licencia de empresa (plan Automators, US$0,01 por render, con un mínimo de US$100 al mes);
- el peso en la rama de evidencia;
- el label `qa-video`, que vale al ponerlo.

- [ ] **Step 1:** Editar el workflow y validar la sintaxis con `actionlint` (`brew install actionlint` si no está) → sin errores.
- [ ] **Step 2:** Prueba local de punta a punta en `examples/notes`:
  1. Introducir un cambio visual (por ejemplo, el color de "Borrar") y correr `QA_PILOT_VIDEO=1 qa-pilot run --root examples/notes --base main`.
  2. Correr `qa-pilot video script --root examples/notes` y luego `qa-pilot video render --root examples/notes`.
  3. El mp4 debe durar ≤ 90 s, mostrar J1 en resumen y J2 completo con la parada del antes y el después. Mirarlo.
- [ ] **Step 3:** Repetir con un fallo, rompiendo un `expect` de J1. Ahora el video tiene que detenerse en el fallo de J1 con su mensaje.
- [ ] **Step 4:** Deshacer los cambios de prueba. `pnpm -r test && pnpm -r typecheck` → PASS.
- [ ] **Step 5: Commit.** `feat(workflow): jobs de video y documentación`

---

## Fuera de este plan (según el spec)

TTS, video por sprint, música, marca por proyecto, otros destinos para el video y acelerar solo los tramos muertos. En esta versión, la velocidad es uniforme por clip, con `playbackRate` entre 1 y 4, y así se decidió aquí.
