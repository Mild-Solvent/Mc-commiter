import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createChangeSnapshot, runGit, stageAndCommit } from '../src/main/git-service'
import type { RepositoryProfile } from '../src/shared/types'

let root = ''
let repository: RepositoryProfile

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'commit-bubble-test-'))
  await runGit(root, ['init'])
  await runGit(root, ['config', 'user.name', 'Commit Bubble Test'])
  await runGit(root, ['config', 'user.email', 'commit-bubble@example.invalid'])
  await fs.writeFile(join(root, 'README.md'), '# Fixture\n', 'utf8')
  await runGit(root, ['add', 'README.md'])
  await runGit(root, ['commit', '-m', 'chore: initialize fixture'])
  const now = new Date().toISOString()
  repository = {
    id: 'fixture-repository',
    rootPath: root,
    displayName: 'fixture',
    commitStyle: 'conventional',
    createdAt: now,
    updatedAt: now
  }
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('Git integration', () => {
  it('commits selected untracked and modified files while leaving deselected files', async () => {
    await fs.appendFile(join(root, 'README.md'), 'Changed\n', 'utf8')
    await fs.writeFile(join(root, 'included file.txt'), 'include me\n', 'utf8')
    await fs.writeFile(join(root, 'left-behind.txt'), 'do not include\n', 'utf8')
    const snapshot = await createChangeSnapshot(repository)
    const selected = snapshot.files
      .filter((file) => file.path !== 'left-behind.txt')
      .map((file) => file.id)

    const result = await stageAndCommit(snapshot, selected, 'test(git): commit selected files', '')
    expect(result.commitHash).toMatch(/^[0-9a-f]{40,64}$/)
    const committed = await runGit(root, ['show', '--pretty=', '--name-only', 'HEAD'])
    expect(committed.stdout).toContain('README.md')
    expect(committed.stdout).toContain('included file.txt')
    expect(committed.stdout).not.toContain('left-behind.txt')
    const status = await runGit(root, ['status', '--porcelain'])
    expect(status.stdout).toContain('left-behind.txt')
  })

  it('invalidates a stale preview before staging', async () => {
    await fs.appendFile(join(root, 'README.md'), 'First change\n', 'utf8')
    const snapshot = await createChangeSnapshot(repository)
    await fs.appendFile(join(root, 'README.md'), 'Racing change\n', 'utf8')
    await expect(
      stageAndCommit(snapshot, snapshot.files.map((file) => file.id), 'fix: stale preview', '')
    ).rejects.toThrow(/no longer match/i)
    const staged = await runGit(root, ['diff', '--cached', '--quiet'], { allowFailure: true })
    expect(staged.exitCode).toBe(0)
  })

  it('keeps existing staged content locked while allowing unstaged content to remain out', async () => {
    await fs.appendFile(join(root, 'README.md'), 'staged line\n', 'utf8')
    await runGit(root, ['add', 'README.md'])
    await fs.appendFile(join(root, 'README.md'), 'unstaged line\n', 'utf8')
    const snapshot = await createChangeSnapshot(repository)
    expect(snapshot.files.some((file) => file.source === 'staged' && !file.selectable)).toBe(true)
    expect(snapshot.files.some((file) => file.source === 'worktree' && file.selectable)).toBe(true)

    const stagedOnly = snapshot.files.filter((file) => file.source === 'staged').map((file) => file.id)
    await stageAndCommit(snapshot, stagedOnly, 'test: preserve staged boundary', '')
    const content = await runGit(root, ['show', 'HEAD:README.md'])
    expect(content.stdout).toContain('staged line')
    expect(content.stdout).not.toContain('unstaged line')
    const working = await fs.readFile(join(root, 'README.md'), 'utf8')
    expect(working).toContain('unstaged line')
  })
})
