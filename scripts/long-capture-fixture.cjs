const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const rowsCount = Math.max(
    1,
    Number.parseInt(process.env.PIXMINT_LONG_ROWS || '160', 10) || 160
  )
  const dark = process.env.PIXMINT_LONG_FIXTURE_THEME === 'dark'
  const withMedia = process.env.PIXMINT_LONG_FIXTURE_MEDIA === '1'
  const unscrollable = process.env.PIXMINT_LONG_FIXTURE_UNSCROLLABLE === '1'
  const fakeScrollbar = process.env.PIXMINT_LONG_FIXTURE_SCROLLBAR === '1'
  const wheelMultiplier = Number(
    process.env.PIXMINT_LONG_FIXTURE_WHEEL_MULTIPLIER || '0'
  )
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

  const rows = Array.from({ length: unscrollable ? 8 : rowsCount }, (_, index) => {
    const marker = ((index * 37) % 97).toString(16).padStart(2, '0')
    const mediaSrc =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='120'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%234f7cff'/%3E%3Cstop offset='1' stop-color='%23ff7a59'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='120' fill='url(%23g)'/%3E%3Ctext x='24' y='68' fill='white' font-size='24' font-family='monospace'%3Emedia " +
      index +
      "%3C/text%3E%3C/svg%3E"
    const media =
      withMedia && index > 0 && index % 40 === 0
        ? `<div class="code"><pre>function mediaBlock${index}() {\n  return ${index}\n}</pre></div><img class="photo" loading="lazy" alt="media ${index}" src="${mediaSrc}" />`
        : ''
    return `${media}<div class="row"><span>${index + 1}</span>Pixmint long capture fixture row ${index + 1} · ${marker}</div>`
  }).join('')

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Pixmint Long Capture Fixture</title>
    <style>
      html, body {
        margin: 0;
        background: ${dark ? '#111214' : '#fbfbfb'};
        color: ${dark ? '#e8e8ea' : '#1c1c1e'};
        font: 13px/20px Consolas, monospace;
      }
      body { ${unscrollable ? 'height: 100vh; overflow: hidden;' : ''} }
      header {
        position: ${unscrollable ? 'static' : 'sticky'};
        top: 0;
        z-index: 2;
        height: 36px;
        display: flex;
        align-items: center;
        padding: 0 16px;
        background: ${dark ? '#1c1d21' : '#fff'};
        border-bottom: 1px solid ${dark ? '#34363c' : '#ddd'};
        font-weight: 700;
      }
      .row { height: 20px; padding: 0 16px; border-bottom: 1px solid ${dark ? '#25272c' : '#eee'}; display: flex; gap: 16px; }
      .row span { width: 48px; color: ${dark ? '#6f737c' : '#999'}; text-align: right; }
      .code { margin: 8px 16px; padding: 8px 12px; background: #0b1020; color: #cbd5e1; border-radius: 6px; }
      .code pre { margin: 0; font: 12px/18px Consolas, monospace; }
      .photo { display: block; width: calc(100% - 32px); margin: 8px 16px; border-radius: 8px; }
      #fake-scrollbar {
        position: fixed; right: 100px; top: 36px; bottom: 0; width: 10px;
        background: ${dark ? '#24262b' : '#e8e8e8'}; z-index: 4;
      }
      #fake-thumb {
        position: absolute; left: 0; width: 10px; height: 40px;
        background: ${dark ? '#6f737c' : '#9a9a9a'};
      }
    </style>
    <script>
      const wheelMultiplier = ${Number.isFinite(wheelMultiplier) ? wheelMultiplier : 0};
      if (wheelMultiplier > 0) {
        window.addEventListener("wheel", (event) => {
          event.preventDefault();
          window.scrollBy(0, Math.sign(event.deltaY) * Math.abs(event.deltaY) * wheelMultiplier);
        }, { passive: false });
      }
      let titleFrame = 0;
      window.addEventListener("scroll", () => {
        cancelAnimationFrame(titleFrame);
        titleFrame = requestAnimationFrame(() => {
          document.title = "Pixmint Long Capture Fixture y=" + Math.round(window.scrollY);
        });
      });
      ${fakeScrollbar ? `
      const fakeThumb = document.getElementById("fake-thumb");
      const updateFakeThumb = () => {
        const max = document.documentElement.scrollHeight - innerHeight;
        const ratio = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
        const track = Math.max(40, innerHeight - 36 - 40);
        fakeThumb.style.top = ratio * track + "px";
      };
      addEventListener("scroll", updateFakeThumb, { passive: true });
      updateFakeThumb();
      ` : ''}
    </script>
  </head>
  <body>
    <header>Pixmint Long Capture Fixture · fixed header</header>
    ${fakeScrollbar ? '<div id="fake-scrollbar"><div id="fake-thumb"></div></div>' : ''}
    ${rows}
  </body>
</html>`

  window.loadURL(`data:text/html,${encodeURIComponent(html)}`)
  window.show()
})
