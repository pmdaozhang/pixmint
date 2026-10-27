import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { OverlayAction, RecorderMode } from '../../../shared/types'
import type { AnnotationCanvasHandle } from './AnnotationCanvas'

interface OverlayKeyboardOptions {
  phase: 'selecting' | 'editing'
  selection: unknown | null
  exportImage: (action: OverlayAction, autoTranslate?: boolean) => void
  cancelRecording: () => void
  setRecorderMode: Dispatch<SetStateAction<RecorderMode | null>>
  annotationRef: { current: AnnotationCanvasHandle | null }
  recorderModeRef: { current: RecorderMode | null }
  recordPhaseRef: { current: string }
}

/**
 * 背景：覆盖层的键盘快捷键和录制/选择状态紧密相关，散在主组件里难以回归。
 * 设计意图：集中处理 Escape、复制、保存、钉图和撤销/重做，主组件只传当前状态。
 * 关键约束：输入框内不劫持键盘；录制态 Escape 只取消录制，不关闭整个覆盖层。
 */
export function useOverlayKeyboard(options: OverlayKeyboardOptions): void {
  const {
    phase,
    selection,
    exportImage,
    cancelRecording,
    setRecorderMode,
    annotationRef,
    recorderModeRef,
    recordPhaseRef
  } = options

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (event.key === 'Escape') event.stopPropagation()
        return
      }
      if (recorderModeRef.current) {
        if (event.key === 'Escape') {
          event.preventDefault()
          if (recordPhaseRef.current === 'idle') setRecorderMode(null)
          else cancelRecording()
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        window.snapglass.overlay.cancel()
        return
      }
      if (phase !== 'editing' || !selection) return
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        exportImage('copy')
      } else if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        exportImage('save')
      } else if (event.key === 'F3') {
        event.preventDefault()
        exportImage('pin')
      } else if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) annotationRef.current?.redo()
        else annotationRef.current?.undo()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    phase,
    selection,
    exportImage,
    cancelRecording,
    setRecorderMode,
    annotationRef,
    recorderModeRef,
    recordPhaseRef
  ])
}
