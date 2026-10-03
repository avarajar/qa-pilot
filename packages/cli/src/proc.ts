import { spawn } from 'node:child_process'

export type ShResult = { code: number; out: string }

export type Proc = {
  sh(cmd: string, opts: { cwd: string; env: Record<string, string>; timeoutS?: number; quiet?: boolean }): Promise<ShResult>
  spawnBg(cmd: string, opts: { cwd: string; env: Record<string, string> }): { stop(): Promise<void> }
}

const MAX_OUT = 200_000
export const TIMEOUT_CODE = 124

const killGroup = (pid: number | undefined, signal: NodeJS.Signals) => {
  if (pid === undefined) return
  try { process.kill(-pid, signal) } catch { /* ya terminó */ }
}

export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export const realProc: Proc = {
  sh(cmd, { cwd, env, timeoutS, quiet }) {
    return new Promise(resolve => {
      // grupo propio: al vencer el tiempo se mata al comando y a todo lo que lanzó
      const child = spawn('bash', ['-c', cmd], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let timedOut = false
      const take = (chunk: Buffer) => {
        if (!quiet) process.stdout.write(chunk)
        out = (out + chunk.toString()).slice(-MAX_OUT)
      }
      child.stdout.on('data', take)
      child.stderr.on('data', take)
      const timer = timeoutS
        ? setTimeout(() => { timedOut = true; killGroup(child.pid, 'SIGKILL') }, timeoutS * 1000)
        : undefined
      let exitCode: number | null = null
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (timedOut) resolve({ code: TIMEOUT_CODE, out: `${out}\nqa-pilot: timeout de ${timeoutS} s; se detuvo el comando` })
        else resolve({ code: exitCode ?? 1, out })
      }
      child.on('close', finish)
      // un nieto que hereda los pipes no debe colgar la espera: medio segundo después de 'exit' se resuelve igual
      child.on('exit', code => { exitCode = code; setTimeout(finish, 500) })
      child.on('error', err => resolve({ code: 127, out: err.message }))
    })
  },

  spawnBg(cmd, { cwd, env }) {
    // grupo de procesos propio para poder matar al servidor y a sus hijos (npm → next)
    const child = spawn('bash', ['-c', cmd], { cwd, env, detached: true, stdio: ['ignore', 'inherit', 'inherit'] })
    return {
      async stop() {
        if (child.pid === undefined) return
        // aunque bash ya haya salido, sus hijos pueden seguir vivos en el grupo
        const exited = child.exitCode !== null || child.signalCode !== null
        const done = exited ? Promise.resolve() : new Promise<void>(r => child.once('exit', () => r()))
        killGroup(child.pid, 'SIGTERM')
        const killer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 5000)
        await done
        clearTimeout(killer)
      },
    }
  },
}

export async function waitForUrl(url: string, timeoutS: number): Promise<boolean> {
  const deadline = Date.now() + timeoutS * 1000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
      if (res.status < 500) return true
    } catch { /* todavía no levanta */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}
