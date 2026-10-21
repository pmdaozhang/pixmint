import { contextBridge, ipcRenderer } from 'electron'
import type { SnapglassApi } from '../shared/api'
import type {
  GifDoneMeta,
  OverlayCompletePayload,
  OverlayInit,
  RecorderBeginPayload,
  RecorderCommand,
  RecorderControlCommand,
  RecorderState,
  RecorderStatePatch,
  Settings,
  VideoDoneMeta
} from '../shared/types'

const api: SnapglassApi = {
  overlay: {
    ready: () => ipcRenderer.invoke('overlay:ready'),
    onInit: (callback: (init: OverlayInit) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, init: OverlayInit) => {
        callback(init)
      }
      ipcRenderer.on('overlay:init', listener)
      return () => ipcRenderer.removeListener('overlay:init', listener)
    },
    onPrepare: (callback: (settings: Settings) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: Settings) => {
        callback(settings)
      }
      ipcRenderer.on('overlay:prepare', listener)
      return () => ipcRenderer.removeListener('overlay:prepare', listener)
    },
    onReset: (callback: () => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('overlay:reset', listener)
      return () => ipcRenderer.removeListener('overlay:reset', listener)
    },
    prepared: () => ipcRenderer.send('overlay:prepared'),
    rendererReady: () => ipcRenderer.send('overlay:renderer-ready'),
    heartbeat: () => ipcRenderer.send('overlay:heartbeat'),
    windowAt: (x: number, y: number) => ipcRenderer.invoke('overlay:window-at', x, y),
    autoCopy: (pngDataUrl: string) => ipcRenderer.send('overlay:auto-copy', pngDataUrl),
    complete: (payload: OverlayCompletePayload) => ipcRenderer.send('overlay:complete', payload),
    cancel: () => ipcRenderer.send('overlay:cancel')
  },
  pin: {
    ready: () => ipcRenderer.invoke('pin:ready'),
    close: () => ipcRenderer.send('pin:close'),
    copy: () => ipcRenderer.invoke('pin:copy'),
    save: () => ipcRenderer.invoke('pin:save'),
    setOpacity: (opacity: number) => ipcRenderer.invoke('pin:set-opacity', opacity),
    toggleIgnore: () => ipcRenderer.invoke('pin:toggle-ignore'),
    zoom: (direction: 1 | -1) => ipcRenderer.invoke('pin:zoom', direction),
    dragStart: () => ipcRenderer.send('pin:drag-start'),
    dragMove: (dx: number, dy: number) => ipcRenderer.send('pin:drag-move', dx, dy),
    dragEnd: () => ipcRenderer.send('pin:drag-end'),
    contextMenu: () => ipcRenderer.send('pin:context-menu')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:update', patch),
    setTranslationKey: (key: string) =>
      ipcRenderer.invoke('settings:set-translation-key', key),
    openWindow: () => ipcRenderer.send('settings:open-window')
  },
  ocr: {
    ready: () => ipcRenderer.invoke('ocr:ready'),
    close: () => ipcRenderer.send('ocr:close'),
    openSettings: () => ipcRenderer.send('ocr:open-settings'),
    resize: (height: number) => ipcRenderer.send('ocr:resize', height)
  },
  translation: {
    translate: (text: string, target?: 'zh-CN' | 'en-US') =>
      ipcRenderer.invoke('translation:translate', text, target)
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text)
  },
  recorder: {
    begin: (payload: RecorderBeginPayload) => ipcRenderer.invoke('recorder:begin', payload),
    state: (patch: RecorderStatePatch) => ipcRenderer.send('recorder:state', patch),
    gifDone: (bytes: Uint8Array, meta: GifDoneMeta) =>
      ipcRenderer.send('recorder:gif-done', bytes, meta),
    videoBegin: (meta: VideoDoneMeta) => ipcRenderer.invoke('recorder:video-begin', meta),
    videoChunk: (chunk: ArrayBuffer) => ipcRenderer.send('recorder:video-chunk', chunk),
    videoDone: (meta: VideoDoneMeta) => ipcRenderer.send('recorder:video-done', meta),
    videoFailed: (message: string) => ipcRenderer.send('recorder:video-failed', message),
    dismiss: () => ipcRenderer.send('recorder:dismiss'),
    onCommand: (callback: (command: RecorderCommand) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, command: RecorderCommand) => {
        callback(command)
      }
      ipcRenderer.on('overlay:recorder-command', listener)
      return () => ipcRenderer.removeListener('overlay:recorder-command', listener)
    }
  },
  recorderControl: {
    ready: () => ipcRenderer.invoke('recorder:control-ready'),
    onState: (callback: (state: RecorderState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: RecorderState) => {
        callback(state)
      }
      ipcRenderer.on('recorder:control-state', listener)
      return () => ipcRenderer.removeListener('recorder:control-state', listener)
    },
    command: (command: RecorderControlCommand) =>
      ipcRenderer.send('recorder:control-command', command)
  },
  recorderPreview: {
    ready: () => ipcRenderer.invoke('recorder:preview-ready'),
    readFile: () => ipcRenderer.invoke('recorder:preview-read'),
    save: () => ipcRenderer.invoke('recorder:preview-save'),
    copy: () => ipcRenderer.invoke('recorder:preview-copy'),
    retry: () => ipcRenderer.send('recorder:preview-retry'),
    close: () => ipcRenderer.send('recorder:preview-close'),
    openFolder: () => ipcRenderer.send('recorder:preview-open-folder')
  },
  app: {
    platform: process.platform,
    version: () => ipcRenderer.invoke('app:version')
  }
}

contextBridge.exposeInMainWorld('snapglass', api)
