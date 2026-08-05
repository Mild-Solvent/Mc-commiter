import { z } from 'zod'

export const providerKinds = [
  'lmstudio',
  'ollama',
  'openai-compatible',
  'openai',
  'anthropic',
  'gemini'
] as const

export const providerKindSchema = z.enum(providerKinds)
export type ProviderKind = z.infer<typeof providerKindSchema>

export const conventionalTypes = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert'
] as const

export const commitDraftSchema = z.object({
  type: z.enum(conventionalTypes),
  scope: z.string().trim().max(20).nullable().optional(),
  summary: z.string().trim().min(3).max(52),
  body: z.string().trim().max(1200).nullable().optional()
})

export type CommitDraftContent = z.infer<typeof commitDraftSchema>

export const commitDraftJsonSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: conventionalTypes },
    scope: { anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }] },
    summary: { type: 'string', minLength: 3, maxLength: 52 },
    body: { anyOf: [{ type: 'string', maxLength: 1200 }, { type: 'null' }] }
  },
  required: ['type', 'scope', 'summary', 'body'],
  additionalProperties: false
} as const

export interface RepositoryProfile {
  id: string
  rootPath: string
  displayName: string
  commitStyle: 'conventional'
  createdAt: string
  updatedAt: string
}

export interface ProviderPublicConfig {
  id: string
  kind: ProviderKind
  name: string
  baseUrl: string
  model: string
  hasSecret: boolean
  customHeader?: string
}

export interface AppSettingsPublic {
  version: 1
  repositories: RepositoryProfile[]
  activeRepositoryId: string | null
  providers: ProviderPublicConfig[]
  activeProviderId: string
  startWithWindows: boolean
}

export type ChangeSource = 'staged' | 'worktree' | 'untracked'

export interface ChangeFile {
  id: string
  path: string
  oldPath?: string
  status: string
  source: ChangeSource
  staged: boolean
  selectable: boolean
  selected: boolean
  binary: boolean
  secretRisk?: string
}

export interface ChangeSnapshot {
  id: string
  repositoryId: string
  rootPath: string
  head: string
  branch: string
  fingerprint: string
  files: ChangeFile[]
  diffPayload: string
  truncated: boolean
  warnings: string[]
  createdAt: string
}

export interface ProviderMetadata {
  id: string
  name: string
  kind: ProviderKind
  model: string
  locality: 'local' | 'remote'
}

export interface CommitPreview {
  snapshot: ChangeSnapshot
  draft: CommitDraftContent
  subject: string
  provider: ProviderMetadata
}

export type PreviewOutcome =
  | { ok: true; preview: CommitPreview }
  | { ok: false; code: 'REMOTE_SECRET_RISK' | 'ERROR'; message: string; files?: string[] }

export interface CommitExecutionRequest {
  snapshotId: string
  selectedFileIds: string[]
  subject: string
  body: string
}

export interface CommitResult {
  commitHash: string
  subject: string
  includedPaths: string[]
  providerId: string
}

export interface ProviderSaveRequest {
  id: string
  name: string
  baseUrl: string
  model: string
  customHeader?: string
  secret?: string
  clearSecret?: boolean
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  models: string[]
}

export type WindowMode = 'bubble' | 'menu' | 'review' | 'settings'

export interface CommitBubbleApi {
  getSettings(): Promise<AppSettingsPublic>
  addRepository(): Promise<RepositoryProfile | null>
  removeRepository(id: string): Promise<AppSettingsPublic>
  selectRepository(id: string): Promise<AppSettingsPublic>
  saveProvider(input: ProviderSaveRequest): Promise<AppSettingsPublic>
  selectProvider(id: string): Promise<AppSettingsPublic>
  testProvider(id: string): Promise<ProviderTestResult>
  listModels(id: string): Promise<string[]>
  startLocalServer(id: string): Promise<{ ok: boolean; message: string }>
  createPreview(options?: { allowRemoteSecrets?: boolean }): Promise<PreviewOutcome>
  cancelPreview(): Promise<void>
  executeCommit(input: CommitExecutionRequest): Promise<CommitResult>
  setWindowMode(mode: WindowMode): Promise<void>
  hideWindow(): Promise<void>
  quitApp(): Promise<void>
  onAction(callback: (action: 'commit' | 'menu' | 'settings') => void): () => void
}

export function assembleSubject(draft: CommitDraftContent): string {
  const scope = draft.scope?.trim() ? `(${draft.scope.trim()})` : ''
  return `${draft.type}${scope}: ${draft.summary.trim()}`
}

export function isValidSubject(subject: string): boolean {
  const value = subject.trim()
  return value.length > 0 && value.length <= 72 && !/[\r\n\0]/.test(value)
}
