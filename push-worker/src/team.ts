// Team attendance and daily work reports (Cloudflare D1 + KV, free plan).
// Employees use their editor key: they check in/out themselves and write a daily report.
// The owner sees everyone's day, monthly attendance and a CSV export. Nothing is tracked in the background.
import { deliver, isValidSubscription, subKey, type StoredSub } from './push.ts'
import { listEditors, type Who } from './owner.ts'
import type { Env } from './index.ts'

export interface TeamSettings {
  startTime: string // "10:00" IST
  graceMin: number
  reminderTime: string // "18:30" IST, report reminder
}
const DEFAULTS: TeamSettings = { startTime: '10:00', graceMin: 15, reminderTime: '18:30' }
const MODES = ['office', 'remote', 'field'] as const
type Mode = (typeof MODES)[number]

const IST_MS = 5.5 * 3600000
export const istDay = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10)
/** "HH:MM" in IST for an ISO timestamp. */
export const istClock = (iso: string) => new Date(Date.parse(iso) + IST_MS).toISOString().slice(11, 16)
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Late if the IST check-in time is after start + grace. */
export function isLate(checkIn: string | null, s: TeamSettings): boolean {
  if (!checkIn) return false
  return toMin(istClock(checkIn)) > toMin(s.startTime) + s.graceMin
}

/** Worked minutes between check-in and check-out (or now if still in, same day only). */
export function workedMinutes(checkIn: string | null, checkOut: string | null, now = Date.now()): number {
  if (!checkIn) return 0
  const end = checkOut ? Date.parse(checkOut) : istDay(now) === istDay(Date.parse(checkIn)) ? now : Date.parse(checkIn)
  return Math.max(0, Math.round((end - Date.parse(checkIn)) / 60000))
}

export async function teamSettings(env: Env): Promise<TeamSettings> {
  return { ...DEFAULTS, ...((await env.SUBS.get<Partial<TeamSettings>>('team:settings', 'json')) ?? {}) }
}

export async function saveTeamSettings(env: Env, body: unknown) {
  const b = (body ?? {}) as Partial<TeamSettings>
  const time = (v: unknown, d: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d)
  const cur = await teamSettings(env)
  const next: TeamSettings = {
    startTime: time(b.startTime, cur.startTime),
    graceMin: Number.isInteger(b.graceMin) && (b.graceMin as number) >= 0 && (b.graceMin as number) <= 120 ? (b.graceMin as number) : cur.graceMin,
    reminderTime: time(b.reminderTime, cur.reminderTime),
  }
  await env.SUBS.put('team:settings', JSON.stringify(next))
  return { ok: true, settings: next }
}

const personId = (who: Who) => who.id ?? 'owner'

interface Att {
  person_id: string
  name: string
  day: string
  check_in: string | null
  check_out: string | null
  mode: string | null
  note: string | null
}
interface Rep {
  person_id: string
  name: string
  day: string
  done: string
  plan: string
  blockers: string
  links: string
  submitted_at: string
}

/* ---------- employee: my day ---------- */
export async function myToday(env: Env, who: Who) {
  const day = istDay()
  const id = personId(who)
  const [att, rep, settings] = await Promise.all([
    env.DB.prepare('SELECT * FROM attendance WHERE person_id = ?1 AND day = ?2').bind(id, day).first<Att>(),
    env.DB.prepare('SELECT * FROM reports WHERE person_id = ?1 AND day = ?2').bind(id, day).first<Rep>(),
    teamSettings(env),
  ])
  return { day, name: who.name, attendance: att, report: rep, settings, late: isLate(att?.check_in ?? null, settings), minutes: workedMinutes(att?.check_in ?? null, att?.check_out ?? null) }
}

export async function checkIn(env: Env, who: Who, body: unknown) {
  const b = (body ?? {}) as { mode?: unknown; note?: unknown }
  const mode: Mode = MODES.includes(b.mode as Mode) ? (b.mode as Mode) : 'office'
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 140) : ''
  const now = new Date().toISOString()
  // First check-in of the day wins; a repeated tap doesn't move the time.
  await env.DB.prepare('INSERT INTO attendance (person_id, name, day, check_in, mode, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(person_id, day) DO NOTHING')
    .bind(personId(who), who.name, istDay(), now, mode, note)
    .run()
  return myToday(env, who)
}

export async function checkOut(env: Env, who: Who) {
  const r = await env.DB.prepare('UPDATE attendance SET check_out = ?1 WHERE person_id = ?2 AND day = ?3 AND check_in IS NOT NULL')
    .bind(new Date().toISOString(), personId(who), istDay())
    .run()
  if (!r.meta.changes) return { ok: false, error: 'Check in first.' }
  return { ok: true, ...(await myToday(env, who)) }
}

export function cleanReport(body: unknown): { done: string; plan: string; blockers: string; links: string } | string {
  const b = (body ?? {}) as Record<string, unknown>
  const t = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const done = t(b.done, 2000)
  if (done.length < 3) return 'Write what you worked on today.'
  return { done, plan: t(b.plan, 1000), blockers: t(b.blockers, 600), links: t(b.links, 1000) }
}

export async function submitReport(env: Env, who: Who, body: unknown) {
  const r = cleanReport(body)
  if (typeof r === 'string') return { ok: false, error: r }
  await env.DB.prepare(
    'INSERT INTO reports (person_id, name, day, done, plan, blockers, links, submitted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(person_id, day) DO UPDATE SET done = ?4, plan = ?5, blockers = ?6, links = ?7, submitted_at = ?8, name = ?2',
  )
    .bind(personId(who), who.name, istDay(), r.done, r.plan, r.blockers, r.links, new Date().toISOString())
    .run()
  return { ok: true, ...(await myToday(env, who)) }
}

export async function myHistory(env: Env, who: Who) {
  const since = istDay(Date.now() - 30 * 86400000)
  const id = personId(who)
  const settings = await teamSettings(env)
  const att = await env.DB.prepare('SELECT * FROM attendance WHERE person_id = ?1 AND day >= ?2 ORDER BY day DESC').bind(id, since).all<Att>()
  const rep = await env.DB.prepare('SELECT day, done, submitted_at FROM reports WHERE person_id = ?1 AND day >= ?2').bind(id, since).all<{ day: string; done: string; submitted_at: string }>()
  const reps = new Map(rep.results.map((r) => [r.day, r]))
  return {
    days: att.results.map((a) => ({ day: a.day, checkIn: a.check_in, checkOut: a.check_out, mode: a.mode, late: isLate(a.check_in, settings), minutes: workedMinutes(a.check_in, a.check_out), report: reps.get(a.day)?.done ?? null })),
  }
}

/* ---------- owner: team day, monthly attendance ---------- */

/**
 * The people on the team: everyone with an active key, plus anyone whose key was later removed but
 * who has attendance in the period (so past records stay complete). The owner is never listed:
 * Palash Roy runs the company and is not tracked as staff.
 */
export function teamPeople(editors: { id: string; name: string; active: boolean }[], att: { person_id: string; name: string }[]): { id: string; name: string }[] {
  const people = editors.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name }))
  const known = new Set(people.map((p) => p.id))
  for (const a of att) {
    if (a.person_id === 'owner' || known.has(a.person_id)) continue
    known.add(a.person_id)
    people.push({ id: a.person_id, name: a.name })
  }
  return people
}
export async function teamDay(env: Env, day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) day = istDay()
  const [editors, settings, att, rep, cal, pushes] = await Promise.all([
    listEditors(env),
    teamSettings(env),
    env.DB.prepare('SELECT * FROM attendance WHERE day = ?1').bind(day).all<Att>(),
    env.DB.prepare('SELECT * FROM reports WHERE day = ?1').bind(day).all<Rep>(),
    env.DB.prepare("SELECT title, status, created_by, substr(updated_at,1,10) AS d FROM calendar WHERE substr(updated_at,1,10) = ?1 OR substr(created_at,1,10) = ?1").bind(day).all<{ title: string; status: string; created_by: string }>(),
    env.DB.prepare('SELECT title, body, by_name FROM pushes WHERE substr(ts,1,10) = ?1').bind(day).all<{ body: string; by_name: string }>(),
  ])
  const attBy = new Map(att.results.map((a) => [a.person_id, a]))
  const repBy = new Map(rep.results.map((r) => [r.person_id, r]))
  const people = teamPeople(editors, att.results)
  const rows = people.map((p) => {
    const a = attBy.get(p.id) ?? null
    const r = repBy.get(p.id) ?? null
    const activity = [
      ...cal.results.filter((c) => c.created_by === p.name).map((c) => `Calendar: ${c.title} (${c.status})`),
      ...pushes.results.filter((x) => x.by_name === p.name).map((x) => `Sent alert: ${x.body}`),
    ]
    return {
      id: p.id,
      name: p.name,
      checkIn: a?.check_in ?? null,
      checkOut: a?.check_out ?? null,
      mode: a?.mode ?? null,
      note: a?.note ?? null,
      late: isLate(a?.check_in ?? null, settings),
      minutes: workedMinutes(a?.check_in ?? null, a?.check_out ?? null),
      report: r ? { done: r.done, plan: r.plan, blockers: r.blockers, links: r.links, submittedAt: r.submitted_at } : null,
      activity,
    }
  })
  return { day, settings, people: rows, summary: { total: rows.length, present: rows.filter((r) => r.checkIn).length, late: rows.filter((r) => r.late).length, reports: rows.filter((r) => r.report).length } }
}

export interface MonthRow {
  id: string
  name: string
  present: number
  late: number
  reports: number
  minutes: number
  avgCheckIn: string | null
  days: Record<string, { in: string | null; out: string | null; late: boolean; report: boolean }>
}

/** Monthly summary per person (pure, for tests). */
export function summarizeMonth(people: { id: string; name: string }[], att: Att[], reps: { person_id: string; day: string }[], s: TeamSettings): MonthRow[] {
  return people.map((p) => {
    const mine = att.filter((a) => a.person_id === p.id && a.check_in)
    const repDays = new Set(reps.filter((r) => r.person_id === p.id).map((r) => r.day))
    const ins = mine.map((a) => toMin(istClock(a.check_in!)))
    const avg = ins.length ? Math.round(ins.reduce((x, y) => x + y, 0) / ins.length) : null
    const days: MonthRow['days'] = {}
    for (const a of mine) days[a.day] = { in: a.check_in ? istClock(a.check_in) : null, out: a.check_out ? istClock(a.check_out) : null, late: isLate(a.check_in, s), report: repDays.has(a.day) }
    return {
      id: p.id,
      name: p.name,
      present: mine.length,
      late: mine.filter((a) => isLate(a.check_in, s)).length,
      reports: repDays.size,
      minutes: mine.reduce((m, a) => m + (a.check_out ? workedMinutes(a.check_in, a.check_out) : 0), 0),
      avgCheckIn: avg === null ? null : `${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(avg % 60).padStart(2, '0')}`,
      days,
    }
  })
}

export async function teamMonth(env: Env, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) month = istDay().slice(0, 7)
  const [editors, settings, att, reps] = await Promise.all([
    listEditors(env),
    teamSettings(env),
    env.DB.prepare('SELECT * FROM attendance WHERE substr(day,1,7) = ?1').bind(month).all<Att>(),
    env.DB.prepare('SELECT person_id, day FROM reports WHERE substr(day,1,7) = ?1').bind(month).all<{ person_id: string; day: string }>(),
  ])
  const people = teamPeople(editors, att.results)
  return { month, settings, rows: summarizeMonth(people, att.results.filter((a) => a.person_id !== 'owner'), reps.results, settings) }
}

/* ---------- reminders and the morning-brief line ---------- */
const STAFF_PREFIX = 'staff-sub:'

export async function registerStaffDevice(env: Env, who: Who, body: unknown) {
  const sub = (body as { subscription?: unknown })?.subscription
  if (!isValidSubscription(sub)) return false
  const value: StoredSub & { person: string } = { sub: { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, person: personId(who) }
  await env.SUBS.put(`${STAFF_PREFIX}${personId(who).slice(0, 16)}:${(await subKey(sub.endpoint)).slice(-24)}`, JSON.stringify(value))
  return true
}

/** At the reminder time (IST), nudge people who checked in today but haven't sent a report. */
export async function reportReminders(env: Env, force = false): Promise<string> {
  const s = await teamSettings(env)
  const now = Date.now()
  const mins = toMin(new Date(now + IST_MS).toISOString().slice(11, 16))
  const due = mins >= toMin(s.reminderTime) && mins < toMin(s.reminderTime) + 10
  const key = `state:report-reminder:${istDay(now)}`
  if (!force && (!due || (await env.SUBS.get(key)))) return 'reminder not due'
  await env.SUBS.put(key, '1', { expirationTtl: 2 * 86400 })
  const day = istDay(now)
  const att = await env.DB.prepare('SELECT person_id FROM attendance WHERE day = ?1 AND check_in IS NOT NULL').bind(day).all<{ person_id: string }>()
  const rep = await env.DB.prepare('SELECT person_id FROM reports WHERE day = ?1').bind(day).all<{ person_id: string }>()
  const done = new Set(rep.results.map((r) => r.person_id))
  const pending = new Set(att.results.map((a) => a.person_id).filter((p) => !done.has(p)))
  if (!pending.size) return 'no reminders needed'
  const r = await deliver(env, STAFF_PREFIX, (st) => (pending.has((st as StoredSub & { person?: string }).person ?? '') ? [{ title: 'Daily report', body: 'Please add today’s work report before you check out.', url: '#/studio?tab=myday', tag: 'report-reminder' }] : []))
  return `reminders sent ${r.sent}`
}

/** One line for the owner's morning brief about yesterday. */
export async function teamBriefLine(env: Env): Promise<string | null> {
  const y = istDay(Date.now() - 86400000)
  const editors = (await listEditors(env)).filter((e) => e.active)
  if (!editors.length) return null
  const present = (await env.DB.prepare("SELECT COUNT(*) AS n FROM attendance WHERE day = ?1 AND person_id != 'owner'").bind(y).first<{ n: number }>())?.n ?? 0
  const reports = (await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE day = ?1 AND person_id != 'owner'").bind(y).first<{ n: number }>())?.n ?? 0
  return `Team: ${present} of ${editors.length} checked in, ${reports} reports.`
}
