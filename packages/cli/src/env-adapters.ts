import type { Proc } from './proc.js'
import type { QaConfig } from './types.js'

export type EnvContext = { root: string; config: QaConfig; proc: Proc; env: Record<string, string> }

export interface EnvAdapter {
  up(ctx: EnvContext): Promise<Record<string, string>>
  down(ctx: EnvContext): Promise<void>
}

async function must(ctx: EnvContext, cmd: string): Promise<string> {
  const r = await ctx.proc.sh(cmd, { cwd: ctx.root, env: ctx.env })
  if (r.code !== 0) throw new Error(`Falló "${cmd}" (código ${r.code}): ${r.out.slice(-500)}`)
  return r.out
}

export function parseSupabaseEnv(output: string, map: Record<string, string>): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim())
    if (m) vars[m[1]!] = m[2]!
  }
  const out: Record<string, string> = {}
  for (const [target, source] of Object.entries(map)) {
    const value = vars[source]
    if (value === undefined) throw new Error(`supabase status no devolvió ${source} (para ${target}); revisa app.env_map`)
    out[target] = value
  }
  return out
}

const command: EnvAdapter = {
  async up() { return {} },
  async down() {},
}

const dockerCompose: EnvAdapter = {
  async up(ctx) {
    await must(ctx, `docker compose -f ${ctx.config.app.compose_file ?? 'docker-compose.yml'} up -d --build`)
    return {}
  },
  async down(ctx) {
    await ctx.proc.sh(`docker compose -f ${ctx.config.app.compose_file ?? 'docker-compose.yml'} down -v`, { cwd: ctx.root, env: ctx.env })
  },
}

const supabaseLocal: EnvAdapter = {
  async up(ctx) {
    await must(ctx, 'npx --yes supabase start')
    await must(ctx, 'npx --yes supabase db reset')
    const status = await must(ctx, 'npx --yes supabase status -o env')
    return parseSupabaseEnv(status, ctx.config.app.env_map ?? {})
  },
  async down(ctx) {
    await ctx.proc.sh('npx --yes supabase stop --no-backup', { cwd: ctx.root, env: ctx.env })
  },
}

export function envAdapter(kind: QaConfig['app']['env']): EnvAdapter {
  return { command, 'docker-compose': dockerCompose, 'supabase-local': supabaseLocal }[kind]
}
