import type { JSX } from 'react'

/**
 * Pixmint 统一品牌标识。
 * 设置页、购买窗和终身会员页共用同一份图形，避免不同窗口出现不同 logo。
 */
export function BrandMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
      <g transform="rotate(-2 256 270)">
        <path
          d="M 148 118 H 364 C 414 118 444 148 444 198 V 342 C 444 392 414 422 364 422 H 148 C 98 422 68 392 68 342 V 198 C 68 148 98 118 148 118 Z"
          fill="currentColor"
        />
        <circle cx="190" cy="250" r="24" fill="var(--bg)" />
        <circle cx="322" cy="250" r="24" fill="var(--bg)" />
      </g>
      <path
        d="M 380 58 H 460 V 138"
        fill="none"
        stroke="currentColor"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
