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
  | 'long'
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
      <rect x="4" y="4" width="4.2" height="4.2" rx="1" />
      <rect x="10" y="4" width="4.2" height="4.2" rx="1" />
      <rect x="16" y="4" width="4.2" height="4.2" rx="1" />
      <rect x="4" y="10" width="4.2" height="4.2" rx="1" />
      <rect x="10" y="10" width="4.2" height="4.2" rx="1" />
      <rect x="16" y="10" width="4.2" height="4.2" rx="1" />
      <rect x="4" y="16" width="4.2" height="4.2" rx="1" />
      <rect x="10" y="16" width="4.2" height="4.2" rx="1" />
      <rect x="16" y="16" width="4.2" height="4.2" rx="1" />
    </>
  ),
  text: <path d="M5 6h14M12 6v13M9 19h6" />,
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
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <text
        x="12"
        y="12.4"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        stroke="none"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="8"
        fontWeight="800"
        letterSpacing="0.2"
      >
        GIF
      </text>
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10.5 21 8v8l-5-2.5z" />
    </>
  ),
  long: (
    <>
      <rect x="6" y="3" width="12" height="15" rx="1.6" />
      <path d="M12 7v6M9 11l3 3 3-3M4 21h16" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4V4h11v1" />
    </>
  ),
  pin: <path d="M9 4h6l-1 7 3 3H7l3-3-1-7zM12 14v6" />,
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
  )
}

export function Icon({ name, size = 17 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
