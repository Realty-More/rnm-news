// Ad sales tracker (owner and full-access staff only).
//   Advertisers: the companies that buy ads (contact person, phone, email, GSTIN).
//   Deals: one sale, e.g. "Full page, Apr–Jun 2027 issue": medium, amount before GST, GST %,
//   stage (lead → proposal → negotiating → confirmed → running → completed, or lost),
//   next follow-up date, invoice number and payment due date.
//   Payments: money received against a deal; the balance is the deal total (with GST) minus payments.
// Amounts are whole rupees. Days are IST dates (YYYY-MM-DD).
import type { Env } from './index.ts'
import type { Who } from './owner.ts'

const IST_MS = 5.5 * 3600000
export const istToday = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10)
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+\n/g, '\n').trim().slice(0, max) : '')
const idOf = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null)

export const STAGES = ['lead', 'proposal', 'negotiating', 'confirmed', 'running', 'completed', 'lost'] as const
export type Stage = (typeof STAGES)[number]
/** Stages where the sale is agreed and money is owed. */
export const BOOKED: readonly Stage[] = ['confirmed', 'running', 'completed']
export const OPEN: readonly Stage[] = ['lead', 'proposal', 'negotiating']
export const MEDIUMS = ['magazine', 'website', 'sponsored', 'video', 'event', 'social', 'other'] as const
const MODES = ['bank', 'upi', 'cheque', 'cash', 'other'] as const

export interface Deal {
  id: number
  client_id: number
  title: string
  medium: string
  period: string
  amount: number
  gst_pct: number
  stage: Stage
  handled_by: string
  next_date: string | null
  next_action: string
  invoice_no: string
  due_day: string | null
  notes: string
  created_by: string
  created_at: string
  updated_at: string
  received?: number
}

/** Deal value with GST, rounded to the rupee. */
export const totalWithGst = (d: Pick<Deal, 'amount' | 'gst_pct'>) => Math.round(d.amount * (1 + d.gst_pct / 100))

/** What is still owed on a booked deal (0 for leads and lost deals). */
export function balanceOf(d: Pick<Deal, 'amount' | 'gst_pct' | 'stage'> & { received?: number }): number {
  if (!BOOKED.includes(d.stage)) return 0
  return Math.max(0, totalWithGst(d) - (d.received ?? 0))
}

/** Indian financial year of a day: "2026-10-27" → "2026-27". */
export function fyOf(day: string): string {
  const y = Number(day.slice(0, 4))
  const start = Number(day.slice(5, 7)) >= 4 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** Follow-ups due (open deals with a follow-up date today or earlier) and overdue payments. */
export function dueToday(deals: Deal[], day = istToday()) {
  const followUps = deals.filter((d) => (OPEN.includes(d.stage) || d.stage === 'confirmed' || d.stage === 'running') && d.next_date && d.next_date <= day)
  const overdue = deals.filter((d) => d.due_day && d.due_day < day && balanceOf(d) > 0)
  return { followUps, overdue, overdueAmount: overdue.reduce((s, d) => s + balanceOf(d), 0) }
}

/** One line for the 9 AM morning brief, or null when nothing needs attention. */
export function adsBriefLine(deals: Deal[], day = istToday()): string | null {
  const { followUps, overdue, overdueAmount } = dueToday(deals, day)
  if (!followUps.length && !overdue.length) return null
  const parts: string[] = []
  if (followUps.length) parts.push(`${followUps.length} ad follow-up${followUps.length > 1 ? 's' : ''} due`)
  if (overdue.length) parts.push(`₹${overdueAmount.toLocaleString('en-IN')} ad payment overdue`)
  return `Ads: ${parts.join(', ')}.`
}

async function dealsWithReceived(env: Env): Promise<Deal[]> {
  const { results } = await env.DB.prepare(
    'SELECT d.*, COALESCE((SELECT SUM(p.amount) FROM ad_payments p WHERE p.deal_id = d.id), 0) AS received FROM ad_deals d ORDER BY d.updated_at DESC LIMIT 3000',
  ).all<Deal>()
  return results
}

/** Everything the Ad sales screen needs in one go (a small company's book fits easily). */
export async function adsBook(env: Env) {
  const [clients, deals, payments] = await Promise.all([
    env.DB.prepare('SELECT * FROM ad_clients ORDER BY name COLLATE NOCASE LIMIT 3000').all(),
    dealsWithReceived(env),
    env.DB.prepare('SELECT * FROM ad_payments ORDER BY day DESC, id DESC LIMIT 5000').all(),
  ])
  return { today: istToday(), clients: clients.results, deals, payments: payments.results }
}

export async function adsBrief(env: Env): Promise<string | null> {
  return adsBriefLine(await dealsWithReceived(env))
}

/* ---------- advertisers ---------- */

export async function saveClient(env: Env, body: unknown, who: Who) {
  const b = (body ?? {}) as Record<string, unknown>
  const name = text(b.name, 120)
  if (name.length < 2) throw new Error('Write the advertiser (company) name.')
  const phone = text(b.phone, 40)
  const email = text(b.email, 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email address does not look right.')
  const gstin = text(b.gstin, 15).toUpperCase()
  if (gstin && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) throw new Error('GSTIN should be 15 letters and numbers.')
  const now = new Date().toISOString()
  const vals = [name, text(b.contact, 80), phone, email, text(b.city, 60), gstin, text(b.notes, 1000)]
  const id = idOf(b.id)
  if (id) {
    await env.DB.prepare('UPDATE ad_clients SET name = ?, contact = ?, phone = ?, email = ?, city = ?, gstin = ?, notes = ?, updated_at = ? WHERE id = ?')
      .bind(...vals, now, id)
      .run()
    return { id }
  }
  const dup = await env.DB.prepare('SELECT id FROM ad_clients WHERE name = ? COLLATE NOCASE').bind(name).first<{ id: number }>()
  if (dup) throw new Error('This advertiser is already in the list.')
  const r = await env.DB.prepare('INSERT INTO ad_clients (name, contact, phone, email, city, gstin, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(...vals, who.name, now, now)
    .run()
  return { id: r.meta.last_row_id }
}

export async function removeClient(env: Env, body: unknown) {
  const id = idOf((body as { id?: unknown })?.id)
  if (!id) throw new Error('Pick an advertiser.')
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM ad_deals WHERE client_id = ?').bind(id).first<{ n: number }>()
  if (used?.n) throw new Error('This advertiser has deals. Remove those deals first.')
  await env.DB.prepare('DELETE FROM ad_clients WHERE id = ?').bind(id).run()
  return { ok: true }
}

/* ---------- deals ---------- */

export async function saveDeal(env: Env, body: unknown, who: Who) {
  const b = (body ?? {}) as Record<string, unknown>
  const clientId = idOf(b.clientId)
  if (!clientId || !(await env.DB.prepare('SELECT id FROM ad_clients WHERE id = ?').bind(clientId).first())) throw new Error('Pick the advertiser.')
  const title = text(b.title, 140)
  if (title.length < 3) throw new Error('Write what is being sold, e.g. Full page ad, Apr–Jun issue.')
  const medium = (MEDIUMS as readonly string[]).includes(String(b.medium)) ? String(b.medium) : 'other'
  const amount = Math.round(Number(b.amount))
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) throw new Error('Enter the amount in rupees (before GST).')
  const gst = Number(b.gstPct ?? 18)
  if (![0, 5, 12, 18, 28].includes(gst)) throw new Error('GST should be 0, 5, 12, 18 or 28%.')
  const stage = (STAGES as readonly string[]).includes(String(b.stage)) ? (String(b.stage) as Stage) : 'lead'
  const now = new Date().toISOString()
  const vals = [
    clientId,
    title,
    medium,
    text(b.period, 80),
    amount,
    gst,
    stage,
    text(b.handledBy, 60) || who.name,
    isDay(b.nextDate) ? b.nextDate : null,
    text(b.nextAction, 200),
    text(b.invoiceNo, 40),
    isDay(b.dueDay) ? b.dueDay : null,
    text(b.notes, 2000),
  ]
  const id = idOf(b.id)
  if (id) {
    await env.DB.prepare(
      'UPDATE ad_deals SET client_id = ?, title = ?, medium = ?, period = ?, amount = ?, gst_pct = ?, stage = ?, handled_by = ?, next_date = ?, next_action = ?, invoice_no = ?, due_day = ?, notes = ?, updated_at = ? WHERE id = ?',
    )
      .bind(...vals, now, id)
      .run()
    return { id }
  }
  const r = await env.DB.prepare(
    'INSERT INTO ad_deals (client_id, title, medium, period, amount, gst_pct, stage, handled_by, next_date, next_action, invoice_no, due_day, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(...vals, who.name, now, now)
    .run()
  return { id: r.meta.last_row_id }
}

/** Quick changes from the list: move to a stage, or set the next follow-up. */
export async function updateDeal(env: Env, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const id = idOf(b.id)
  if (!id) throw new Error('Pick a deal.')
  const now = new Date().toISOString()
  if (b.stage !== undefined) {
    if (!(STAGES as readonly string[]).includes(String(b.stage))) throw new Error('Unknown stage.')
    // A lost or completed deal needs no more follow-ups.
    const clear = b.stage === 'lost' || b.stage === 'completed'
    await env.DB.prepare(`UPDATE ad_deals SET stage = ?, updated_at = ?${clear ? ', next_date = NULL' : ''} WHERE id = ?`).bind(String(b.stage), now, id).run()
  }
  if (b.nextDate !== undefined) {
    await env.DB.prepare('UPDATE ad_deals SET next_date = ?, next_action = COALESCE(?, next_action), updated_at = ? WHERE id = ?')
      .bind(isDay(b.nextDate) ? b.nextDate : null, b.nextAction === undefined ? null : text(b.nextAction, 200), now, id)
      .run()
  }
  return { ok: true }
}

export async function removeDeal(env: Env, body: unknown) {
  const id = idOf((body as { id?: unknown })?.id)
  if (!id) throw new Error('Pick a deal.')
  await env.DB.batch([env.DB.prepare('DELETE FROM ad_payments WHERE deal_id = ?').bind(id), env.DB.prepare('DELETE FROM ad_deals WHERE id = ?').bind(id)])
  return { ok: true }
}

/* ---------- payments ---------- */

export async function addPayment(env: Env, body: unknown, who: Who) {
  const b = (body ?? {}) as Record<string, unknown>
  const dealId = idOf(b.dealId)
  const deal = dealId ? await env.DB.prepare('SELECT id FROM ad_deals WHERE id = ?').bind(dealId).first() : null
  if (!deal) throw new Error('Pick the deal this payment is for.')
  const amount = Math.round(Number(b.amount))
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new Error('Enter the amount received in rupees.')
  const day = isDay(b.day) ? b.day : istToday()
  if (day > istToday()) throw new Error('The payment date can’t be in the future.')
  const mode = (MODES as readonly string[]).includes(String(b.mode)) ? String(b.mode) : 'bank'
  const r = await env.DB.prepare('INSERT INTO ad_payments (deal_id, day, amount, mode, ref, note, by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(dealId, day, amount, mode, text(b.ref, 60), text(b.note, 300), who.name, new Date().toISOString())
    .run()
  await env.DB.prepare('UPDATE ad_deals SET updated_at = ? WHERE id = ?').bind(new Date().toISOString(), dealId).run()
  return { id: r.meta.last_row_id }
}

export async function removePayment(env: Env, body: unknown) {
  const id = idOf((body as { id?: unknown })?.id)
  if (!id) throw new Error('Pick a payment.')
  await env.DB.prepare('DELETE FROM ad_payments WHERE id = ?').bind(id).run()
  return { ok: true }
}
