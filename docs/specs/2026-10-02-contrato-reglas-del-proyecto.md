# qa-pilot · Reglas del proyecto en el contrato `qa/`

Fecha: 2026-10-02 · Estado: propuesta (fase 2). Primer caso: un proyecto piloto interno
(`qa/authz-matrix.yaml`, `qa/design-rules.md`).

## Problema

Las reglas que deciden si algo está bien dependen de cada proyecto: qué roles hay y qué puede
hacer cada uno, cómo debe verse la UI y qué decisiones no se reabren. Casi siempre ya están
escritas en la documentación del proyecto (CLAUDE.md, specs, prototipos), pero no en un formato
que una prueba pueda usar. Escribirlas dos veces no escala, y si nadie las convierte en oráculo,
las pruebas solo verifican lo que el agente creyó entender.

## Dos archivos nuevos y opcionales en `qa/`

| Archivo | Qué contiene | Quién lo usa |
|---|---|---|
| `authz-matrix.yaml` | Roles × recursos × acciones × alcance, se niega por defecto. Cada celda dice dónde se aplica la regla (`enforced: db` o `server`), de dónde salió (`# fuente:`) y si hoy el código no la cumple (`# hoy:`). Más `invariants` y `doubts`. | El generador de tests de permisos (fase 2): de cada celda salen tests de pgTAP/PostgREST (`db`) o de actions/rutas (`server`), positivos y negativos. |
| `design-rules.md` | La referencia canónica, los tokens, el kit, el layout, el movimiento, el copy y la accesibilidad. Termina en §8a, reglas verificables automáticamente, y §8b, reglas de juicio. | §8a: checks deterministas en Playwright (estilos computados, DOM, contraste). §8b: el revisor de UX, que solo avisa y nunca bloquea. |

Los dos cuentan como oráculo: cambiarlos activa G3 (ya está cubierto por `qa/**`).

Las celdas marcadas `# hoy:` describen lo esperado y no lo actual. Los tests que generan deben
fallar hasta que se corrija el código o un humano cambie la regla. Así un bug conocido no queda
"aprobado" por la matriz.

## Cómo los propone `init` (fase 3)

1. **Leer** el código (políticas, guards, rutas, tokens CSS) y la documentación (`CLAUDE.md`,
   `AGENTS.md`, `docs/specs/`, `docs/`, prototipos HTML) con agentes de solo lectura, uno por
   archivo de destino.
2. **Derivar** el comportamiento esperado de la documentación y comparar con el código.
   - Donde coinciden, la celda queda limpia.
   - Donde no, se escribe lo de la spec con `# hoy:` y la discrepancia va a `doubts`.
   - Nunca se inventa una regla que no esté en ninguna fuente: sin fuente, va a `doubts`.
3. **Proponer** los archivos como borrador marcado "para revisar" en un PR. El PR escala por G3,
   así que un humano los confirma.
4. **Mantener:** cuando cambia la documentación, o el router ve un recurso nuevo que la matriz
   no cubre (tabla, ruta, action), `init --update` propone solo el diff o hace una micro-pregunta.

## Fuera de esta propuesta

- El generador de tests desde la matriz (fase 2, plan aparte).
- Los checks de §8a como paquete reutilizable. Varios son genéricos y van al preset: un `<h1>`,
  sin scroll horizontal a 390 px, sin errores de consola, reduced-motion. Otros dependen del
  proyecto: familias de fuente y tokens retirados.
