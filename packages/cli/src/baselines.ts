import { resolve } from 'node:path'
import { shellQuote } from './proc.js'
import { run } from './run.js'
import type { Io } from './cli.js'

export function playwrightVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null
}

// Las capturas dependen de las fuentes del sistema: se generan en la misma imagen Linux que usa CI.
// El repo se monta en la misma ruta, así no hay que traducir rutas; --network=host deja ver la app en localhost.
export function dockerize(cmd: string, o: { mount: string; cwd: string; version: string; env: string[] }): string {
  return [
    'docker run --rm --ipc=host --network=host',
    `-v ${shellQuote(o.mount)}:${shellQuote(o.mount)}`,
    `-w ${shellQuote(o.cwd)}`,
    ...[...new Set(o.env)].map(name => `-e ${name}`),
    `mcr.microsoft.com/playwright:v${o.version}-noble`,
    `bash -c ${shellQuote(cmd)}`,
  ].join(' ')
}

// qa-pilot run completo (levanta y apaga la app), con el e2e dentro de Docker y --update-snapshots
export async function baselines(root: string, io: Io): Promise<number> {
  process.env.QA_PILOT_E2E_ARGS = '--update-snapshots'
  process.env.QA_PILOT_E2E_DOCKER = '1'
  const d = await run({ root: resolve(root), base: 'HEAD', log: s => io.err(s) })
  const e2e = d.checks.e2e
  if (e2e === 'fail' || e2e === undefined) {
    io.err(`qa-pilot baselines: el e2e no terminó bien (${e2e ?? 'sin resultado'}); revisa qa-results/`)
    return 1
  }
  io.out('Imágenes base actualizadas en Linux. Al commitearlas el PR escala por G3 (cambia el oráculo).')
  return 0
}
