import type { JSX } from 'react'

export type IconName =
  | 'move'
  | 'shape'
  | 'arrow'
  | 'mosaic'
  | 'text'
  | 'seq'
  | 'ocr'
  | 'translate'
  | 'gif'
  | 'video'
  | 'copy'
  | 'pin'
  | 'save'
  | 'close'
  | 'undo'
  | 'redo'
  | 'settings'
  | 'check'
  | 'eye'
  | 'folder'
  | 'trash'
  | 'keyboard'
  | 'palette'
  | 'volume'
  | 'crown'

const paths: Record<IconName, JSX.Element> = {
  move: (
    <>
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
      <circle cx="12" cy="12" r="2.2" />
    </>
  ),
  shape: (
    <>
      <rect x="3.5" y="5.5" width="12.5" height="10" rx="1.5" />
      <ellipse cx="14.5" cy="14" rx="6" ry="4.8" />
    </>
  ),
  arrow: <path d="M5 19 18 6M18 6h-6M18 6v6" />,
  mosaic: (
    <>
      <rect x="1.4" y="1.4" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="10.2" y="1.4" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="19" y="1.4" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="5.8" y="5.8" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="14.6" y="5.8" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="1.4" y="10.2" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="10.2" y="10.2" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="19" y="10.2" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="5.8" y="14.6" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="14.6" y="14.6" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="1.4" y="19" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="10.2" y="19" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="19" y="19" width="3.6" height="3.6" rx="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  text: <path d="M5 6h14M6.3 6v2.2M17.7 6v2.2M12 6v13M9 19h6" />,
  seq: (
    <>
      <circle cx="12" cy="12" r="8" />
      <text x="12" y="15.5" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">
        1
      </text>
    </>
  ),
  ocr: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M8 9.5h8M8 13h5" strokeLinecap="round" />
    </>
  ),
  translate: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3.5 3.5 3.5 15 0 18M12 3c-3.5 3.5-3.5 15 0 18" />
    </>
  ),
  gif: (
    <>
      <rect x="1.5" y="5" width="21" height="14" rx="3" />
      <text
        x="12"
        y="12.4"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        stroke="none"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="9"
        fontWeight="800"
        letterSpacing="0.1"
      >
        GIF
      </text>
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10.5 21 8v8l-5-2.5z" />
      <circle cx="7.3" cy="12" r="1.8" fill="#FF3B30" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="5" y="8" width="11" height="11" rx="2" />
      <path d="M8 8V5h11v11h-3" />
      <path d="M8 11.5h5M8 14h5M8 16.5h5" />
    </>
  ),
  pin: (
    <g transform="rotate(45 12 12)">
      <path d="M9 4h6l-1 7 3 3H7l3-3-1-7z" />
      <path d="M12 14v6" />
    </g>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h7V4M8 20v-6h8v6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  undo: <path d="M9 7 4 12l5 5M4 12h9a6 6 0 0 1 6 6" />,
  redo: <path d="m15 7 5 5-5 5M20 12h-9a6 6 0 0 0-6 6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z" />
    </>
  ),
  check: <path d="M5 13l4 4 10-10" />,
  eye: (
    <>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  folder: <path d="M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-15z" />,
  trash: (
    <>
      <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" strokeLinecap="round" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 13h10" strokeLinecap="round" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H13a2 2 0 0 1 0-4h5a3 3 0 0 0 3-3 7 7 0 0 0-9-7z" />
      <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 8a5 5 0 0 1 0 8M18.5 5.5a8.5 8.5 0 0 1 0 13" />
    </>
  ),
  crown: (
    <>
      <path d="M4.5 18.5 3 8.5l5.2 3.7L12 4.5l3.8 7.7L21 8.5l-1.5 10z" />
      <path d="M6.5 21h11" strokeLinecap="round" />
    </>
  ),
}

interface IconBounds {
  x: number
  y: number
  width: number
  height: number
  /** 单个图标的光学留白；越小图形越大。 */
  padding?: number
}

/**
 * 工具栏图标在 24 网格里的实际几何包围盒。
 * 图标外框统一后，用它把每个图形都撑到同样的光学尺寸；未列出的图标保持原 viewBox。
 */
const bounds: Partial<Record<IconName, IconBounds>> = {
  shape: { x: 3.5, y: 5.5, width: 17, height: 13.3 },
  arrow: { x: 5, y: 6, width: 13, height: 13, padding: 2.4 },
  mosaic: { x: 1.4, y: 1.4, width: 21.2, height: 21.2 },
  text: { x: 5, y: 6, width: 14, height: 13, padding: 2.4 },
  seq: { x: 4, y: 4, width: 16, height: 16 },
  undo: { x: 4, y: 7, width: 15, height: 11 },
  redo: { x: 5, y: 7, width: 15, height: 11 },
  ocr: { x: 4, y: 4, width: 16, height: 16 },
  translate: { x: 3, y: 3, width: 18, height: 18 },
  gif: { x: 1.5, y: 4.3, width: 21, height: 14.7 },
  video: { x: 3, y: 6, width: 18, height: 12 },
  close: { x: 6, y: 6, width: 12, height: 12, padding: 2.4 },
  pin: { x: 2.8, y: 2.8, width: 18.4, height: 18.4, padding: -0.6 },
  save: { x: 5, y: 4, width: 14, height: 16 },
  copy: { x: 5, y: 5, width: 14, height: 14 }
}

const OPTICAL_PADDING = 1.2

export function Icon({ name, size = 17 }: { name: IconName; size?: number }): JSX.Element {
  const box = bounds[name]
  const padding = box?.padding ?? OPTICAL_PADDING
  const viewBox = box
    ? `${box.x - padding} ${box.y - padding} ${box.width + padding * 2} ${box.height + padding * 2}`
    : '0 0 24 24'
  // 缩放 viewBox 会连带缩放描边；反算 strokeWidth，让屏幕上的线宽保持原来的 1.8/24。
  const strokeWidth = box
    ? (1.8 * Math.max(box.width + padding * 2, box.height + padding * 2)) / 24
    : 1.8

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
