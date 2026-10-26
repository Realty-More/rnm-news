// Magazine mailing list: the company's address book for the quarterly print issue.
// Private: only owner and team keys reach these routes; nothing here is cached or public.
import type { Env } from './index.ts'
import type { Who } from './owner.ts'

export interface Contact {
  id: number
  name: string
  designation: string | null
  company: string | null
  address: string | null
  city: string | null
  pin: string | null
  phone: string | null
  email: string | null
  remark: string | null
}

export type Status = 'pending' | 'sent' | 'delivered' | 'returned'
const STATUSES: Status[] = ['pending', 'sent', 'delivered', 'returned']

// Longer names first, so "Greater Noida" wins over "Noida" and "Navi Mumbai" over "Mumbai".
const CITIES: [RegExp, string][] = (
  [
    ['Greater Noida', 'Greater Noida'], ['Navi Mumbai', 'Navi Mumbai'], ['New Delhi', 'Delhi'], ['Gurugram|Gurgaon|Gurgoan', 'Gurugram'], ['Gautam Buddha Nagar', 'Noida'], ['Sainik Farms?', 'Delhi'], ['Sahibzada Ajit Singh Nagar', 'Mohali'],
    ['Noida', 'Noida'], ['Ghaziabad', 'Ghaziabad'], ['Faridabad', 'Faridabad'], ['Sonipat|Sonepat', 'Sonipat'], ['Delhi', 'Delhi'],
    ['Mumbai|Bombay', 'Mumbai'], ['Thane', 'Thane'], ['Pune', 'Pune'], ['Bengaluru|Bangalore|Bengluru', 'Bengaluru'], ['Hyderabad|Secunderabad', 'Hyderabad'],
    ['Chennai', 'Chennai'], ['Kolkata', 'Kolkata'], ['Ahmedabad', 'Ahmedabad'], ['Lucknow', 'Lucknow'], ['Jaipur', 'Jaipur'],
    ['Mohali', 'Mohali'], ['Chandigarh', 'Chandigarh'], ['Panchkula', 'Panchkula'], ['Dehradun', 'Dehradun'], ['Goa', 'Goa'],
    ['Indore', 'Indore'], ['Bhopal', 'Bhopal'], ['Kochi|Cochin', 'Kochi'], ['Surat', 'Surat'], ['Vadodara|Baroda', 'Vadodara'], ['Rajkot', 'Rajkot'], ['Nagpur', 'Nagpur'],
    ['Meerut', 'Meerut'], ['Bathinda', 'Bathinda'], ['Dubai', 'Dubai'],
  ] as const
).map(([re, name]) => [new RegExp(`\\b(${re})\\b`, 'i'), name])

/** City named in an address ("…Sector 43, Gurgaon" → "Gurugram"), or null. */
export function cityOf(address: string): string | null {
  for (const [re, name] of CITIES) if (re.test(address)) return name
  return null
}

/** Six-digit Indian PIN code, also written "122 001" or "122-001". */
export function pinOf(address: string): string | null {
  const m = /\b(\d{3})[\s-]?(\d{3})\b(?!\d)/.exec(address.replace(/\+91[\s\d-]{10,}/g, ''))
  return m && /^[1-9]/.test(m[1]) ? m[1] + m[2] : null
}

const clean = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : ''
  return s || null
}

/** Validates a contact from the app; fills city and PIN from the address when left empty. */
export function cleanContact(body: unknown): Omit<Contact, 'id'> & { id: number | null } {
  const b = (body ?? {}) as Record<string, unknown>
  const name = clean(b.name, 120)
  if (!name) throw new Error('Name is required.')
  const address = clean(b.address, 400)
  return {
    id: Number.isInteger(b.id) && (b.id as number) > 0 ? (b.id as number) : null,
    name,
    designation: clean(b.designation, 120),
    company: clean(b.company, 160),
    address,
    city: clean(b.city, 60) ?? (address ? cityOf(address) : null),
    pin: clean(b.pin, 6) ?? (address ? pinOf(address) : null),
    phone: clean(b.phone, 60),
    email: clean(b.email, 120),
    remark: clean(b.remark, 300),
  }
}

/** Quarter id and label, e.g. "2026-Q4" / "Oct–Dec 2026". */
export function quarterOf(d = new Date()): { id: string; title: string } {
  const ist = new Date(d.getTime() + 5.5 * 3600000)
  const q = Math.floor(ist.getUTCMonth() / 3) + 1
  const y = ist.getUTCFullYear()
  const months = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][q - 1]
  return { id: `${y}-Q${q}`, title: `${months} ${y}` }
}

export async function magazineBook(env: Env) {
  const current = quarterOf()
  await env.DB.prepare('INSERT OR IGNORE INTO mag_issues (id, title, created_at) VALUES (?, ?, ?)').bind(current.id, current.title, new Date().toISOString()).run()
  const [{ results: contacts }, { results: issues }] = await Promise.all([
    env.DB.prepare('SELECT id, name, designation, company, address, city, pin, phone, email, remark FROM contacts WHERE active = 1 ORDER BY company IS NULL, company COLLATE NOCASE, name COLLATE NOCASE').all<Contact>(),
    env.DB.prepare(
      `SELECT i.id, i.title, COUNT(d.contact_id) AS marked,
        SUM(d.status = 'sent') AS sent, SUM(d.status = 'delivered') AS delivered, SUM(d.status = 'returned') AS returned
       FROM mag_issues i LEFT JOIN mag_dispatch d ON d.issue_id = i.id GROUP BY i.id ORDER BY i.id DESC`,
    ).all<{ id: string; title: string; marked: number; sent: number; delivered: number; returned: number }>(),
  ])
  return { contacts, issues, current: current.id }
}

export async function dispatchOf(env: Env, issue: string) {
  const { results } = await env.DB.prepare('SELECT contact_id AS id, status, courier, tracking, by_name AS byName, updated_at AS at FROM mag_dispatch WHERE issue_id = ?')
    .bind(issue)
    .all<{ id: number; status: Status; courier: string | null; tracking: string | null; byName: string | null; at: string }>()
  return { issue, rows: results }
}

export async function saveContact(env: Env, body: unknown, who: Who) {
  const c = cleanContact(body)
  const now = new Date().toISOString()
  if (c.id) {
    const r = await env.DB.prepare(
      'UPDATE contacts SET name = ?, designation = ?, company = ?, address = ?, city = ?, pin = ?, phone = ?, email = ?, remark = ?, updated_at = ?, updated_by = ? WHERE id = ? AND active = 1',
    )
      .bind(c.name, c.designation, c.company, c.address, c.city, c.pin, c.phone, c.email, c.remark, now, who.name, c.id)
      .run()
    if (!r.meta.changes) throw new Error('Contact not found.')
    return { id: c.id }
  }
  const r = await env.DB.prepare(
    'INSERT INTO contacts (name, designation, company, address, city, pin, phone, email, remark, active, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
  )
    .bind(c.name, c.designation, c.company, c.address, c.city, c.pin, c.phone, c.email, c.remark, now, now, who.name)
    .run()
  return { id: r.meta.last_row_id }
}

/** Owner only. Kept in the database (inactive) so past dispatch records still make sense. */
export async function removeContact(env: Env, id: number, who: Who) {
  await env.DB.prepare('UPDATE contacts SET active = 0, updated_at = ?, updated_by = ? WHERE id = ?').bind(new Date().toISOString(), who.name, id).run()
  return { ok: true }
}

export async function createIssue(env: Env, body: unknown) {
  const b = (body ?? {}) as { id?: unknown; title?: unknown }
  const id = typeof b.id === 'string' && /^\d{4}-Q[1-4]$/.test(b.id) ? b.id : null
  if (!id) throw new Error('Pick a quarter like 2027-Q1.')
  const title = clean(b.title, 80) ?? id
  await env.DB.prepare('INSERT OR IGNORE INTO mag_issues (id, title, created_at) VALUES (?, ?, ?)').bind(id, title, new Date().toISOString()).run()
  return { id }
}

/** Marks many contacts at once (e.g. "all Gurugram contacts: sent by DTDC"). */
export async function setDispatch(env: Env, body: unknown, who: Who) {
  const b = (body ?? {}) as { issue?: unknown; ids?: unknown; status?: unknown; courier?: unknown; tracking?: unknown }
  const issue = typeof b.issue === 'string' && /^\d{4}-Q[1-4]$/.test(b.issue) ? b.issue : null
  const status = STATUSES.includes(b.status as Status) ? (b.status as Status) : null
  const ids = Array.isArray(b.ids) ? b.ids.filter((n): n is number => Number.isInteger(n) && n > 0).slice(0, 1000) : []
  if (!issue || !status || ids.length === 0) throw new Error('Choose an issue, a status and at least one contact.')
  const exists = await env.DB.prepare('SELECT id FROM mag_issues WHERE id = ?').bind(issue).first()
  if (!exists) throw new Error('That issue does not exist yet.')
  const now = new Date().toISOString()
  const courier = clean(b.courier, 60)
  const tracking = ids.length === 1 ? clean(b.tracking, 60) : null
  const stmts = ids.map((id) =>
    status === 'pending'
      ? env.DB.prepare('DELETE FROM mag_dispatch WHERE issue_id = ? AND contact_id = ?').bind(issue, id)
      : env.DB.prepare(
          `INSERT INTO mag_dispatch (issue_id, contact_id, status, courier, tracking, by_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(issue_id, contact_id) DO UPDATE SET status = excluded.status, courier = COALESCE(excluded.courier, mag_dispatch.courier),
             tracking = COALESCE(excluded.tracking, mag_dispatch.tracking), by_name = excluded.by_name, updated_at = excluded.updated_at`,
        ).bind(issue, id, status, courier, tracking, who.name, now),
  )
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100))
  return { updated: ids.length }
}
