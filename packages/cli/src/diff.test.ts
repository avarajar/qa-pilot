import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitDiff } from './diff.js'

describe('gitDiff', () => {
  it('en un proyecto dentro de un monorepo, las rutas son relativas al proyecto', () => {
    const repo = mkdtempSync(join(tmpdir(), 'qa-mono-'))
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@t.t')
    git('config', 'user.name', 't')
    mkdirSync(join(repo, 'examples/notes'), { recursive: true })
    writeFileSync(join(repo, 'examples/notes/auth.js'), 'a\n')
    writeFileSync(join(repo, 'otro.txt'), 'x\n')
    git('add', '-A')
    git('commit', '-qm', 'base')
    git('checkout', '-qb', 'feat')
    writeFileSync(join(repo, 'examples/notes/auth.js'), 'b\n')
    writeFileSync(join(repo, 'otro.txt'), 'y\n')
    git('commit', '-qam', 'cambio')
    expect(gitDiff(join(repo, 'examples/notes'), 'main').files.map(f => f.path)).toEqual(['auth.js'])
  })
  it('nombres con acentos salen sin comillas ni escapes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'qa-acc-'))
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@t.t')
    git('config', 'user.name', 't')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git('add', '-A')
    git('commit', '-qm', 'base')
    git('checkout', '-qb', 'feat')
    mkdirSync(join(repo, 'supabase/migrations'), { recursive: true })
    writeFileSync(join(repo, 'supabase/migrations/20261002_añade_índice.sql'), 'x\n')
    git('add', '-A')
    git('commit', '-qm', 'mig')
    expect(gitDiff(repo, 'main').files.map(f => f.path)).toEqual(['supabase/migrations/20261002_añade_índice.sql'])
  })

  it('con head explícito compara base...head sin hacer checkout', () => {
    const repo = mkdtempSync(join(tmpdir(), 'qa-head-'))
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@t.t')
    git('config', 'user.name', 't')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git('add', '-A')
    git('commit', '-qm', 'base')
    git('checkout', '-qb', 'feat')
    writeFileSync(join(repo, 'b.txt'), 'b\n')
    git('add', '-A')
    git('commit', '-qm', 'b')
    const head = git('rev-parse', 'HEAD').trim()
    git('checkout', '-q', 'main')
    expect(gitDiff(repo, 'main', head).files.map(f => f.path)).toEqual(['b.txt'])
  })
})
