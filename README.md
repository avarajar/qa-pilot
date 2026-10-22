# qa-pilot

QA automático para apps web con un router de riesgo: lo que no es crítico se aprueba solo y lo crítico escala a una persona con la evidencia lista.

Ver `docs/specs/2026-10-02-qa-pilot-fase-1-design.md`.

## Cómo se usa en un proyecto

1. Crea `qa/` en la raíz con `qa-pilot.yaml`, `protected-paths` y `critical-journeys.md` (ver `examples/notes/qa/`).
2. Escribe los tests de journeys con el preset:

   ```ts
   // playwright.config.ts
   import { defineQaConfig } from '@qa-pilot/playwright'
   export default defineQaConfig()
   ```

   ```ts
   // e2e/j1-entrar.spec.ts
   import { test, expect } from '@qa-pilot/playwright'
   test('entra y ve sus notas', { tag: '@J1' }, async ({ page, qa }) => {
     await page.goto('/notes')
     await expect(page.getByRole('heading', { name: 'Notas' })).toBeVisible()
     await qa.snap(page, 'notas')
     await qa.a11y(page)
   })
   ```

   Los tests corren en paralelo contra el mismo servidor. Si un test sale de la sesión,
   que llame antes a `qa.login(page)` para no invalidar la sesión compartida del rol.
   Si un test cambia datos, `defineQaConfig({}, { isolationHeader: 'x-qa-test' })` manda
   un id distinto por test en ese header para que la app separe sus datos (ver `examples/notes`).

   El comando `setup` del proyecto instala dependencias y el navegador
   (`npm ci && npx playwright install --with-deps chromium`).
3. Agrega el workflow (ver el encabezado de `.github/workflows/qa.yml`; necesita `contents: write` para el auto-merge) y exige el
   status `qa-pilot/decision` en branch protection.
4. En local: `qa-pilot run --base main` corre exactamente lo mismo que CI.

Las imágenes base de screenshots se generan en Linux: `qa-pilot baselines` (Docker)
o en CI con `QA_PILOT_E2E_ARGS=--update-snapshots`. Commitearlas escala por G3.

Cuando una captura cambia, el comentario del PR muestra el antes, el después (con la
zona que cambió encerrada en rojo) y la diferencia, y dice qué elementos hay en esa zona,
cuánto cambió y dónde. Si el workflow recibe el secreto opcional `anthropic-api-key`, el job
`publish` además le pide a Claude una frase de qué cambió ("los botones «Borrar» pasaron
de rojo a verde"), marcada como IA. Usa `claude-opus-5-5` (cámbialo con `QA_PILOT_AI_MODEL`)
y describe hasta 5 capturas por corrida. La clave no llega al job que corre el código del PR. Las imágenes se guardan en la rama `qa-pilot/evidence` del repo: si una
regla de branch protection la cubre, el comentario sale sin imágenes. La rama crece
con cada corrida que cambia capturas; se puede borrar cuando estorbe (los comentarios
viejos pierden sus imágenes).

## Video de QA

Cuando un PR escala o queda bloqueado, qa-pilot puede armar un video corto (≤ 90 s) que
muestra la app recorrida en cada journey crítico, se detiene donde algo cambió o falló
(el antes y el después, o el mensaje del error) y termina con el veredicto. El comentario
del PR trae una vista previa en GIF enlazada al mp4. El video nunca cambia ni atrasa la
decisión: los jobs de video corren después de `publish`, y si fallan el comentario lo dice
en una línea.

**Cómo activarlo.** En `qa/qa-pilot.yaml` de la rama base (un PR no puede prenderlo para sí mismo):

```yaml
video:
  enabled: true
  max_seconds: 90           # opcional
  project: admin-desktop    # opcional: proyecto de Playwright que se graba
```

El workflow del proyecto necesita además `actions: read` en `permissions` (ver el
encabezado de `.github/workflows/qa.yml`).

**Cuándo se genera.**
- Si el router escala (`escalate`) o bloquea (`blocked`).
- A mano, con el label `qa-video` (configurable con el input `video-label`), aunque el PR
  haya pasado solo. El label vale al ponerlo: genera el video de la última corrida sin
  repetir los tests. Si después llega un commit nuevo no se genera otro; para repetirlo,
  quita y vuelve a poner el label. Si los resultados de esa corrida ya no están (vencen a
  los 14 días o el PR avanzó de commit), el comentario lo avisa.

Con el video activado, el preset graba solo el proyecto elegido en cada corrida; el guion y
el render, que es lo caro, ocurren solo en los casos de arriba. Con el secreto
`anthropic-api-key`, Claude redacta los subtítulos, la portada y el cierre; los hechos
(estado de cada journey, compuertas, archivos) salen siempre de la corrida. Sin clave se usa
una plantilla. Los tres jobs están separados: el que tiene la clave no abre video ni Chrome,
el que renderiza no tiene secretos ni escritura y el que publica solo valida y copia.

En local: `QA_PILOT_VIDEO=1 qa-pilot run --base main`, luego `qa-pilot video script` (lee el
PR de `GITHUB_EVENT_PATH`) y `qa-pilot video render`, con `@qa-pilot/video` instalado junto a
`qa-pilot`.

**Licencia de Remotion.** El render usa [Remotion](https://www.remotion.dev/docs/license), que
no es MIT. Es gratis para personas, organizaciones con fines de lucro de hasta 3 empleados y
sin ánimo de lucro. Las empresas de 4 o más necesitan una licencia de empresa: para renders
automáticos es el plan "Automators", US$0,01 por render, con un mínimo de US$100 al mes.
qa-pilot sigue siendo MIT, pero quien active el video en una empresa de 4 o más personas
asume esa licencia. Por eso el video viene apagado.

**Peso en la rama de evidencia.** El mp4 (≤ 15 MB, 720p) y el GIF (≤ 5 MB) se guardan en
`qa-pilot/evidence`, bajo `pr-<n>/<sha7>/video/`. Son varios MB por PR que escala, así que la
rama crece más rápido; se puede borrar cuando estorbe (los comentarios viejos pierden sus videos).
