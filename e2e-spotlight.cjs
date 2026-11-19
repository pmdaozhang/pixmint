/**
 * 聚光灯端到端回归（真实 Electron + 真实 canvas 像素）。
 *
 * 用法：node e2e-spotlight.cjs
 *
 * 覆盖单测覆盖不到、又实际出过 bug 的场景：
 * 1. 先画普通矩形，再开聚光灯画第二个：旧边框不能被遮罩吞掉。
 * 2. 遮挡与亮区的像素值：亮区 alpha=0，暗区 alpha≈140（0.55×255）。
 * 3. 两个聚光灯形状重叠：重叠处不能叠加变暗。
 * 4. 手动关闭聚光灯后，下一次截图保持关闭。
 * 5. 免费用户当天第 3 次截图：默认关闭，点开关弹购买窗。
 */
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT = path.join(PROJECT, 'test-results')
const DARK_ALPHA = Math.round(0.55 * 255) // 140

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function writeUsage(userData, spotlightUsed) {
  const now = new Date()
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`
  fs.writeFileSync(
    path.join(userData, 'usage.json'),
    JSON.stringify({
      version: 1,
      day,
      counts: { ocr: 0, translate: 0, gif: 0, video: 0, spotlight: spotlightUsed }
    })
  )
}

function assert(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
  if (!ok) throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`)
}

async function launch(userData) {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    // 开发版默认不限次数；这里显式打开限制，验证免费用户路径。
    // 本机如果设置过 PIXMINT_DEV_LICENSE=pro，会覆盖成 Pro，必须清掉才能测免费额度。
    env: {
      ...process.env,
      PIXMINT_USER_DATA_DIR: userData,
      PIXMINT_ENFORCE_QUOTA: '1',
      PIXMINT_DEV_LICENSE: ''
    }
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.overlay-root', { timeout: 15000 })
  await window.waitForTimeout(700)
  await window.waitForFunction(() => document.visibilityState === 'visible')
  await window.bringToFront()
  await window.evaluate(() => window.focus())
  return { app, window }
}

/** 等覆盖层回到“可再开一次”的状态，再触发下一次截图 */
async function openOverlayAgain(app, window) {
  // 等会话真正结束：以 tooldock 消失为标志（active 标志在 complete 流程里会提前变 false）
  await window
    .waitForFunction(() => document.querySelectorAll('.tooldock').length === 0, undefined, {
      timeout: 10000
    })
    .catch(() => console.log('WARN tooldock still present after session'))
  await sleep(500)
  await app.evaluate(() => globalThis.__snapglassShowOverlay())
  await window.waitForSelector('.overlay-root', { timeout: 10000 })
  await window.waitForTimeout(900)
  await window.bringToFront()
  await window.evaluate(() => window.focus())
}

async function selectRegion(window, rect) {
  await window.mouse.move(rect.x, rect.y)
  await window.mouse.down()
  await window.mouse.move(rect.x + rect.width, rect.y + rect.height, { steps: 10 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 8000 })
  await window.waitForSelector('.anno-canvas', { timeout: 8000 })
  await window.waitForTimeout(300)
}

/**
 * 画完所有形状后的一次性自检：选区可能在绘图过程中被意外移动，
 * 一旦位置和预期不同，后面的像素采样全部没有意义。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function redBounds(window) {
  return window.evaluate(() => {
    const c = document.querySelector('.anno-canvas')
    const ctx = c.getContext('2d')
    const img = ctx.getImageData(0, 0, c.width, c.height).data
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0
    for (let y = 0; y < c.height; y += 1) {
      for (let x = 0; x < c.width; x += 1) {
        const i = (y * c.width + x) * 4
        if (img[i + 3] > 60 && img[i] - Math.max(img[i + 1], img[i + 2]) > 50) {
          n += 1
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    return { n, box: [minX, minY, maxX, maxY] }
  })
}

async function assertSelectionAt(window, expected) {
  const got = await window.evaluate(() => {
    const c = document.querySelector('.anno-canvas')
    const r = c.getBoundingClientRect()
    return [r.x, r.y, r.width, r.height]
  })
  assert(
    '选区保持原位',
    got[0] === expected.x &&
      got[1] === expected.y &&
      got[2] === expected.width &&
      got[3] === expected.height,
    `expected=${JSON.stringify(expected)} got=${JSON.stringify(got)}`
  )
}

async function useShapeTool(window) {
  await window.locator('.tooldock .tb[title="矩形 / 椭圆"]').click()
  await window.waitForTimeout(200)
}

async function drag(window, from, to, label = '') {
  await window.mouse.move(from.x, from.y)
  await window.mouse.down()
  await window.mouse.move(to.x, to.y, { steps: 12 })
  await window.mouse.up()
  await sleep(250)
  const pos = await window.evaluate(() => {
    const r = document.querySelector('.anno-canvas').getBoundingClientRect()
    return [r.x, r.y]
  })
  console.log(`DRAG ${label} -> canvas at ${JSON.stringify(pos)}`)
}

/**
 * 按「屏幕坐标」取样：先用画布自己的 boundingRect 换算成画布内坐标。
 * 选区不一定从固定的屏幕位置开始，直接拿屏幕坐标当画布坐标会全部错位。
 */
/**
 * 画布内坐标（CSS px）取样，返回 alpha。越界直接抛错，避免把“画布外”误读成 0。
 */
async function canvasAlpha(window, cx, cy) {
  return window.evaluate(
    ({ cx, cy }) => {
      const canvas = document.querySelector('.anno-canvas')
      if (!canvas) return null
      const dpr = window.devicePixelRatio || 1
      if (cx < 0 || cy < 0 || cx >= canvas.width / dpr || cy >= canvas.height / dpr) {
        throw new Error(`sample out of canvas: ${cx},${cy} (${canvas.width / dpr}x${canvas.height / dpr})`)
      }
      return canvas
        .getContext('2d')
        .getImageData(Math.round(cx * dpr), Math.round(cy * dpr), 1, 1).data[3]
    },
    { cx, cy }
  )
}

async function spotOn(window) {
  return window.locator('.spotlight-toggle').evaluate((el) => el.classList.contains('on'))
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })

  // ===== 场景 1–4：单进程内连续两次截图 =====
  {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-spot-'))
    writeUsage(userData, 0) // 当天第 1 次 → 有额度
    const { app, window } = await launch(userData)
    try {
      await selectRegion(window, { x: 100, y: 100, width: 900, height: 600 })
      await useShapeTool(window)

      const spot = () => window.locator('.spotlight-toggle')
      assert('聚光灯按钮存在', (await spot().count()) === 1)
      assert(
        '有额度时首次截图默认选中',
        await spotOn(window)
      )

      // 第一笔：关掉聚光灯，画普通矩形
      await spot().click()
      await sleep(250)
      await drag(window, { x: 200, y: 200 }, { x: 400, y: 340 }, 'plain-rect')
      // 第二笔：打开聚光灯，画一个跨过第一个矩形的形状
      await window.locator('.spotlight-toggle').click()
      await sleep(250)
      assert('打开聚光灯后状态为开', await spotOn(window))
      await drag(window, { x: 340, y: 250 }, { x: 640, y: 460 }, 'spotlit-1')
      // 第三笔：直接再画一个聚光灯矩形（不要再点工具按钮，否则会把矩形工具关掉）
      await drag(window, { x: 520, y: 330 }, { x: 760, y: 520 }, 'spotlit-2')
      console.log('SEL AFTER DRAW', JSON.stringify(await window.evaluate(() => { const r = document.querySelector('.anno-canvas').getBoundingClientRect(); return [r.x, r.y] })))
      await window.screenshot({ path: path.join(OUT, 'spotlight-overlap.png') })

      // 画布坐标 = 屏幕坐标 - 选区左上角。
      // 形状是按画布坐标画的，采样直接落在这些形状上：
      // 矩形一(普通) 画布 (100,100)-(300,240)，矩形二(聚光灯) (240,150)-(540,360)，矩形三(聚光灯) (420,230)-(660,420)。
      const sel = { x: 100, y: 100, width: 900, height: 600 }
      await assertSelectionAt(window, sel)
      const litAlpha = await canvasAlpha(window, 320, 200) // 只在矩形二亮区内
      const darkAlpha = await canvasAlpha(window, 50, 50) // 远离所有亮区
      const overlapAlpha = await canvasAlpha(window, 480, 300) // 矩形二与三的重叠处
      console.log(`ALPHA lit=${litAlpha} dark=${darkAlpha} overlap=${overlapAlpha}`)
      assert('亮区没有遮罩', litAlpha === 0, `alpha=${litAlpha}`)
      assert(
        '暗区遮罩为 55%',
        darkAlpha !== null && Math.abs(darkAlpha - DARK_ALPHA) <= 2,
        `alpha=${darkAlpha}`
      )
      assert('两个聚光灯重叠区不叠加变暗', overlapAlpha === 0, `alpha=${overlapAlpha}`)

      // 导出前把画布整块导出来，确认导出/输入流程的基准画面
      const beforeExport = await window.evaluate(() =>
        document.querySelector('.anno-canvas').toDataURL('image/png')
      )
      fs.writeFileSync(
        path.join(OUT, 'spotlight-canvas-before-export.png'),
        Buffer.from(beforeExport.split(',')[1], 'base64')
      )

      // 回归：第一个矩形（画布 100,100–300,240）的左边框在暗区里，
      // 必须仍然被描出来（红色像素），不能被遮罩吞掉。
      // 第一个矩形(普通)左边框在画布 x=100、y∈[100,240]，处于暗区，必须仍被描出来。
      const borderPixel = await window.evaluate(() => {
        const canvas = document.querySelector('.anno-canvas')
        const dpr = window.devicePixelRatio || 1
        let best = null
        for (let y = 110; y < 230; y += 2) {
          for (let x = 92; x < 112; x += 1) {
            const d = canvas
              .getContext('2d')
              .getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data
            const redness = d[0] - Math.max(d[1], d[2])
            if (d[3] > 0 && (!best || redness > best.redness)) {
              best = { x, y, redness }
            }
          }
        }
        return best
      })
      assert(
        '旧矩形边框在暗区里仍然可见（未被遮罩吞掉）',
        Boolean(borderPixel) && borderPixel.redness > 60,
        JSON.stringify(borderPixel)
      )

      // 回归：亮区边缘必须与边框外沿对齐，不能多出一圈亮边（白底截图上很明显）。
      // 第二个聚光灯矩形画布范围 (240,150)-(540,360)，线宽 2.5 → 外沿 238.75 / 541.25。
      const edge = await window.evaluate(() => {
        const c = document.querySelector('.anno-canvas')
        const ctx = c.getContext('2d')
        const row = []
        for (let x = 230; x < 250; x += 1) {
          const d = ctx.getImageData(x, 255, 1, 1).data
          row.push(`${x}:a${d[3]}/r${d[0]}`)
        }
        return row
      })
      console.log('EDGE_ROW', JSON.stringify(edge))
      // 期望：x≤238 为纯遮罩，x=239 处开始出现边框像素（红色描边，不透明），
      // x≥241 为纯亮区；允许 1px 抗锯齿过渡。
      // row 元素形如 "238:a142/r102"
      const alphaAt = (i) => Number(edge[i].split(':')[1].split('/')[0].slice(1))
      const pureMask = Array.from({ length: 9 }, (_, i) => alphaAt(i)).every(
        (a) => Math.abs(a - 140) <= 2
      )
      const borderStarts = alphaAt(9) > 200 // 239 处是边框
      const clearAfter = Array.from({ length: 8 }, (_, i) => alphaAt(i + 12)).every((a) => a === 0)
      assert(
        '亮区边缘与边框外沿对齐（不多扩）',
        pureMask && borderStarts && clearAfter,
        `pureMask=${pureMask} borderStarts=${borderStarts} clearAfter=${clearAfter}`
      )

      // 场景 4：手动关闭 → 结束本次截图 → 下一次截图应保持关闭
      // （必须先做，因为复制会结束会话）
      await window.locator('.spotlight-toggle').click()
      await sleep(150)
      assert('手动点一下可关闭', (await spotOn(window)) === false)
      await window.screenshot({ path: path.join(OUT, 'spotlight-scene.png') })
      // 结束本次会话：直接复制（会话正常 complete 并关闭覆盖层），
      // 不要用 Esc——Esc 和复制连用时覆盖层状态不可靠。
      await window.locator('.act[data-action="copy"]').click()
      await sleep(1500)
      await openOverlayAgain(app, window)
      await selectRegion(window, { x: 100, y: 100, width: 700, height: 500 })
      await useShapeTool(window)
      assert('手动关闭后，下次截图保持关闭', (await spotOn(window)) === false)

      // 导出回归：重新打开聚光灯、画一个聚光灯矩形后复制，检查导出图
      await window.locator('.spotlight-toggle').click()
      await sleep(150)
      await drag(window, { x: 300, y: 250 }, { x: 560, y: 430 }, 'export-rect')
      await window.locator('.act[data-action="copy"]').click()
      await sleep(1500)
      const exported = await app.evaluate(({ clipboard }) => {
        const image = clipboard.readImage()
        const size = image.getSize()
        return { empty: image.isEmpty(), size, png: image.toPNG().toString('base64') }
      })
      assert(
        '复制后剪贴板有图片',
        !exported.empty && exported.size.width > 0,
        JSON.stringify(exported.size)
      )
      if (!exported.empty) {
        fs.writeFileSync(
          path.join(OUT, 'spotlight-export.png'),
          Buffer.from(exported.png, 'base64')
        )
      }
      // 导出图铺在底图之上，暗区是该点的合成 alpha；这里只校验边框与亮区，暗区在屏幕断言里已验过
      const exportStats = await window.evaluate(async (b64) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const at = (x, y) => {
          const d = ctx.getImageData(x, y, 1, 1).data
          return { r: d[0], g: d[1], b: d[2], a: d[3] }
        }
        // 选区从 (100,100) 开始，聚光灯矩形屏幕 (300,250)-(560,430) → 导���坐标 (200,150)-(460,330)
        let borderHits = 0
        for (let x = 210; x < 450; x += 4) {
          const p = at(x, 150)
          if (p.r - Math.max(p.g, p.b) > 40) borderHits += 1
        }
        return {
          borderHits,
          lit: at(330, 250),
          dark: at(20, 450),
          size: [img.width, img.height]
        }
      }, exported.png)
      console.log('EXPORT_STATS', JSON.stringify(exportStats))
      assert(
        '导出图里聚光灯矩形边框可见',
        exportStats.borderHits > 20,
        `hits=${exportStats.borderHits}`
      )
      assert(
        '导出图里亮区没有被遮罩',
        exportStats.lit.a === 0,
        JSON.stringify(exportStats.lit)
      )
    } finally {
      await app.close().catch(() => {})
    }
  }

  // ===== 场景 5：当天额度用完 =====
  // 本机无法覆盖：主进程在本地没有授权时会调用 restoreByDevice() 从生产服务端把授权拉回来，
  // 所以免费用户路径在此环境不可复现。额度计算本身由 tests/usage.test.ts 覆盖。
  // 手工验证方式：在一台没有授权、且当天已在真实截图里用满 2 次的机器上按 F1。

  console.log('SPOTLIGHT_E2E_DONE')
  process.exit(0)
})().catch((error) => {
  console.error('SPOTLIGHT_E2E_FAIL', error)
  process.exit(1)
})
