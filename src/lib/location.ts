// The phone's position, read once at check-in or check-out (never in the background).
import { Capacitor } from '@capacitor/core'

/** Why the last position request failed: blocked by the person, GPS off / no signal, or too slow. */
export type SpotProblem = 'denied' | 'unavailable' | 'timeout'
export let lastSpotProblem: SpotProblem | null = null

/** The browser's location permission for this site, when it can tell. */
export async function locationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const r = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return r?.state ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Which kind of device / app this is, for the "turn location back on" steps. */
export function deviceKind(): 'android-app' | 'android-installed' | 'android-browser' | 'iphone' | 'computer' {
  if (Capacitor.isNativePlatform()) return 'android-app'
  const ua = navigator.userAgent
  const installed = window.matchMedia?.('(display-mode: standalone)').matches
  if (/iphone|ipad|ipod/i.test(ua)) return 'iphone'
  if (/android/i.test(ua)) return installed ? 'android-installed' : 'android-browser'
  return 'computer'
}

export interface Spot {
  lat: number
  lng: number
  acc: number
}

/** Current position, or null if location is off, refused or too slow. */
export function getSpot(timeoutMs = 12000): Promise<Spot | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = setTimeout(() => resolve(null), timeoutMs + 1000)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(done)
        lastSpotProblem = null
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy })
      },
      (e) => {
        clearTimeout(done)
        lastSpotProblem = e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    )
  })
}

export const mapLink = (p: { lat: number; lng: number }) => `https://www.google.com/maps?q=${p.lat},${p.lng}`
