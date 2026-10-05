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
zona que cambió encerrada en rojo) y la diferencia, y dice cuánto cambió y dónde. Las imágenes se guardan en la rama `qa-pilot/evidence` del repo: si una
regla de branch protection la cubre, el comentario sale sin imágenes. La rama crece
con cada corrida que cambia capturas; se puede borrar cuando estorbe (los comentarios
viejos pierden sus imágenes).
