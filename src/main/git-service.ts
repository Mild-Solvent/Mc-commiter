import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import type { ChangeFile, ChangeSnapshot, RepositoryProfile } from '../shared/types'

export class GitError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
}

export function runGit(
  cwd: string,
  args: string[],
  options: { input?: string | Buffer; timeoutMs?: number; allowFailure?: boolean } = {}
): Promise<GitResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    const timeout = setTimeout(() => {
      child.kill()
      if (!settled) {
        settled = true
        reject(new GitError(`Git command timed out: git ${args[0] ?? ''}`, '', null))
      }
    }, options.timeoutMs ?? 30_000)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.stdin.on('error', () => {
      // Git may close stdin early after reporting an argument or repository error.
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      if (!settled) {
        settled = true
        reject(new GitError(error.message, '', null))
      }
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (settled) return
      settled = true
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: code ?? 1
      }
      if (result.exitCode !== 0 && !options.allowFailure) {
        reject(
          new GitError(
            result.stderr.trim() || `Git command failed: git ${args[0] ?? ''}`,
            result.stderr,
            code
          )
        )
      } else {
        resolvePromise(result)
      }
    })
    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

export async function resolveGitRoot(selectedPath: string): Promise<string> {
  const result = await runGit(selectedPath, ['rev-parse', '--show-toplevel'])
  return resolve(result.stdout.trim())
}

function statusLabel(code: string): string {
  const labels: Record<string, string> = {
    M: 'modified',
    A: 'added',
    D: 'deleted',
    R: 'renamed',
    C: 'copied',
    T: 'type changed',
    U: 'unmerged',
    '?': 'untracked'
  }
  return labels[code] ?? 'changed'
}

function parsePorcelainV2(raw: string): ChangeFile[] {
  const records = raw.split('\0')
  const files: ChangeFile[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.startsWith('? ')) {
      const path = record.slice(2)
      files.push({
        id: `untracked:${path}`,
        path,
        status: 'untracked',
        source: 'untracked',
        staged: false,
        selectable: true,
        selected: true,
        binary: false
      })
      continue
    }
    if (!record.startsWith('1 ') && !record.startsWith('2 ')) continue
    const fields = record.split(' ')
    const isRename = record.startsWith('2 ')
    const xy = fields[1] ?? '..'
    const path = fields.slice(isRename ? 9 : 8).join(' ')
    const oldPath = isRename ? records[++index] || undefined : undefined
    const stagedCode = xy[0]
    const worktreeCode = xy[1]
    if (stagedCode && stagedCode !== '.') {
      files.push({
        id: `staged:${path}`,
        path,
        oldPath,
        status: statusLabel(stagedCode),
        source: 'staged',
        staged: true,
        selectable: false,
        selected: true,
        binary: false
      })
    }
    if (worktreeCode && worktreeCode !== '.') {
      files.push({
        id: `worktree:${path}`,
        path,
        oldPath,
        status: statusLabel(worktreeCode),
        source: 'worktree',
        staged: false,
        selectable: true,
        selected: true,
        binary: false
      })
    }
  }
  return files
}

function secretRiskForPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/').toLocaleLowerCase()
  const name = normalized.split('/').at(-1) ?? normalized
  if (/^\.env($|\.)/.test(name)) return 'environment file'
  if (/\.(pem|pfx|p12|key|keystore|jks)$/.test(name)) return 'private key or certificate'
  if (/(credentials|secrets?|service[-_]?account|auth[-_]?token)/.test(name)) {
    return 'credential-like filename'
  }
  return undefined
}

function containsCredentialPattern(text: string): boolean {
  return /(api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\-\/+=]{12,}/i.test(
    text
  )
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function inspectUntracked(root: string, path: string): Promise<{
  excerpt: string
  binary: boolean
  hash: string
  secretPattern: boolean
  truncated: boolean
}> {
  const fullPath = resolve(root, path)
  if (!isInside(root, fullPath)) throw new Error(`Unsafe repository path: ${path}`)
  const stat = await fs.lstat(fullPath)
  if (stat.isSymbolicLink()) {
    const target = await fs.readlink(fullPath)
    return {
      excerpt: `[symbolic link -> ${target}]`,
      binary: false,
      hash: createHash('sha256').update(target).digest('hex'),
      secretPattern: false,
      truncated: false
    }
  }
  if (!stat.isFile()) {
    return {
      excerpt: `[non-regular file: ${path}]`,
      binary: true,
      hash: `${stat.size}:${stat.mtimeMs}`,
      secretPattern: false,
      truncated: false
    }
  }
  const data = await fs.readFile(fullPath)
  const hash = createHash('sha256').update(data).digest('hex')
  const binary = data.subarray(0, 8192).includes(0)
  if (binary) {
    return {
      excerpt: `[binary file, ${data.byteLength} bytes]`,
      binary: true,
      hash,
      secretPattern: false,
      truncated: false
    }
  }
  const text = data.toString('utf8')
  const excerpt = text.slice(0, 16_000)
  return {
    excerpt,
    binary: false,
    hash,
    secretPattern: containsCredentialPattern(excerpt),
    truncated: text.length > excerpt.length
  }
}

async function assertSafeRepository(root: string): Promise<{ head: string; branch: string }> {
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree'])
  if (inside.stdout.trim() !== 'true') throw new Error('The selected folder is not a Git worktree')
  const headResult = await runGit(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
  if (headResult.exitCode !== 0) throw new Error('The repository has no commits yet')
  const branchResult = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    allowFailure: true
  })
  if (branchResult.exitCode !== 0) throw new Error('Detached HEAD is not supported')

  const stateNames = [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'rebase-merge',
    'rebase-apply',
    'BISECT_LOG'
  ]
  for (const stateName of stateNames) {
    const statePathResult = await runGit(root, ['rev-parse', '--git-path', stateName])
    const rawPath = statePathResult.stdout.trim()
    const statePath = isAbsolute(rawPath) ? rawPath : resolve(root, rawPath)
    try {
      await fs.access(statePath)
      throw new Error(`Git operation in progress (${stateName}); finish it before using Commit Bubble`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return { head: headResult.stdout.trim(), branch: branchResult.stdout.trim() }
}

export async function createChangeSnapshot(
  repository: RepositoryProfile,
  maxPayloadCharacters = 80_000
): Promise<ChangeSnapshot> {
  const root = resolve(repository.rootPath)
  const { head, branch } = await assertSafeRepository(root)
  const statusResult = await runGit(root, [
    'status',
    '--porcelain=v2',
    '-z',
    '--untracked-files=all'
  ])
  const files = parsePorcelainV2(statusResult.stdout)
  if (files.length === 0) throw new Error('There are no changes to commit')

  const [stagedDiff, worktreeDiff, stats] = await Promise.all([
    runGit(root, ['diff', '--cached', '--no-ext-diff', '--find-renames', '--unified=3']),
    runGit(root, ['diff', '--no-ext-diff', '--find-renames', '--unified=3']),
    runGit(root, ['diff', 'HEAD', '--stat', '--no-ext-diff'])
  ])
  const warnings: string[] = []
  const untrackedSections: string[] = []
  const untrackedHashes: string[] = []
  let truncated = false

  for (const file of files.filter((candidate) => candidate.source === 'untracked')) {
    const inspected = await inspectUntracked(root, file.path)
    file.binary = inspected.binary
    file.secretRisk = secretRiskForPath(file.path) ?? (inspected.secretPattern ? 'credential-like content' : undefined)
    untrackedHashes.push(`${file.path}:${inspected.hash}`)
    untrackedSections.push(`--- untracked: ${file.path}\n${inspected.excerpt}`)
    truncated ||= inspected.truncated
  }
  for (const file of files.filter((candidate) => candidate.source !== 'untracked')) {
    file.secretRisk = secretRiskForPath(file.path)
    const diff = file.source === 'staged' ? stagedDiff.stdout : worktreeDiff.stdout
    const section = diff
      .split(/^diff --git /m)
      .find((candidate) => candidate.includes(`b/${file.path}`) || Boolean(file.oldPath && candidate.includes(`a/${file.oldPath}`)))
    if (section) {
      file.binary = /Binary files|GIT binary patch/.test(section)
      if (!file.secretRisk && containsCredentialPattern(section)) {
        file.secretRisk = 'credential-like content in diff'
      }
    }
  }

  let diffPayload = [
    `BRANCH: ${branch}`,
    `HEAD: ${head}`,
    `CHANGE SUMMARY:\n${stats.stdout.trim() || '(untracked files only)'}`,
    `STAGED DIFF:\n${stagedDiff.stdout.trim() || '(none)'}`,
    `WORKTREE DIFF:\n${worktreeDiff.stdout.trim() || '(none)'}`,
    `UNTRACKED FILES:\n${untrackedSections.join('\n\n') || '(none)'}`
  ].join('\n\n')
  if (diffPayload.length > maxPayloadCharacters) {
    diffPayload = `${diffPayload.slice(0, maxPayloadCharacters)}\n\n[diff truncated by Commit Bubble]`
    truncated = true
  }
  if (truncated) warnings.push('Some large file content was summarized or truncated for the model.')
  if (files.some((file) => file.binary)) warnings.push('Binary files are represented by metadata only.')

  const fingerprint = createHash('sha256')
    .update(head)
    .update(statusResult.stdout)
    .update(stagedDiff.stdout)
    .update(worktreeDiff.stdout)
    .update(untrackedHashes.sort().join('\n'))
    .digest('hex')

  return {
    id: randomUUID(),
    repositoryId: repository.id,
    rootPath: root,
    head,
    branch,
    fingerprint,
    files,
    diffPayload,
    truncated,
    warnings,
    createdAt: new Date().toISOString()
  }
}

export async function stageAndCommit(
  snapshot: ChangeSnapshot,
  selectedFileIds: string[],
  subject: string,
  body: string
): Promise<{ commitHash: string; includedPaths: string[] }> {
  const repository: RepositoryProfile = {
    id: snapshot.repositoryId,
    rootPath: snapshot.rootPath,
    displayName: basename(snapshot.rootPath),
    commitStyle: 'conventional',
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.createdAt
  }
  const current = await createChangeSnapshot(repository)
  if (current.fingerprint !== snapshot.fingerprint || current.head !== snapshot.head) {
    throw new Error('Repository changes no longer match this preview. Generate a new preview.')
  }
  await runGit(snapshot.rootPath, ['var', 'GIT_AUTHOR_IDENT'])

  const selected = snapshot.files.filter(
    (file) => file.source !== 'staged' && selectedFileIds.includes(file.id)
  )
  const selectedPaths = [...new Set(selected.map((file) => file.path))]
  if (selectedPaths.length > 0) {
    const pathspec = Buffer.from(`${selectedPaths.join('\0')}\0`, 'utf8')
    await runGit(
      snapshot.rootPath,
      ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'],
      { input: pathspec }
    )
  }
  const stagedCheck = await runGit(snapshot.rootPath, ['diff', '--cached', '--quiet'], {
    allowFailure: true
  })
  if (stagedCheck.exitCode === 0) throw new Error('No staged changes remain to commit')

  const message = body.trim() ? `${subject.trim()}\n\n${body.trim()}\n` : `${subject.trim()}\n`
  await runGit(snapshot.rootPath, ['commit', '-F', '-'], { input: message, timeoutMs: 120_000 })
  const hash = await runGit(snapshot.rootPath, ['rev-parse', 'HEAD'])
  const includedPaths = [
    ...new Set([
      ...snapshot.files.filter((file) => file.source === 'staged').map((file) => file.path),
      ...selectedPaths
    ])
  ]
  return { commitHash: hash.stdout.trim(), includedPaths }
}

export const gitInternals = { parsePorcelainV2, secretRiskForPath, containsCredentialPattern }
