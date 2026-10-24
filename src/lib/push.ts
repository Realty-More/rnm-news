// Breaking-news notifications (Web Push). The push server is push-worker/ on Cloudflare's free plan.
import { Capacitor } from '@capacitor/core'

/** Set after the worker is deployed (see push-worker/README.md). Empty = notifications hidden. */
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

export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const reg = await navigator.serviceWorker.ready
  const { publicKey } = (await (await fetch(`${PUSH_API}/vapid`)).json()) as { publicKey: string }
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  await post('/subscribe', { subscription: sub.toJSON() })
  return 'on'
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
