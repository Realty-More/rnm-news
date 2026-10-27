// Team attendance and daily work reports (Cloudflare D1 + KV, free plan).
// Employees use their editor key: they check in/out themselves and write a daily report.
// The owner sees everyone's day, monthly attendance and a CSV export. Nothing is tracked in the background:
// location is read only at the moment of check-in and check-out (when the person allows it), and shown
// as "at <office>" or the distance from the nearest office the owner set.
import { deliver, isValidSubscription, subKey, type StoredSub } from './push.ts'
import { listEditors, type Who } from './owner.ts'
import { accountStaff } from './accounts.ts'
import { approvedLeavesInMonth, leaveDays, leaveOnDay, LEAVE_KINDS, tasksForDay, type Leave } from './work.ts'
import type { Env } from './index.ts'

/** One person's own office hours, set by the owner (anything left out uses the office default). */
export interface PersonTime {
  start?: string
  end?: string
  weekOff?: number[]
}
export interface TeamSettings {
  startTime: string // "10:00" IST
  endTime: string // "18:30" IST
  graceMin: number
  reminderTime: string // "18:30" IST, report reminder
  /** Weekly off days, 0 = Sunday … 6 = Saturday (not counted as working or leave days). */
  weekOff: number[]
  /** Per-person office hours, by person id. */
  people: Record<string, PersonTime>
  /** Push reminders: check in (start + grace), check out (30 min after the end time). */
  notifyCheckIn: boolean
  notifyCheckOut: boolean
  /** Attendance summary to the owner 15 minutes after start + grace. */
  managerSummary: boolean
  /** A notification to the owner for every check-in and check-out. */
  ownerLive: boolean
  /** Office locations for the "at office" check (up to 5). */
  offices: Office[]
  /** If true, check-in and check-out need the phone's location. */
  requireLocation: boolean
}
export interface Office {
  name: string
  lat: number
  lng: number
  /** Metres around the point that count as "at office". */
  radius: number
}
/** A position from the phone at check-in or check-out (accuracy in metres). */
export interface Spot {
  lat: number
  lng: number
  acc: number
}
export interface Place {
  lat: number
  lng: number
  acc: number
  /** The office they were at, or null. */
  office: string | null
  /** Metres from the nearest office (null when no office is set). */
  meters: number | null
  label: string
}
const DEFAULTS: TeamSettings = { startTime: '10:00', endTime: '18:30', graceMin: 15, reminderTime: '18:30', weekOff: [0], people: {}, notifyCheckIn: true, notifyCheckOut: true, managerSummary: true, ownerLive: false, offices: [], requireLocation: false }

/** Straight-line distance in metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** A position sent by the app, or null if missing or not a real position. */
export function cleanSpot(v: unknown): Spot | null {
  if (!v || typeof v !== 'object') return null
  const { lat, lng, acc } = v as Record<string, unknown>
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) return null
  const a = typeof acc === 'number' && Number.isFinite(acc) && acc >= 0 ? Math.min(Math.round(acc), 100000) : 9999
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: a }
}

/** Where a check-in happened relative to the offices (pure, for tests). */
export function placeOf(spot: Spot | null, offices: Office[]): Place | null {
  if (!spot) return null
  if (!offices.length) return { ...spot, office: null, meters: null, label: 'Location shared' }
  let best = offices[0]
  let d = distanceM(spot, best)
  for (const o of offices.slice(1)) {
    const x = distanceM(spot, o)
    if (x < d) {
      best = o
      d = x
    }
  }
  // Phone positions indoors can be off by tens of metres, so a little of the reported accuracy counts.
  const inside = d <= best.radius + Math.min(spot.acc, 100)
  const far = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`
  return { ...spot, office: inside ? best.name : null, meters: Math.round(d), label: inside ? `At ${best.name}` : `${far} from ${best.name}` }
}

export function cleanOffices(v: unknown): Office[] {
  if (!Array.isArray(v)) return []
  const out: Office[] = []
  for (const raw of v.slice(0, 5)) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const spot = cleanSpot({ lat: o.lat, lng: o.lng, acc: 0 })
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : ''
    if (!spot || !name) continue
    const radius = Number.isFinite(Number(o.radius)) ? Math.min(2000, Math.max(50, Math.round(Number(o.radius)))) : 150
    out.push({ name, lat: spot.lat, lng: spot.lng, radius })
  }
  return out
}

/** The office settings with this person's own hours and weekly off applied. */
export function forPerson(s: TeamSettings, id: string): TeamSettings {
  const p = s.people?.[id]
  if (!p) return s
  return { ...s, startTime: p.start ?? s.startTime, endTime: p.end ?? s.endTime, weekOff: p.weekOff ?? s.weekOff }
}
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

const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const cleanDays = (v: unknown): number[] | null => (Array.isArray(v) ? [...new Set(v.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : null)

/** Per-person hours from the Studio form: valid times only, end after start, at most 200 people. */
export function cleanPeopleTimes(v: unknown): Record<string, PersonTime> {
  const out: Record<string, PersonTime> = {}
  if (!v || typeof v !== 'object') return out
  for (const [id, raw] of Object.entries(v as Record<string, unknown>).slice(0, 200)) {
    // Ids: "ph:<mobile>" for account logins, a 64-character hash for login keys.
    if (!/^[\w:.-]{1,80}$/.test(id) || !raw || typeof raw !== 'object') continue
    const t = raw as Record<string, unknown>
    const p: PersonTime = {}
    if (isTime(t.start)) p.start = t.start
    if (isTime(t.end)) p.end = t.end
    const days = cleanDays(t.weekOff)
    if (days) p.weekOff = days
    if (p.start && p.end && toMin(p.end) <= toMin(p.start)) throw new Error('Each person’s end time must be after their start time.')
    if (Object.keys(p).length) out[id] = p
  }
  return out
}

export async function saveTeamSettings(env: Env, body: unknown) {
  const b = (body ?? {}) as Partial<Record<keyof TeamSettings, unknown>>
  const time = (v: unknown, d: string) => (isTime(v) ? v : d)
  const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const cur = await teamSettings(env)
  const next: TeamSettings = {
    startTime: time(b.startTime, cur.startTime),
    endTime: time(b.endTime, cur.endTime),
    graceMin: Number.isInteger(b.graceMin) && (b.graceMin as number) >= 0 && (b.graceMin as number) <= 120 ? (b.graceMin as number) : cur.graceMin,
    reminderTime: time(b.reminderTime, cur.reminderTime),
    weekOff: cleanDays(b.weekOff) ?? cur.weekOff,
    people: b.people === undefined ? cur.people : cleanPeopleTimes(b.people),
    notifyCheckIn: flag(b.notifyCheckIn, cur.notifyCheckIn),
    notifyCheckOut: flag(b.notifyCheckOut, cur.notifyCheckOut),
    managerSummary: flag(b.managerSummary, cur.managerSummary),
    ownerLive: flag(b.ownerLive, cur.ownerLive),
    offices: b.offices === undefined ? cur.offices : cleanOffices(b.offices),
    requireLocation: flag(b.requireLocation, cur.requireLocation),
  }
  if (toMin(next.endTime) <= toMin(next.startTime)) throw new Error('Office end time must be after the start time.')
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
  in_lat?: number | null
  in_lng?: number | null
  in_acc?: number | null
  out_lat?: number | null
  out_lng?: number | null
  out_acc?: number | null
}
const spotIn = (a: Att | null): Spot | null => (a?.in_lat != null && a.in_lng != null ? { lat: a.in_lat, lng: a.in_lng, acc: a.in_acc ?? 9999 } : null)
const spotOut = (a: Att | null): Spot | null => (a?.out_lat != null && a.out_lng != null ? { lat: a.out_lat, lng: a.out_lng, acc: a.out_acc ?? 9999 } : null)
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
  const mine = forPerson(settings, id)
  const place = { in: placeOf(spotIn(att), settings.offices), out: placeOf(spotOut(att), settings.offices) }
  return { day, name: who.name, attendance: att, report: rep, settings: mine, place, late: isLate(att?.check_in ?? null, mine), minutes: workedMinutes(att?.check_in ?? null, att?.check_out ?? null) }
}

export async function checkIn(env: Env, who: Who, body: unknown) {
  const b = (body ?? {}) as { mode?: unknown; note?: unknown; loc?: unknown }
  const mode: Mode = MODES.includes(b.mode as Mode) ? (b.mode as Mode) : 'office'
  const spot = cleanSpot(b.loc)
  if (!spot && (await teamSettings(env)).requireLocation) throw new Error('Turn on location for this app to check in.')
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 140) : ''
  const now = new Date().toISOString()
  // First check-in of the day wins; a repeated tap doesn't move the time.
  await env.DB.prepare(
    'INSERT INTO attendance (person_id, name, day, check_in, mode, note, in_lat, in_lng, in_acc) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(person_id, day) DO NOTHING',
  )
    .bind(personId(who), who.name, istDay(), now, mode, note, spot?.lat ?? null, spot?.lng ?? null, spot?.acc ?? null)
    .run()
  const today = await myToday(env, who)
  if (today.attendance?.check_in === now)
    await ownerLive(env, `${who.name} checked in`, `${istClock(now)} · ${mode}${today.late ? ' · late' : ''} · ${today.place.in?.label ?? 'no location'}${note ? ` · ${note}` : ''}`)
  return today
}

export async function checkOut(env: Env, who: Who, body: unknown = {}) {
  const spot = cleanSpot((body as { loc?: unknown } | null)?.loc)
  if (!spot && (await teamSettings(env)).requireLocation) throw new Error('Turn on location for this app to check out.')
  const r = await env.DB.prepare('UPDATE attendance SET check_out = ?1, out_lat = ?4, out_lng = ?5, out_acc = ?6 WHERE person_id = ?2 AND day = ?3 AND check_in IS NOT NULL')
    .bind(new Date().toISOString(), personId(who), istDay(), spot?.lat ?? null, spot?.lng ?? null, spot?.acc ?? null)
    .run()
  if (!r.meta.changes) return { ok: false, error: 'Check in first.' }
  const today = await myToday(env, who)
  const mins = today.minutes
  await ownerLive(env, `${who.name} checked out`, `${istClock(new Date().toISOString())} · ${Math.floor(mins / 60)}h ${mins % 60}m today · ${today.place.out?.label ?? 'no location'}${today.report ? '' : ' · no report yet'}`)
  return { ok: true, ...today }
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
    days: att.results.map((a) => ({ day: a.day, checkIn: a.check_in, checkOut: a.check_out, mode: a.mode, late: isLate(a.check_in, forPerson(settings, id)), minutes: workedMinutes(a.check_in, a.check_out), report: reps.get(a.day)?.done ?? null })),
  }
}

/* ---------- owner: team day, monthly attendance ---------- */

/**
 * The people on the team: everyone with an active key, plus anyone whose key was later removed but
 * who has attendance in the period (so past records stay complete). The owner is never listed:
 * Palash Roy runs the company and is not tracked as staff.
 */
/** Everyone who can be given tasks: staff with an active key or account. */
export async function assignablePeople(env: Env): Promise<{ id: string; name: string }[]> {
  const [keys, accounts] = await Promise.all([listEditors(env), accountStaff(env)])
  return teamPeople([...keys, ...accounts], [])
}

export function teamPeople(editors: { id: string; name: string; active: boolean; created?: string }[], att: { person_id: string; name: string }[]): { id: string; name: string; since?: string }[] {
  // `since`: the day their login was created, so days before they joined never count as absent.
  const people: { id: string; name: string; since?: string }[] = editors.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name, ...(e.created ? { since: istDay(Date.parse(e.created)) } : {}) }))
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
    Promise.all([listEditors(env), accountStaff(env)]).then(([keys, accounts]) => [...keys, ...accounts]),
    teamSettings(env),
    env.DB.prepare('SELECT * FROM attendance WHERE day = ?1').bind(day).all<Att>(),
    env.DB.prepare('SELECT * FROM reports WHERE day = ?1').bind(day).all<Rep>(),
    env.DB.prepare("SELECT title, status, created_by, substr(updated_at,1,10) AS d FROM calendar WHERE substr(updated_at,1,10) = ?1 OR substr(created_at,1,10) = ?1").bind(day).all<{ title: string; status: string; created_by: string }>(),
    env.DB.prepare('SELECT title, body, by_name FROM pushes WHERE substr(ts,1,10) = ?1').bind(day).all<{ body: string; by_name: string }>(),
  ])
  const attBy = new Map(att.results.map((a) => [a.person_id, a]))
  const repBy = new Map(rep.results.map((r) => [r.person_id, r]))
  const people = teamPeople(editors, att.results)
  const [onLeave, tasks] = await Promise.all([leaveOnDay(env, day), tasksForDay(env, day)])
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
      late: isLate(a?.check_in ?? null, forPerson(settings, p.id)),
      inPlace: placeOf(spotIn(a), settings.offices),
      outPlace: placeOf(spotOut(a), settings.offices),
      start: forPerson(settings, p.id).startTime,
      end: forPerson(settings, p.id).endTime,
      minutes: workedMinutes(a?.check_in ?? null, a?.check_out ?? null),
      report: r ? { done: r.done, plan: r.plan, blockers: r.blockers, links: r.links, submittedAt: r.submitted_at } : null,
      activity,
      leave: onLeave.get(p.id) ?? null,
      tasks: tasks.get(p.id) ?? { done: [], open: 0, overdue: 0 },
    }
  })
  return {
    day,
    settings,
    people: rows,
    summary: { total: rows.length, present: rows.filter((r) => r.checkIn).length, late: rows.filter((r) => r.late).length, reports: rows.filter((r) => r.report).length, onLeave: rows.filter((r) => r.leave).length },
  }
}

export interface MonthRow {
  id: string
  name: string
  present: number
  late: number
  reports: number
  minutes: number
  avgCheckIn: string | null
  /** Working days so far in the month (weekly offs excluded). */
  workingDays: number
  /** Approved leave days in the month (half days count 0.5), and by type. */
  leave: number
  leaveByKind: Record<string, number>
  /** Working days with no check-in and no approved leave. */
  absent: number
  days: Record<string, { in: string | null; out: string | null; late: boolean; report: boolean; leave?: string; place?: string }>
}

/** Working days in a month up to `upTo` (inclusive), skipping weekly offs. */
export function workingDaysIn(month: string, weekOff: number[], upTo: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const out: string[] = []
  for (let d = 1; d <= last; d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`
    if (day > upTo) break
    if (!weekOff.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) out.push(day)
  }
  return out
}

/** Monthly summary per person (pure, for tests). */
export function summarizeMonth(
  people: { id: string; name: string; since?: string }[],
  att: Att[],
  reps: { person_id: string; day: string }[],
  s: TeamSettings,
  leaves: Pick<Leave, 'person_id' | 'kind' | 'from_day' | 'to_day' | 'half'>[] = [],
  month = '',
  upTo = '9999-12-31',
): MonthRow[] {
  return people.map((p) => {
    const ps = forPerson(s, p.id)
    const weekOff = ps.weekOff ?? [0]
    const working = month ? workingDaysIn(month, weekOff, upTo) : []
    const mine = att.filter((a) => a.person_id === p.id && a.check_in)
    const repDays = new Set(reps.filter((r) => r.person_id === p.id).map((r) => r.day))
    const ins = mine.map((a) => toMin(istClock(a.check_in!)))
    const avg = ins.length ? Math.round(ins.reduce((x, y) => x + y, 0) / ins.length) : null
    const days: MonthRow['days'] = {}
    for (const a of mine) days[a.day] = { in: a.check_in ? istClock(a.check_in) : null, out: a.check_out ? istClock(a.check_out) : null, late: isLate(a.check_in, ps), report: repDays.has(a.day), ...(spotIn(a) ? { place: placeOf(spotIn(a), s.offices ?? [])!.label } : {}) }
    // Approved leave in this month (only up to today counts towards absences; future leave is shown too).
    const leaveByKind: Record<string, number> = {}
    const leaveOn = new Map<string, number>()
    for (const l of leaves.filter((x) => x.person_id === p.id)) {
      for (const { day, amount } of leaveDays(l, weekOff, month || undefined)) {
        leaveOn.set(day, (leaveOn.get(day) ?? 0) + amount)
        const label = LEAVE_KINDS[l.kind] ?? l.kind
        leaveByKind[label] = (leaveByKind[label] ?? 0) + amount
        days[day] = { ...(days[day] ?? { in: null, out: null, late: false, report: false }), leave: l.half ? `${label} (half)` : label }
      }
    }
    const presentDays = new Set(mine.map((a) => a.day))
    // A working day with no check-in is absent, less any approved leave that day (a half day leaves 0.5).
    // Only days from the first check-in or joining date count (whichever is earlier).
    const start = [p.since, ...mine.map((a) => a.day)].filter((d): d is string => !!d).sort()[0]
    const mineWorking = start ? working.filter((d) => d >= start) : working
    const absent = mineWorking.filter((d) => !presentDays.has(d)).reduce((n, d) => n + Math.max(0, 1 - (leaveOn.get(d) ?? 0)), 0)
    return {
      workingDays: mineWorking.length,
      leave: [...leaveOn.values()].reduce((a, b) => a + b, 0),
      leaveByKind,
      absent,
      id: p.id,
      name: p.name,
      present: mine.length,
      late: mine.filter((a) => isLate(a.check_in, ps)).length,
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
    Promise.all([listEditors(env), accountStaff(env)]).then(([keys, accounts]) => [...keys, ...accounts]),
    teamSettings(env),
    env.DB.prepare('SELECT * FROM attendance WHERE substr(day,1,7) = ?1').bind(month).all<Att>(),
    env.DB.prepare('SELECT person_id, day FROM reports WHERE substr(day,1,7) = ?1').bind(month).all<{ person_id: string; day: string }>(),
  ])
  const leaves = await approvedLeavesInMonth(env, month)
  const people = teamPeople(editors, [...att.results, ...leaves.map((l) => ({ person_id: l.person_id, name: l.name }))])
  const today = istDay()
  return {
    month,
    settings,
    rows: summarizeMonth(people, att.results.filter((a) => a.person_id !== 'owner'), reps.results, settings, leaves, month, month < today.slice(0, 7) ? '9999-12-31' : today),
  }
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
  const editors = await assignablePeople(env)
  if (!editors.length) return null
  const present = (await env.DB.prepare("SELECT COUNT(*) AS n FROM attendance WHERE day = ?1 AND person_id != 'owner'").bind(y).first<{ n: number }>())?.n ?? 0
  const reports = (await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE day = ?1 AND person_id != 'owner'").bind(y).first<{ n: number }>())?.n ?? 0
  return `Team: ${present} of ${editors.length} checked in, ${reports} reports.`
}

/* ---------- check-in / check-out reminders and the owner's attendance summary ---------- */

async function ownerLive(env: Env, title: string, body: string) {
  const s = await teamSettings(env)
  if (!s.ownerLive) return
  const { toOwners } = await import('./owner.ts')
  await toOwners(env, { title, body, url: '#/studio?tab=teamday', tag: `att-${title}` }).catch(() => {})
}

const nowMin = (ms: number) => toMin(new Date(ms + IST_MS).toISOString().slice(11, 16))
/** True in the 20 minutes from `at` (the cron runs every 10 minutes; KV keeps each nudge to once a day). */
const inWindow = (mins: number, at: number) => mins >= at && mins < at + 20

/** Who should get which nudge right now (pure, for tests). */
export function planNudges(
  people: { id: string; name: string }[],
  s: TeamSettings,
  att: Map<string, { check_in: string | null; check_out: string | null }>,
  onLeave: Set<string>,
  day: string,
  mins: number,
): { checkIn: { id: string; name: string; start: string }[]; checkOut: { id: string; name: string; end: string }[] } {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  const out = { checkIn: [] as { id: string; name: string; start: string }[], checkOut: [] as { id: string; name: string; end: string }[] }
  for (const p of people) {
    const ps = forPerson(s, p.id)
    if (ps.weekOff.includes(weekday) || onLeave.has(p.id)) continue
    const a = att.get(p.id)
    if (s.notifyCheckIn && !a?.check_in && inWindow(mins, toMin(ps.startTime) + s.graceMin)) out.checkIn.push({ id: p.id, name: p.name, start: ps.startTime })
    if (s.notifyCheckOut && a?.check_in && !a.check_out && inWindow(mins, toMin(ps.endTime) + 30)) out.checkOut.push({ id: p.id, name: p.name, end: ps.endTime })
  }
  return out
}

/** Attendance summary text for the owner (pure, for tests). */
export function summaryText(
  people: { id: string; name: string }[],
  s: TeamSettings,
  att: Map<string, { check_in: string | null }>,
  onLeave: Set<string>,
  day: string,
): string | null {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  const due = people.filter((p) => !forPerson(s, p.id).weekOff.includes(weekday))
  if (!due.length) return null
  const leave = due.filter((p) => onLeave.has(p.id))
  const working = due.filter((p) => !onLeave.has(p.id))
  const inNow = working.filter((p) => att.get(p.id)?.check_in)
  const late = inNow.filter((p) => isLate(att.get(p.id)!.check_in, forPerson(s, p.id)))
  const missing = working.filter((p) => !att.get(p.id)?.check_in)
  const first = (n: string) => n.split(' ')[0]
  const parts = [`${inNow.length} of ${working.length} checked in`]
  if (late.length) parts.push(`${late.length} late (${late.map((p) => first(p.name)).join(', ')})`)
  if (missing.length) parts.push(`not in yet: ${missing.map((p) => first(p.name)).join(', ')}`)
  if (leave.length) parts.push(`${leave.length} on leave`)
  return parts.join(' · ').slice(0, 220)
}

/** Every 10 minutes: check-in and check-out reminders to staff, and the owner's summary once a day. */
export async function attendanceNudges(env: Env, now = Date.now()): Promise<string> {
  const s = await teamSettings(env)
  if (!s.notifyCheckIn && !s.notifyCheckOut && !s.managerSummary) return 'nudges off'
  const day = istDay(now)
  const mins = nowMin(now)
  const summaryAt = toMin(s.startTime) + s.graceMin + 15
  const wantSummary = s.managerSummary && inWindow(mins, summaryAt) && !(await env.SUBS.get(`state:att-summary:${day}`))
  // Quick exit outside every reminder window, so most cron runs read nothing else.
  const times = [s, ...Object.keys(s.people).map((id) => forPerson(s, id))]
  const near = times.some((t) => inWindow(mins, toMin(t.startTime) + s.graceMin) || inWindow(mins, toMin(t.endTime) + 30))
  if (!near && !wantSummary) return 'no nudges due'
  const [people, attRows, leave] = await Promise.all([
    assignablePeople(env),
    env.DB.prepare('SELECT person_id, check_in, check_out FROM attendance WHERE day = ?1').bind(day).all<{ person_id: string; check_in: string | null; check_out: string | null }>(),
    leaveOnDay(env, day),
  ])
  const att = new Map(attRows.results.map((a) => [a.person_id, a]))
  const onLeave = new Set(leave.keys())
  const plan = planNudges(people, s, att, onLeave, day, mins)
  // Each person gets each reminder at most once a day.
  const fresh = async (kind: string, id: string) => {
    const key = `state:nudge:${kind}:${day}:${id.slice(0, 40)}`
    if (await env.SUBS.get(key)) return false
    await env.SUBS.put(key, '1', { expirationTtl: 2 * 86400 })
    return true
  }
  const notices = new Map<string, { title: string; body: string; url: string; tag: string }>()
  for (const p of plan.checkIn)
    if (await fresh('in', p.id)) notices.set(p.id, { title: `Good morning, ${p.name.split(' ')[0]}`, body: `Your office time is ${p.start}. You haven’t checked in yet. Tap to check in.`, url: '#/studio?tab=myday', tag: 'checkin-reminder' })
  for (const p of plan.checkOut)
    if (await fresh('out', p.id)) notices.set(p.id, { title: 'Still checked in', body: `Your day ended at ${p.end}. Add today’s report and check out before you leave.`, url: '#/studio?tab=myday', tag: 'checkout-reminder' })
  let sent = 0
  if (notices.size)
    sent = (
      await deliver(env, STAFF_PREFIX, (st) => {
        const n = notices.get((st as StoredSub & { person?: string }).person ?? '')
        return n ? [n] : []
      })
    ).sent
  let summary = ''
  if (wantSummary) {
    await env.SUBS.put(`state:att-summary:${day}`, '1', { expirationTtl: 2 * 86400 })
    const text = summaryText(people, s, att, onLeave, day)
    if (text) {
      const { toOwners } = await import('./owner.ts')
      const r = await toOwners(env, { title: `Attendance at ${new Date(now + IST_MS).toISOString().slice(11, 16)}`, body: text, url: '#/studio?tab=teamday', tag: 'att-summary' })
      summary = `, summary to ${r.sent}`
    }
  }
  return `nudges: ${plan.checkIn.length} in, ${plan.checkOut.length} out, sent ${sent}${summary}`
}
