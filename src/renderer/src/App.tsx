import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettingsPublic,
  CommitPreview,
  ProviderPublicConfig,
  ProviderSaveRequest,
  WindowMode
} from '../../shared/types'
import { isValidSubject } from '../../shared/types'
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  EyeOffIcon,
  FolderPlusIcon,
  GitCommitIcon,
  MenuIcon,
  PlayIcon,
  PowerIcon,
  RefreshIcon,
  SettingsIcon,
  TrashIcon
} from './icons'

type View = WindowMode

function locality(baseUrl: string): 'local' | 'remote' {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) ? 'local' : 'remote'
  } catch {
    return 'remote'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function App() {
  const [settings, setSettings] = useState<AppSettingsPublic | null>(null)
  const [view, setView] = useState<View>('bubble')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<CommitPreview | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const activeRepository = settings?.repositories.find((repo) => repo.id === settings.activeRepositoryId)
  const activeProvider = settings?.providers.find((provider) => provider.id === settings.activeProviderId)

  useEffect(() => {
    void window.commitBubble.getSettings().then((loaded) => {
      setSettings(loaded)
      if (loaded.repositories.length === 0) {
        setView('onboarding')
        void window.commitBubble.setWindowMode('onboarding')
      }
    }).catch((err) => setError(errorMessage(err)))
    return window.commitBubble.onAction((action) => {
      if (action === 'commit') void createPreview()
      else void openView(action === 'menu' ? 'menu' : 'settings')
    })
  }, [])

  async function openView(next: View) {
    setError('')
    setView(next)
    await window.commitBubble.setWindowMode(next)
  }

  async function closePanel() {
    setError('')
    setPreview(null)
    await window.commitBubble.cancelPreview()
    await openView('bubble')
  }

  async function createPreview(allowRemoteSecrets = false) {
    if (busy) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const outcome = await window.commitBubble.createPreview({ allowRemoteSecrets })
      if (!outcome.ok) {
        if (outcome.code === 'REMOTE_SECRET_RISK') {
          const details = outcome.files?.join('\n') ?? ''
          const approved = window.confirm(`${outcome.message}\n\n${details}\n\nSend to the active remote provider once?`)
          if (approved) {
            setBusy(false)
            await createPreview(true)
            return
          }
        } else {
          setError(outcome.message)
        }
        return
      }
      setPreview(outcome.preview)
      setSubject(outcome.preview.subject)
      setBody(outcome.preview.draft.body ?? '')
      setSelectedIds(new Set(outcome.preview.snapshot.files.filter((file) => file.selected).map((file) => file.id)))
      await openView('review')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!preview || !isValidSubject(subject) || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await window.commitBubble.executeCommit({
        snapshotId: preview.snapshot.id,
        selectedFileIds: [...selectedIds],
        subject: subject.trim(),
        body: body.trim()
      })
      setNotice(`Committed ${result.commitHash.slice(0, 8)}`)
      setPreview(null)
      await openView('bubble')
      window.setTimeout(() => setNotice(''), 3500)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function toggleFile(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!settings) {
    return <Bubble busy error={error} notice="" onCommit={() => undefined} onMenu={() => undefined} />
  }

  return (
    <main className={`app-shell view-${view}`}>
      <div className="drag-surface" aria-hidden="true" />
      {view === 'bubble' && (
        <Bubble
          busy={busy}
          error={error}
          notice={notice}
          onCommit={() => void createPreview()}
          onMenu={() => void openView('menu')}
          repositoryName={activeRepository?.displayName}
        />
      )}
      {view === 'menu' && (
        <MenuPanel
          settings={settings}
          error={error}
          onClose={() => void closePanel()}
          onAdd={async () => {
            setError('')
            try {
              await window.commitBubble.addRepository()
              setSettings(await window.commitBubble.getSettings())
            } catch (err) {
              setError(errorMessage(err))
            }
          }}
          onSelect={async (id) => setSettings(await window.commitBubble.selectRepository(id))}
          onRemove={async (id) => {
            if (window.confirm('Remove this repository from Commit Bubble? No files will be deleted.')) {
              setSettings(await window.commitBubble.removeRepository(id))
            }
          }}
          onSettings={() => void openView('settings')}
          onCommit={() => void createPreview()}
        />
      )}
      {view === 'review' && preview && (
        <ReviewPanel
          preview={preview}
          selectedIds={selectedIds}
          subject={subject}
          body={body}
          busy={busy}
          error={error}
          onSubject={setSubject}
          onBody={setBody}
          onToggle={toggleFile}
          onCancel={() => void closePanel()}
          onCommit={() => void commit()}
        />
      )}
      {view === 'settings' && (
        <SettingsPanel
          settings={settings}
          error={error}
          setError={setError}
          onSettings={setSettings}
          onClose={() => void closePanel()}
        />
      )}
      {view === 'onboarding' && (
        <OnboardingPanel
          settings={settings}
          onSettings={setSettings}
          onFinish={() => void openView('bubble')}
        />
      )}
    </main>
  )
}

function OnboardingPanel({
  settings,
  onSettings,
  onFinish
}: {
  settings: AppSettingsPublic
  onSettings: (settings: AppSettingsPublic) => void
  onFinish: () => void
}) {
  const [step, setStep] = useState(0)
  const [providerId, setProviderId] = useState(settings.activeProviderId || 'lmstudio')
  const provider = settings.providers.find((candidate) => candidate.id === providerId) ?? settings.providers[0]
  const [form, setForm] = useState<ProviderSaveRequest>(() => providerForm(provider))
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const repository = settings.repositories.find((repo) => repo.id === settings.activeRepositoryId)

  useEffect(() => {
    setForm(providerForm(provider))
    setModels([])
    setMessage('')
    setError('')
  }, [providerId])

  async function addRepository() {
    setBusy(true); setError('')
    try {
      await window.commitBubble.addRepository()
      const next = await window.commitBubble.getSettings()
      onSettings(next)
      if (next.activeRepositoryId) setMessage('Repository added and ready.')
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  async function saveProviderForm(): Promise<AppSettingsPublic> {
    const saved = await window.commitBubble.saveProvider(form)
    const activated = await window.commitBubble.selectProvider(provider.id)
    onSettings(activated)
    return saved
  }

  async function startServer() {
    setBusy(true); setError(''); setMessage('')
    try {
      await saveProviderForm()
      const result = await window.commitBubble.startLocalServer(provider.id)
      if (!result.ok) throw new Error(result.message)
      setMessage(`${result.message} Wait a moment, then click Detect models.`)
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  async function detectModels() {
    setBusy(true); setError(''); setMessage('')
    try {
      await saveProviderForm()
      const result = await window.commitBubble.testProvider(provider.id)
      if (!result.ok) throw new Error(result.message)
      setModels(result.models)
      if (result.models.length === 1) {
        const nextForm = { ...form, model: result.models[0], secret: '' }
        setForm(nextForm)
        onSettings(await window.commitBubble.saveProvider(nextForm))
      }
      setMessage(result.models.length ? `${result.models.length} model(s) found. Choose one below.` : 'Connected, but no models were found. Enter a model ID or load a model in the provider app.')
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  async function finish() {
    setBusy(true); setError('')
    try {
      await saveProviderForm()
      onSettings(await window.commitBubble.getSettings())
      onFinish()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <section className="panel onboarding-panel">
      <header className="onboarding-header">
        <div className="brand-lockup"><span className="brand-icon"><GitCommitIcon /></span><div><span className="eyebrow">DAV Studios</span><strong>Commit Bubble</strong></div></div>
        <span className="step-count">Step {step + 1} of 4</span>
      </header>
      <div className="progress-track"><span style={{ width: `${((step + 1) / 4) * 100}%` }} /></div>

      <div className="onboarding-content">
        {step === 0 && (
          <div className="welcome-step">
            <span className="welcome-orb"><GitCommitIcon /></span>
            <span className="eyebrow">A safer one-click commit</span>
            <h1>Let’s get you ready in a few clicks.</h1>
            <p>Choose a repository and connect the AI you already use. Commit Bubble reviews every message and file with you before Git is changed.</p>
            <div className="assurance-grid">
              <div><CheckIcon /><span><strong>Local-first</strong><small>LM Studio and Ollama supported</small></span></div>
              <div><CheckIcon /><span><strong>Review first</strong><small>Nothing commits without approval</small></span></div>
              <div><CheckIcon /><span><strong>Private keys</strong><small>Encrypted with Windows DPAPI</small></span></div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-step">
            <span className="eyebrow">Your work</span>
            <h1>Pick a Git repository</h1>
            <p>Choose any folder inside the repository. Commit Bubble will resolve its top-level Git root and remember only that path.</p>
            {repository ? (
              <div className="selected-repository"><span className="repo-mark"><CheckIcon /></span><span><strong>{repository.displayName}</strong><small>{repository.rootPath}</small></span></div>
            ) : (
              <div className="wizard-empty"><FolderPlusIcon /><span>No repository selected yet</span></div>
            )}
            <button className="primary-button roomy no-drag" onClick={() => void addRepository()} disabled={busy}><FolderPlusIcon /> {repository ? 'Choose a different folder' : 'Choose repository folder'}</button>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-step provider-choice-step">
            <span className="eyebrow">AI connection</span>
            <h1>Choose your provider</h1>
            <p>Local providers keep your code on this computer. Cloud providers are always marked REMOTE and are never selected automatically.</p>
            <div className="wizard-provider-grid">
              {settings.providers.map((item) => (
                <button className={`wizard-provider no-drag ${providerId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setProviderId(item.id)}>
                  <span className={`locality-dot ${locality(item.baseUrl)}`} /><span><strong>{item.name}</strong><small>{locality(item.baseUrl)}</small></span>{providerId === item.id && <CheckIcon />}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="wizard-step connection-step">
            <div className="connection-title"><div><span className="eyebrow">Final connection</span><h1>Connect {provider.name}</h1></div><span className={`provider-badge ${locality(form.baseUrl)}`}>{locality(form.baseUrl)}</span></div>
            <label className="field-label">Server URL<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} spellCheck={false} /></label>
            <label className="field-label">API key or token <span className="optional">leave blank if local and not required</span><input type="password" autoComplete="off" value={form.secret ?? ''} placeholder={provider.hasSecret ? 'Stored securely · enter to replace' : 'Optional for local servers'} onChange={(event) => setForm({ ...form, secret: event.target.value })} /></label>
            <label className="field-label">Model<input list="wizard-models" value={form.model} placeholder="Detect models or enter an ID" onChange={(event) => setForm({ ...form, model: event.target.value })} /><datalist id="wizard-models">{models.map((model) => <option key={model} value={model} />)}</datalist></label>
            <div className="wizard-connection-actions">
              {(provider.kind === 'lmstudio' || provider.kind === 'ollama') && <button className="secondary-button no-drag" onClick={() => void startServer()} disabled={busy}><PowerIcon /> Start server</button>}
              <button className="secondary-button no-drag" onClick={() => void detectModels()} disabled={busy}><RefreshIcon /> Detect models</button>
            </div>
            <div className="privacy-note compact"><strong>{locality(form.baseUrl) === 'local' ? 'Local connection' : 'Remote connection'}.</strong> {locality(form.baseUrl) === 'local' ? 'Repository content stays on this machine.' : 'Selected change content will be sent to this provider only when you press the commit button.'}</div>
          </div>
        )}

        {message && <div className="success-box wizard-message">{message}</div>}
        {error && <ErrorBox message={error} />}
      </div>

      <footer className="onboarding-footer">
        <button className="link-button no-drag" onClick={onFinish}>Set up later</button>
        <div className="wizard-nav">
          {step > 0 && <button className="secondary-button no-drag" onClick={() => { setStep(step - 1); setError(''); setMessage('') }} disabled={busy}>Back</button>}
          {step < 3 ? (
            <button className="primary-button no-drag" onClick={() => { setStep(step + 1); setError(''); setMessage('') }} disabled={busy || (step === 1 && !repository)}>Continue <ChevronIcon /></button>
          ) : (
            <button className="primary-button no-drag" onClick={() => void finish()} disabled={busy || !form.model.trim()}>{busy ? <span className="button-spinner" /> : <CheckIcon />} Finish setup</button>
          )}
        </div>
      </footer>
    </section>
  )
}

function Bubble({
  busy,
  error,
  notice,
  onCommit,
  onMenu,
  repositoryName
}: {
  busy: boolean
  error: string
  notice: string
  onCommit: () => void
  onMenu: () => void
  repositoryName?: string
}) {
  const title = repositoryName ? `Generate commit for ${repositoryName}` : 'Add a repository to get started'
  return (
    <div className="bubble-stage">
      <button className="menu-orb no-drag" onClick={onMenu} aria-label="Open repositories and settings">
        <MenuIcon />
      </button>
      <button
        className={`commit-orb no-drag ${busy ? 'is-busy' : ''} ${error ? 'has-error' : ''} ${notice ? 'has-success' : ''}`}
        onClick={onCommit}
        disabled={busy}
        aria-label={title}
        title={error || notice || title}
      >
        {notice ? <CheckIcon /> : <GitCommitIcon />}
        {busy && <span className="orbit" />}
      </button>
    </div>
  )
}

function PanelHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <header className="panel-header">
      <div className="panel-title-wrap">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      <button className="icon-button no-drag" onClick={onClose} aria-label="Close panel">
        <CloseIcon />
      </button>
    </header>
  )
}

function MenuPanel({
  settings,
  error,
  onClose,
  onAdd,
  onSelect,
  onRemove,
  onSettings,
  onCommit
}: {
  settings: AppSettingsPublic
  error: string
  onClose: () => void
  onAdd: () => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onSettings: () => void
  onCommit: () => void
}) {
  const activeProvider = settings.providers.find((provider) => provider.id === settings.activeProviderId)
  return (
    <section className="panel menu-panel">
      <PanelHeader eyebrow="Commit Bubble" title="Repositories" onClose={onClose} />
      <div className="panel-scroll">
        {settings.repositories.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><FolderPlusIcon /></div>
            <h2>Add your first repository</h2>
            <p>Commit Bubble only remembers the folder path. It never initializes, moves, or deletes a repository.</p>
          </div>
        ) : (
          <div className="repo-list">
            {settings.repositories.map((repo) => {
              const active = repo.id === settings.activeRepositoryId
              return (
                <div className={`repo-row ${active ? 'active' : ''}`} key={repo.id}>
                  <button className="repo-select no-drag" onClick={() => onSelect(repo.id)}>
                    <span className="repo-mark">{active ? <CheckIcon /> : <GitCommitIcon />}</span>
                    <span className="repo-text"><strong>{repo.displayName}</strong><small>{repo.rootPath}</small></span>
                    <ChevronIcon className="chevron" />
                  </button>
                  <button className="delete-button no-drag" onClick={() => onRemove(repo.id)} aria-label={`Remove ${repo.displayName}`}><TrashIcon /></button>
                </div>
              )
            })}
          </div>
        )}
        {error && <ErrorBox message={error} />}
      </div>
      <footer className="panel-actions vertical-actions">
        <button className="primary-button no-drag" onClick={onCommit} disabled={!settings.activeRepositoryId}>
          <GitCommitIcon /> Generate commit
        </button>
        <div className="split-actions">
          <button className="secondary-button no-drag" onClick={onAdd}><FolderPlusIcon /> Add folder</button>
          <button className="secondary-button no-drag" onClick={onSettings}><SettingsIcon /> Settings</button>
        </div>
        <div className="provider-strip">
          <span className={`locality-dot ${activeProvider ? locality(activeProvider.baseUrl) : ''}`} />
          <span>{activeProvider?.name ?? 'No provider'}</span>
          <small>{activeProvider?.model || 'model not selected'}</small>
        </div>
        <div className="utility-links">
          <button className="link-button no-drag" onClick={() => void window.commitBubble.hideWindow()}><EyeOffIcon /> Hide</button>
          <button className="link-button danger no-drag" onClick={() => void window.commitBubble.quitApp()}><PowerIcon /> Quit</button>
        </div>
      </footer>
    </section>
  )
}

function ReviewPanel({
  preview,
  selectedIds,
  subject,
  body,
  busy,
  error,
  onSubject,
  onBody,
  onToggle,
  onCancel,
  onCommit
}: {
  preview: CommitPreview
  selectedIds: Set<string>
  subject: string
  body: string
  busy: boolean
  error: string
  onSubject: (value: string) => void
  onBody: (value: string) => void
  onToggle: (id: string) => void
  onCancel: () => void
  onCommit: () => void
}) {
  const subjectValid = isValidSubject(subject)
  const includedCount = new Set(
    preview.snapshot.files.filter((file) => file.staged || selectedIds.has(file.id)).map((file) => file.path)
  ).size
  return (
    <section className="panel review-panel">
      <PanelHeader eyebrow={`${preview.snapshot.branch} · ${preview.snapshot.head.slice(0, 8)}`} title="Review commit" onClose={onCancel} />
      <div className="panel-scroll review-scroll">
        <div className="provider-badge-row">
          <span className={`provider-badge ${preview.provider.locality}`}>{preview.provider.locality}</span>
          <span>{preview.provider.name}</span><small>{preview.provider.model}</small>
        </div>
        <label className="field-label">
          Commit subject
          <input className={!subjectValid ? 'invalid' : ''} value={subject} maxLength={72} onChange={(event) => onSubject(event.target.value)} />
          <span className="field-hint"><span>{subjectValid ? 'Conventional Commit' : 'Required, one line, 72 characters maximum'}</span><span>{subject.length}/72</span></span>
        </label>
        <label className="field-label">
          Body <span className="optional">optional</span>
          <textarea value={body} maxLength={10_000} rows={4} onChange={(event) => onBody(event.target.value)} />
        </label>
        {preview.snapshot.warnings.map((warning) => <div className="warning-box" key={warning}>{warning}</div>)}
        <div className="section-heading"><span>Files</span><small>{includedCount} included</small></div>
        <div className="file-list">
          {preview.snapshot.files.map((file) => {
            const checked = file.staged || selectedIds.has(file.id)
            return (
              <label className={`file-row ${file.staged ? 'locked' : ''}`} key={file.id}>
                <input type="checkbox" checked={checked} disabled={file.staged} onChange={() => onToggle(file.id)} />
                <span className={`status-chip status-${file.status.replace(/\s/g, '-')}`}>{file.status.slice(0, 1).toUpperCase()}</span>
                <span className="file-path"><strong>{file.path}</strong><small>{file.staged ? 'already staged · always included' : file.source}{file.secretRisk ? ` · ${file.secretRisk}` : ''}</small></span>
              </label>
            )
          })}
        </div>
        {error && <ErrorBox message={error} />}
      </div>
      <footer className="panel-actions commit-actions">
        <button className="secondary-button no-drag" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="primary-button no-drag" onClick={onCommit} disabled={busy || !subjectValid || includedCount === 0}>
          {busy ? <span className="button-spinner" /> : <CheckIcon />} Commit {includedCount} file{includedCount === 1 ? '' : 's'}
        </button>
      </footer>
    </section>
  )
}

function SettingsPanel({
  settings,
  error,
  setError,
  onSettings,
  onClose
}: {
  settings: AppSettingsPublic
  error: string
  setError: (value: string) => void
  onSettings: (settings: AppSettingsPublic) => void
  onClose: () => void
}) {
  const [providerId, setProviderId] = useState(settings.activeProviderId)
  const provider = settings.providers.find((candidate) => candidate.id === providerId) ?? settings.providers[0]
  const [form, setForm] = useState<ProviderSaveRequest>(() => providerForm(provider))
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm(providerForm(provider))
    setModels([])
    setStatus('')
  }, [providerId])

  const isLocalServer = provider.kind === 'lmstudio' || provider.kind === 'ollama'
  const requiresKey = ['openai', 'anthropic', 'gemini'].includes(provider.kind)

  async function save() {
    setBusy(true); setError(''); setStatus('')
    try {
      const next = await window.commitBubble.saveProvider(form)
      onSettings(next)
      setForm((current) => ({ ...current, secret: '' }))
      setStatus('Saved securely.')
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  async function activate() {
    setBusy(true); setError('')
    try {
      onSettings(await window.commitBubble.selectProvider(provider.id))
      setStatus(`${provider.name} is now the active provider.`)
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  async function test() {
    setBusy(true); setError(''); setStatus('')
    try {
      await save()
      const result = await window.commitBubble.testProvider(provider.id)
      setModels(result.models)
      setStatus(result.message)
      if (!result.ok) setError(result.message)
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  async function loadModels() {
    setBusy(true); setError('')
    try {
      await save()
      const loaded = await window.commitBubble.listModels(provider.id)
      setModels(loaded)
      setStatus(`${loaded.length} model(s) loaded.`)
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <section className="panel settings-panel">
      <PanelHeader eyebrow="Local-first AI" title="Provider settings" onClose={onClose} />
      <div className="panel-scroll settings-scroll">
        <div className="provider-tabs" role="tablist" aria-label="AI providers">
          {settings.providers.map((item) => (
            <button key={item.id} role="tab" aria-selected={item.id === providerId} className={`provider-tab no-drag ${item.id === providerId ? 'selected' : ''}`} onClick={() => setProviderId(item.id)}>
              <span className={`locality-dot ${locality(item.baseUrl)}`} />
              <span>{item.name}</span>
              {item.id === settings.activeProviderId && <CheckIcon />}
            </button>
          ))}
        </div>
        <div className="settings-card">
          <div className="provider-card-heading">
            <div><span className={`provider-badge ${locality(form.baseUrl)}`}>{locality(form.baseUrl)}</span><h2>{provider.name}</h2></div>
            {provider.id === settings.activeProviderId ? <span className="active-label">Active</span> : <button className="text-button no-drag" onClick={() => void activate()}>Make active</button>}
          </div>
          <label className="field-label">Display name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="field-label">Base URL<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} spellCheck={false} /></label>
          <label className="field-label">Model
            <input list="provider-models" value={form.model} placeholder="Load or enter a model ID" onChange={(event) => setForm({ ...form, model: event.target.value })} spellCheck={false} />
            <datalist id="provider-models">{models.map((model) => <option value={model} key={model} />)}</datalist>
          </label>
          {provider.kind === 'openai-compatible' && <label className="field-label">Custom auth header <span className="optional">optional</span><input value={form.customHeader ?? ''} placeholder="Authorization uses Bearer by default" onChange={(event) => setForm({ ...form, customHeader: event.target.value })} /></label>}
          <label className="field-label">{requiresKey ? 'API key' : 'API token'} <span className="optional">optional for local servers</span>
            <input type="password" autoComplete="off" value={form.secret ?? ''} placeholder={provider.hasSecret ? 'Stored securely · enter to replace' : 'Not stored'} onChange={(event) => setForm({ ...form, secret: event.target.value })} />
          </label>
          <div className="settings-buttons">
            <button className="secondary-button no-drag" onClick={() => void loadModels()} disabled={busy}><RefreshIcon /> Models</button>
            <button className="secondary-button no-drag" onClick={() => void test()} disabled={busy}><PlayIcon /> Test</button>
            {isLocalServer && <button className="secondary-button no-drag" onClick={async () => { const result = await window.commitBubble.startLocalServer(provider.id); setStatus(result.message); if (!result.ok) setError(result.message) }} disabled={busy}><PowerIcon /> Start</button>}
          </div>
          {status && <div className="success-box">{status}</div>}
        </div>
        <div className="privacy-note"><strong>Manual switching only.</strong> Commit Bubble never falls back to another provider. A REMOTE badge means selected repository content will leave this machine.</div>
        {error && <ErrorBox message={error} />}
      </div>
      <footer className="panel-actions commit-actions">
        <button className="secondary-button no-drag" onClick={onClose}>Cancel</button>
        <button className="primary-button no-drag" onClick={() => void save()} disabled={busy}>{busy ? <span className="button-spinner" /> : <CheckIcon />} Save settings</button>
      </footer>
    </section>
  )
}

function providerForm(provider: ProviderPublicConfig): ProviderSaveRequest {
  return { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, model: provider.model, customHeader: provider.customHeader, secret: '' }
}

function ErrorBox({ message }: { message: string }) {
  return <div className="error-box" role="alert"><strong>Couldn’t continue</strong><span>{message}</span></div>
}
