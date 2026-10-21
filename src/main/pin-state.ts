export function clampOpacity(value: number): number {
  return Math.max(0.2, Math.min(1, value))
}

export function nextPinSize(
  width: number,
  height: number,
  direction: 1 | -1,
  minWidth = 80,
  maxWidth = 2400
): { width: number; height: number } {
  const factor = direction > 0 ? 1.1 : 0.9
  const nextWidth = Math.round(Math.max(minWidth, Math.min(maxWidth, width * factor)))
  const ratio = height / width
  return { width: nextWidth, height: Math.max(1, Math.round(nextWidth * ratio)) }
}
