// Owner and editor access for the Content Studio. Keys are checked by the server; a key is stored only on
// the device where it was entered and never shipped in the app.
import { ensureSubscription, PUSH_API } from './push.ts'

const KEY = 'rnm-owner-key'
const ROLE = 'rnm-owner-role'

export type Role = 'owner' | 'editor'

export function ownerKey(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function ownerRole(): { role: Role; name: string } | null {
  try {
    const raw = localStorage.getItem(ROLE)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function forgetOwner() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(ROLE)
  } catch {
    /* ignore */
  }
}

async function call<T>(path: string, init: RequestInit = {}, key = ownerKey()): Promise<T> {
  if (!PUSH_API) throw new Error('App server is not set up.')
  const res = await fetch(`${PUSH_API}/editor/${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${key ?? ''}` } })
  if (res.status === 401) throw new Error('Wrong or revoked key.')
  if (res.status === 403) throw new Error('Only the owner can do this.')
  if (!res.ok) throw new Error(`Studio data unavailable (${res.status}).`)
  return res.json() as Promise<T>
}

export function studio<T>(path: string, key = ownerKey(), signal?: AbortSignal): Promise<T> {
  return call<T>(path, { signal }, key)
}

export function studioPost<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export async function unlock(key: string): Promise<boolean> {
  try {
    const me = await studio<{ role: Role; name: string }>('ping', key.trim())
    localStorage.setItem(KEY, key.trim())
    localStorage.setItem(ROLE, JSON.stringify({ role: me.role, name: me.name }))
    return true
  } catch {
    return false
  }
}

/** Lets this phone receive owner alerts (website down, morning brief). */
export async function registerOwnerDevice(): Promise<'ok' | 'denied' | 'unsupported'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  const sub = await ensureSubscription()
  if (!sub) return 'denied'
  await studioPost('owner-device', { subscription: sub.toJSON() })
  return 'ok'
}

/** Keys saved before roles existed get their role on the next Studio visit. */
export async function refreshRole(): Promise<void> {
  if (!ownerKey()) return
  try {
    const me = await studio<{ role: Role; name: string }>('ping')
    localStorage.setItem(ROLE, JSON.stringify({ role: me.role, name: me.name }))
  } catch {
    /* keep what we have */
  }
}
