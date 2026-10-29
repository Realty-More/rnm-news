// Owner and editor access for the Content Studio. Keys are checked by the server; a key is stored only on
// the device where it was entered and never shipped in the app.
import { ensureSubscription, PUSH_API } from './push.ts'

const KEY = 'rnm-owner-key'
const ROLE = 'rnm-owner-role'

export type Role = 'owner' | 'admin' | 'editor'

/** Owner (Palash Roy) or staff with full access: sees every owner section. */
export const hasFullAccess = () => {
  const r = ownerRole()?.role
  return r === 'owner' || r === 'admin'
}

export function ownerKey(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export interface Me {
  role: Role
  name: string
  /** Still on a password the owner gave them: must choose their own first. */
  mustChange?: boolean
  photo?: string
  avatar?: string
  title?: string
}

export function ownerRole(): Me | null {
  try {
    const raw = localStorage.getItem(ROLE)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function forgetOwner() {
  // A password login also ends its session on the server.
  const key = ownerKey()
  if (key?.startsWith('s_') && PUSH_API) void fetch(`${PUSH_API}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
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
  if (res.status === 401) throw new Error('Your login has ended. Please log in again.')
  if (!res.ok) {
    // Show the server's own reason ("Name is required.", "Only the owner can do this." …) when it gives one.
    const reason = await res.json().then((j: { error?: string }) => j.error, () => null)
    throw new Error(reason ?? (res.status === 403 ? 'Only the owner can do this.' : `Newsroom data unavailable (${res.status}).`))
  }
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

/** True when this device signed in with a mobile number and password (not a key). */
export const isAccountLogin = () => !!ownerKey()?.startsWith('s_')

async function auth<T>(path: 'login' | 'signup' | 'delete' | 'forgot' | 'reset', body: unknown): Promise<T> {
  if (!PUSH_API) throw new Error('App server is not set up.')
  let res: Response
  try {
    res = await fetch(`${PUSH_API}/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new Error(navigator.onLine ? 'Could not reach the server. Try again.' : 'You are offline.')
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Try again.')
  return data
}

function remember(token: string, role: Role, name: string) {
  localStorage.setItem(KEY, token)
  localStorage.setItem(ROLE, JSON.stringify({ role, name }))
}

/** Mobile number (or the email added in My profile) + password. */
export async function passwordLogin(phoneOrEmail: string, password: string): Promise<{ role: Role; name: string }> {
  const id = phoneOrEmail.includes('@') ? { email: phoneOrEmail.trim() } : { phone: phoneOrEmail }
  const r = await auth<{ token: string; role: Role; name: string }>('login', { ...id, password })
  remember(r.token, r.role, r.name)
  return r
}

/** Forgot password for a team login: a code goes to its email, if it has one. */
export const staffForgot = (id: string) => auth<{ matched: boolean; sent: boolean }>('forgot', { id })

/** Sets a new team password with the emailed code and logs in here. */
export async function staffReset(id: string, code: string, password: string): Promise<{ role: Role; name: string }> {
  const r = await auth<{ token: string; role: Role; name: string }>('reset', { id, code, password })
  remember(r.token, r.role, r.name)
  return r
}

/** New account. Staff accounts wait for the owner's approval; the owner's (with the setup key) is ready at once. */
export async function createAccount(a: { name: string; phone: string; password: string; ownerKey?: string }): Promise<{ pending: boolean; name: string }> {
  const r = await auth<{ pending?: boolean; token?: string; role?: Role; name: string }>('signup', a)
  if (r.token && r.role) remember(r.token, r.role, r.name)
  return { pending: !!r.pending, name: r.name }
}

/** Deletes a staff account for good (mobile number + password), then logs out here. */
export async function deleteMyAccount(phone: string, password: string): Promise<void> {
  await auth<{ deleted: boolean }>('delete', { phone, password })
  forgetOwner()
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
    const me = await studio<Me>('ping')
    localStorage.setItem(ROLE, JSON.stringify({ role: me.role, name: me.name, mustChange: !!me.mustChange, photo: me.photo ?? '', avatar: me.avatar ?? '', title: me.title ?? '' }))
  } catch {
    /* keep what we have */
  }
}
