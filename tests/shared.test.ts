import { describe, expect, it } from 'vitest'
import { assembleSubject, commitDraftSchema, isValidSubject } from '../src/shared/types'
import { isLoopbackUrl, providerInternals } from '../src/main/provider-service'

describe('commit draft contract', () => {
  it('assembles a scoped Conventional Commit subject', () => {
    const draft = commitDraftSchema.parse({
      type: 'feat',
      scope: 'ui',
      summary: 'add floating commit review',
      body: null
    })
    expect(assembleSubject(draft)).toBe('feat(ui): add floating commit review')
    expect(isValidSubject(assembleSubject(draft))).toBe(true)
  })

  it('rejects multiline and oversized subjects', () => {
    expect(isValidSubject('fix: valid subject')).toBe(true)
    expect(isValidSubject('fix: first\nsecond')).toBe(false)
    expect(isValidSubject(`fix: ${'x'.repeat(70)}`)).toBe(false)
  })

  it('repairs fenced JSON from less capable local models', () => {
    const parsed = providerInternals.parseDraft(
      '```json\n{"type":"fix","scope":null,"summary":"handle empty repositories","body":null}\n```'
    )
    expect(parsed.type).toBe('fix')
  })
})

describe('provider URL boundaries', () => {
  it('classifies only explicit loopback hosts as local', () => {
    expect(isLoopbackUrl('http://127.0.0.1:1234')).toBe(true)
    expect(isLoopbackUrl('http://localhost:11434')).toBe(true)
    expect(isLoopbackUrl('https://api.openai.com')).toBe(false)
    expect(isLoopbackUrl('http://localhost.attacker.test')).toBe(false)
  })

  it('does not duplicate the v1 path', () => {
    expect(providerInternals.endpoint('http://localhost:8000/v1', '/v1/models')).toBe(
      'http://localhost:8000/v1/models'
    )
  })
})
