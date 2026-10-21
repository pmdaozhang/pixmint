const SCREEN =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAASCAIAAAC1qksFAAAAUklEQVR4nO2U0QnAQAhDX/TGuu/O1PHLKS5Q6k8RRKJIJATVvm5DjiJb4iitmkr8bmZhggwr8CVeeCM7R4E3shMLGtkpBeMB4wFzB5pfxI9/0QPdpASQ4E1zpwAAAABJRU5ErkJggg=='

const settings = {
  shortcut: 'F1',
  theme: 'dark',
  language: 'zh-CN',
  launchAtLogin: false
}

const capture = {
  displayId: 1,
  bounds: { x: 0, y: 0, width: 1000, height: 700 },
  scaleFactor: 1,
  imageDataUrl: SCREEN,
  imageWidth: 1000,
  imageHeight: 700,
  settings
}

window.__completed = null
window.__cancelled = false
window.__pinCalls = []

window.snapglass = {
  overlay: {
    ready: async () => capture,
    onInit: () => () => {},
    rendererReady: () => {},
    complete: (payload) => {
      window.__completed = payload
    },
    cancel: () => {
      window.__cancelled = true
    }
  },
  pin: {
    ready: async () => ({
      id: '1',
      dataUrl: SCREEN,
      width: 300,
      height: 200,
      opacity: 1
    }),
    close: () => window.__pinCalls.push('close'),
    copy: async () => window.__pinCalls.push('copy'),
    save: async () => {
      window.__pinCalls.push('save')
      return null
    },
    setOpacity: async () => 1,
    toggleIgnore: async () => true,
    zoom: async () => ({ width: 330, height: 220 }),
    dragStart: (x, y) => window.__pinCalls.push(['dragStart', x, y]),
    dragMove: (x, y) => window.__pinCalls.push(['dragMove', x, y]),
    dragEnd: () => window.__pinCalls.push('dragEnd'),
    contextMenu: () => window.__pinCalls.push('contextMenu')
  },
  settings: {
    get: async () => settings,
    update: async (patch) => ({ ...settings, ...patch }),
    openWindow: () => {}
  },
  history: {
    list: async () => [],
    clear: async () => {},
    open: async () => {}
  },
  app: {
    platform: 'win32',
    version: async () => '0.1.0'
  }
}
