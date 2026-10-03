import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { register, summarize } from './cli.js'
import { run } from './run.js'
import { baselines } from './baselines.js'

register('run', async (args, io) => {
  const { values } = parseArgs({ args, options: { root: { type: 'string', default: '.' }, out: { type: 'string' }, base: { type: 'string', default: 'origin/main' } }, strict: false })
  const d = await run({
    root: resolve(String(values.root)),
    base: String(values.base),
    ...(values.out ? { out: resolve(String(values.out)) } : {}),
    log: s => io.err(s),
  })
  io.out(summarize(d))
  return 0
})


register('baselines', async (args, io) => {
  const { values } = parseArgs({ args, options: { root: { type: 'string', default: '.' } }, strict: false })
  return baselines(resolve(String(values.root)), io)
})
