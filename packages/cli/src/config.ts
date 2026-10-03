import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { Ajv } from 'ajv'
import type { Journey, QaConfig, QaContract } from './types.js'

export class ConfigError extends Error {
  override name = 'ConfigError'
}

const here = dirname(fileURLToPath(import.meta.url))
// en el repo: packages/cli/src → spec/; publicado: dist → schema/ (copiado al empaquetar)
const schemaCandidates = [join(here, '../../../spec/qa-pilot.schema.json'), join(here, '../schema/qa-pilot.schema.json')]

function loadSchema(): object {
  const path = schemaCandidates.find(p => existsSync(p))
  if (!path) throw new ConfigError('No encuentro qa-pilot.schema.json')
  return JSON.parse(readFileSync(path, 'utf8')) as object
}

const ajv = new Ajv({ allErrors: true, useDefaults: true })
let validate: ReturnType<typeof ajv.compile> | undefined

type Plain = Record<string, unknown>
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v)

function merge(base: Plain, over: Plain): Plain {
  const out: Plain = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = isPlain(v) && isPlain(out[k]) ? merge(out[k] as Plain, v) : v
  return out
}

function readYaml(path: string): Plain {
  let data: unknown
  try {
    data = parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new ConfigError(`${path}: YAML inválido: ${(err as Error).message}`)
  }
  if (!isPlain(data)) throw new ConfigError(`${path}: se esperaba un objeto`)
  return data
}

function readConfig(qaDir: string): QaConfig {
  const file = join(qaDir, 'qa-pilot.yaml')
  if (!existsSync(file)) throw new ConfigError(`Falta qa/qa-pilot.yaml en ${dirname(qaDir)}`)
  let data = readYaml(file)
  if (typeof data.extends === 'string') {
    const basePath = resolve(qaDir, data.extends)
    if (!existsSync(basePath)) throw new ConfigError(`extends: no existe ${basePath}`)
    const { extends: _ignored, ...local } = data
    data = merge(readYaml(basePath), local)
  }
  delete data.extends
  data.auth ??= {}
  data.roles ??= {}
  data.checks ??= {}
  data.router ??= {}
  validate ??= ajv.compile(loadSchema())
  if (!validate(data)) {
    const detail = (validate.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message ?? ''}`.trim()).join('; ')
    throw new ConfigError(`qa/qa-pilot.yaml inválido: ${detail}`)
  }
  return data as unknown as QaConfig
}

export function parseProtectedPaths(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
}

export function parseJourneys(md: string): Journey[] {
  const out: Journey[] = []
  for (const line of md.split('\n')) {
    const m = /^##\s+(J\d+)\s*[·\-–—:]\s*(.+?)\s*$/.exec(line)
    if (m) out.push({ id: m[1]!, name: m[2]! })
  }
  return out
}

export function loadContract(root: string): QaContract {
  const qaDir = join(root, 'qa')
  const config = readConfig(qaDir)
  const pp = join(qaDir, 'protected-paths')
  const cj = join(qaDir, 'critical-journeys.md')
  return {
    root,
    config,
    protectedPaths: existsSync(pp) ? parseProtectedPaths(readFileSync(pp, 'utf8')) : [],
    journeys: existsSync(cj) ? parseJourneys(readFileSync(cj, 'utf8')) : [],
  }
}
