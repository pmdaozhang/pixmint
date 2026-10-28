const { app, BrowserWindow } = require('electron')

const failure = process.argv.includes('--failure')
const sections = Array.from({ length: 36 }, (_, index) => {
  const n = String(index + 1).padStart(2, '0')
  return `<section><h2>Isolated Section ${n}</h2><p>${`isolated long capture test line ${n}. `.repeat(8)}</p></section>`
}).join('')

const noise = failure
  ? `<div id="noise" style="position:fixed;inset:0;z-index:9999;pointer-events:none;opacity:.65;background:repeating-linear-gradient(0deg,rgba(255,0,0,.55) 0 2px,transparent 2px 7px)"></div>
    <script>setInterval(()=>{const el=document.getElementById('noise');if(el)el.style.backgroundPositionY=Math.random()*40+'px'},40)</script>`
  : ''

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pixmint Isolated Long Target</title>
<style>
html,body{margin:0;background:#f4f6fa;color:#111827;font:14px/1.6 sans-serif}
header{position:sticky;top:0;padding:18px 22px;background:#1d4ed8;color:white;font-weight:700}
main{padding:0 22px 80px}section{padding:24px 0;border-bottom:1px solid #d7ddea}
h2{margin:0 0 10px;font-size:20px}p{margin:0;color:#334155}
</style></head><body><header>Pixmint Isolated Long Target</header><main>${sections}</main>${noise}</body></html>`

app.whenReady().then(() => {
  app.setAccessibilitySupportEnabled(true)
  const win = new BrowserWindow({
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Pixmint Isolated Long Target',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setMenuBarVisibility(false)
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
})

app.on('window-all-closed', () => app.quit())
