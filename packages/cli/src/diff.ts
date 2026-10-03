import { execFileSync } from 'node:child_process'

export type DiffFile = { path: string; from?: string; status: 'A' | 'M' | 'D' | 'R'; added: number; removed: number }
// files: relativas al proyecto (root). repo: todo lo que cambió en el repo, con rutas del repo,
// porque --relative esconde lo de fuera del proyecto y ahí están el CI y los lockfiles (G2)
export type Diff = { files: DiffFile[]; repo?: { prefix: string; paths: string[] } }

// numstat escribe los renombres como "a => b" o "dir/{a => b}/x"
function renamedTarget(path: string): string {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path)
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/\//g, '/')
  const plain = path.split(' => ')
  return plain.length === 2 ? plain[1]! : path
}

export function parseDiff(nameStatus: string, numstat: string): Diff {
  const counts = new Map<string, { added: number; removed: number }>()
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue
    const [a, r, ...rest] = line.split('\t')
    const path = renamedTarget(rest.join('\t'))
    counts.set(path, { added: a === '-' ? 0 : Number(a), removed: r === '-' ? 0 : Number(r) })
  }
  const files: DiffFile[] = []
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue
    const [code, first, second] = line.split('\t')
    const letter = code!.charAt(0)
    const status = (['A', 'M', 'D', 'R'].includes(letter) ? letter : 'M') as DiffFile['status']
    const path = status === 'R' ? second! : first!
    const c = counts.get(path) ?? { added: 0, removed: 0 }
    files.push(status === 'R' ? { path, from: first!, status, ...c } : { path, status, ...c })
  }
  return { files }
}

export function gitDiff(root: string, base: string, head = 'HEAD'): Diff {
  // quotePath=false: sin esto git escribe "a\303\261o.sql" y los globs no coinciden con nombres con acentos
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const range = `${base}...${head}`
  const diff = parseDiff(git('diff', '--relative', '--name-status', '-M', range), git('diff', '--relative', '--numstat', '-M', range))
  // --no-renames: un renombre sale como borrado + alta, así cuentan las dos rutas
  const paths = git('diff', '--name-only', '--no-renames', range, '--', ':(top)').split('\n').filter(Boolean)
  return { ...diff, repo: { prefix: git('rev-parse', '--show-prefix').trim(), paths } }
}

export function headSha(root: string, ref = 'HEAD'): string {
  return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
