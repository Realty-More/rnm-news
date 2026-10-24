// Breaking-news notifications (Web Push). The server is push-worker/ on Cloudflare's free plan.
import { Capacitor } from '@capacitor/core'
import { readPrefs } from './prefs.ts'
import { CURATED_CATEGORIES } from './wp.ts'

/** App server address (repo variable PUSH_API at build time). Empty = server features hidden. */
export const PUSH_API: string = import.meta.env.VITE_PUSH_API ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on'

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export function pushAvailable(): boolean {
  return !!PUSH_API && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator && 'Notification' in window
}

export async function pushState(): Promise<PushState> {
  if (!pushAvailable()) return 'unsupported'
  // iPhone only allows web notifications for apps added to the Home Screen.
  if (isIos() && !isStandalone()) return 'ios-install'
  if (!('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${PUSH_API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Notification server error (${res.status})`)
}

/** Sections (category ids) and cities to filter alerts by; undefined = every story. */
export function currentFilters() {
  const p = readPrefs()
  if (p.notifyMode !== 'feed') return undefined
  const topics = CURATED_CATEGORIES.filter((c) => p.topics.includes(c.slug)).map((c) => c.id)
  return topics.length || p.cities.length ? { topics, cities: p.cities } : undefined
}

/** Asks permission and returns this device's push subscription (null if refused). */
export async function ensureSubscription(): Promise<PushSubscription | null> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null
  const reg = await navigator.serviceWorker.ready
  const { publicKey } = (await (await fetch(`${PUSH_API}/vapid`)).json()) as { publicKey: string }
  return (await reg.pushManager.getSubscription()) ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
}

export async function enablePush(): Promise<PushState> {
  const sub = await ensureSubscription()
  if (!sub) return Notification.permission === 'denied' ? 'denied' : 'off'
  await post('/subscribe', { subscription: sub.toJSON(), filters: currentFilters() })
  return 'on'
}

/** Re-sends this device's filters after My Feed or the alert mode changes. */
export async function syncPushFilters() {
  if (!pushAvailable() || Notification.permission !== 'granted') return
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
  if (sub) await post('/subscribe', { subscription: sub.toJSON(), filters: currentFilters() })
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await post('/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
    await sub.unsubscribe()
  }
  return 'off'
}
