// Notice board (R&M Newsroom): the owner or full access posts a notice ("Monday meeting 11 AM"); everyone
// gets a phone notification and sees it pinned at the top of the Newsroom until it expires. Team members
// tap "Got it", and the owner sees "Seen by 3/5" with who has and hasn't seen it.
import type { Env } from './index.ts'
import { full, type Who } from './owner.ts'

interface NoticeRow {
  id: number
  title: string
  body: string
  urgent: number
  created_by: string
  by_id: string
  created_at: string
  expires_at: string | null
}

const personId = (who: Who) => who.id ?? 'owner'
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '')

/** Active notices, newest first; with "seen" details for managers and "seen by me" for everyone. */
export async function listNotices(env: Env, who: Who) {
  const now = new Date().toISOString()
  const { results } = await env.DB.prepare('SELECT * FROM notices WHERE deleted = 0 AND (expires_at IS NULL OR expires_at > ?) ORDER BY urgent DESC, created_at DESC LIMIT 10').bind(now).all<NoticeRow>()
  if (!results.length) return { notices: [] }
  const ids = results.map((n) => n.id)
  const { results: seen } = await env.DB.prepare(`SELECT notice_id, person_id, name, seen_at FROM notice_seen WHERE notice_id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ notice_id: number; person_id: string; name: string; seen_at: string }>()
  const me = personId(who)
  let team: { id: string; name: string }[] = []
  if (full(who)) team = await (await import('./team.ts')).assignablePeople(env)
  return {
    notices: results.map((n) => {
      const mine = seen.filter((s) => s.notice_id === n.id)
      const base = { id: n.id, title: n.title, body: n.body, urgent: !!n.urgent, by: n.created_by, at: n.created_at, expires: n.expires_at, seenByMe: n.by_id === me || mine.some((s) => s.person_id === me) }
      if (!full(who)) return base
      // Everyone on the team except the person who posted it.
      const audience = team.filter((p) => p.id !== n.by_id)
      const seenIds = new Set(mine.map((s) => s.person_id))
      return { ...base, seen: audience.filter((p) => seenIds.has(p.id)).map((p) => ({ name: p.name, at: mine.find((s) => s.person_id === p.id)!.seen_at })), notSeen: audience.filter((p) => !seenIds.has(p.id)).map((p) => p.name), total: audience.length }
    }),
  }
}

/** Owner or full access: post a notice and notify every phone. */
export async function postNotice(env: Env, who: Who, body: unknown) {
  if (!full(who)) throw new Error('Only the owner or full access can post notices.')
  const b = (body ?? {}) as { title?: unknown; body?: unknown; urgent?: unknown; days?: unknown }
  const title = text(b.title, 90)
  const msg = text(b.body, 800)
  if (title.length < 3) throw new Error('Write a short title.')
  const days = Number(b.days)
  const expires = Number.isFinite(days) && days > 0 && days <= 60 ? new Date(Date.now() + days * 86400000).toISOString() : null
  const r = await env.DB.prepare('INSERT INTO notices (title, body, urgent, created_by, by_id, created_at, expires_at, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(title, msg, b.urgent === true ? 1 : 0, who.name, personId(who), new Date().toISOString(), expires)
    .run()
  const id = Number(r.meta.last_row_id)
  // Phones: every team member's device, and the owner's devices (unless the owner posted it).
  const notice = { title: `${b.urgent === true ? '🔴 ' : '📢 '}${title}`, body: msg ? msg.slice(0, 160) : `Notice from ${who.name}`, url: '#/studio', tag: `notice-${id}` }
  const { deliver } = await import('./push.ts')
  const author = personId(who)
  const [team, owners] = await Promise.all([
    deliver(env, 'staff-sub:', (st) => ((st as { person?: string }).person === author ? [] : [notice])).catch(() => ({ sent: 0 })),
    who.role === 'owner' ? Promise.resolve({ sent: 0 }) : import('./owner.ts').then((m) => m.toOwners(env, notice)).catch(() => ({ sent: 0 })),
  ])
  return { ok: true, id, sent: team.sent + owners.sent }
}

/** "Got it": the notice counts as seen by this person. */
export async function seeNotice(env: Env, who: Who, body: unknown) {
  const id = Number((body as { id?: unknown })?.id)
  if (!Number.isInteger(id) || id < 1) throw new Error('Notice not found.')
  await env.DB.prepare('INSERT INTO notice_seen (notice_id, person_id, name, seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(notice_id, person_id) DO NOTHING')
    .bind(id, personId(who), who.name, new Date().toISOString())
    .run()
  return { ok: true }
}

/** Owner or full access: take a notice down. */
export async function removeNotice(env: Env, who: Who, body: unknown) {
  if (!full(who)) throw new Error('Only the owner or full access can remove notices.')
  const id = Number((body as { id?: unknown })?.id)
  await env.DB.prepare('UPDATE notices SET deleted = 1 WHERE id = ?').bind(id).run()
  return { ok: true }
}
