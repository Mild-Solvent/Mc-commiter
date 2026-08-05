import { describe, expect, it } from 'vitest'
import { gitInternals } from '../src/main/git-service'

describe('Git porcelain parsing', () => {
  it('splits staged and worktree portions of the same file', () => {
    const raw = [
      '1 MM N... 100644 100644 100644 aaaaaaa bbbbbbb src/app.ts',
      '? .env.local',
      '2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 src/new name.ts',
      'src/old name.ts',
      ''
    ].join('\0')
    const files = gitInternals.parsePorcelainV2(raw)
    expect(files.map((file) => file.id)).toEqual([
      'staged:src/app.ts',
      'worktree:src/app.ts',
      'untracked:.env.local',
      'staged:src/new name.ts'
    ])
    expect(files.at(-1)?.oldPath).toBe('src/old name.ts')
    expect(files[0].selectable).toBe(false)
    expect(files[1].selectable).toBe(true)
  })

  it('flags credential-like paths and content', () => {
    expect(gitInternals.secretRiskForPath('.env')).toBeTruthy()
    expect(gitInternals.secretRiskForPath('certs/prod.key')).toBeTruthy()
    expect(gitInternals.secretRiskForPath('src/index.ts')).toBeUndefined()
    expect(gitInternals.containsCredentialPattern('API_KEY="abcdefghijklmnop"')).toBe(true)
  })
})
