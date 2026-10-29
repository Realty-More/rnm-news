import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/playfair-display/wght.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './styles.css'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import App from './App.tsx'
import { applyPrefs } from './lib/prefs.ts'
import { startReaderSync } from './lib/reader.ts'

applyPrefs()
// Signed-in readers: keep saved stories and feed choices the same on every device.
startReaderSync()

// Android back button: go back inside the app, exit only from the first screen.
if (Capacitor.isNativePlatform()) {
  void NativeApp.addListener('backButton', ({ canGoBack }) => (canGoBack ? window.history.back() : NativeApp.exitApp()))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Hash routes: no server rewrites needed on GitHub Pages or inside the Android app. */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
