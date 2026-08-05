import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  session,
  Tray,
  type IpcMainInvokeEvent,
  type Rectangle
} from 'electron'
import { join, basename } from 'node:path'
import { z } from 'zod'
import { ConfigStore } from './config-store'
import { createChangeSnapshot, resolveGitRoot, stageAndCommit } from './git-service'
import {
  generateCommitDraft,
  isLoopbackUrl,
  listProviderModels,
  startLocalServer,
  testProvider
} from './provider-service'
import {
  assembleSubject,
  isValidSubject,
  type ChangeSnapshot,
  type PreviewOutcome,
  type WindowMode
} from '../shared/types'

const providerSaveSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(80),
  baseUrl: z.string().url(),
  model: z.string().max(200),
  customHeader: z.string().max(100).optional(),
  secret: z.string().max(10_000).optional(),
  clearSecret: z.boolean().optional()
})

const commitExecutionSchema = z.object({
  snapshotId: z.string().uuid(),
  selectedFileIds: z.array(z.string()).max(20_000),
  subject: z.string().min(1).max(72).refine((value) => isValidSubject(value)),
  body: z.string().max(10_000).refine((value) => !/[\0]/.test(value))
})

const modeSizes: Record<WindowMode, { width: number; height: number }> = {
  bubble: { width: 84, height: 84 },
  menu: { width: 380, height: 560 },
  review: { width: 460, height: 700 },
  settings: { width: 500, height: 740 }
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let windowMode: WindowMode = 'bubble'
let store: ConfigStore
let moveSaveTimer: NodeJS.Timeout | undefined
const previews = new Map<string, { snapshot: ChangeSnapshot; providerId: string }>()

function assertTrusted(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Untrusted IPC sender')
  }
}

function clampBounds(bounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height),
    width: bounds.width,
    height: bounds.height
  }
}

function setWindowMode(mode: WindowMode): void {
  if (!mainWindow) return
  const current = mainWindow.getBounds()
  const size = modeSizes[mode]
  const bubbleAnchor = {
    x: current.x + current.width - modeSizes.bubble.width,
    y: current.y + current.height - modeSizes.bubble.height
  }
  const next = clampBounds({
    x: bubbleAnchor.x + modeSizes.bubble.width - size.width,
    y: bubbleAnchor.y + modeSizes.bubble.height - size.height,
    ...size
  })
  windowMode = mode
  mainWindow.setResizable(mode !== 'bubble')
  mainWindow.setBounds(next, true)
  mainWindow.setResizable(false)
  mainWindow.show()
  if (mode !== 'bubble') mainWindow.focus()
}

function makeTrayIcon(): Electron.NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7c5cff"/><stop offset="1" stop-color="#29c6d1"/></linearGradient></defs><circle cx="32" cy="32" r="29" fill="url(#g)"/><path d="M20 20h24v17H30l-7 7v-7h-3z" fill="white" opacity=".95"/><path d="M26 27h12M26 32h8" stroke="#6a51dc" stroke-width="3" stroke-linecap="round"/></svg>`
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  return nativeImage.createFromDataURL(dataUrl).resize({ width: 32, height: 32 })
}

function createTray(): void {
  tray = new Tray(makeTrayIcon())
  tray.setToolTip('Commit Bubble')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Commit changes',
        click: () => {
          mainWindow?.show()
          mainWindow?.webContents.send('app:action', 'commit')
        }
      },
      {
        label: 'Repositories',
        click: () => {
          setWindowMode('menu')
          mainWindow?.webContents.send('app:action', 'menu')
        }
      },
      {
        label: 'Settings',
        click: () => {
          setWindowMode('settings')
          mainWindow?.webContents.send('app:action', 'settings')
        }
      },
      { type: 'separator' },
      { label: 'Hide', click: () => mainWindow?.hide() },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) mainWindow.hide()
    else {
      setWindowMode('bubble')
      mainWindow.show()
    }
  })
}

function createWindow(): void {
  const saved = store.getBubblePosition()
  const primaryArea = screen.getPrimaryDisplay().workArea
  const initial = clampBounds({
    x: saved?.x ?? primaryArea.x + primaryArea.width - 112,
    y: saved?.y ?? primaryArea.y + primaryArea.height - 132,
    ...modeSizes.bubble
  })
  mainWindow = new BrowserWindow({
    ...initial,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    title: 'Commit Bubble',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  })
  mainWindow.setAlwaysOnTop(true, 'floating')
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('moved', () => {
    if (!mainWindow || windowMode !== 'bubble') return
    if (moveSaveTimer) clearTimeout(moveSaveTimer)
    moveSaveTimer = setTimeout(() => {
      if (!mainWindow) return
      const { x, y } = mainWindow.getBounds()
      void store.setBubblePosition({ x, y })
    }, 250)
  })
  mainWindow.once('ready-to-show', () => mainWindow?.showInactive())
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', (event) => {
    assertTrusted(event)
    return store.publicSettings()
  })
  ipcMain.handle('repositories:add', async (event) => {
    assertTrusted(event)
    const selection = await dialog.showOpenDialog(mainWindow!, {
      title: 'Add a Git repository',
      properties: ['openDirectory']
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    const root = await resolveGitRoot(selection.filePaths[0])
    return store.addRepository(root, basename(root))
  })
  ipcMain.handle('repositories:remove', async (event, id: unknown) => {
    assertTrusted(event)
    const value = z.string().uuid().parse(id)
    await store.removeRepository(value)
    return store.publicSettings()
  })
  ipcMain.handle('repositories:select', async (event, id: unknown) => {
    assertTrusted(event)
    const value = z.string().uuid().parse(id)
    await store.selectRepository(value)
    previews.clear()
    return store.publicSettings()
  })
  ipcMain.handle('providers:save', async (event, input: unknown) => {
    assertTrusted(event)
    await store.saveProvider(providerSaveSchema.parse(input))
    return store.publicSettings()
  })
  ipcMain.handle('providers:select', async (event, id: unknown) => {
    assertTrusted(event)
    const value = z.string().min(1).parse(id)
    await store.selectProvider(value)
    previews.clear()
    return store.publicSettings()
  })
  ipcMain.handle('providers:test', async (event, id: unknown) => {
    assertTrusted(event)
    const provider = store.getProvider(z.string().min(1).parse(id))
    return testProvider(provider, store.getSecret(provider))
  })
  ipcMain.handle('providers:models', async (event, id: unknown) => {
    assertTrusted(event)
    const provider = store.getProvider(z.string().min(1).parse(id))
    return listProviderModels(provider, store.getSecret(provider))
  })
  ipcMain.handle('providers:start', async (event, id: unknown) => {
    assertTrusted(event)
    return startLocalServer(store.getProvider(z.string().min(1).parse(id)))
  })
  ipcMain.handle('preview:create', async (event, options: unknown): Promise<PreviewOutcome> => {
    assertTrusted(event)
    try {
      const parsed = z.object({ allowRemoteSecrets: z.boolean().optional() }).optional().parse(options)
      const repository = store.getActiveRepository()
      if (!repository) throw new Error('Add and select a Git repository first')
      const provider = store.getActiveProvider()
      const local = isLoopbackUrl(provider.baseUrl)
      const snapshot = await createChangeSnapshot(repository, local ? 80_000 : 60_000)
      const riskyFiles = snapshot.files.filter((file) => file.selected && file.secretRisk)
      if (!local && riskyFiles.length > 0 && !parsed?.allowRemoteSecrets) {
        return {
          ok: false,
          code: 'REMOTE_SECRET_RISK',
          message: 'Potential secrets were detected. Sending this change set to a remote provider requires explicit approval.',
          files: riskyFiles.map((file) => `${file.path} (${file.secretRisk})`)
        }
      }
      const generated = await generateCommitDraft(provider, store.getSecret(provider), snapshot)
      const preview = {
        snapshot,
        draft: generated.draft,
        subject: assembleSubject(generated.draft),
        provider: generated.metadata
      }
      previews.set(snapshot.id, { snapshot, providerId: provider.id })
      while (previews.size > 10) previews.delete(previews.keys().next().value as string)
      return { ok: true, preview }
    } catch (error) {
      return { ok: false, code: 'ERROR', message: (error as Error).message }
    }
  })
  ipcMain.handle('preview:cancel', (event) => {
    assertTrusted(event)
    previews.clear()
  })
  ipcMain.handle('commit:execute', async (event, input: unknown) => {
    assertTrusted(event)
    const request = commitExecutionSchema.parse(input)
    const stored = previews.get(request.snapshotId)
    if (!stored) throw new Error('This commit preview has expired')
    const validIds = new Set(stored.snapshot.files.map((file) => file.id))
    if (request.selectedFileIds.some((id) => !validIds.has(id))) {
      throw new Error('The selected file list is invalid')
    }
    const result = await stageAndCommit(
      stored.snapshot,
      request.selectedFileIds,
      request.subject,
      request.body
    )
    previews.delete(request.snapshotId)
    if (Notification.isSupported()) {
      new Notification({
        title: 'Commit created',
        body: `${result.commitHash.slice(0, 8)} ${request.subject}`,
        icon: makeTrayIcon()
      }).show()
    }
    return {
      commitHash: result.commitHash,
      subject: request.subject,
      includedPaths: result.includedPaths,
      providerId: stored.providerId
    }
  })
  ipcMain.handle('window:mode', (event, mode: unknown) => {
    assertTrusted(event)
    setWindowMode(z.enum(['bubble', 'menu', 'review', 'settings']).parse(mode))
  })
  ipcMain.handle('window:hide', (event) => {
    assertTrusted(event)
    mainWindow?.hide()
  })
  ipcMain.handle('app:quit', (event) => {
    assertTrusted(event)
    quitting = true
    app.quit()
  })
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    setWindowMode('bubble')
    mainWindow?.show()
  })
  app.whenReady().then(async () => {
    app.setAppUserModelId('studio.dav.commitbubble')
    store = new ConfigStore()
    await store.load()
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    registerIpc()
    createWindow()
    createTray()
  })
}

app.on('window-all-closed', () => {
  // Keep the tray process alive when the floating window is hidden or closed.
})
app.on('before-quit', () => {
  quitting = true
})
