const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const text = process.env.OCR_FIXTURE_TEXT || '把眼前的文字变成可以继续使用的文本'
  const fontSize = Number(process.env.OCR_FIXTURE_SIZE || 20)
  const win = new BrowserWindow({
    x: 80,
    y: 80,
    width: 900,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const html = `<!doctype html><html><head><meta charset="utf-8" /></head>
  <body style="margin:0;background:#fff;font-family:'Microsoft YaHei',sans-serif">
    <div style="position:absolute;left:40px;top:78px;font-size:${fontSize}px;line-height:1.4;color:#111">
      ${text}
    </div>
  </body></html>`
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
})
