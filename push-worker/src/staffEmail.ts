// Team logins with an email (added later by the team member in R&M Newsroom → My profile):
//   • sign in with the email or the mobile number, same password;
//   • forgot password: a 6-digit code to that email (Brevo), valid 20 minutes, 5 tries;
//     setting a new password signs out other devices and opens the Newsroom.
// Changing the email asks for the current password, so a borrowed phone can't take over the login.
// Without an email, the owner still sets a new password from Employees, as before.
import type { Env } from './index.ts'
import { addFail, fails, hashPassword, ipOf, normPhone, passwordProblem, pepperOf, unb64, b64 } from './accounts.ts'
import { normEmail } from './reader.ts'
import { sameKey, sha256hex, type Who } from './owner.ts'

const RESET_MIN = 20
const SESSION_DAYS = 180
const DAY = 86400000

interface StaffRow {
  phone: string
  name: string
  role: 'owner' | 'admin' | 'editor'
  status: string
  salt: string
  hash: string
  email: string | null
  reset_hash: string | null
  reset_expires: string | null
  reset_tries: number | null
}

const checkPassword = async (env: Env, pw: string, a: StaffRow) => sameKey((await hashPassword(pw, pepperOf(env), unb64(a.salt))).hash, a.hash)

/** The team login for a mobile number or an email, or null. */
export async function staffById(env: Env, id: unknown): Promise<StaffRow | null> {
  const s = String(id ?? '').trim()
  if (s.includes('@')) {
    const email = normEmail(s)
    return email ? env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first<StaffRow>() : null
  }
  const phone = normPhone(s)
  return phone ? env.DB.prepare('SELECT * FROM accounts WHERE phone = ?').bind(phone).first<StaffRow>() : null
}

export async function myEmail(env: Env, who: Who) {
  if (!who.phone) return { email: '', canChange: false }
  const r = await env.DB.prepare('SELECT email FROM accounts WHERE phone = ?').bind(who.phone).first<{ email: string | null }>()
  return { email: r?.email ?? '', canChange: true }
}

/** Adds, changes or removes the email on my team login (current password needed). */
export async function setMyEmail(env: Env, who: Who, body: unknown) {
  if (!who.phone) throw new Error('Log in with your mobile number to add an email.')
  const b = (body ?? {}) as { email?: unknown; password?: unknown }
  const a = await env.DB.prepare('SELECT * FROM accounts WHERE phone = ?').bind(who.phone).first<StaffRow>()
  if (!a) throw new Error('Account not found.')
  if (typeof b.password !== 'string' || !(await checkPassword(env, b.password, a))) throw new Error('Your password is not right.')
  const raw = String(b.email ?? '').trim()
  const email = raw ? normEmail(raw) : null
  if (raw && !email) throw new Error('Enter a valid email address.')
  if (email && email !== a.email && (await env.DB.prepare('SELECT phone FROM accounts WHERE email = ?').bind(email).first())) throw new Error('This email is already used by another team login.')
  await env.DB.prepare('UPDATE accounts SET email = ? WHERE phone = ?').bind(email, who.phone).run()
  return { ok: true, email: email ?? '' }
}

/** Sends a reset code to the team login's email. `matched` tells the app to use the team reset. */
export async function staffForgot(env: Env, req: Request, body: unknown) {
  const id = (body as { id?: unknown })?.id
  const ipKey = `sforgot:${await sha256hex(ipOf(req))}`
  if ((await fails(env, ipKey)) >= 10) throw new Error('Too many codes asked for. Please try again in an hour.')
  const a = await staffById(env, id)
  if (!a || a.status !== 'active') return { matched: false, sent: false }
  if ((await fails(env, `sforgot:${a.phone}`)) >= 4) throw new Error('Too many codes asked for. Please try again in an hour.')
  await Promise.all([addFail(env, ipKey), addFail(env, `sforgot:${a.phone}`)])
  if (!a.email) return { matched: true, sent: false }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
  await env.DB.prepare('UPDATE accounts SET reset_hash = ?, reset_expires = ?, reset_tries = 0 WHERE phone = ?')
    .bind(await sha256hex(`staff:${a.phone}:${code}`), new Date(Date.now() + RESET_MIN * 60000).toISOString(), a.phone)
    .run()
  const { sendRaw } = await import('./newsletter.ts')
  const name = a.name.replace(/[<>&"]/g, '')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#141416"><p style="font:700 12px Arial;letter-spacing:2px;color:#A87412;text-transform:uppercase">R&amp;M Newsroom</p><h1 style="font:400 26px Georgia,serif;margin:8px 0 12px">Your password reset code</h1><p>Hi ${name}, use this code on the Realtynmore Sign in page to set a new team password:</p><p style="font:700 34px/1 'Courier New',monospace;letter-spacing:8px;background:#F7F6F2;border-radius:8px;padding:16px;text-align:center">${code}</p><p style="color:#6B6B70;font-size:13px">It works for ${RESET_MIN} minutes. If you did not ask for this, tell Palash sir and ignore this email.</p></div>`
  await sendRaw(env, { to: a.email, subject: `${code} is your R&M Newsroom reset code`, html, text: `Your R&M Newsroom password reset code: ${code}\nIt works for ${RESET_MIN} minutes.`, tag: 'staff-reset' }).catch(() => null)
  return { matched: true, sent: true }
}

/** Checks the code, sets the new password, signs out other devices and logs in here. */
export async function staffReset(env: Env, req: Request, body: unknown) {
  const b = (body ?? {}) as { id?: unknown; code?: unknown; password?: unknown }
  const code = String(b.code ?? '').replace(/\D/g, '')
  const a = await staffById(env, b.id)
  if (!a || a.status !== 'active') throw new Error('No team login for this email or number.')
  if (code.length !== 6) throw new Error('Enter the 6-digit code.')
  const problem = passwordProblem(b.password)
  if (problem) throw new Error(problem)
  if (!a.reset_hash || !a.reset_expires || Date.parse(a.reset_expires) < Date.now() || (a.reset_tries ?? 0) >= 5) throw new Error('This code has expired. Ask for a new one.')
  if (!sameKey(await sha256hex(`staff:${a.phone}:${code}`), a.reset_hash)) {
    await env.DB.prepare('UPDATE accounts SET reset_tries = COALESCE(reset_tries, 0) + 1 WHERE phone = ?').bind(a.phone).run()
    throw new Error('That code is not right.')
  }
  const { salt, hash } = await hashPassword(b.password as string, pepperOf(env))
  const token = `s_${b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('UPDATE accounts SET salt = ?, hash = ?, must_change = 0, reset_hash = NULL, reset_expires = NULL, reset_tries = 0, last_login = ? WHERE phone = ?').bind(salt, hash, new Date(now).toISOString(), a.phone),
    env.DB.prepare('DELETE FROM sessions WHERE phone = ?').bind(a.phone),
    env.DB.prepare('INSERT INTO sessions (token_hash, phone, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256hex(token), a.phone, new Date(now).toISOString(), new Date(now + SESSION_DAYS * DAY).toISOString()),
  ])
  void req
  const reader = await import('./staffAccess.ts').then((m) => m.readerForStaff(env, a.phone)).catch(() => null)
  return { token, role: a.role, name: a.name, reader }
}

/* ---------- the owner's own mobile login ---------- */
// Palash sir has always used the owner key. While logged in with it, My profile lets him add a mobile
// number, an email (optional) and his own password; after that he can sign in with the number (or the
// email) like the team, and "Forgot password?" sends a code to the email. The key keeps working.
// Only a key login can set this up: the key itself proves it is the owner.

interface OwnerRow {
  phone: string
  email: string | null
}

export async function ownerLogin(env: Env, who: Who) {
  if (who.role !== 'owner') return { can: false }
  const r = await env.DB.prepare("SELECT phone, email FROM accounts WHERE role = 'owner' ORDER BY created_at LIMIT 1").first<OwnerRow>()
  return { can: true, viaKey: !who.phone, phone: r?.phone ?? '', email: r?.email ?? '' }
}

export async function setOwnerLogin(env: Env, who: Who, body: unknown) {
  if (who.role !== 'owner') throw new Error('Only the owner can do this.')
  if (who.phone) throw new Error('You already sign in with your mobile number. Change your password or email from the Account menu.')
  const b = (body ?? {}) as { phone?: unknown; email?: unknown; password?: unknown }
  const phone = normPhone(b.phone)
  if (!phone) throw new Error('Enter a valid 10-digit Indian mobile number.')
  const raw = String(b.email ?? '').trim()
  const email = raw ? normEmail(raw) : null
  if (raw && !email) throw new Error('Enter a valid email address.')
  const problem = passwordProblem(b.password)
  if (problem) throw new Error(problem)
  const cur = await env.DB.prepare("SELECT phone, email FROM accounts WHERE role = 'owner' ORDER BY created_at LIMIT 1").first<OwnerRow>()
  const taken = await env.DB.prepare("SELECT name FROM accounts WHERE phone = ? AND role != 'owner'").bind(phone).first<{ name: string }>()
  if (taken) throw new Error(`This number is already ${taken.name}’s team login. Use another number.`)
  if (email && (await env.DB.prepare("SELECT name FROM accounts WHERE email = ? AND role != 'owner'").bind(email).first())) throw new Error('This email is already used by a team login.')
  const { salt, hash } = await hashPassword(b.password as string, pepperOf(env))
  const now = new Date().toISOString()
  const { OWNER_NAME } = await import('./owner.ts')
  if (cur)
    await env.DB.batch([
      // A new number or password signs the old mobile logins out.
      env.DB.prepare('DELETE FROM sessions WHERE phone = ?').bind(cur.phone),
      env.DB.prepare("UPDATE accounts SET phone = ?, email = ?, salt = ?, hash = ?, status = 'active', must_change = 0 WHERE phone = ? AND role = 'owner'").bind(phone, email, salt, hash, cur.phone),
      env.DB.prepare('DELETE FROM auth_fail WHERE k = ?').bind(`login:${phone}`),
    ])
  else
    await env.DB.batch([
      env.DB.prepare("INSERT INTO accounts (phone, name, role, status, salt, hash, email, created_at, approved_at, must_change) VALUES (?, ?, 'owner', 'active', ?, ?, ?, ?, ?, 0)").bind(phone, OWNER_NAME, salt, hash, email, now, now),
      env.DB.prepare('DELETE FROM auth_fail WHERE k = ?').bind(`login:${phone}`),
    ])
  return { ok: true, phone, email: email ?? '' }
}
