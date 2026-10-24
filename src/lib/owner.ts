// Owner access for the Content Studio. The key is checked by the server; it is stored only on the
// owner's own device and never shipped in the app.
import { PUSH_API } from './push.ts'

const KEY = 'rnm-owner-key'

export function ownerKey(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function forgetOwner() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export async function studio<T>(path: string, key = ownerKey(), signal?: AbortSignal): Promise<T> {
  if (!PUSH_API) throw new Error('App server is not set up.')
  const res = await fetch(`${PUSH_API}/editor/${path}`, { headers: { Authorization: `Bearer ${key ?? ''}` }, signal })
  if (res.status === 401) throw new Error('Wrong owner key.')
  if (!res.ok) throw new Error(`Studio data unavailable (${res.status}).`)
  return res.json() as Promise<T>
}

export async function unlock(key: string): Promise<boolean> {
  try {
    await studio('ping', key.trim())
    localStorage.setItem(KEY, key.trim())
    return true
  } catch {
    return false
  }
}
