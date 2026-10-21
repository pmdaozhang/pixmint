import { describe, expect, it } from 'vitest'
import {
  MAX_GIF_DURATION_MS,
  MAX_VIDEO_DURATION_MS,
  estimateVideoBitrate,
  fitGifOutputSize,
  fitOutputSize,
  formatBytes,
  formatRecordingDuration,
  gifFrameDelay,
  gifPaletteSampleStep,
  maxDurationFor,
  pickVideoMime,
  recordingFileName
} from '../src/shared/recording'

describe('recording helpers', () => {
  it('keeps original size under the long-side guard', () => {
    expect(fitOutputSize(1280, 720, 'original')).toEqual({ width: 1280, height: 720 })
    expect(fitOutputSize(3840, 2160, 'original')).toEqual({ width: 1920, height: 1080 })
  })

  it('fits 720 and 480 by long side', () => {
    expect(fitOutputSize(1920, 1080, '720')).toEqual({ width: 720, height: 405 })
    expect(fitOutputSize(1080, 1920, '480')).toEqual({ width: 270, height: 480 })
  })

  it('caps GIF output at 720 long side for smoother playback', () => {
    expect(fitGifOutputSize(1919, 1079)).toEqual({ width: 720, height: 405 })
    expect(fitGifOutputSize(600, 380)).toEqual({ width: 600, height: 380 })
    expect(fitGifOutputSize(1080, 1920)).toEqual({ width: 405, height: 720 })
  })

  it('samples palettes more aggressively for large GIF frames', () => {
    expect(gifPaletteSampleStep(300, 200)).toBe(1)
    expect(gifPaletteSampleStep(600, 380)).toBe(2)
    expect(gifPaletteSampleStep(720, 405)).toBe(2)
    expect(gifPaletteSampleStep(960, 540)).toBe(3)
  })

  it('never returns a zero dimension', () => {
    expect(fitOutputSize(1, 1, '480')).toEqual({ width: 2, height: 2 })
  })

  it('picks the first supported video mime', () => {
    expect(pickVideoMime((mime) => mime.includes('webm'))).toEqual({
      mimeType: 'video/webm;codecs=vp9,opus',
      extension: 'webm'
    })
    expect(pickVideoMime(() => false)).toBeNull()
  })

  it('formats duration and bytes', () => {
    expect(formatRecordingDuration(0)).toBe('00:00.0')
    expect(formatRecordingDuration(61_250)).toBe('01:01.3')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })

  it('uses stable file names', () => {
    const date = new Date(2026, 9, 19, 8, 5, 7)
    expect(recordingFileName('gif', 'gif', date)).toBe('Pixmint-GIF-20261019-080507.gif')
    expect(recordingFileName('video', 'webm', date)).toBe(
      'Pixmint-Video-20261019-080507.webm'
    )
  })

  it('caps recording duration and bitrate', () => {
    expect(maxDurationFor('gif')).toBe(MAX_GIF_DURATION_MS)
    expect(maxDurationFor('video')).toBe(MAX_VIDEO_DURATION_MS)
    expect(estimateVideoBitrate(1280, 720, 30)).toBeGreaterThanOrEqual(2_000_000)
    expect(estimateVideoBitrate(3840, 2160, 30)).toBeLessThanOrEqual(24_000_000)
  })

  it('uses real capture intervals for GIF frame delays', () => {
    expect(gifFrameDelay(1000, 0, 66.7)).toBe(67)
    expect(gifFrameDelay(1080, 1000, 66.7)).toBe(80)
    expect(gifFrameDelay(1500, 1000, 66.7)).toBe(500)
    expect(gifFrameDelay(1004, 1000, 66.7)).toBe(10)
  })
})
