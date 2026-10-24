import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.realtynmore.news',
  appName: 'R&M News',
  webDir: 'dist',
  backgroundColor: '#141416',
  plugins: {
    // Native HTTP: lets the Android app read the YouTube feeds directly (no CORS in native requests).
    CapacitorHttp: { enabled: true },
  },
}

export default config
