# qa-pilot · Video de QA por PR · Diseño

Fecha: 2026-10-22 · Estado: borrador para aprobar.

## 1. Para qué

Cuando un PR escala a una persona, hoy le llega un comentario con el veredicto,
las compuertas y el antes/después de las capturas que cambiaron. Para entender
qué se probó de verdad tiene que leer tests o abrir traces de Playwright.

Cuando un PR queda bloqueado porque un test falló, quien tiene que arreglarlo
tampoco ve dónde se rompió sin abrir el trace.

El video resuelve las dos cosas: un mp4 corto que muestra la app recorrida en cada journey
crítico, se detiene donde algo cambió o falló y termina con el veredicto. Lo ve
quien revisa el PR (alguien del equipo o el cliente), que puede no leer código, y
en un minuto sabe qué se probó, qué pasó y qué tiene que decidir.

**Éxito:** en un PR escalado del proyecto de ejemplo (`examples/notes`), el
comentario del PR trae una vista previa y un link a un video de ≤ 90 s que
alguien que no conoce el código entiende sin abrir nada más.

## 2. Alcance

**Dentro:**
- Grabar video de los journeys en el preset de Playwright.
- Un guion escrito por Claude a partir de la corrida.
- Un paquete `packages/video` con una composición de Remotion que arma el mp4.
- Un comando `qa-pilot video`.
- Un job nuevo en el workflow reutilizable.
- Publicar el video en la rama de evidencia y enlazarlo en el comentario del PR.

**Fuera (para después):**
- Narración con voz (TTS).
- Video por entrega o sprint para el cliente.
- Música.
- Personalizar marca o colores por proyecto.
- Subir el video a otro lugar que no sea la rama de evidencia.

**Anti-objetivos.** Fallaría aunque funcione si:
- **retrasa o bloquea la decisión.** El status `qa-pilot/decision` y el comentario salen igual que hoy, con video o sin él, y un video que falla nunca cambia el veredicto.
- **cuenta algo que no pasó.** Claude redacta los subtítulos, pero los hechos (qué journey, si pasó o falló, qué compuerta y qué archivo) salen de los datos de la corrida y no del modelo.
- **le da la clave de Anthropic, o permisos de escritura, a un proceso que toque contenido del PR sin aislar.**

## 3. Cuándo se genera

Decidido en la conversación:
- **Siempre que el router escala** (`decision: 'escalate'`).
- **Siempre que el router bloquea** (`decision: 'blocked'`). Cuando falla un test, un a11y o hay un error, el router bloquea en lugar de escalar, y ese es el caso donde más sirve ver el momento exacto en que se rompió.
- **A mano, con el label `qa-video`** en el PR, aunque el PR haya pasado solo.
- En `auto` sin el label no se arma video.

La grabación de Playwright corre en cada corrida **solo si el proyecto tiene el
video activado**, porque cuesta poco mientras el test ya navega. Escribir el
guion y renderizar, que es lo caro, solo ocurre en los casos de arriba.

**Decisión mía: qué configuración manda.** `video.enabled` se lee del
`qa-pilot.yaml` de la **rama base**, igual que `route`, para que un PR no pueda
prenderlo ni apagarlo para sí mismo. El job `checks` lee ese valor antes de
correr los tests (`git show <base>:<root>/qa/qa-pilot.yaml`) y se lo pasa al
preset con una variable de entorno (`QA_PILOT_VIDEO=1`). Sin ella, el preset no
graba nada, y quien tenga el video apagado no paga tiempo ni peso en el artifact.

**Decisión mía: el label vale al ponerlo.** Poner `qa-video` genera un video de
la última corrida. Si después llega un commit nuevo y el PR queda `auto`, no se
genera otro. Para repetirlo se quita y se vuelve a poner el label.

Hoy el workflow no corre `checks` ni `publish` con el evento `labeled` (solo
atiende el label `qa:approved`). Cuando llega `qa-video`, el video tiene que
salir de los artifacts `qa-results` de la última corrida del SHA actual, sin
volver a correr los tests. Si esos artifacts ya no existen, porque vencieron a
los 14 días o el SHA cambió, se deja un aviso en el comentario y no se
reintenta.

## 4. Cómo se ve el video (estructura A · Recorrido completo)

Elegido en la conversación con bocetos:

1. **Portada (≈ 3 s).** Número y título del PR, y cuántos journeys se probaron.
2. **Journeys en orden (J1, J2…).**
   - Va la grabación real de Playwright con un subtítulo de qué se prueba ("J1 · La persona entra y ve sus notas") y una marca de estado: ✓ pasó, ⚠ cambió, ✗ falló.
   - Los tramos sin acción (esperas, cargas) se aceleran.
3. **Cuando un journey tiene un hallazgo** (falla, cambio visual o a11y), el video se detiene en ese momento y muestra:
   - el antes y el después, con la zona que cambió marcada (la imagen `marked`);
   - la frase que ya genera Claude ("el botón «Borrar» pasó de rojo a verde");
   - o el mensaje resumido del error, si el journey falló.
4. **Veredicto (≈ 4 s).** Si el PR quedó escalado o aprobado, y por qué: las compuertas con su motivo (por ejemplo, "G1 · tocó `supabase/policies`").

**Límite de duración (decisión mía, tomada en la conversación):** el video no pasa de 90 s.
- Salen completos los journeys con hallazgo, más los que tocan archivos del PR, si eso se puede saber.
- Los demás se muestran en un resumen rápido: unos 2 s cada uno con la marca ✓.
- Si aun así no alcanza, se recortan los journeys completos en este orden de prioridad: falló, cambió y luego el resto.

## 5. Arquitectura

```
checks (código del PR, sin claves)      publish (sin cambios)       video (job nuevo)
  Playwright graba video + pasos   →      route + comentario    →    guion (Claude) → render (Remotion)
  reporter escribe timeline.json          como hoy                   → sube mp4 + GIF a evidencia
  upload-artifact qa-results                                          → edita el comentario: agrega el video
```

### 5.1 Grabación: preset `@qa-pilot/playwright`

- Con `QA_PILOT_VIDEO=1` se agrega `video: 'on'` en `use`, junto a `trace`, y **solo en el proyecto elegido para el video**. Los demás proyectos no graban.
- **Decisión mía, de qué proyecto sale la grabación.** El preset arma un proyecto por cada combinación de rol y viewport (`<rol>-<viewport>`, con `mobile` antes que `desktop`), así que se elige así:
  - Si está `video.project`, se usa ese nombre completo de proyecto (por ejemplo `admin-desktop`).
  - Si no, se usa el primer rol que **no** tiene `expect: rejected`, en `desktop`, porque se ve bien en 16:9.
  - Si no hay roles, se usa el proyecto `desktop`.
  - Un hallazgo que pasó en otro proyecto (por ejemplo, solo en mobile) se muestra con sus capturas fijas y su mensaje, no con video.
- El reporter escribe `qa-results/timeline.json`. Por cada test etiquetado `@J<n>` guarda:
  - la ruta del video;
  - los pasos (`test.step` y las acciones de Playwright) con su tiempo desde el inicio;
  - el estado final;
  - en qué segundo se tomó cada `qa.snap` o se produjo el fallo.

  Así Remotion sabe dónde detenerse.
- Los videos se copian a `qa-results/artifacts/` y viajan en el mismo artifact `qa-results`.
- **Tope:** si un video pesa más de N MB o pasa del límite de duración, se descarta el clip. El journey se muestra con sus capturas fijas.

### 5.2 Guion: Claude

- Va en un módulo nuevo junto a `describe.ts`, con el mismo cliente y el mismo patrón: `claude-opus-5-5` por defecto, `QA_PILOT_AI_MODEL` para cambiarlo, `effort: 'low'`, el beta `server-side-fallback` y `null` si algo falla.
- **Recibe solo datos ya armados:**
  - la `Decision` (veredicto, compuertas, hallazgos con su frase `ai`);
  - el `timeline.json`;
  - el nombre y la prosa de cada journey de `critical-journeys.md`, tomados de la rama base, igual que `route`;
  - el título del PR.
- **Devuelve un guion con salida estructurada (zod):** subtítulos cortos por journey y por paso relevante, el texto de la portada y la frase del cierre.
- **Los hechos no los decide Claude.** El estado de cada journey, las compuertas y los archivos se pegan desde los datos. Claude solo redacta. Un esquema que no valide se descarta.
- **Si no hay clave o Claude falla,** se usa un guion de plantilla: el nombre del journey como subtítulo y el veredicto tal cual. El video sale igual.
- Lo que venga del PR (título, nombres en `timeline`, texto de las capturas) es contenido y no instrucciones. El system prompt lo dice, como en `describe.ts`.

### 5.3 Render: `packages/video` con Remotion

- Es un paquete nuevo del monorepo con una composición de React que recibe `{ guion, timeline, decision, rutas de clips e imágenes }` como props.
- Se renderiza con `@remotion/renderer` desde Node en 1280×720 a 30 fps, en H.264.
- Además del mp4 se genera una vista previa en GIF de 6–8 s, con la portada y el primer hallazgo, porque el comentario de GitHub no reproduce mp4 desde una rama.
- El comando es `qa-pilot video --out <qa-results>`. Lee los artifacts, pide el guion, renderiza y deja `video.mp4`, `preview.gif` y `video.json` (metadatos) en `qa-results/video/`.

### 5.4 Workflow: job `video`

- Corre `needs: publish`, solo si la decisión fue `escalate` o `blocked`, o en el evento `labeled` con `qa-video`.
- **Aislamiento (decisión mía):** los clips son contenido generado por el código del PR, y Chrome y ffmpeg los van a abrir. Por eso el render corre en un paso o job **sin** `GITHUB_TOKEN` de escritura y **sin** `ANTHROPIC_API_KEY`:
  1. **Guion:** un paso con la clave, que solo lee JSON y texto, sin video ni Chrome. Deja `guion.json`.
  2. **Render:** un paso o job con permisos `contents: read`, sin secretos, en la imagen de Playwright, que ya trae Chrome. Remotion necesita ffmpeg, que trae empaquetado. Sube el mp4 y el GIF como artifact.
  3. **Publicar:** un paso con permisos de escritura que solo copia archivos. Valida el tipo y el tamaño del mp4 y el GIF y los sube a `qa-pilot/evidence` con `uploadEvidence`, bajo `pr-<n>/<sha7>/video/`. Después edita el comentario existente (`upsertComment` con el mismo `MARKER`) para agregar la sección del video.
- **Tiempo límite:** el job tiene su propio `timeout-minutes`. Si se pasa, el comentario dice "no se pudo generar el video" y nada más cambia.

### 5.5 Comentario del PR

Se agrega una sección `### Video` con el GIF enlazado al mp4 (raw de la rama de
evidencia) y la duración. Mientras el job `video` corre, la sección dice
"generando video…". Si falla, dice que no se pudo y por qué, en una línea.

## 6. Restricciones

- **Licencia de Remotion.** No es MIT, y esto lo verifiqué el 2026-10-22 en remotion.dev/docs/license.
  - Es gratis para personas, organizaciones con fines de lucro de hasta 3 empleados y sin ánimo de lucro.
  - Las empresas de 4 o más necesitan licencia de empresa. Para renders automáticos es el plan "Automators": US$0,01 por render, con un mínimo de US$100 al mes.
  - qa-pilot sigue siendo MIT, pero quien active el video en una empresa de 4 o más personas asume esa licencia. El README y el input del workflow lo tienen que decir.
  - Por eso el video es **opcional y viene apagado** por defecto (`video: { enabled: false }` en `qa-pilot.yaml`).
- **Tamaño de la rama de evidencia.** Un mp4 de 90 s en 720p pesa varios MB por PR. Hay que fijar un tope de bitrate y de peso, por ejemplo ≤ 15 MB. El README ya advierte que la rama crece y se puede borrar.
- **Tiempo de CI.** Grabar video vuelve un poco más lentos los tests de `checks`, y el render agrega minutos al job `video`. Nada de eso debe atrasar el status de la decisión, y no lo hace, porque `video` corre después de `publish`.
- **El mismo contrato `qa/`.** No hace falta escribir tests nuevos para tener video.

## 7. Configuración

```yaml
video:
  enabled: false      # opt-in (licencia de Remotion)
  max_seconds: 90
  project: admin-desktop  # opcional: nombre completo del proyecto de Playwright que se graba
```

Hay que agregarlo al JSON Schema (`spec/qa-pilot.schema.json`), con valores por defecto.

## 8. Qué decide quien construye

- El formato exacto de `timeline.json` y del esquema del guion.
- El diseño visual de la composición: tipografía, colores neutros, transiciones. Tiene que leerse bien a 720p y verse sobrio, sin efectos llamativos.
- Cómo acelerar los tramos muertos (por ejemplo, saltar segmentos sin acciones de más de X s).
- Cómo saber si un journey "toca archivos del PR". Si no hay una forma fiable, se usa solo "tiene hallazgo".
- Si guion, render y publicación son pasos de un job o jobs separados, siempre que se respete el aislamiento de §5.4.
- Los topes concretos (MB por clip, bitrate, `timeout-minutes`).

## 9. Pruebas

- Unitarias:
  - armar el timeline desde resultados de Playwright de mentira;
  - recortar a 90 s según prioridad;
  - armar el guion de plantilla;
  - validar el guion de Claude, rechazando el que no valide;
  - la sección del comentario en cada estado (generando, listo, falló).
- Render con Remotion en CI del propio repo, con un timeline y clips de prueba pequeños: que salga un mp4 válido con la duración esperada.
- De punta a punta en `examples/notes`:
  - un PR que escala produce el video;
  - un PR bloqueado por un journey que falla produce el video y se detiene en el fallo;
  - uno `auto` no lo produce, salvo con el label `qa-video`.
