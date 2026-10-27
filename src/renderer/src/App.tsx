import type { JSX } from 'react'
import { OverlayApp } from './overlay/OverlayApp'
import { PinApp } from './pin/PinApp'
import { OcrApp } from './ocr/OcrApp'
import { RecorderControlApp } from './recorder/RecorderControlApp'
import { RecordPreviewApp } from './recorder/RecordPreviewApp'
import { OnboardingApp } from './onboarding/OnboardingApp'
import { SettingsApp } from './settings/SettingsApp'
import { LongCaptureHudApp } from './long-capture/LongCaptureHudApp'
import { LongCapturePreviewApp } from './long-capture/LongCapturePreviewApp'
import { LongCaptureBorderApp } from './long-capture/LongCaptureBorderApp'
import { WindowLongSelectionApp } from './long-capture/WindowLongSelectionApp'

function currentRoute(): string {
  return window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'settings'
}

export default function App(): JSX.Element {
  const route = currentRoute()
  if (route === 'overlay') return <OverlayApp />
  if (route === 'pin') return <PinApp />
  if (route === 'ocr') return <OcrApp />
  if (route === 'recorder-control') return <RecorderControlApp />
  if (route === 'record-preview') return <RecordPreviewApp />
  if (route === 'long-capture-hud') return <LongCaptureHudApp />
  if (route === 'long-capture-preview') return <LongCapturePreviewApp />
  if (route === 'long-capture-border') return <LongCaptureBorderApp />
  if (route === 'window-long-selection') return <WindowLongSelectionApp />
  if (route === 'onboarding') return <OnboardingApp />
  return <SettingsApp />
}
