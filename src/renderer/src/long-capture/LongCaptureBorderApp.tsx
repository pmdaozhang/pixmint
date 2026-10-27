import { useEffect } from 'react'
import type { JSX } from 'react'
import './long-capture-border.css'

function readParams(): URLSearchParams {
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query)
}

/**
 * 背景：长截图采集期间需要一个不抢焦点、不进入截图的选区边界。
 * 设计意图：边框和标签画在选区外侧，窗口中心完全透明，点击穿透。
 * 关键约束：尺寸参数来自主进程路由；不要在这里绘制选区内部内容。
 */
export function LongCaptureBorderApp(): JSX.Element {
  useEffect(() => {
    document.documentElement.dataset.route = 'long-capture-border'
    return () => {
      delete document.documentElement.dataset.route
    }
  }, [])

  const params = readParams()
  const width = Math.max(1, Number(params.get('w')) || 1)
  const height = Math.max(1, Number(params.get('h')) || 1)
  const side = Math.max(2, Number(params.get('side')) || 8)
  const top = Math.max(24, Number(params.get('top')) || 30)
  const mode = params.get('mode') === 'manual' ? '手动滚动' : '自动滚动'

  return (
    <div className="long-border-root">
      <div
        className="long-border-frame"
        style={{
          left: side - 2,
          top: top - 2,
          width: width + 4,
          height: height + 4
        }}
      />
      <div
        className="long-border-label"
        style={{ left: side, top: 5 }}
      >
        <span className="long-border-dot" />
        长截图区域 · {mode}
      </div>
    </div>
  )
}
