import { describe, expect, it } from 'vitest'
import {
  annotationBounds,
  appendMosaicBrushCells,
  canMoveAnnotationWithTool,
  hitTestAnnotation,
  moveAnnotation
} from '../src/shared/annotation-utils'
import type { Annotation, AnnoStyle } from '../src/shared/types'

const style: AnnoStyle = {
  color: '#E64545',
  lineW: 2.5,
  lineStyle: 'solid',
  arrowMode: 'single'
}

describe('annotation hit testing', () => {
  it('hits the border of a rectangle', () => {
    const annotation: Annotation = {
      id: 'a',
      type: 'rect',
      style,
      x1: 10,
      y1: 10,
      x2: 110,
      y2: 60,
      fill: false
    }
    expect(hitTestAnnotation(annotation, { x: 10, y: 30 })).toBe(true)
    expect(hitTestAnnotation(annotation, { x: 50, y: 30 })).toBe(false)
  })

  it('hits the center of an ellipse', () => {
    const annotation: Annotation = {
      id: 'b',
      type: 'ellipse',
      style,
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 50,
      fill: true
    }
    expect(hitTestAnnotation(annotation, { x: 50, y: 25 })).toBe(true)
  })

  it('only allows the matching tool to move an annotation', () => {
    const rect: Annotation = {
      id: 'rect-tool',
      type: 'rect',
      style,
      x1: 10,
      y1: 10,
      x2: 110,
      y2: 60,
      fill: false
    }
    const arrow: Annotation = {
      id: 'arrow-tool',
      type: 'arrow',
      style,
      x1: 10,
      y1: 10,
      x2: 110,
      y2: 60
    }
    const text: Annotation = {
      id: 'text-tool',
      type: 'text',
      style,
      x: 10,
      y: 20,
      text: 'hello',
      fontSize: 16,
      fontFamily: 'sans-serif',
      bold: false,
      italic: false,
      underline: false
    }
    expect(canMoveAnnotationWithTool(rect, 'shape')).toBe(true)
    expect(canMoveAnnotationWithTool(rect, 'arrow')).toBe(false)
    expect(canMoveAnnotationWithTool(arrow, 'arrow')).toBe(true)
    expect(canMoveAnnotationWithTool(arrow, 'shape')).toBe(false)
    expect(canMoveAnnotationWithTool(text, 'text')).toBe(true)
    expect(canMoveAnnotationWithTool(text, 'shape')).toBe(false)
  })

  it('hits a hand-drawn stroke', () => {
    const annotation: Annotation = {
      id: 'c',
      type: 'pen',
      style,
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 0,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 30 },
        { x: 100, y: 0 }
      ]
    }
    expect(hitTestAnnotation(annotation, { x: 50, y: 30 })).toBe(true)
    expect(hitTestAnnotation(annotation, { x: 50, y: 60 })).toBe(false)
  })

  it('moves every point of a pen stroke', () => {
    const annotation: Annotation = {
      id: 'd',
      type: 'pen',
      style,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      ]
    }
    moveAnnotation(annotation, 5, 7)
    expect(annotation.points).toEqual([
      { x: 5, y: 7 },
      { x: 15, y: 17 }
    ])
  })

  it('computes text bounds', () => {
    const annotation: Annotation = {
      id: 'e',
      type: 'text',
      style,
      x: 10,
      y: 20,
      text: 'hello',
      fontSize: 16,
      fontFamily: 'sans-serif',
      bold: false,
      italic: false,
      underline: false
    }
    const bounds = annotationBounds(annotation)
    expect(bounds.width).toBeGreaterThan(24)
    expect(bounds.height).toBeGreaterThan(16)
  })

  it('fills mosaic brush gaps along a fast drag', () => {
    const cells = [{ x: 0, y: 0 }]
    appendMosaicBrushCells(cells, { x: 0, y: 0 }, { x: 100, y: 0 }, 10)
    expect(cells.length).toBeGreaterThan(10)
    for (let index = 1; index < cells.length; index += 1) {
      expect(cells[index].x - cells[index - 1].x).toBeLessThanOrEqual(7.01)
    }
    expect(cells[cells.length - 1].x).toBeLessThanOrEqual(100)
  })

  it('keeps mosaic annotations from being selected and moved', () => {
    const annotation: Annotation = {
      id: 'mosaic',
      type: 'mosaic',
      style,
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 100,
      mode: 'rect',
      size: 12,
      cells: []
    }
    expect(hitTestAnnotation(annotation, { x: 50, y: 50 })).toBe(false)
  })
})
