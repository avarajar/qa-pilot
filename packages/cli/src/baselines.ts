import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { loadContract } from './config.js'
import type { Io } from './cli.js'

export function playwrightVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null
}

// Las capturas dependen de las fuentes del sistema: se generan en la misma imagen Linux que usa CI.
// La app tiene que estar corriendo en el host (--network=host la deja ver en localhost).
export function baselinesCommand(o: { root: string; appDir: string; version: string; e2e: string }): string[] {
  const rel = relative(o.root, o.appDir)
  return [
    'docker', 'run', '--rm', '--ipc=host', '--network=host',
    '-v', `${o.root}:/work`, '-w', rel ? `/work/${rel}` : '/work', '-e', 'QA_PILOT_ROOT=/work', '-e', 'QA_PILOT_OUT=/work/qa-results',
    `mcr.microsoft.com/playwright:v${o.version}-noble`,
    'bash', '-c', `${o.e2e} --update-snapshots`,
  ]
}

export async function baselines(root: string, io: Io): Promise<number> {
  const { config } = loadContract(root)
  if (!config.checks.e2e) {
    io.err('checks.e2e no está definido en qa/qa-pilot.yaml')
    return 1
  }
  const appDir = resolve(root, config.app.dir)
  const v = spawnSync('npx', ['playwright', '--version'], { cwd: appDir, encoding: 'utf8' })
  const version = playwrightVersion(v.stdout ?? '')
  if (!version) {
    io.err('No encuentro @playwright/test instalado en ' + appDir)
    return 1
  }
  const [cmd, ...args] = baselinesCommand({ root, appDir, version, e2e: config.checks.e2e })
  io.err(`qa-pilot: ${[cmd, ...args].join(' ')}`)
  const r = spawnSync(cmd!, args, { stdio: 'inherit' })
  if (r.status === 0) io.out('Imágenes base actualizadas. Al commitearlas el PR escala por G3 (cambia el oráculo).')
  return r.status ?? 1
}
