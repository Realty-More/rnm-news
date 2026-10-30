// Studio accounts: mobile number + password (no OTP, so no SMS costs).
//   Create account: staff requests wait for the owner's approval; the owner's own account is created
//   once with the owner setup key (STATS_KEY) and is active straight away.
//   Passwords: PBKDF2-SHA256 over an HMAC with a server-side pepper (AUTH_PEPPER), per-user salt.
//   Sessions: random tokens ("s_…"), stored only as SHA-256 hashes, valid 180 days from the last use
//   (rolling, so people who use the app never have to log in again), ended on log out.
//   Forgot password: the owner sets a new one from the Studio.
import type { Env } from './index.ts'
import { full, sameKey, sha256hex, type Who } from './owner.ts'

const ITERATIONS = 20000
const SESSION_DAYS = 180
const MAX_FAILS = 8
// One office Wi-Fi is one network address for everyone, so the per-network limit is generous.
const MAX_NETWORK_FAILS = 80
const DAY = 86400000

type Status = 'pending' | 'active' | 'rejected'
interface Account { phone: string; name: string; role: 'owner' | 'admin' | 'editor'; status: Status; salt: string; hash: string; created_at: string; approved_at: string | null; last_login: string | null }

/** Indian mobile number → 10 digits ("+91 98100 79064" → "9810079064"), or null. */
export function normPhone(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '')
  const n = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d
  return /^[6-9]\d{9}$/.test(n) ? n : null
}

/** Why a password is not allowed, or null when it is fine. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters for the password.'
  if (pw.length > 64) return 'Use at most 64 characters for the password.'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use both letters and numbers in the password.'
  return null
}

export const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
export const pepperOf = (env: Env) => env.AUTH_PEPPER || env.STATS_KEY

export async function hashPassword(pw: string, pepper: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<{ salt: string; hash: string }> {
  const enc = new TextEncoder()
  const hk = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const peppered = new Uint8Array(await crypto.subtle.sign('HMAC', hk, enc.encode(pw)))
  const pk = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, pk, 256))
  return { salt: b64(salt), hash: b64(bits) }
}

async function checkPassword(pw: string, a: Account, pepper: string): Promise<boolean> {
  const { hash } = await hashPassword(pw, pepper, unb64(a.salt))
  return sameKey(hash, a.hash)
}

const hourKey = () => new Date().toISOString().slice(0, 13)
export async function fails(env: Env, k: string): Promise<number> {
  return (await env.DB.prepare('SELECT n FROM auth_fail WHERE k = ? AND hour = ?').bind(k, hourKey()).first<{ n: number }>())?.n ?? 0
}
export async function addFail(env: Env, k: string) {
  await env.DB.prepare('INSERT INTO auth_fail (k, hour, n) VALUES (?, ?, 1) ON CONFLICT(k, hour) DO UPDATE SET n = n + 1').bind(k, hourKey()).run()
}

async function newSession(env: Env, phone: string): Promise<string> {
  const token = `s_${b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token_hash, phone, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256hex(token), phone, new Date(now).toISOString(), new Date(now + SESSION_DAYS * DAY).toISOString()),
    env.DB.prepare('UPDATE accounts SET last_login = ? WHERE phone = ?').bind(new Date(now).toISOString(), phone),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date(now).toISOString()),
  ])
  return token
}

export const ipOf = (req: Request) => req.headers.get('CF-Connecting-IP') ?? 'x'

export async function signup(env: Env, req: Request, body: unknown) {
  const b = (body ?? {}) as { name?: unknown; phone?: unknown; password?: unknown; ownerKey?: unknown }
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  if (name.length < 2) throw new Error('Enter your full name.')
  const phone = normPhone(b.phone)
  if (!phone) throw new Error('Enter a valid 10-digit mobile number.')
  const problem = passwordProblem(b.password)
  if (problem) throw new Error(problem)
  const ipKey = `signup:${await sha256hex(ipOf(req))}`
  if ((await fails(env, ipKey)) >= 12) throw new Error('Too many new accounts from this network. Try again in an hour.')
  const exists = await env.DB.prepare('SELECT status FROM accounts WHERE phone = ?').bind(phone).first<{ status: Status }>()
  if (exists && exists.status !== 'rejected') throw new Error('This number already has an account. Log in, or ask the owner to reset your password.')
  // The owner login is set up (mobile number); a new one can no longer be made with the owner key.
  const wantsOwner = false
  if (typeof b.ownerKey === 'string' && b.ownerKey.trim()) throw new Error('The owner login is already set up. Sign in with your mobile number.')
  const role = wantsOwner ? 'owner' : 'editor'
  const status: Status = wantsOwner ? 'active' : 'pending'
  const { salt, hash } = await hashPassword(b.password as string, pepperOf(env))
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO accounts (phone, name, role, status, salt, hash, created_at, approved_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(phone) DO UPDATE SET name = excluded.name, role = excluded.role, status = excluded.status, salt = excluded.salt, hash = excluded.hash, created_at = excluded.created_at, approved_at = excluded.approved_at`,
  )
    .bind(phone, name, role, status, salt, hash, now, wantsOwner ? now : null)
    .run()
  await addFail(env, ipKey) // counts sign-ups per network per hour
  if (!wantsOwner) return { pending: true, name }
  return { token: await newSession(env, phone), role, name }
}

export async function login(env: Env, req: Request, body: unknown) {
  const b = (body ?? {}) as { phone?: unknown; email?: unknown; password?: unknown }
  // A team member who added an email can sign in with it too.
  let phone = normPhone(b.phone)
  if (!phone && typeof b.email === 'string' && b.email.includes('@')) {
    const row = await env.DB.prepare('SELECT phone FROM accounts WHERE email = ?').bind(b.email.trim().toLowerCase()).first<{ phone: string }>()
    if (!row) throw new Error('No team login with this email.')
    phone = row.phone
  }
  if (!phone || typeof b.password !== 'string' || !b.password) throw new Error('Enter your mobile number and password.')
  const phoneKey = `login:${phone}`
  const ipKey = `login-ip:${await sha256hex(ipOf(req))}`
  if ((await fails(env, phoneKey)) >= MAX_FAILS || (await fails(env, ipKey)) >= MAX_NETWORK_FAILS) throw new Error('Too many wrong tries. Wait an hour, or ask the owner to reset your password.')
  const a = await env.DB.prepare('SELECT * FROM accounts WHERE phone = ?').bind(phone).first<Account>()
  if (!a || !(await checkPassword(b.password, a, pepperOf(env)))) {
    await Promise.all([addFail(env, phoneKey), addFail(env, ipKey)])
    throw new Error(a ? 'Wrong password. Use the latest password you were given (passwords are case-sensitive). Forgot it? Ask the owner for a “New password”.' : 'No login on this mobile number. Ask the owner to add you, or tap “Create account”.')
  }
  if (a.status === 'pending') throw new Error('Your account is waiting for the owner’s approval.')
  if (a.status !== 'active') throw new Error('This account is not active. Please contact the owner.')
  // Also signs in to their Realtynmore app account (one login for both).
  const reader = await import('./staffAccess.ts').then((m) => m.readerForStaff(env, phone!)).catch(() => null)
  return { token: await newSession(env, phone), role: a.role, name: a.name, reader }
}

export async function logout(env: Env, token: string) {
  if (token.startsWith('s_')) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256hex(token)).run()
  return { ok: true }
}

/** The signed-in person for a session token, or null. */
export async function sessionWho(env: Env, token: string): Promise<Who | null> {
  if (!/^s_[\w-]{40,60}$/.test(token)) return null
  const hash = await sha256hex(token)
  const now = Date.now()
  const row = await env.DB.prepare(
    "SELECT a.phone, a.name, a.role, a.last_seen AS seen, s.expires_at AS expires FROM sessions s JOIN accounts a ON a.phone = s.phone WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'active'",
  )
    .bind(hash, new Date(now).toISOString())
    .first<{ phone: string; name: string; role: 'owner' | 'admin' | 'editor'; expires: string; seen: string | null }>()
  if (!row) return null
  // "Last seen" for the Employees list, written at most every 5 minutes.
  if (!row.seen || Date.parse(row.seen) < now - 5 * 60000) await env.DB.prepare('UPDATE accounts SET last_seen = ? WHERE phone = ?').bind(new Date(now).toISOString(), row.phone).run()
  // Rolling login: anyone who uses the app stays logged in. Once a day at most, the 180 days restart.
  if (Date.parse(row.expires) < now + (SESSION_DAYS - 1) * DAY)
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(new Date(now + SESSION_DAYS * DAY).toISOString(), hash).run()
  return row.role === 'owner' ? { role: 'owner', name: row.name, phone: row.phone } : { role: row.role, name: row.name, id: `ph:${row.phone}`, phone: row.phone }
}

/** Staff with an active account, in the shape the team lists use. */
export async function accountStaff(env: Env): Promise<{ id: string; name: string; active: boolean; created: string }[]> {
  const [{ results }, linked] = await Promise.all([
    env.DB.prepare("SELECT phone, name, COALESCE(approved_at, created_at) AS since FROM accounts WHERE role IN ('editor', 'admin') AND status = 'active' ORDER BY name").all<{ phone: string; name: string; since: string }>(),
    // Normal accounts the owner gave Newsroom access ("rd:<id>").
    import('./staffAccess.ts').then((m) => m.linkedStaff(env)),
  ])
  return [...results.map((r) => ({ id: `ph:${r.phone}`, name: r.name, active: true, created: r.since })), ...linked]
}

/* ---------- owner: requests and accounts ---------- */

export async function listAccounts(env: Env) {
  const [{ results }, { allProfiles }] = await Promise.all([
    env.DB.prepare("SELECT phone, name, role, status, email, created_at AS created, approved_at AS approved, last_login AS lastLogin, last_seen AS lastSeen, must_change AS mustChange FROM accounts ORDER BY status = 'pending' DESC, name")
      .all<{ phone: string; name: string; mustChange: number | null }>(),
    import('./profile.ts'),
  ])
  const [profiles, devices, linked] = await Promise.all([
    allProfiles(env),
    // Devices still logged in (sessions not ended or expired).
    env.DB.prepare('SELECT phone, COUNT(*) AS n FROM sessions WHERE expires_at > ? GROUP BY phone').bind(new Date().toISOString()).all<{ phone: string; n: number }>(),
    import('./staffAccess.ts').then((m) => m.listLinked(env)),
  ])
  const devicesBy = new Map(devices.results.map((d) => [d.phone, d.n]))
  // Picture and designation for the Employees list.
  return {
    accounts: results.map((a) => {
      const p = profiles.get(`ph:${a.phone}`)
      return { ...a, mustChange: a.mustChange === 1, devices: devicesBy.get(a.phone) ?? 0, title: p?.title ?? '', photo: p?.photo ?? '', avatar: p?.avatar ?? '' }
    }),
    // Normal accounts with Newsroom access (Employees → Give Newsroom access).
    linked,
  }
}

const randomPassword = () => {
  const abc = 'abcdefghjkmnpqrstuvwxyz'
  const r = crypto.getRandomValues(new Uint8Array(8))
  return `${[...r.slice(0, 5)].map((x) => abc[x % abc.length]).join('')}${100 + (r[5] * 256 + r[6]) % 900}`
}

export async function manageAccount(env: Env, action: string, body: unknown, who: Who) {
  const phone = normPhone((body as { phone?: unknown })?.phone)
  if (!phone) throw new Error('Pick an account.')
  const a = await env.DB.prepare('SELECT role, status FROM accounts WHERE phone = ?').bind(phone).first<{ role: string; status: Status }>()
  if (!a) throw new Error('Account not found.')
  if (a.role === 'owner' && action !== 'reset') throw new Error('The owner account can’t be changed here.')
  if (a.role === 'owner' && who.phone !== phone) throw new Error('Only the owner can reset the owner password.')
  // Full access (owner or admin) can manage everyone except the owner's own account.
  if (!full(who)) throw new Error('Only the owner or full-access staff can do this.')
  const endSessions = env.DB.prepare('DELETE FROM sessions WHERE phone = ?').bind(phone)
  switch (action) {
    case 'approve':
      await env.DB.prepare("UPDATE accounts SET status = 'active', approved_at = ? WHERE phone = ?").bind(new Date().toISOString(), phone).run()
      return { ok: true }
    case 'reject':
      await env.DB.batch([env.DB.prepare("UPDATE accounts SET status = 'rejected' WHERE phone = ?").bind(phone), endSessions])
      return { ok: true }
    case 'remove':
      await env.DB.batch([env.DB.prepare('DELETE FROM accounts WHERE phone = ?').bind(phone), endSessions])
      return { ok: true }
    case 'signout':
      await endSessions.run()
      return { ok: true }
    case 'email': {
      // Owner or full access adds / changes / removes a team member's login email (for sign-in,
      // password-reset codes and alerts). The owner's own email is changed only by the owner.
      const raw = String((body as { email?: unknown })?.email ?? '').trim()
      const { normEmail } = await import('./reader.ts')
      const email = raw ? normEmail(raw) : null
      if (raw && !email) throw new Error('Enter a valid email address.')
      if (email && (await env.DB.prepare('SELECT phone FROM accounts WHERE email = ? AND phone != ?').bind(email, phone).first())) throw new Error('This email is already used by another team login.')
      await env.DB.prepare('UPDATE accounts SET email = ? WHERE phone = ?').bind(email, phone).run()
      return { ok: true, email: email ?? '' }
    }
    case 'grant':
    case 'ungrant':
      await env.DB.prepare('UPDATE accounts SET role = ? WHERE phone = ?').bind(action === 'grant' ? 'admin' : 'editor', phone).run()
      return { ok: true }
    case 'reset': {
      const password = randomPassword()
      const { salt, hash } = await hashPassword(password, pepperOf(env))
      await env.DB.batch([env.DB.prepare('UPDATE accounts SET salt = ?, hash = ?, must_change = 1 WHERE phone = ?').bind(salt, hash, phone), endSessions, env.DB.prepare('DELETE FROM auth_fail WHERE k = ?').bind(`login:${phone}`)])
      return { password }
    }
  }
  throw new Error('Unknown action.')
}

/** Signed-in account changes its own password (other devices are logged out). */
export async function changePassword(env: Env, body: unknown, who: Who, token: string) {
  if (!who.phone) throw new Error('Log in with your mobile number to change your password.')
  const b = (body ?? {}) as { current?: unknown; next?: unknown }
  const a = await env.DB.prepare('SELECT * FROM accounts WHERE phone = ?').bind(who.phone).first<Account & { must_change?: number }>()
  if (!a) throw new Error('Account not found.')
  // Right after logging in with a temporary password the session itself proves who they are.
  const forced = a.must_change === 1
  if (!forced && (typeof b.current !== 'string' || !(await checkPassword(b.current, a, pepperOf(env))))) throw new Error('Your current password is not right.')
  const problem = passwordProblem(b.next)
  if (problem) throw new Error(problem)
  const { salt, hash } = await hashPassword(b.next as string, pepperOf(env))
  await env.DB.batch([
    env.DB.prepare('UPDATE accounts SET salt = ?, hash = ?, must_change = 0 WHERE phone = ?').bind(salt, hash, who.phone),
    env.DB.prepare('DELETE FROM sessions WHERE phone = ? AND token_hash != ?').bind(who.phone, await sha256hex(token)),
  ])
  return { ok: true }
}

/**
 * Delete my account (Google Play / App Store rule): mobile number + password, from the app or the
 * public delete-account page. Removes the login, its sessions and failed-login counts. Attendance,
 * leave, task and report entries are the company's work records and stay with the owner.
 * The owner's account is not deleted this way.
 */
export async function deleteAccount(env: Env, req: Request, body: unknown) {
  const b = (body ?? {}) as { phone?: unknown; password?: unknown }
  const phone = normPhone(b.phone)
  if (!phone || typeof b.password !== 'string' || !b.password) throw new Error('Enter your mobile number and password.')
  const phoneKey = `login:${phone}`
  const ipKey = `login-ip:${await sha256hex(ipOf(req))}`
  if ((await fails(env, phoneKey)) >= MAX_FAILS || (await fails(env, ipKey)) >= MAX_NETWORK_FAILS) throw new Error('Too many wrong tries. Wait an hour and try again.')
  const a = await env.DB.prepare('SELECT * FROM accounts WHERE phone = ?').bind(phone).first<Account>()
  if (!a || !(await checkPassword(b.password, a, pepperOf(env)))) {
    await Promise.all([addFail(env, phoneKey), addFail(env, ipKey)])
    throw new Error('Wrong mobile number or password.')
  }
  if (a.role === 'owner') throw new Error('The owner account can’t be deleted here. Please write to desk@realtynmore.com.')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE phone = ?').bind(phone),
    env.DB.prepare('DELETE FROM auth_fail WHERE k = ?').bind(phoneKey),
    env.DB.prepare('DELETE FROM accounts WHERE phone = ?').bind(phone),
  ])
  return { deleted: true }
}

/** True when the account still uses a password the owner gave them (they must choose their own). */
export async function mustChangePassword(env: Env, phone: string | undefined): Promise<boolean> {
  if (!phone) return false
  const r = await env.DB.prepare('SELECT must_change FROM accounts WHERE phone = ?').bind(phone).first<{ must_change: number | null }>()
  return r?.must_change === 1
}

/**
 * Owner or full access adds a staff login: name + mobile number. The account is active at once with a
 * temporary password, shown once to the owner; on first login the person must choose their own.
 */
export async function addStaffLogin(env: Env, body: unknown, who: Who) {
  if (!full(who)) throw new Error('Only the owner or full-access staff can add logins.')
  const b = (body ?? {}) as { name?: unknown; phone?: unknown; title?: unknown; start?: unknown; end?: unknown; admin?: unknown }
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : ''
  if (name.length < 2 || name.length > 40) throw new Error('Write the person’s name (2 to 40 characters).')
  const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
  const start = isTime(b.start) ? b.start : undefined
  const end = isTime(b.end) ? b.end : undefined
  const phone = normPhone(b.phone)
  if (!phone) throw new Error('Enter a valid 10-digit Indian mobile number.')
  const cur = await env.DB.prepare('SELECT name, status FROM accounts WHERE phone = ?').bind(phone).first<{ name: string; status: Status }>()
  if (cur) throw new Error(`${cur.name} already has a login on this number. Use “New password” on their account instead.`)
  const password = randomPassword()
  const { salt, hash } = await hashPassword(password, pepperOf(env))
  const now = new Date().toISOString()
  // Office time first, so a mistake (end before start) stops before the login is made.
  if (start || end) {
    const { teamSettings, cleanPeopleTimes } = await import('./team.ts')
    const s = await teamSettings(env)
    const people = { ...s.people, ...cleanPeopleTimes({ [`ph:${phone}`]: { start, end } }, s.startTime, s.endTime) }
    await env.SUBS.put('team:settings', JSON.stringify({ ...s, people }))
  }
  await env.DB.prepare("INSERT INTO accounts (phone, name, role, status, salt, hash, created_at, approved_at, must_change) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, 1)")
    .bind(phone, name, b.admin === true ? 'admin' : 'editor', salt, hash, now, now)
    .run()
  if (title)
    await env.DB.prepare('INSERT INTO profiles (person_id, title, photo, avatar, updated_at) VALUES (?, ?, \'\', \'\', ?) ON CONFLICT(person_id) DO UPDATE SET title = excluded.title')
      .bind(`ph:${phone}`, title, now)
      .run()
  return { name, phone, password }
}

/**
 * The same person with an old login key and a mobile login: moves the key's attendance, reports, tasks,
 * leave, office hours and profile to the account, then removes the key.
 */
export async function mergeKeyIntoAccount(env: Env, body: unknown, who: Who) {
  if (!full(who)) throw new Error('Only the owner or full-access staff can merge logins.')
  const b = (body ?? {}) as { keyId?: unknown; phone?: unknown }
  const keyId = typeof b.keyId === 'string' && /^[0-9a-f]{64}$/.test(b.keyId) ? b.keyId : null
  const phone = normPhone(b.phone)
  if (!keyId || !phone) throw new Error('Pick the login key and the account.')
  const key = await env.SUBS.get<{ name: string }>(`editor:${keyId}`, 'json')
  if (!key) throw new Error('That login key no longer exists.')
  const acc = await env.DB.prepare("SELECT name FROM accounts WHERE phone = ? AND status = 'active'").bind(phone).first<{ name: string }>()
  if (!acc) throw new Error('That account is not active.')
  const moved = await movePersonRecords(env, keyId, `ph:${phone}`, acc.name)
  await env.SUBS.delete(`editor:${keyId}`)
  return { ok: true, moved, name: acc.name }
}

/**
 * The same person under two team ids: moves attendance, reports, tasks, leave, profile and office hours
 * from `from` to `to`. A day both ids have keeps the `to` entry (the earlier login).
 */
export async function movePersonRecords(env: Env, from: string, to: string, name: string): Promise<number> {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM attendance WHERE person_id = ?1 AND day IN (SELECT day FROM attendance WHERE person_id = ?2)').bind(from, to),
    env.DB.prepare('UPDATE attendance SET person_id = ?2, name = ?3 WHERE person_id = ?1').bind(from, to, name),
    env.DB.prepare('DELETE FROM reports WHERE person_id = ?1 AND day IN (SELECT day FROM reports WHERE person_id = ?2)').bind(from, to),
    env.DB.prepare('UPDATE reports SET person_id = ?2, name = ?3 WHERE person_id = ?1').bind(from, to, name),
    env.DB.prepare('UPDATE tasks SET assignee_id = ?2, assignee_name = ?3 WHERE assignee_id = ?1').bind(from, to, name),
    env.DB.prepare('UPDATE leaves SET person_id = ?2, name = ?3 WHERE person_id = ?1').bind(from, to, name),
    env.DB.prepare('UPDATE profiles SET person_id = ?2 WHERE person_id = ?1 AND NOT EXISTS (SELECT 1 FROM profiles WHERE person_id = ?2)').bind(from, to),
    env.DB.prepare('DELETE FROM profiles WHERE person_id = ?1').bind(from),
  ])
  // Their own office hours move too, unless the target already has some.
  const { teamSettings } = await import('./team.ts')
  const s = await teamSettings(env)
  if (s.people?.[from]) {
    const people = { ...s.people }
    if (!people[to]) people[to] = people[from]
    delete people[from]
    await env.SUBS.put('team:settings', JSON.stringify({ ...s, people }))
  }
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0)
}

/**
 * Gives a login-key user a mobile number login. If the number already has a login, the key is merged
 * into it; otherwise a login is made with the key's name and a temporary password (shown once).
 */
export async function keyToMobile(env: Env, body: unknown, who: Who) {
  if (!full(who)) throw new Error('Only the owner or full-access staff can do this.')
  const b = (body ?? {}) as { keyId?: unknown; phone?: unknown }
  const keyId = typeof b.keyId === 'string' && /^[0-9a-f]{64}$/.test(b.keyId) ? b.keyId : null
  const phone = normPhone(b.phone)
  if (!keyId) throw new Error('Pick the login key.')
  if (!phone) throw new Error('Enter a valid 10-digit Indian mobile number.')
  const key = await env.SUBS.get<{ name: string }>(`editor:${keyId}`, 'json')
  if (!key) throw new Error('That login key no longer exists.')
  const acc = await env.DB.prepare('SELECT name, status FROM accounts WHERE phone = ?').bind(phone).first<{ name: string; status: Status }>()
  let password: string | undefined
  if (!acc) password = (await addStaffLogin(env, { name: key.name, phone }, who)).password
  else if (acc.status !== 'active') throw new Error(`The login on this number (${acc.name}) is not active. Approve it first.`)
  const merged = await mergeKeyIntoAccount(env, { keyId, phone }, who)
  return { ...merged, phone, created: !acc, password }
}
