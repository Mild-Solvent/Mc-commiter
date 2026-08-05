import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AppSettingsPublic,
  ProviderKind,
  ProviderPublicConfig,
  ProviderSaveRequest,
  RepositoryProfile
} from '../shared/types'

export interface PersistedProvider {
  id: string
  kind: ProviderKind
  name: string
  baseUrl: string
  model: string
  customHeader?: string
  encryptedSecret?: string
}

interface PersistedSettings {
  version: 1
  repositories: RepositoryProfile[]
  activeRepositoryId: string | null
  providers: PersistedProvider[]
  activeProviderId: string
  startWithWindows: boolean
  bubblePosition?: { x: number; y: number }
}

const defaultProviders: PersistedProvider[] = [
  {
    id: 'lmstudio',
    kind: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234',
    model: ''
  },
  {
    id: 'ollama',
    kind: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: ''
  },
  {
    id: 'openai-compatible',
    kind: 'openai-compatible',
    name: 'OpenAI-compatible server',
    baseUrl: 'http://127.0.0.1:8000',
    model: ''
  },
  {
    id: 'openai',
    kind: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    model: ''
  },
  {
    id: 'anthropic',
    kind: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: ''
  },
  {
    id: 'gemini',
    kind: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: ''
  }
]

function defaults(): PersistedSettings {
  return {
    version: 1,
    repositories: [],
    activeRepositoryId: null,
    providers: structuredClone(defaultProviders),
    activeProviderId: 'lmstudio',
    startWithWindows: false
  }
}

export class ConfigStore {
  private readonly filePath = join(app.getPath('userData'), 'settings.json')
  private state: PersistedSettings = defaults()

  async load(): Promise<void> {
    try {
      const text = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(text) as Partial<PersistedSettings>
      if (parsed.version !== 1) throw new Error('Unsupported settings version')
      const seeded = defaults()
      const savedProviders = Array.isArray(parsed.providers) ? parsed.providers : []
      const providers = seeded.providers.map(
        (provider) => savedProviders.find((saved) => saved.id === provider.id) ?? provider
      )
      this.state = {
        ...seeded,
        ...parsed,
        repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [],
        providers
      }
      if (!this.state.repositories.some((repo) => repo.id === this.state.activeRepositoryId)) {
        this.state.activeRepositoryId = this.state.repositories[0]?.id ?? null
      }
      if (!this.state.providers.some((provider) => provider.id === this.state.activeProviderId)) {
        this.state.activeProviderId = 'lmstudio'
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        await this.writeBackup().catch(() => undefined)
      }
      this.state = defaults()
      await this.save()
    }
  }

  private async writeBackup(): Promise<void> {
    const backup = `${this.filePath}.invalid-${Date.now()}`
    await fs.copyFile(this.filePath, backup)
  }

  private async save(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.${process.pid}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await fs.rename(temp, this.filePath)
  }

  publicSettings(): AppSettingsPublic {
    return {
      version: 1,
      repositories: structuredClone(this.state.repositories),
      activeRepositoryId: this.state.activeRepositoryId,
      providers: this.state.providers.map((provider) => this.toPublicProvider(provider)),
      activeProviderId: this.state.activeProviderId,
      startWithWindows: this.state.startWithWindows
    }
  }

  private toPublicProvider(provider: PersistedProvider): ProviderPublicConfig {
    return {
      id: provider.id,
      kind: provider.kind,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      customHeader: provider.customHeader,
      hasSecret: Boolean(provider.encryptedSecret)
    }
  }

  getActiveRepository(): RepositoryProfile | null {
    return this.state.repositories.find((repo) => repo.id === this.state.activeRepositoryId) ?? null
  }

  getProvider(id: string): PersistedProvider {
    const provider = this.state.providers.find((candidate) => candidate.id === id)
    if (!provider) throw new Error('Provider profile not found')
    return structuredClone(provider)
  }

  getActiveProvider(): PersistedProvider {
    return this.getProvider(this.state.activeProviderId)
  }

  getSecret(provider: PersistedProvider): string | undefined {
    if (!provider.encryptedSecret) return undefined
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows credential encryption is not available')
    }
    return safeStorage.decryptString(Buffer.from(provider.encryptedSecret, 'base64'))
  }

  async addRepository(rootPath: string, displayName: string): Promise<RepositoryProfile> {
    const existing = this.state.repositories.find(
      (repo) => repo.rootPath.toLocaleLowerCase() === rootPath.toLocaleLowerCase()
    )
    if (existing) {
      this.state.activeRepositoryId = existing.id
      await this.save()
      return structuredClone(existing)
    }
    const now = new Date().toISOString()
    const profile: RepositoryProfile = {
      id: randomUUID(),
      rootPath,
      displayName,
      commitStyle: 'conventional',
      createdAt: now,
      updatedAt: now
    }
    this.state.repositories.push(profile)
    this.state.activeRepositoryId = profile.id
    await this.save()
    return structuredClone(profile)
  }

  async removeRepository(id: string): Promise<void> {
    this.state.repositories = this.state.repositories.filter((repo) => repo.id !== id)
    if (this.state.activeRepositoryId === id) {
      this.state.activeRepositoryId = this.state.repositories[0]?.id ?? null
    }
    await this.save()
  }

  async selectRepository(id: string): Promise<void> {
    if (!this.state.repositories.some((repo) => repo.id === id)) {
      throw new Error('Repository profile not found')
    }
    this.state.activeRepositoryId = id
    await this.save()
  }

  async saveProvider(input: ProviderSaveRequest): Promise<void> {
    const provider = this.state.providers.find((candidate) => candidate.id === input.id)
    if (!provider) throw new Error('Provider profile not found')
    provider.name = input.name.trim() || provider.name
    provider.baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
    provider.model = input.model.trim()
    provider.customHeader = input.customHeader?.trim() || undefined
    if (input.clearSecret) provider.encryptedSecret = undefined
    if (input.secret) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Windows credential encryption is not available')
      }
      provider.encryptedSecret = safeStorage.encryptString(input.secret).toString('base64')
    }
    await this.save()
  }

  async selectProvider(id: string): Promise<void> {
    if (!this.state.providers.some((provider) => provider.id === id)) {
      throw new Error('Provider profile not found')
    }
    this.state.activeProviderId = id
    await this.save()
  }

  getBubblePosition(): { x: number; y: number } | undefined {
    return this.state.bubblePosition ? { ...this.state.bubblePosition } : undefined
  }

  async setBubblePosition(position: { x: number; y: number }): Promise<void> {
    this.state.bubblePosition = { ...position }
    await this.save()
  }
}
