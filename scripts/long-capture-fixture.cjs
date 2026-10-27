const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const window = new BrowserWindow({
    x: 80,
    y: 80,
    width: 900,
    height: 600,
    alwaysOnTop: true,
    title: 'Pixmint Long Capture Fixture',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.setAlwaysOnTop(true, 'screen-saver')

  const rows = Array.from({ length: 160 }, (_, index) => {
    const marker = ((index * 37) % 97).toString(16).padStart(2, '0')
    return `<div class="row"><span>${index + 1}</span>Pixmint long capture fixture row ${index + 1} · ${marker}</div>`
  }).join('')

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Pixmint Long Capture Fixture</title>
    <style>
      html, body { margin: 0; background: #fbfbfb; color: #1c1c1e; font: 13px/20px Consolas, monospace; }
      header {
        position: sticky;
        top: 0;
        z-index: 2;
        height: 36px;
        display: flex;
        align-items: center;
        padding: 0 16px;
        background: #fff;
        border-bottom: 1px solid #ddd;
        font-weight: 700;
      }
      .row { height: 20px; padding: 0 16px; border-bottom: 1px solid #eee; display: flex; gap: 16px; }
      .row span { width: 48px; color: #999; text-align: right; }
    </style>
    <script>
      let titleFrame = 0;
      window.addEventListener("scroll", () => {
        cancelAnimationFrame(titleFrame);
        titleFrame = requestAnimationFrame(() => {
          document.title = "Pixmint Long Capture Fixture y=" + Math.round(window.scrollY);
        });
      });
    </script>
  </head>
  <body>
    <header>Pixmint Long Capture Fixture · fixed header</header>
    ${rows}
  </body>
</html>`

  window.loadURL(`data:text/html,${encodeURIComponent(html)}`)
  window.show()
})
