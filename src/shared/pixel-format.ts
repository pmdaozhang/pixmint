/**
 * 背景：Electron nativeImage 输出 BGRA，PaddleOCR 需要 RGBA；旧实现每次额外分配一份整图。
 * 设计意图：在调用方拥有的像素缓冲上原地换通道，减少 OCR 每帧的外部内存分配。
 * 关键约束：只允许传入独占的 BGRA 缓冲；alpha 统一置为 255，长度不足 4 字节的尾部保持原样。
 */
export function bgraToRgbaInPlace(bitmap: Uint8Array): Uint8Array {
  for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
    const blue = bitmap[offset]
    bitmap[offset] = bitmap[offset + 2]
    bitmap[offset + 2] = blue
    bitmap[offset + 3] = 255
  }
  return bitmap
}
