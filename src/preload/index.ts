import { contextBridge, ipcRenderer } from 'electron'
import type { SnapglassApi } from '../shared/api'
import type {
  FeedbackStatusEvent,
  FeedbackSubmitInput
} from '../shared/feedback'
import type {
  LicenseActivation,
  LicenseDevice,
  LicenseStatus,
  ManualOrder,
  ManualOrderResult,
  PaymentProvider,
  PurchaseOrder,
  PurchaseOrderResult
} from '../shared/license'
import type { UsageFeature, UsageView } from '../shared/usage'
import type {
  GifDoneMeta,
  OverlayCompletePayload,
  OverlayInit,
  OcrResult,
  RecorderBeginPayload,
  RecorderCommand,
  RecorderControlCommand,
  RecorderState,
  RecorderStatePatch,
  Rect,
  Settings,
  DiagnosticsInfo,
  UpdateState,
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
    onWarmEdit: (callback: (bounds: Rect) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, bounds: Rect): void => {
        callback(bounds)
      }
      ipcRenderer.on('overlay:warm-edit', listener)
      return () => ipcRenderer.removeListener('overlay:warm-edit', listener)
    },
    prepared: () => ipcRenderer.send('overlay:prepared'),
    warmEditDone: () => ipcRenderer.send('overlay:warm-edit-done'),
    rendererReady: () => ipcRenderer.send('overlay:renderer-ready'),
    heartbeat: () => ipcRenderer.send('overlay:heartbeat'),
    windowAt: (x: number, y: number) => ipcRenderer.invoke('overlay:window-at', x, y),
    complete: (payload: OverlayCompletePayload) => ipcRenderer.send('overlay:complete', payload),
    cancel: () => ipcRenderer.send('overlay:cancel')
  },
  pin: {
    ready: () => ipcRenderer.invoke('pin:ready'),
    close: () => ipcRenderer.send('pin:close'),
    copy: () => ipcRenderer.invoke('pin:copy'),
    save: () => ipcRenderer.invoke('pin:save'),
    recognizeText: () => ipcRenderer.invoke('pin:recognize-text') as Promise<OcrResult | null>,
    setOpacity: (opacity: number) => ipcRenderer.invoke('pin:set-opacity', opacity),
    zoom: (direction: 1 | -1) => ipcRenderer.invoke('pin:zoom', direction),
    dragStart: () => ipcRenderer.send('pin:drag-start'),
    dragMove: (dx: number, dy: number) => ipcRenderer.send('pin:drag-move', dx, dy),
    dragEnd: () => ipcRenderer.send('pin:drag-end'),
    contextMenu: () => ipcRenderer.send('pin:context-menu'),
    setEditMode: (active: boolean) => ipcRenderer.invoke('pin:set-edit-mode', active),
    commitEdit: (imageBytes: Uint8Array) => ipcRenderer.invoke('pin:commit-edit', imageBytes)
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
  dictionary: {
    lookup: (word: string) => ipcRenderer.invoke('dictionary:lookup', word)
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
    version: () => ipcRenderer.invoke('app:version'),
    contentReady: () => ipcRenderer.send('window:content-ready')
  },
  diagnostics: {
    info: () => ipcRenderer.invoke('diagnostics:info') as Promise<DiagnosticsInfo>,
    openLogFolder: () => ipcRenderer.invoke('diagnostics:open-log-folder') as Promise<string>,
    openCrashFolder: () =>
      ipcRenderer.invoke('diagnostics:open-crash-folder') as Promise<string>,
    flush: () => ipcRenderer.invoke('diagnostics:flush') as Promise<void>,
    disableSafeMode: () =>
      ipcRenderer.invoke('diagnostics:disable-safe-mode') as Promise<boolean>,
    exportReport: () =>
      ipcRenderer.invoke('diagnostics:export-report') as Promise<string | null>
  },
  feedback: {
    submit: (input: FeedbackSubmitInput) => ipcRenderer.invoke('feedback:submit', input),
    onStatus: (callback: (event: FeedbackStatusEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: FeedbackStatusEvent) => {
        callback(event)
      }
      ipcRenderer.on('feedback:status', listener)
      return () => ipcRenderer.removeListener('feedback:status', listener)
    }
  },
  whatsNew: {
    resize: (height: number) => ipcRenderer.send('whats-new:resize', height),
    minimize: () => ipcRenderer.send('whats-new:minimize')
  },
  usage: {
    get: () => ipcRenderer.invoke('usage:get') as Promise<UsageView>
  },
  license: {
    status: () => ipcRenderer.invoke('license:status') as Promise<LicenseStatus>,
    activate: (code: string) =>
      ipcRenderer.invoke('license:activate', code) as Promise<LicenseActivation>,
    restore: () => ipcRenderer.invoke('license:restore') as Promise<LicenseStatus | null>,
    refresh: () => ipcRenderer.invoke('license:refresh') as Promise<LicenseStatus>,
    devices: () => ipcRenderer.invoke('license:devices') as Promise<LicenseDevice[]>,
    unbind: (deviceHash: string) =>
      ipcRenderer.invoke('license:unbind', deviceHash) as Promise<void>,
    trial: (inviteCode: string) =>
      ipcRenderer.invoke('license:trial', inviteCode) as Promise<LicenseActivation>
  },
  purchase: {
    open: (feature?: UsageFeature) => ipcRenderer.send('purchase:open', feature),
    createOrder: (plan, provider: PaymentProvider) =>
      ipcRenderer.invoke('purchase:create-order', plan, provider) as Promise<PurchaseOrder>,
    orderStatus: (orderId: string, orderToken: string) =>
      ipcRenderer.invoke('purchase:order-status', orderId, orderToken) as Promise<PurchaseOrderResult>,
    createManualOrder: (
      plan: 'monthly' | 'yearly' | 'lifetime',
      provider: PaymentProvider
    ) =>
      ipcRenderer.invoke(
        'purchase:create-manual-order',
        plan,
        provider
      ) as Promise<ManualOrder>,
    submitManualOrder: (orderId: string, orderToken: string) =>
      ipcRenderer.invoke(
        'purchase:submit-manual-order',
        orderId,
        orderToken
      ) as Promise<ManualOrder>,
    manualOrderStatus: (orderId: string, orderToken: string) =>
      ipcRenderer.invoke(
        'purchase:manual-order-status',
        orderId,
        orderToken
      ) as Promise<ManualOrderResult>,
    resize: (height: number, width?: number) =>
      ipcRenderer.send('purchase:resize', height, width)
  },
  updater: {
    getState: () => ipcRenderer.invoke('updater:get-state') as Promise<UpdateState>,
    check: () => ipcRenderer.invoke('updater:check') as Promise<UpdateState>,
    download: () => ipcRenderer.invoke('updater:download') as Promise<UpdateState>,
    install: () => ipcRenderer.invoke('updater:install') as Promise<void>,
    onState: (callback: (state: UpdateState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => {
        callback(state)
      }
      ipcRenderer.on('updater:state', listener)
      return () => ipcRenderer.removeListener('updater:state', listener)
    }
  }
}

contextBridge.exposeInMainWorld('snapglass', api)
