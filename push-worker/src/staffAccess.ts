// R&M Newsroom access for normal Realtynmore accounts (email, mobile number or Google).
//   • A new employee creates a normal account on the Sign in page.
//   • The owner or full-access staff finds it in Employees → "Give Newsroom access", picks Employee or
//     Full access (and office hours), and the same login now opens the Newsroom.
//   • Taking access away closes the Newsroom at once; the account stays a normal reader account.
// Their team id is "rd:<account number>" (old team logins keep "ph:<mobile>" and login keys a hash).
// Work records (attendance, reports, tasks, leave) stay with the company when access is removed.
import type { Env } from './index.ts'
import { full, sha256hex, type Who } from './owner.ts'
import { readId } from './reader.ts'

const DAY = 86400000
const READER_SESSION_DAYS = 365

export type AccessRole = 'admin' | 'editor'
interface LinkRow {
  id: number
  name: string
  email: string | null
  phone: string | null
  google_sub: string | null
  created_at: string
  role: AccessRole
  by_name: string | null
  granted_at: string
  last_seen: string | null
}

export const linkId = (readerId: number) => `rd:${readerId}`

/** A reader token with Newsroom access → who they are in the Newsroom; anything else → null. */
export async function linkedWho(env: Env, token: string): Promise<Who | null> {
  if (!/^r_[\w-]{40,60}$/.test(token)) return null
  const hash = await sha256hex(token)
  const now = Date.now()
  const row = await env.DB.prepare(
    'SELECT r.id, r.name, l.role, l.last_seen, s.expires_at AS expires FROM reader_sessions s JOIN readers r ON r.id = s.reader_id JOIN staff_links l ON l.reader_id = r.id WHERE s.token_hash = ? AND s.expires_at > ?',
  )
    .bind(hash, new Date(now).toISOString())
    .first<{ id: number; name: string; role: AccessRole; last_seen: string | null; expires: string }>()
  if (!row) return null
  // "Last seen" for Employees (every 5 minutes at most); someone who uses the Newsroom stays signed in.
  const writes: D1PreparedStatement[] = []
  if (!row.last_seen || Date.parse(row.last_seen) < now - 5 * 60000) writes.push(env.DB.prepare('UPDATE staff_links SET last_seen = ? WHERE reader_id = ?').bind(new Date(now).toISOString(), row.id))
  if (Date.parse(row.expires) < now + (READER_SESSION_DAYS - 1) * DAY) writes.push(env.DB.prepare('UPDATE reader_sessions SET expires_at = ? WHERE token_hash = ?').bind(new Date(now + READER_SESSION_DAYS * DAY).toISOString(), hash))
  if (writes.length) await env.DB.batch(writes)
  return { role: row.role === 'admin' ? 'admin' : 'editor', name: row.name, id: linkId(row.id) }
}

/** Newsroom role of a reader account, or null. */
export async function accessOf(env: Env, readerId: number): Promise<AccessRole | null> {
  const r = await env.DB.prepare('SELECT role FROM staff_links WHERE reader_id = ?').bind(readerId).first<{ role: AccessRole }>()
  return r ? (r.role === 'admin' ? 'admin' : 'editor') : null
}

/** Granted accounts, in the shape the team lists use (attendance, tasks, Team today). */
export async function linkedStaff(env: Env): Promise<{ id: string; name: string; active: boolean; created: string }[]> {
  const { results } = await env.DB.prepare('SELECT r.id, r.name, l.granted_at FROM staff_links l JOIN readers r ON r.id = l.reader_id ORDER BY r.name').all<{ id: number; name: string; granted_at: string }>()
  return results.map((r) => ({ id: linkId(r.id), name: r.name, active: true, created: r.granted_at }))
}

/** For the Employees list. */
export async function listLinked(env: Env) {
  const [{ results }, { allProfiles }] = await Promise.all([
    env.DB.prepare(
      'SELECT r.id, r.name, r.email, r.phone, r.google_sub, r.created_at, l.role, l.by_name, l.granted_at, l.last_seen FROM staff_links l JOIN readers r ON r.id = l.reader_id ORDER BY r.name',
    ).all<LinkRow>(),
    import('./profile.ts'),
  ])
  const profiles = await allProfiles(env)
  return results.map((r) => {
    const p = profiles.get(linkId(r.id))
    return {
      readerId: r.id,
      personId: linkId(r.id),
      name: r.name,
      email: r.email ?? '',
      phone: r.phone ?? '',
      google: !!r.google_sub,
      role: r.role === 'admin' ? 'admin' : 'editor',
      by: r.by_name ?? '',
      granted: r.granted_at,
      lastSeen: r.last_seen ?? '',
      title: p?.title ?? '',
      photo: p?.photo ?? '',
      avatar: p?.avatar ?? '',
    }
  })
}

function mustBeFull(who: Who) {
  if (!full(who)) throw new Error('Only the owner or full-access staff can give Newsroom access.')
}

/** Finds a Realtynmore account by its email or mobile number, for "Give Newsroom access". */
export async function findAccount(env: Env, who: Who, body: unknown) {
  mustBeFull(who)
  const id = readId((body as { id?: unknown })?.id)
  if (!id) throw new Error('Enter their email address or 10-digit mobile number.')
  // Someone who already has an old team login on this number or email just uses it.
  const team =
    'email' in id
      ? await env.DB.prepare('SELECT name FROM accounts WHERE email = ?').bind(id.email).first<{ name: string }>()
      : await env.DB.prepare('SELECT name FROM accounts WHERE phone = ?').bind(id.phone).first<{ name: string }>()
  if (team) return { found: false, team: team.name }
  const r =
    'email' in id
      ? await env.DB.prepare('SELECT id, name, email, phone, google_sub, created_at FROM readers WHERE email = ?').bind(id.email).first<LinkRow>()
      : await env.DB.prepare('SELECT id, name, email, phone, google_sub, created_at FROM readers WHERE phone = ?').bind(id.phone).first<LinkRow>()
  if (!r) return { found: false }
  return { found: true, account: { readerId: r.id, name: r.name, email: r.email ?? '', phone: r.phone ?? '', google: !!r.google_sub, created: r.created_at, access: await accessOf(env, r.id) } }
}

const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)

/** Gives (or changes) Newsroom access: Employee or Full access, optional designation and office hours. */
export async function grantAccess(env: Env, who: Who, body: unknown) {
  mustBeFull(who)
  const b = (body ?? {}) as { readerId?: unknown; role?: unknown; title?: unknown; start?: unknown; end?: unknown }
  const readerId = Number(b.readerId)
  if (!Number.isInteger(readerId) || readerId < 1) throw new Error('Pick the account first.')
  const r = await env.DB.prepare('SELECT id, name, email, phone FROM readers WHERE id = ?').bind(readerId).first<{ id: number; name: string; email: string | null; phone: string | null }>()
  if (!r) throw new Error('That account no longer exists.')
  const clash =
    (r.phone && (await env.DB.prepare('SELECT name FROM accounts WHERE phone = ?').bind(r.phone).first<{ name: string }>())) ||
    (r.email && (await env.DB.prepare('SELECT name FROM accounts WHERE email = ?').bind(r.email).first<{ name: string }>()))
  if (clash) throw new Error(`${clash.name} already has a team login with this number or email. They can sign in with it.`)
  const role: AccessRole = b.role === 'admin' ? 'admin' : 'editor'
  const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  const start = isTime(b.start) ? b.start : undefined
  const end = isTime(b.end) ? b.end : undefined
  const pid = linkId(r.id)
  const now = new Date().toISOString()
  // Office hours first, so a mistake (end before start) stops before access is given.
  if (start || end) {
    const { teamSettings, cleanPeopleTimes } = await import('./team.ts')
    const s = await teamSettings(env)
    const people = { ...s.people, ...cleanPeopleTimes({ [pid]: { start, end } }, s.startTime, s.endTime) }
    await env.SUBS.put('team:settings', JSON.stringify({ ...s, people }))
  }
  const before = await accessOf(env, r.id)
  await env.DB.prepare('INSERT INTO staff_links (reader_id, role, by_name, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT(reader_id) DO UPDATE SET role = excluded.role')
    .bind(r.id, role, who.name.slice(0, 60), now)
    .run()
  if (title)
    await env.DB.prepare("INSERT INTO profiles (person_id, title, photo, avatar, updated_at) VALUES (?, ?, '', '', ?) ON CONFLICT(person_id) DO UPDATE SET title = excluded.title")
      .bind(pid, title, now)
      .run()
  return { ok: true, name: r.name, role, changed: !!before }
}

/** Takes Newsroom access away. The account itself stays (they keep reading and saving stories). */
export async function revokeAccess(env: Env, who: Who, body: unknown) {
  mustBeFull(who)
  const readerId = Number((body as { readerId?: unknown })?.readerId)
  if (!Number.isInteger(readerId) || readerId < 1) throw new Error('Pick the account first.')
  if (who.id === linkId(readerId)) throw new Error('You can’t take away your own access.')
  const out = await env.DB.prepare('DELETE FROM staff_links WHERE reader_id = ?').bind(readerId).run()
  if (!out.meta.changes) throw new Error('This account has no Newsroom access.')
  return { ok: true }
}

/** Signs a granted account out of every device (lost phone). */
export async function signOutLinked(env: Env, who: Who, body: unknown) {
  mustBeFull(who)
  const readerId = Number((body as { readerId?: unknown })?.readerId)
  if (!Number.isInteger(readerId) || !(await accessOf(env, readerId))) throw new Error('This account has no Newsroom access.')
  await env.DB.prepare('DELETE FROM reader_sessions WHERE reader_id = ?').bind(readerId).run()
  return { ok: true }
}
