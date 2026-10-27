const path = require('node:path')
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')

/**
 * 背景：P8 手动长截图不再要求用户控速，采集端必须证明能稳定拿到 10-15fps。
 * 设计意图：先测 Electron 自带的 desktopCapturer 视频流，避免一上来就引入原生模块。
 * 关键约束：只测帧率和裁切成本，不保存任何屏幕像素；隐藏窗口关闭后进程立即退出。
 */
function percentile(values, ratio) {
  if (values.length === 0) return 0
  const ordered = [...values].sort((a, b) => a - b)
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ratio * ordered.length) - 1)
  )
  return ordered[index]
}

/**
 * 背景：需要在渲染层调用 getUserMedia，才能拿到 desktopCapturer 的视频帧。
 * 设计意图：把整段逻辑序列化进 executeJavaScript，避免额外 preload 和 IPC 文件。
 * 关键约束：只返回统计结果；视频轨道和 canvas 在结束时会释放。
 */
function runInPage(options) {
  return (async () => {
    const { sourceId, width, height, cropWidth, cropHeight, seconds } = options
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: width,
          maxHeight: height,
          maxFrameRate: 30
        }
      }
    })

    const video = document.createElement('video')
    video.muted = true
    video.srcObject = stream
    await video.play()

    const canvas = document.createElement('canvas')
    const context =
      cropWidth > 0 && cropHeight > 0
        ? canvas.getContext('2d', { willReadFrequently: true })
        : null
    if (context) {
      canvas.width = cropWidth
      canvas.height = cropHeight
    }

    const intervals = []
    let frames = 0
    let last = performance.now()
    const start = performance.now()

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('requestVideoFrameCallback timeout')),
        (seconds + 5) * 1000
      )
      const tick = () => {
        const now = performance.now()
        frames += 1
        intervals.push(now - last)
        last = now

        if (context) {
          context.drawImage(
            video,
            0,
            0,
            cropWidth,
            cropHeight,
            0,
            0,
            cropWidth,
            cropHeight
          )
          context.getImageData(0, 0, cropWidth, cropHeight)
        }

        if (now - start < seconds * 1000) {
          video.requestVideoFrameCallback(tick)
          return
        }

        clearTimeout(timeout)
        stream.getTracks().forEach((track) => track.stop())
        resolve({
          frames,
          elapsedMs: now - start,
          fps: frames / ((now - start) / 1000),
          intervals
        })
      }
      video.requestVideoFrameCallback(tick)
    })
  })()
}

async function main() {
  await app.whenReady()
  const display = screen.getPrimaryDisplay()
  const width = Math.round(display.size.width * display.scaleFactor)
  const height = Math.round(display.size.height * display.scaleFactor)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
    fetchWindowIcons: false
  })
  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ??
    sources[0]
  if (!source) throw new Error('没有可用的屏幕采集源')

  const allConfigs = [
    { name: 'full-frame', cropWidth: 0, cropHeight: 0, seconds: 5 },
    {
      name: 'crop-700x600',
      cropWidth: Math.min(700, width),
      cropHeight: Math.min(600, height),
      seconds: 5
    },
    {
      name: 'crop-full-frame',
      cropWidth: width,
      cropHeight: height,
      seconds: 5
    }
  ]
  const requested = process.argv
    .find((argument) => argument.startsWith('--config='))
    ?.slice('--config='.length)
  const configs =
    requested && requested !== 'all'
      ? allConfigs.filter((config) => config.name === requested)
      : allConfigs
  if (configs.length === 0) {
    throw new Error(`未知配置：${requested}`)
  }

  const results = []
  for (const config of configs) {
    const window = new BrowserWindow({
      show: false,
      width: 480,
      height: 320,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    try {
      await window.loadFile(path.join(__dirname, 'electron-capture-bench.html'))
      const result = await window.webContents.executeJavaScript(
        `(${runInPage.toString()})(${JSON.stringify({
          sourceId: source.id,
          width,
          height,
          cropWidth: config.cropWidth,
          cropHeight: config.cropHeight,
          seconds: config.seconds
        })})`,
        true
      )
      results.push({
        name: config.name,
        cropWidth: config.cropWidth,
        cropHeight: config.cropHeight,
        seconds: config.seconds,
        frames: result.frames,
        elapsedMs: Number(result.elapsedMs.toFixed(2)),
        fps: Number(result.fps.toFixed(2)),
        avgIntervalMs: Number(
          (
            result.intervals.reduce((sum, value) => sum + value, 0) /
            Math.max(1, result.intervals.length)
          ).toFixed(2)
        ),
        p95IntervalMs: Number(percentile(result.intervals, 0.95).toFixed(2))
      })
    } catch (error) {
      results.push({
        name: config.name,
        cropWidth: config.cropWidth,
        cropHeight: config.cropHeight,
        seconds: config.seconds,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        display: {
          id: display.id,
          width,
          height,
          scaleFactor: display.scaleFactor
        },
        source: {
          id: source.id,
          name: source.name,
          displayId: source.display_id
        },
        results
      },
      null,
      2
    )
  )

  app.quit()
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  )
  app.quit()
  process.exitCode = 1
})
