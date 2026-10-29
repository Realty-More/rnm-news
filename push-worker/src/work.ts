// Tasks and leave for the team (Cloudflare D1).
//   Tasks: the owner or full-access staff assign work with a due date; the person marks it done
//   (with an optional note), and it shows on their day and in Team today.
//   Leave: staff request leave; the owner or full-access staff approve or decline. Approved leave
//   counts in attendance and in the monthly summary used for salary.
import { full, type Who } from './owner.ts'
import type { Env } from './index.ts'

const IST_MS = 5.5 * 3600000
const today = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10)
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+\n/g, '\n').trim().slice(0, max) : '')
const personId = (who: Who) => who.id ?? 'owner'

/* ---------- tasks ---------- */

export interface Task {
  id: number
  title: string
  details: string
  assignee_id: string
  assignee_name: string
  due: string | null
  priority: 'normal' | 'high'
  status: 'open' | 'done' | 'cancelled'
  created_by: string
  created_at: string
  done_at: string | null
  done_note: string | null
}

/** Open tasks first (overdue, then by due date), then finished ones, newest first. */
export function sortTasks(tasks: Task[], day = today()): Task[] {
  const rank = (t: Task) => (t.status !== 'open' ? 3 : t.due && t.due < day ? 0 : t.priority === 'high' ? 1 : 2)
  return [...tasks].sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.created_at.localeCompare(a.created_at))
}

export async function listTasks(env: Env, who: Who, scope: string) {
  const all = scope === 'all' && full(who)
  const since = new Date(Date.now() - 45 * 86400000).toISOString()
  const { results } = all
    ? await env.DB.prepare("SELECT * FROM tasks WHERE status = 'open' OR created_at >= ? ORDER BY created_at DESC LIMIT 400").bind(since).all<Task>()
    : await env.DB.prepare("SELECT * FROM tasks WHERE assignee_id = ? AND (status = 'open' OR created_at >= ?) ORDER BY created_at DESC LIMIT 200").bind(personId(who), since).all<Task>()
  return { today: today(), tasks: sortTasks(results) }
}

export async function createTask(env: Env, who: Who, body: unknown, people: { id: string; name: string }[]) {
  const b = (body ?? {}) as Record<string, unknown>
  const title = text(b.title, 140)
  if (title.length < 3) throw new Error('Write what needs to be done.')
  const person = people.find((p) => p.id === b.assigneeId)
  if (!person) throw new Error('Pick who should do it.')
  const due = isDay(b.due) ? b.due : null
  const priority = b.priority === 'high' ? 'high' : 'normal'
  const r = await env.DB.prepare(
    "INSERT INTO tasks (title, details, assignee_id, assignee_name, due, priority, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)",
  )
    .bind(title, text(b.details, 1000), person.id, person.name, due, priority, who.name, new Date().toISOString())
    .run()
  return { id: r.meta.last_row_id }
}

/** The assignee marks done or reopens; the owner or full access can also cancel. */
export async function updateTask(env: Env, who: Who, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const id = Number(b.id)
  const t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<Task>()
  if (!t) throw new Error('Task not found.')
  const mine = t.assignee_id === personId(who)
  if (!mine && !full(who)) throw new Error('This task belongs to someone else.')
  const status = b.status
  if (status === 'done') {
    await env.DB.prepare("UPDATE tasks SET status = 'done', done_at = ?, done_note = ? WHERE id = ?").bind(new Date().toISOString(), text(b.note, 300) || null, id).run()
  } else if (status === 'open') {
    await env.DB.prepare("UPDATE tasks SET status = 'open', done_at = NULL WHERE id = ?").bind(id).run()
  } else if (status === 'cancelled' && full(who)) {
    await env.DB.prepare("UPDATE tasks SET status = 'cancelled' WHERE id = ?").bind(id).run()
  } else throw new Error('Choose done, reopen or cancel.')
  return { ok: true }
}

export async function deleteTask(env: Env, body: unknown) {
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(Number((body as { id?: unknown })?.id)).run()
  return { ok: true }
}

/** Tasks per person for one day: finished that day, and still open (with overdue count). */
export async function tasksForDay(env: Env, day: string) {
  const { results } = await env.DB.prepare("SELECT id, title, assignee_id, due, status, done_at FROM tasks WHERE status = 'open' OR substr(done_at, 1, 10) = ?")
    .bind(day)
    .all<{ id: number; title: string; assignee_id: string; due: string | null; status: string; done_at: string | null }>()
  const by = new Map<string, { done: string[]; open: number; overdue: number }>()
  for (const t of results) {
    const e = by.get(t.assignee_id) ?? { done: [], open: 0, overdue: 0 }
    if (t.status === 'done' && t.done_at && today(Date.parse(t.done_at)) === day) e.done.push(t.title)
    if (t.status === 'open') {
      e.open++
      if (t.due && t.due < day) e.overdue++
    }
    by.set(t.assignee_id, e)
  }
  return by
}

/* ---------- leave ---------- */

export const LEAVE_KINDS = { casual: 'Casual leave', sick: 'Sick leave', earned: 'Earned / paid leave', unpaid: 'Unpaid leave', comp: 'Comp off' } as const
type Kind = keyof typeof LEAVE_KINDS

export interface Leave {
  id: number
  person_id: string
  name: string
  kind: Kind
  from_day: string
  to_day: string
  half: number
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

/** Every date from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 400; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/** Leave days a request takes, skipping weekly offs; a half day counts 0.5. Optionally only inside one month. */
export function leaveDays(l: { from_day: string; to_day: string; half: number }, weekOff: number[], month?: string): { day: string; amount: number }[] {
  return daysBetween(l.from_day, l.to_day)
    .filter((d) => !weekOff.includes(new Date(`${d}T00:00:00Z`).getUTCDay()) && (!month || d.startsWith(month)))
    .map((day) => ({ day, amount: l.half ? 0.5 : 1 }))
}

export async function requestLeave(env: Env, who: Who, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const kind = (Object.keys(LEAVE_KINDS) as Kind[]).includes(b.kind as Kind) ? (b.kind as Kind) : null
  if (!kind) throw new Error('Pick the type of leave.')
  if (!isDay(b.from)) throw new Error('Pick the first day of leave.')
  const to = isDay(b.to) ? b.to : b.from
  if (to < b.from) throw new Error('The last day is before the first day.')
  if (daysBetween(b.from, to).length > 60) throw new Error('A request can cover at most 60 days.')
  const half = b.half === true && to === b.from ? 1 : 0
  const reason = text(b.reason, 400)
  if (reason.length < 3) throw new Error('Write a short reason.')
  const id = personId(who)
  const clash = await env.DB.prepare("SELECT id FROM leaves WHERE person_id = ? AND status IN ('pending', 'approved') AND from_day <= ? AND to_day >= ?").bind(id, to, b.from).first()
  if (clash) throw new Error('You already have leave on some of these days.')
  const r = await env.DB.prepare(
    "INSERT INTO leaves (person_id, name, kind, from_day, to_day, half, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
  )
    .bind(id, who.name, kind, b.from, to, half, reason, new Date().toISOString())
    .run()
  // Tell the owner and everyone with full access (they approve or decline it).
  await leaveNotice(env, 'request', { person_id: id, name: who.name, kind, from_day: b.from, to_day: to, half, reason }).catch(() => {})
  return { id: r.meta.last_row_id }
}

const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const spanOf = (l: { from_day: string; to_day: string; half: number }) => (l.from_day === l.to_day ? `${shortDay(l.from_day)}${l.half ? ' (half day)' : ''}` : `${shortDay(l.from_day)} – ${shortDay(l.to_day)}`)

/** Team ids with full access: admin mobile logins, admin login keys, accounts given Full access. */
async function fullAccessIds(env: Env): Promise<Set<string>> {
  const [accts, links, { listEditors }] = await Promise.all([
    env.DB.prepare("SELECT phone FROM accounts WHERE role = 'admin' AND status = 'active'").all<{ phone: string }>(),
    env.DB.prepare("SELECT reader_id FROM staff_links WHERE role = 'admin' AND person_id IS NULL").all<{ reader_id: number }>(),
    import('./owner.ts'),
  ])
  const keys = (await listEditors(env)).filter((e) => e.active && e.admin)
  return new Set([...accts.results.map((a) => `ph:${a.phone}`), ...links.results.map((l) => `rd:${l.reader_id}`), ...keys.map((k) => k.id)])
}

/**
 * Leave notifications. A new request goes to the owner's devices and to everyone with full access
 * (not to the person who asked); a decision goes back to the person who asked.
 */
export async function leaveNotice(env: Env, what: 'request' | 'approved' | 'rejected', l: { person_id: string; name: string; kind: Kind; from_day: string; to_day: string; half: number; reason?: string }, by = '') {
  const { deliver } = await import('./push.ts')
  const tag = `leave-${l.person_id.slice(-10)}-${l.from_day}`
  if (what === 'request') {
    const notice = { title: `Leave request · ${l.name}`, body: `${LEAVE_KINDS[l.kind]} · ${spanOf(l)}${l.reason ? ` · ${l.reason.slice(0, 80)}` : ''}`, url: '#/studio?tab=leave', tag }
    const fullIds = await fullAccessIds(env)
    fullIds.delete(l.person_id)
    const { toOwners } = await import('./owner.ts')
    await Promise.all([
      toOwners(env, notice).catch(() => null),
      fullIds.size ? deliver(env, 'staff-sub:', (st) => (fullIds.has((st as { person?: string }).person ?? '') ? [notice] : [])).catch(() => null) : null,
    ])
    return
  }
  const notice = {
    title: what === 'approved' ? 'Leave approved ✓' : 'Leave declined',
    body: `${LEAVE_KINDS[l.kind]} · ${spanOf(l)}${by ? ` · by ${by}` : ''}`,
    url: '#/studio?tab=leave',
    tag,
  }
  await deliver(env, 'staff-sub:', (st) => ((st as { person?: string }).person === l.person_id ? [notice] : [])).catch(() => null)
}

export async function myLeaves(env: Env, who: Who) {
  const { results } = await env.DB.prepare('SELECT * FROM leaves WHERE person_id = ? ORDER BY from_day DESC LIMIT 100').bind(personId(who)).all<Leave>()
  return { leaves: results }
}

export async function cancelLeave(env: Env, who: Who, body: unknown) {
  const id = Number((body as { id?: unknown })?.id)
  const r = await env.DB.prepare("UPDATE leaves SET status = 'cancelled' WHERE id = ? AND person_id = ? AND (status = 'pending' OR (status = 'approved' AND from_day > ?))")
    .bind(id, personId(who), today())
    .run()
  if (!r.meta.changes) throw new Error('Only waiting requests, or approved leave that has not started, can be cancelled.')
  return { ok: true }
}

export async function allLeaves(env: Env, month: string) {
  const m = /^\d{4}-\d{2}$/.test(month) ? month : today().slice(0, 7)
  const { results } = await env.DB.prepare(
    "SELECT * FROM leaves WHERE status = 'pending' OR (substr(from_day, 1, 7) <= ? AND substr(to_day, 1, 7) >= ?) ORDER BY status = 'pending' DESC, from_day DESC LIMIT 300",
  )
    .bind(m, m)
    .all<Leave>()
  return { month: m, leaves: results }
}

export async function decideLeave(env: Env, who: Who, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const status = b.status === 'approved' || b.status === 'rejected' ? b.status : null
  if (!status) throw new Error('Approve or decline.')
  const r = await env.DB.prepare("UPDATE leaves SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status IN ('pending', 'approved', 'rejected')")
    .bind(status, who.name, new Date().toISOString(), text(b.note, 300) || null, Number(b.id))
    .run()
  if (!r.meta.changes) throw new Error('Leave request not found.')
  // Tell the person who asked.
  const l = await env.DB.prepare('SELECT * FROM leaves WHERE id = ?').bind(Number(b.id)).first<Leave>()
  if (l) await leaveNotice(env, status, l, who.name).catch(() => {})
  return { ok: true }
}

/** Approved leave that covers a day, per person. */
export async function leaveOnDay(env: Env, day: string) {
  const { results } = await env.DB.prepare("SELECT person_id, kind, half FROM leaves WHERE status = 'approved' AND from_day <= ? AND to_day >= ?").bind(day, day).all<{ person_id: string; kind: Kind; half: number }>()
  return new Map(results.map((l) => [l.person_id, { kind: LEAVE_KINDS[l.kind], half: !!l.half }]))
}

export async function approvedLeavesInMonth(env: Env, month: string): Promise<Leave[]> {
  const { results } = await env.DB.prepare("SELECT * FROM leaves WHERE status = 'approved' AND substr(from_day, 1, 7) <= ? AND substr(to_day, 1, 7) >= ?").bind(month, month).all<Leave>()
  return results
}
