import { contextBridge, ipcRenderer } from 'electron'
import type {
  CommitBubbleApi,
  CommitExecutionRequest,
  ProviderSaveRequest,
  WindowMode
} from '../shared/types'

const api: CommitBubbleApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  addRepository: () => ipcRenderer.invoke('repositories:add'),
  removeRepository: (id: string) => ipcRenderer.invoke('repositories:remove', id),
  selectRepository: (id: string) => ipcRenderer.invoke('repositories:select', id),
  saveProvider: (input: ProviderSaveRequest) => ipcRenderer.invoke('providers:save', input),
  selectProvider: (id: string) => ipcRenderer.invoke('providers:select', id),
  testProvider: (id: string) => ipcRenderer.invoke('providers:test', id),
  listModels: (id: string) => ipcRenderer.invoke('providers:models', id),
  startLocalServer: (id: string) => ipcRenderer.invoke('providers:start', id),
  createPreview: (options?: { allowRemoteSecrets?: boolean }) =>
    ipcRenderer.invoke('preview:create', options),
  cancelPreview: () => ipcRenderer.invoke('preview:cancel'),
  executeCommit: (input: CommitExecutionRequest) => ipcRenderer.invoke('commit:execute', input),
  setWindowMode: (mode: WindowMode) => ipcRenderer.invoke('window:mode', mode),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onAction: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, action: 'commit' | 'menu' | 'settings') => callback(action)
    ipcRenderer.on('app:action', listener)
    return () => ipcRenderer.removeListener('app:action', listener)
  }
}

contextBridge.exposeInMainWorld('commitBubble', api)
