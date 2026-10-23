import { describe, expect, it } from 'vitest'
import {
  encodeSidecarRequest,
  LineBuffer,
  parseSidecarResponse
} from '../src/main/sidecar/protocol'

describe('sidecar protocol', () => {
  it('buffers partial lines and returns complete lines', () => {
    const buffer = new LineBuffer()
    expect(buffer.push('1|abc')).toEqual([])
    expect(buffer.pending).toBe('1|abc')
    expect(buffer.push('def\n2|ok\r\n')).toEqual(['1|abcdef', '2|ok'])
    expect(buffer.pending).toBe('')
  })

  it('encodes request id and payload', () => {
    expect(encodeSidecarRequest(7, '10,20,30,40')).toBe('7,10,20,30,40')
  })

  it('parses response id and keeps separators in payload', () => {
    expect(parseSidecarResponse('12|abc|def')).toEqual({ id: 12, payload: 'abc|def' })
  })

  it('rejects malformed response ids', () => {
    expect(parseSidecarResponse('abc|x')).toBeNull()
    expect(parseSidecarResponse('0|x')).toBeNull()
    expect(parseSidecarResponse('-1|x')).toBeNull()
    expect(parseSidecarResponse('1.5|x')).toBeNull()
  })
})
