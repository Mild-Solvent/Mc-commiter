import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { listProviderModels, testProvider } from '../src/main/provider-service'
import type { PersistedProvider } from '../src/main/config-store'

let server: Server | undefined

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
})

async function mockServer(status = 200, body: unknown = { data: [{ id: 'fixture-model' }] }) {
  server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing mock server address')
  return `http://127.0.0.1:${address.port}`
}

function provider(baseUrl: string): PersistedProvider {
  return { id: 'mock', kind: 'openai-compatible', name: 'Mock', baseUrl, model: 'fixture-model' }
}

describe('provider contracts', () => {
  it('lists OpenAI-compatible models', async () => {
    const baseUrl = await mockServer()
    await expect(listProviderModels(provider(baseUrl))).resolves.toEqual(['fixture-model'])
  })

  it('returns bounded connection errors without throwing from testProvider', async () => {
    const baseUrl = await mockServer(401, { error: 'invalid key' })
    const result = await testProvider(provider(baseUrl))
    expect(result.ok).toBe(false)
    expect(result.message).toContain('401')
    expect(result.message).toContain('invalid key')
  })
})
