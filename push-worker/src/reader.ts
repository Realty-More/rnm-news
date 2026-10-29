// Reader accounts ("My Realty & More"): email + password, for readers only.
//   Kept apart from team logins on purpose: reader sessions ("r_…") never open R&M Newsroom; the
//   Newsroom only accepts staff sessions ("s_…"), editor keys and the owner key.
//   Passwords: the same PBKDF2 + server pepper as staff. Sessions: random tokens stored as SHA-256
//   hashes, 365 days from the last use. Wrong passwords and sign-ups are rate limited.
//   Sync: saved stories (title, picture, link; the full text loads when opened) and feed choices
//   (topics, cities, alerts, language, text size) follow the reader to every device.
//   Forgot password: a 6-digit code by email (Brevo), valid 20 minutes, 5 tries.
import type { Env } from './index.ts'
import { addFail, b64, fails, hashPassword, ipOf, passwordProblem, pepperOf, unb64 } from './accounts.ts'
import { sameKey, sha256hex } from './owner.ts'

const SESSION_DAYS = 365
const DAY = 86400000
const MAX_SAVED = 500
const RESET_MIN = 20

interface Reader {
  id: number
  email: string
  name: string
  salt: string
  hash: string
  created_at: string
  sync: string | null
  reset_hash: string | null
  reset_expires: string | null
  reset_tries: number
}

export interface SavedLite {
  id: number
  savedAt: string
  slug?: string
  date?: string
  link?: string
  title?: string
  excerpt?: string
  image?: { src: string; srcSet?: string; alt?: string } | null
  categories?: { id: number; name: string; slug: string }[]
}
export interface ReaderPrefs {
  topics?: string[]
  cities?: string[]
  notifyMode?: string
  lang?: string
  textSize?: number
  updatedAt?: string
}
interface SyncState {
  saved: SavedLite[]
  removed: Record<string, string> // story id → when it was removed
  prefs: ReaderPrefs
}

export const normEmail = (v: unknown): string | null => {
  const e = String(v ?? '').trim().toLowerCase()
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(e) ? e : null
}
const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 50) : '')

async function newSession(env: Env, id: number): Promise<string> {
  const token = `r_${b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO reader_sessions (token_hash, reader_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256hex(token), id, new Date(now).toISOString(), new Date(now + SESSION_DAYS * DAY).toISOString()),
    env.DB.prepare('UPDATE readers SET last_login = ? WHERE id = ?').bind(new Date(now).toISOString(), id),
    env.DB.prepare('DELETE FROM reader_sessions WHERE expires_at < ?').bind(new Date(now).toISOString()),
  ])
  return token
}

const publicMe = (r: Reader) => ({ name: r.name, email: r.email, created: r.created_at, sync: parseSync(r.sync) })

function parseSync(s: string | null): SyncState {
  try {
    const v = JSON.parse(s ?? '{}') as Partial<SyncState>
    return { saved: Array.isArray(v.saved) ? v.saved : [], removed: v.removed && typeof v.removed === 'object' ? v.removed : {}, prefs: v.prefs && typeof v.prefs === 'object' ? v.prefs : {} }
  } catch {
    return { saved: [], removed: {}, prefs: {} }
  }
}

/** The reader for a session token, or null. Keeps the session alive while it is used. */
export async function readerOf(env: Env, req: Request): Promise<Reader | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!/^r_[\w-]{40,60}$/.test(token)) return null
  const hash = await sha256hex(token)
  const now = Date.now()
  const row = await env.DB.prepare('SELECT r.*, s.expires_at AS expires FROM reader_sessions s JOIN readers r ON r.id = s.reader_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(hash, new Date(now).toISOString())
    .first<Reader & { expires: string }>()
  if (!row) return null
  if (Date.parse(row.expires) < now + (SESSION_DAYS - 1) * DAY) await env.DB.prepare('UPDATE reader_sessions SET expires_at = ? WHERE token_hash = ?').bind(new Date(now + SESSION_DAYS * DAY).toISOString(), hash).run()
  return row
}

export async function readerSignup(env: Env, req: Request, body: unknown) {
  const b = (body ?? {}) as { name?: unknown; email?: unknown; password?: unknown }
  const name = cleanName(b.name)
  if (name.length < 2) throw new Error('Enter your name.')
  const email = normEmail(b.email)
  if (!email) throw new Error('Enter a valid email address.')
  const problem = passwordProblem(b.password)
  if (problem) throw new Error(problem)
  const ipKey = `rsignup:${await sha256hex(ipOf(req))}`
  if ((await fails(env, ipKey)) >= 15) throw new Error('Too many new accounts from this network. Please try again in an hour.')
  if (await env.DB.prepare('SELECT id FROM readers WHERE email = ?').bind(email).first()) throw new Error('This email already has an account. Sign in instead, or use “Forgot password”.')
  const { salt, hash } = await hashPassword(b.password as string, pepperOf(env))
  const now = new Date().toISOString()
  const r = await env.DB.prepare('INSERT INTO readers (email, name, salt, hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(email, name, salt, hash, now).run()
  await addFail(env, ipKey)
  const id = Number(r.meta.last_row_id)
  return { token: await newSession(env, id), me: { name, email, created: now, sync: parseSync(null) } }
}

async function checkPassword(env: Env, pw: string, r: Reader) {
  const { hash } = await hashPassword(pw, pepperOf(env), unb64(r.salt))
  return sameKey(hash, r.hash)
}

export async function readerLogin(env: Env, req: Request, body: unknown) {
  const b = (body ?? {}) as { email?: unknown; password?: unknown }
  const email = normEmail(b.email)
  if (!email || typeof b.password !== 'string' || !b.password) throw new Error('Enter your email and password.')
  const k = `rlogin:${email}`
  const ipKey = `rlogin-ip:${await sha256hex(ipOf(req))}`
  if ((await fails(env, k)) >= 8 || (await fails(env, ipKey)) >= 60) throw new Error('Too many wrong tries. Please wait an hour, or reset your password.')
  const r = await env.DB.prepare('SELECT * FROM readers WHERE email = ?').bind(email).first<Reader>()
  if (!r || !(await checkPassword(env, b.password, r))) {
    await Promise.all([addFail(env, k), addFail(env, ipKey)])
    throw new Error('Email or password is not right. Passwords are case-sensitive.')
  }
  return { token: await newSession(env, r.id), me: publicMe(r) }
}

export async function readerLogout(env: Env, req: Request) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (token.startsWith('r_')) await env.DB.prepare('DELETE FROM reader_sessions WHERE token_hash = ?').bind(await sha256hex(token)).run()
  return { ok: true }
}

export async function readerMe(env: Env, req: Request) {
  const r = await readerOf(env, req)
  if (!r) throw new Error('Please sign in again.')
  return publicMe(r)
}

const cleanSaved = (v: unknown): SavedLite[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is SavedLite => !!x && Number.isInteger((x as SavedLite).id) && typeof (x as SavedLite).savedAt === 'string')
    .slice(0, MAX_SAVED)
    .map((x) => ({
      id: x.id,
      savedAt: x.savedAt.slice(0, 30),
      slug: String(x.slug ?? '').slice(0, 200),
      date: String(x.date ?? '').slice(0, 30),
      link: String(x.link ?? '').slice(0, 400),
      title: String(x.title ?? '').slice(0, 300),
      excerpt: String(x.excerpt ?? '').slice(0, 600),
      image: x.image && typeof x.image.src === 'string' ? { src: x.image.src.slice(0, 500), srcSet: String(x.image.srcSet ?? '').slice(0, 1500), alt: String(x.image.alt ?? '').slice(0, 200) } : null,
      categories: Array.isArray(x.categories) ? x.categories.slice(0, 6).map((c) => ({ id: Number(c.id) || 0, name: String(c.name ?? '').slice(0, 60), slug: String(c.slug ?? '').slice(0, 60) })) : [],
    }))

/** Merges this device's saved stories and feed choices with the account's, and returns the result. */
export function mergeSync(server: SyncState, device: { saved?: unknown; removed?: unknown; prefs?: unknown }, now = Date.now()): SyncState {
  const removed: Record<string, string> = { ...server.removed }
  if (device.removed && typeof device.removed === 'object')
    for (const [id, at] of Object.entries(device.removed as Record<string, unknown>)) if (/^\d+$/.test(id) && typeof at === 'string' && (!removed[id] || removed[id] < at)) removed[id] = at.slice(0, 30)
  const byId = new Map<number, SavedLite>()
  for (const s of [...server.saved, ...cleanSaved(device.saved)]) {
    const seen = byId.get(s.id)
    if (!seen || seen.savedAt < s.savedAt) byId.set(s.id, s)
  }
  // A story stays saved only if it was saved after it was last removed.
  const saved = [...byId.values()].filter((s) => !removed[s.id] || removed[s.id] < s.savedAt).sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, MAX_SAVED)
  // Forget removals older than 120 days.
  for (const [id, at] of Object.entries(removed)) if (Date.parse(at) < now - 120 * DAY) delete removed[id]
  const dp = (device.prefs ?? {}) as ReaderPrefs
  const prefs =
    dp && typeof dp.updatedAt === 'string' && (!server.prefs.updatedAt || dp.updatedAt > server.prefs.updatedAt)
      ? {
          topics: Array.isArray(dp.topics) ? dp.topics.filter((t) => typeof t === 'string').slice(0, 40) : [],
          cities: Array.isArray(dp.cities) ? dp.cities.filter((t) => typeof t === 'string').slice(0, 40) : [],
          notifyMode: dp.notifyMode === 'feed' ? 'feed' : 'all',
          lang: dp.lang === 'hi' ? 'hi' : 'en',
          textSize: Number.isInteger(dp.textSize) ? Math.max(0, Math.min(3, dp.textSize!)) : 1,
          updatedAt: dp.updatedAt.slice(0, 30),
        }
      : server.prefs
  return { saved, removed, prefs }
}

export async function readerSync(env: Env, req: Request, body: unknown) {
  const r = await readerOf(env, req)
  if (!r) throw new Error('Please sign in again.')
  const next = mergeSync(parseSync(r.sync), (body ?? {}) as Record<string, unknown>)
  await env.DB.prepare('UPDATE readers SET sync = ?, last_seen = ? WHERE id = ?').bind(JSON.stringify(next), new Date().toISOString(), r.id).run()
  return next
}

export async function readerProfile(env: Env, req: Request, body: unknown) {
  const r = await readerOf(env, req)
  if (!r) throw new Error('Please sign in again.')
  const b = (body ?? {}) as { name?: unknown; password?: unknown; newPassword?: unknown }
  if (b.newPassword !== undefined) {
    if (typeof b.password !== 'string' || !(await checkPassword(env, b.password, r))) throw new Error('Your current password is not right.')
    const problem = passwordProblem(b.newPassword)
    if (problem) throw new Error(problem)
    const { salt, hash } = await hashPassword(b.newPassword as string, pepperOf(env))
    await env.DB.prepare('UPDATE readers SET salt = ?, hash = ? WHERE id = ?').bind(salt, hash, r.id).run()
    return { ok: true }
  }
  const name = cleanName(b.name)
  if (name.length < 2) throw new Error('Enter your name.')
  await env.DB.prepare('UPDATE readers SET name = ? WHERE id = ?').bind(name, r.id).run()
  return { ok: true, name }
}

export async function readerDelete(env: Env, req: Request, body: unknown) {
  const r = await readerOf(env, req)
  if (!r) throw new Error('Please sign in again.')
  const pw = (body as { password?: unknown })?.password
  if (typeof pw !== 'string' || !(await checkPassword(env, pw, r))) throw new Error('Your password is not right.')
  await env.DB.batch([env.DB.prepare('DELETE FROM reader_sessions WHERE reader_id = ?').bind(r.id), env.DB.prepare('DELETE FROM readers WHERE id = ?').bind(r.id)])
  return { ok: true }
}

/** Sends a 6-digit code to reset the password. Always answers the same, so emails cannot be guessed. */
export async function readerForgot(env: Env, req: Request, body: unknown) {
  const email = normEmail((body as { email?: unknown })?.email)
  if (!email) throw new Error('Enter a valid email address.')
  const ipKey = `rforgot:${await sha256hex(ipOf(req))}`
  if ((await fails(env, ipKey)) >= 10 || (await fails(env, `rforgot:${email}`)) >= 4) throw new Error('Too many codes asked for. Please try again in an hour.')
  await Promise.all([addFail(env, ipKey), addFail(env, `rforgot:${email}`)])
  const r = await env.DB.prepare('SELECT id, name FROM readers WHERE email = ?').bind(email).first<{ id: number; name: string }>()
  if (r) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
    await env.DB.prepare('UPDATE readers SET reset_hash = ?, reset_expires = ?, reset_tries = 0 WHERE id = ?')
      .bind(await sha256hex(`${email}:${code}`), new Date(Date.now() + RESET_MIN * 60000).toISOString(), r.id)
      .run()
    const { sendRaw } = await import('./newsletter.ts')
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#141416"><p style="font:700 12px Arial;letter-spacing:2px;color:#A87412;text-transform:uppercase">Realty &amp; More</p><h1 style="font:400 26px Georgia,serif;margin:8px 0 12px">Your password reset code</h1><p>Hi ${r.name.replace(/[<>&"]/g, '')}, use this code in the Realtynmore app to set a new password:</p><p style="font:700 34px/1 'Courier New',monospace;letter-spacing:8px;background:#F7F6F2;border-radius:8px;padding:16px;text-align:center">${code}</p><p style="color:#6B6B70;font-size:13px">It works for ${RESET_MIN} minutes. If you did not ask for this, you can ignore this email.</p></div>`
    await sendRaw(env, { to: email, subject: `${code} is your Realty & More reset code`, html, text: `Your Realty & More password reset code: ${code}\nIt works for ${RESET_MIN} minutes.`, tag: 'reader-reset' }).catch(() => null)
  }
  return { ok: true }
}

export async function readerReset(env: Env, req: Request, body: unknown) {
  const b = (body ?? {}) as { email?: unknown; code?: unknown; password?: unknown }
  const email = normEmail(b.email)
  const code = String(b.code ?? '').replace(/\D/g, '')
  if (!email || code.length !== 6) throw new Error('Enter your email and the 6-digit code.')
  const problem = passwordProblem(b.password)
  if (problem) throw new Error(problem)
  const r = await env.DB.prepare('SELECT * FROM readers WHERE email = ?').bind(email).first<Reader>()
  if (!r || !r.reset_hash || !r.reset_expires || Date.parse(r.reset_expires) < Date.now() || r.reset_tries >= 5) throw new Error('This code has expired. Ask for a new one.')
  if (!sameKey(await sha256hex(`${email}:${code}`), r.reset_hash)) {
    await env.DB.prepare('UPDATE readers SET reset_tries = reset_tries + 1 WHERE id = ?').bind(r.id).run()
    throw new Error('That code is not right.')
  }
  const { salt, hash } = await hashPassword(b.password as string, pepperOf(env))
  await env.DB.batch([
    env.DB.prepare('UPDATE readers SET salt = ?, hash = ?, reset_hash = NULL, reset_expires = NULL, reset_tries = 0 WHERE id = ?').bind(salt, hash, r.id),
    env.DB.prepare('DELETE FROM reader_sessions WHERE reader_id = ?').bind(r.id),
  ])
  return { token: await newSession(env, r.id), me: publicMe({ ...r, salt, hash }) }
}
