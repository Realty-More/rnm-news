// Daily team report by email to the owner (default palash@realtynmore.com, 19:30 IST), laid out as an
// "Evening Brief": dark logo header with a greeting and one-line summary, four headline numbers with
// the change since the previous working day, numbered action items (absent, blocked, overdue, late,
// missing reports, not checked out), then each person with a day timeline (shift, worked, late start),
// times, place, the work report and tasks; and what was published on realtynmore.com that day
// (count vs the previous day, sections, most read so far, every story with time and views).
// Email-safe HTML only (tables and inline styles; no scripts, SVG or web fonts).
// Sent through the same Brevo connection as the newsletter.
import type { Env } from './index.ts'
import { esc } from './newsletter.ts'

const IST_MS = 5.5 * 3600000
const clock = (iso: string | null) => (iso ? new Date(Date.parse(iso) + IST_MS).toISOString().slice(11, 16) : '–')
const hours = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '–')
const MODE: Record<string, string> = { office: 'Office', remote: 'Work from home', field: 'Field / site visit' }

export interface DayPerson {
  name: string
  title?: string | null
  checkIn: string | null
  checkOut: string | null
  mode: string | null
  note: string | null
  late: boolean
  minutes: number
  start?: string
  end?: string
  inPlace?: { label: string; office: string | null; lat: number; lng: number } | null
  outPlace?: { label: string; office: string | null; lat: number; lng: number } | null
  report: { done: string; plan: string; blockers: string; links: string } | null
  leave?: { kind: string; half: boolean } | null
  tasks?: { done: string[]; open: number; overdue: number }
}
export interface TeamDayData {
  day: string
  people: DayPerson[]
  summary: { total: number; present: number; late: number; reports: number; onLeave?: number }
}

const para = (s: string) => esc(s).replace(/\n/g, '<br>')
const map = (p: { lat: number; lng: number }) => `https://www.google.com/maps?q=${p.lat},${p.lng}`
const clock12 = (iso: string | null) => {
  if (!iso) return '–'
  const d = new Date(Date.parse(iso) + IST_MS)
  const h = d.getUTCHours()
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
const minOf = (iso: string) => {
  const d = new Date(Date.parse(iso) + IST_MS)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
const toMin = (hhmm: string | undefined, fallback: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback
}
const hourLabel = (m: number) => `${Math.floor(m / 60) % 12 || 12} ${Math.floor(m / 60) < 12 ? 'AM' : 'PM'}`

const C = { gold: '#FAA61B', ink: '#141416', mute: '#6B6B70', line: '#ECEBE6', soft: '#F7F6F2', green: '#2E9D5B', orange: '#E0782F', red: '#D9502E', blue: '#3B7DDD', purple: '#7A5AF8' }
const AVATAR = ['#FAA61B', '#2E9D5B', '#3B7DDD', '#C2477A', '#7A5AF8', '#D9502E', '#0F9BA8', '#8A6D3B']
const initials = (name: string) => {
  const p = name.trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?'
}
const avatarColor = (name: string) => AVATAR[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR.length]

/** The day as coloured pieces: shift (light gold), worked (green), late start (orange), the rest grey. */
export function daySegments(from: number, to: number, start: number, end: number, inAt: number | null, workTo: number | null, grace: number): { w: number; color: string }[] {
  const pts = [...new Set([from, to, start, end, inAt, workTo].filter((x): x is number => x !== null && x >= from && x <= to))].sort((a, b) => a - b)
  const out: { w: number; color: string }[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const mid = (a + b) / 2
    const color =
      inAt !== null && workTo !== null && mid >= inAt && mid < workTo ? C.green : inAt !== null && inAt > start + grace && mid >= start && mid < inAt ? C.orange : mid >= start && mid < end ? '#F6E3BD' : '#EFEEEA'
    const w = ((b - a) / (to - from)) * 100
    if (out.length && out[out.length - 1].color === color) out[out.length - 1].w += w
    else out.push({ w, color })
  }
  return out.map((s) => ({ ...s, w: Math.round(s.w * 10) / 10 }))
}

/* ---------- what went up on realtynmore.com that day ---------- */

export interface PublishedStory {
  id: number
  title: string
  link: string
  time: string // ISO, UTC
  section: string
  views: number | null
}
export interface PublishedDay {
  stories: PublishedStory[]
  prevCount?: number
  prevLabel?: string
}

/** UTC bounds of an IST calendar day. */
const istDayBounds = (day: string) => {
  const start = Date.parse(`${day}T00:00:00Z`) - IST_MS
  return { start, end: start + 86400000 }
}

/**
 * Stories published on the site that day (one request to the site), with the view counts the
 * hourly job has saved. Falls back to the saved list if the site does not answer.
 */
export async function publishedOn(env: Env, day: string, prevDay?: string): Promise<PublishedDay> {
  const { start, end } = istDayBounds(day)
  let stories: PublishedStory[] = []
  try {
    const q = new URLSearchParams({ after: new Date(start - 6 * 3600000).toISOString(), before: new Date(end + 6 * 3600000).toISOString(), per_page: '60', _fields: 'id,date_gmt,link,title,categories' })
    const res = await fetch(`${env.SITE_API}/posts?${q}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RM-News-Studio/1.0)' } })
    if (!res.ok) throw new Error(String(res.status))
    const { decode } = await import('./site.ts')
    const { sectionOf } = await import('./website.ts')
    const rows = (await res.json()) as { id: number; date_gmt: string; link: string; title: { rendered: string }; categories: number[] }[]
    stories = rows
      .map((p) => ({ id: p.id, title: decode(p.title.rendered), link: p.link, time: `${p.date_gmt}Z`, section: sectionOf(p.categories ?? []), views: null as number | null }))
      .filter((p) => Date.parse(p.time) >= start && Date.parse(p.time) < end)
  } catch {
    const { results } = await env.DB.prepare('SELECT post_id AS id, title, link, published AS time, section, views FROM webposts WHERE published >= ? AND published < ? ORDER BY published')
      .bind(new Date(start).toISOString().slice(0, 19), new Date(end).toISOString().slice(0, 19))
      .all<PublishedStory>()
    stories = results.map((r) => ({ ...r, time: r.time.endsWith('Z') ? r.time : `${r.time}Z` }))
  }
  if (stories.length) {
    const ids = stories.map((s) => s.id)
    const { results } = await env.DB.prepare(`SELECT post_id AS id, views FROM webposts WHERE post_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: number; views: number }>()
    const seen = new Map(results.map((r) => [r.id, r.views]))
    stories = stories.map((s) => ({ ...s, views: seen.get(s.id) ?? s.views ?? null }))
  }
  stories.sort((a, b) => a.time.localeCompare(b.time))
  let prevCount: number | undefined
  if (prevDay) {
    const pb = istDayBounds(prevDay)
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM webposts WHERE published >= ? AND published < ?')
      .bind(new Date(pb.start).toISOString().slice(0, 19), new Date(pb.end).toISOString().slice(0, 19))
      .first<{ n: number }>()
      .catch(() => null)
    prevCount = r?.n ?? undefined
  }
  return { stories, prevCount }
}

/** The previous working day's totals, for "vs yesterday". */
export interface PrevDay {
  day: string
  present: number
  total: number
  late: number
  reports: number
  minutes: number
}

const F = { sans: 'Arial,Helvetica,sans-serif', serif: "Georgia,'Times New Roman',serif" }

/** The email (pure, for tests). */
export function buildTeamEmail(d: TeamDayData, appUrl: string, now = Date.now(), prev?: PrevDay | null, site?: PublishedDay | null, ownerName = 'Palash'): { subject: string; html: string; text: string } {
  const date = new Date(`${d.day}T00:00:00Z`)
  const dateLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
  const shortDate = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date)
  const s = d.summary
  const absent = d.people.filter((p) => !p.checkIn && !p.leave)
  const present = d.people.filter((p) => p.checkIn)
  const noReport = present.filter((p) => !p.report)
  const isToday = new Date(now + IST_MS).toISOString().slice(0, 10) === d.day
  const nowMin = minOf(new Date(now).toISOString())
  const workedMin = (p: DayPerson) => (p.checkIn && !p.checkOut && isToday ? Math.max(p.minutes, nowMin - minOf(p.checkIn)) : p.minutes)
  const teamMin = present.reduce((n, p) => n + workedMin(p), 0)
  const onTime = Math.max(0, s.present - s.late)
  const subject = `Daily Team Report · ${shortDate} · ${s.present}/${s.total} in${s.late ? ` · ${s.late} late` : ''}${absent.length ? ` · ${absent.length} absent` : ''}${noReport.length ? ` · ${noReport.length} report${noReport.length === 1 ? '' : 's'} pending` : ''}${site ? ` · ${site.stories.length} stor${site.stories.length === 1 ? 'y' : 'ies'} published` : ''}`
  const order = (p: DayPerson) => (p.checkIn ? 0 : p.leave ? 1 : 2)
  const people = [...d.people].sort((a, b) => order(a) - order(b) || (a.checkIn ?? '').localeCompare(b.checkIn ?? '') || a.name.localeCompare(b.name))
  const grace = 15

  // One timeline scale for everyone, so the bars line up.
  const starts = people.map((p) => toMin(p.start, 600))
  const ends = people.map((p) => toMin(p.end, 1080))
  const ins = present.map((p) => minOf(p.checkIn!))
  const outs = present.map((p) => (p.checkOut ? minOf(p.checkOut) : isToday ? nowMin : toMin(p.end, 1080)))
  const from = Math.max(0, Math.floor((Math.min(...starts, ...ins, 600) - 30) / 60) * 60)
  const to = Math.min(1440, Math.ceil((Math.max(...ends, ...outs, 1080) + 30) / 60) * 60)

  // Action items, most serious first: red = needs action, amber = follow up, grey = for information.
  const items: { tone: 'red' | 'amber' | 'grey'; html: string }[] = []
  if (absent.length) items.push({ tone: 'red', html: `<b>Absent without leave:</b> ${absent.map((p) => esc(p.name)).join(', ')}` })
  for (const p of present.filter((x) => x.report?.blockers)) items.push({ tone: 'red', html: `<b>${esc(p.name)} is blocked:</b> ${esc(p.report!.blockers)}` })
  for (const p of people.filter((x) => x.tasks?.overdue)) items.push({ tone: 'red', html: `<b>${esc(p.name)}</b> has ${p.tasks!.overdue} overdue task${p.tasks!.overdue === 1 ? '' : 's'}` })
  for (const p of present.filter((x) => x.late)) {
    const by = minOf(p.checkIn!) - toMin(p.start, 600)
    items.push({ tone: 'amber', html: `<b>${esc(p.name)}</b> came in ${by > 0 ? `${hours(by).replace(/^0h /, '')} late` : 'late'}, at ${clock12(p.checkIn)}` })
  }
  if (noReport.length) items.push({ tone: 'amber', html: `<b>No work report from</b> ${noReport.map((p) => esc(p.name)).join(', ')}` })
  if (site && site.stories.length === 0 && s.present > 0) items.push({ tone: 'amber', html: '<b>No stories published</b> on realtynmore.com today' })
  for (const p of present.filter((x) => !x.checkOut)) items.push({ tone: 'grey', html: `<b>${esc(p.name)}</b> has not checked out yet` })
  const TONE = { red: { dot: C.red, bg: '#FBEAE5', fg: '#B23F20' }, amber: { dot: C.orange, bg: '#FCEFE2', fg: '#A6501A' }, grey: { dot: '#9A9AA0', bg: '#F1F0EC', fg: '#55555A' } }

  const pct = s.total ? Math.round((s.present / s.total) * 100) : 0
  const bits = [s.late ? `${s.late} late` : '', noReport.length ? `${noReport.length} report${noReport.length === 1 ? '' : 's'} pending` : '', s.onLeave ? `${s.onLeave} on leave` : '', absent.length ? `${absent.length} absent` : ''].filter(Boolean)
  const lead = s.total === 0 ? 'No team members yet.' : `${s.present} of ${s.total} in today${bits.length ? `, ${bits.join(', ')}` : ', everyone on time and every report in'}.`
  const preheader = `${lead} The team worked ${hours(teamMin)}.`

  /** "▲ 1 vs yesterday" in green, red or grey; for late, more is worse. */
  const delta = (cur: number, before: number | undefined, fmt: (n: number) => string, worseUp = false) => {
    if (before === undefined) return ''
    const diff = cur - before
    if (!diff) return `<div style="margin-top:6px;font:600 11px ${F.sans};color:#8D8D92">Same as ${prevLabel}</div>`
    const good = worseUp ? diff < 0 : diff > 0
    return `<div style="margin-top:6px;font:600 11px ${F.sans};color:${good ? '#6FD39B' : '#F08C6A'}">${diff > 0 ? '▲' : '▼'} ${fmt(Math.abs(diff))} vs ${prevLabel}</div>`
  }
  const prevLabel = prev ? (Date.parse(`${d.day}T00:00:00Z`) - Date.parse(`${prev.day}T00:00:00Z`) === 86400000 ? 'yesterday' : new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${prev.day}T00:00:00Z`))) : ''
  const prevPct = prev && prev.total ? Math.round((prev.present / prev.total) * 100) : undefined
  const metric = (label: string, value: string, sub: string, deltaHtml: string, first = false) =>
    `<td class="m" width="25%" valign="top" style="padding:18px 14px 20px;${first ? '' : 'border-left:1px solid #2A2A2E;'}"><div style="font:700 9.5px ${F.sans};letter-spacing:1.2px;text-transform:uppercase;color:#8D8D92">${label}</div><div style="margin-top:8px;font:700 ${value.length > 5 ? 21 : 26}px/1.15 ${F.serif};color:#FFFFFF">${value}</div><div style="margin-top:3px;font:12px ${F.sans};color:#A1A1A6">${sub}</div>${deltaHtml}</td>`

  const section = (title: string, right = '') =>
    `<tr><td class="px" style="padding:30px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font:700 11px ${F.sans};letter-spacing:2.2px;text-transform:uppercase;color:#A87412;white-space:nowrap;padding-right:12px">${title}</td><td width="100%" style="border-bottom:1px solid ${C.line};font-size:0;line-height:0">&nbsp;</td>${right ? `<td style="padding-left:12px;white-space:nowrap">${right}</td>` : ''}</tr></table></td></tr>`

  const legend = `<span style="font:11px ${F.sans};color:${C.mute}"><span style="display:inline-block;width:12px;height:4px;border-radius:2px;background:#F2DDB0;vertical-align:middle"></span> Shift&nbsp;&nbsp;<span style="display:inline-block;width:12px;height:4px;border-radius:2px;background:${C.green};vertical-align:middle"></span> Worked&nbsp;&nbsp;<span style="display:inline-block;width:12px;height:4px;border-radius:2px;background:${C.orange};vertical-align:middle"></span> Late</span>`

  const person = (p: DayPerson, i: number) => {
    const start = toMin(p.start, 600)
    const end = toMin(p.end, 1080)
    const inAt = p.checkIn ? minOf(p.checkIn) : null
    const workTo = p.checkIn ? (p.checkOut ? minOf(p.checkOut) : isToday ? nowMin : end) : null
    const st = p.checkIn
      ? p.checkOut
        ? { label: p.late ? 'Present · late' : 'Present', color: p.late ? '#A6501A' : '#1F7A45', dot: p.late ? C.orange : C.green }
        : { label: 'Still checked in', color: '#2A62B5', dot: C.blue }
      : p.leave
        ? { label: `On leave${p.leave.half ? ' · half day' : ''}`, color: '#5B3FD6', dot: C.purple }
        : { label: 'Absent', color: '#B23F20', dot: C.red }
    const bar = daySegments(from, to, start, end, inAt, workTo, grace)
      .map((seg) => `<td width="${seg.w}%" style="height:4px;background:${seg.color === '#F6E3BD' ? '#F2DDB0' : seg.color === '#EFEEEA' ? '#F1F0EC' : seg.color};font-size:0;line-height:0">&nbsp;</td>`)
      .join('')
    const placeLink = (pl: DayPerson['inPlace']) => (pl ? `<a href="${map(pl)}" style="color:${pl.office ? '#1F7A45' : '#A6501A'};text-decoration:none">${esc(pl.label)}</a>` : 'no location')
    const times = p.checkIn
      ? `<div style="font:700 14px ${F.sans};color:${C.ink};white-space:nowrap">${clock12(p.checkIn)} – ${p.checkOut ? clock12(p.checkOut) : 'now'}</div><div style="margin-top:2px;font:12px ${F.sans};color:${C.mute};white-space:nowrap">${hours(workedMin(p))} worked</div>`
      : p.leave
        ? `<div style="font:13px ${F.sans};color:${C.mute}">${esc(p.leave.kind)}</div>`
        : `<div style="font:13px ${F.sans};color:${C.mute}">Did not check in</div>`
    const meta = p.checkIn
      ? `<div style="margin-top:10px;font:12.5px/1.6 ${F.sans};color:${C.mute}">${esc(MODE[p.mode ?? 'office'] ?? p.mode ?? '')} &nbsp;·&nbsp; In: ${placeLink(p.inPlace)}${p.checkOut ? ` &nbsp;·&nbsp; Out: ${placeLink(p.outPlace)}` : ''}${p.start ? ` &nbsp;·&nbsp; Shift ${esc(p.start)}–${esc(p.end ?? '')}` : ''}${p.note ? `<br><i>“${esc(p.note)}”</i>` : ''}</div>`
      : ''
    const r = p.report
    const label = (t: string, color = '#8D8D92') => `<div style="font:700 10px ${F.sans};letter-spacing:1.4px;text-transform:uppercase;color:${color}">${t}</div>`
    const links = r?.links
      ? r.links
          .split(/\s+/)
          .filter((l) => /^https?:\/\//.test(l))
          .map((l) => `<a href="${esc(l)}" style="color:#2A62B5;text-decoration:none">${esc(l.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 48))}</a>`)
          .join(' &nbsp;·&nbsp; ')
      : ''
    const report = r
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr><td style="border-left:2px solid ${C.gold};padding:2px 0 2px 14px">
${label('Worked on')}<div style="margin:3px 0 0;font:14px/1.6 ${F.sans};color:#2A2A2E">${para(r.done)}</div>
${r.plan ? `<div style="margin-top:10px">${label('Tomorrow')}<div style="margin-top:3px;font:14px/1.6 ${F.sans};color:#2A2A2E">${para(r.plan)}</div></div>` : ''}
${r.blockers ? `<div style="margin-top:10px">${label('Blocked by', '#B23F20')}<div style="margin-top:3px;font:14px/1.6 ${F.sans};color:#B23F20">${para(r.blockers)}</div></div>` : ''}
${links ? `<div style="margin-top:10px;font:13px ${F.sans}">${links}</div>` : ''}
</td></tr></table>`
      : p.checkIn
        ? `<div style="margin-top:12px;font:italic 13px ${F.sans};color:#A6501A">No work report submitted.</div>`
        : ''
    const t = p.tasks
    const tasks =
      t && (t.done.length || t.open || t.overdue)
        ? `<div style="margin-top:10px;font:12.5px/1.6 ${F.sans};color:${C.mute}">Tasks: <b style="color:${C.ink}">${t.done.length} done</b> · ${t.open} open${t.overdue ? ` · <b style="color:#B23F20">${t.overdue} overdue</b>` : ''}${t.done.length ? ` &nbsp;—&nbsp; <span style="color:#1F7A45">${t.done.map(esc).join(', ')}</span>` : ''}</div>`
        : ''
    return `<tr><td style="padding:${i ? 22 : 18}px 0 22px;${i ? `border-top:1px solid ${C.line};` : ''}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="44" valign="top"><div style="width:38px;height:38px;border-radius:50%;background:${avatarColor(p.name)};color:#fff;font:700 14px/38px ${F.sans};text-align:center;letter-spacing:.5px">${esc(initials(p.name))}</div></td>
<td valign="top" style="padding-left:8px"><div style="font:700 16px/1.3 ${F.serif};color:${C.ink}">${esc(p.name)}</div><div style="margin-top:1px;font:12.5px ${F.sans};color:${C.mute}">${esc(p.title || 'Team member')}</div><div style="margin-top:5px;font:700 11.5px ${F.sans};color:${st.color}"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${st.dot};vertical-align:1px"></span>&nbsp; ${st.label}</div></td>
<td valign="top" align="right" style="padding-left:10px">${times}</td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-radius:2px;overflow:hidden"><tr>${bar}</tr></table>
${meta}${report}${tasks}
</td></tr>`
  }

  // What went up on the website that day.
  const pub = site?.stories ?? []
  const withViews = pub.filter((x) => x.views !== null)
  const totalViews = withViews.reduce((n, x) => n + (x.views ?? 0), 0)
  const sections = [...pub.reduce((m, x) => m.set(x.section, (m.get(x.section) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])
  const top = [...withViews].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0]
  const storyTime = (iso: string) => clock12(iso).replace(' ', ' ')
  const countDelta =
    site?.prevCount !== undefined
      ? (() => {
          const diff = pub.length - site.prevCount!
          return diff ? `<span style="color:${diff > 0 ? '#1F7A45' : '#B23F20'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} vs ${prevLabel || 'yesterday'}</span>` : `<span style="color:${C.mute}">same as ${prevLabel || 'yesterday'}</span>`
        })()
      : ''
  const MAX_STORIES = 30
  const publishedSection = `${section('Published on realtynmore.com', `<span style="font:700 11px ${F.sans};color:${C.mute}">${pub.length}</span>`)}
<tr><td class="px" style="padding:12px 36px 0">
${
  pub.length
    ? `<div style="font:14px/1.6 ${F.sans};color:#2A2A2E"><b style="font:700 22px ${F.serif};color:${C.ink}">${pub.length}</b> stor${pub.length === 1 ? 'y' : 'ies'} published${countDelta ? ` &nbsp;·&nbsp; ${countDelta}` : ''}${withViews.length ? ` &nbsp;·&nbsp; <b>${totalViews.toLocaleString('en-IN')}</b> views so far` : ''}</div>
<div style="margin-top:6px;font:12.5px/1.7 ${F.sans};color:${C.mute}">${sections.map(([name, n]) => `<span style="display:inline-block;margin:0 6px 4px 0;padding:2px 9px;border:1px solid ${C.line};border-radius:999px;color:#55555A">${esc(name)} <b style="color:${C.ink}">${n}</b></span>`).join('')}</div>
${
  top && (top.views ?? 0) > 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:#FBF6EA;border-radius:4px"><tr><td style="padding:14px 16px"><div style="font:700 10px ${F.sans};letter-spacing:1.4px;text-transform:uppercase;color:#A87412">Most read so far · ${(top.views ?? 0).toLocaleString('en-IN')} views</div><a href="${esc(top.link)}" style="display:block;margin-top:4px;font:700 16px/1.4 ${F.serif};color:${C.ink};text-decoration:none">${esc(top.title)}</a></td></tr></table>`
    : ''
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">
${pub
  .slice(0, MAX_STORIES)
  .map(
    (x, i) =>
      `<tr><td width="70" valign="top" style="padding:10px 10px 10px 0;${i ? `border-top:1px solid ${C.line};` : ''}font:12px ${F.sans};color:#9A9AA0;white-space:nowrap">${storyTime(x.time)}</td><td valign="top" style="padding:9px 0;${i ? `border-top:1px solid ${C.line};` : ''}"><a href="${esc(x.link)}" style="font:600 14px/1.45 ${F.sans};color:${C.ink};text-decoration:none">${esc(x.title)}</a><div style="margin-top:2px;font:11.5px ${F.sans};color:${C.mute}">${esc(x.section)}</div></td><td width="56" valign="top" align="right" style="padding:10px 0 10px 10px;${i ? `border-top:1px solid ${C.line};` : ''}font:700 13px ${F.sans};color:${C.ink};white-space:nowrap">${x.views !== null ? `${x.views.toLocaleString('en-IN')}<div style="font:400 10.5px ${F.sans};color:#9A9AA0">views</div>` : '<span style="color:#9A9AA0;font-weight:400">–</span>'}</td></tr>`,
  )
  .join('')}
</table>
${pub.length > MAX_STORIES ? `<div style="padding-top:8px;font:12.5px ${F.sans};color:${C.mute}">+ ${pub.length - MAX_STORIES} more on the website</div>` : ''}
<div style="padding-top:8px;font:11.5px ${F.sans};color:#9A9AA0">Views are from the website’s counter, updated every hour.</div>`
    : `<div style="font:14px ${F.sans};color:#A6501A">No stories were published on the website today.</div>`
}
</td></tr>`

  const logo = `${appUrl}brand/logo_white.png`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title>
<style>@media only screen and (max-width:520px){.m{display:inline-block!important;width:50%!important;box-sizing:border-box!important;border-left:0!important;border-bottom:1px solid #2A2A2E!important;padding:16px 14px!important}.m:nth-child(n+3){border-bottom:0!important}.px{padding-left:20px!important;padding-right:20px!important}.hl{font-size:26px!important}}</style></head>
<body style="margin:0;padding:0;background:#E9E6DF;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#E9E6DF">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E9E6DF"><tr><td align="center" style="padding:28px 10px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#FFFFFF;border-radius:4px;overflow:hidden;box-shadow:0 14px 40px rgba(20,20,22,.10)">

<tr><td class="px" style="background:#0F0F11;padding:26px 36px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle"><a href="https://realtynmore.com" style="text-decoration:none"><img src="${esc(logo)}" width="104" height="58" alt="Realty &amp; More" style="display:block;border:0;width:104px;height:auto"></a></td>
<td valign="middle" align="right"><div style="font:700 10px ${F.sans};letter-spacing:3px;text-transform:uppercase;color:${C.gold}">Evening Brief</div><div style="margin-top:5px;font:12px ${F.sans};color:#8D8D92">${esc(dateLabel)}</div></td>
</tr></table>
<div style="margin-top:30px;width:36px;height:2px;background:${C.gold};font-size:0;line-height:0">&nbsp;</div>
<div class="hl" style="margin-top:16px;font:400 30px/1.2 ${F.serif};color:#FFFFFF">Good evening, ${esc(ownerName)}.</div>
<div style="margin-top:10px;font:15px/1.6 ${F.sans};color:#C9C9CC">${esc(lead)} The team put in <b style="color:#FFFFFF">${hours(teamMin)}</b>${site ? ` and published <b style="color:#FFFFFF">${site.stories.length} stor${site.stories.length === 1 ? 'y' : 'ies'}</b> on the website` : ''}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border-top:1px solid #2A2A2E;table-layout:fixed"><tr>
${metric('Attendance', `${pct}%`, `${s.present} of ${s.total} in`, delta(pct, prevPct, (n) => `${n} pts`), true)}${metric('On time', String(onTime), `${s.late} late`, delta(s.late, prev?.late, (n) => `${n} late`, true))}${metric('Hours', hours(teamMin), 'whole team', delta(teamMin, prev?.minutes, (n) => hours(n).replace(/^0h /, '')))}${metric('Reports', `${s.reports}/${s.present || s.total}`, noReport.length ? `${noReport.length} pending` : 'all in', delta(s.reports, prev?.reports, (n) => String(n)))}
</tr></table>
</td></tr>

${section('Action items', items.length ? `<span style="font:700 11px ${F.sans};color:${C.mute}">${items.length}</span>` : '')}
<tr><td class="px" style="padding:10px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${
  items.length
    ? items
        .map(
          (it, i) =>
            `<tr><td width="34" valign="top" style="padding:10px 0;${i ? `border-top:1px solid ${C.line};` : ''}"><div style="width:22px;height:22px;border-radius:50%;background:${TONE[it.tone].bg};color:${TONE[it.tone].fg};font:700 11px/22px ${F.sans};text-align:center">${i + 1}</div></td><td valign="top" style="padding:11px 0 10px;font:14px/1.55 ${F.sans};color:#2A2A2E;${i ? `border-top:1px solid ${C.line};` : ''}">${it.html}</td></tr>`,
        )
        .join('')
    : `<tr><td style="padding:12px 0;font:14px ${F.sans};color:#1F7A45">✓&nbsp; Nothing needs your attention today.</td></tr>`
}
</table></td></tr>

${site ? publishedSection : ''}
${section('The team', legend)}
<tr><td class="px" style="padding:0 36px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${people.map(person).join('') || `<tr><td style="padding:16px 0;font:14px ${F.sans};color:${C.mute}">No team members yet.</td></tr>`}</table></td></tr>

<tr><td class="px" align="center" style="padding:10px 36px 36px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#141416;border-radius:2px"><a href="${esc(appUrl)}#/studio?tab=teamday" style="display:inline-block;padding:14px 30px;font:700 12px ${F.sans};letter-spacing:1.6px;text-transform:uppercase;color:${C.gold};text-decoration:none">Open the full report &rarr;</a></td></tr></table>
</td></tr>

<tr><td class="px" style="background:#0F0F11;padding:26px 36px;text-align:center">
<img src="${esc(logo)}" width="72" height="40" alt="Realty &amp; More" style="display:inline-block;border:0;width:72px;height:auto">
<div style="margin:14px auto 0;width:24px;height:1px;background:#3A3A40;font-size:0;line-height:0">&nbsp;</div>
<div style="margin-top:14px;font:11.5px/1.7 ${F.sans};color:#8D8D92">Confidential · prepared for ${esc(ownerName)}. Sent automatically every evening by the Realtynmore app.<br>Change the time or address in Studio → Team today → Daily team report.<br><a href="https://realtynmore.com" style="color:#B9B9BD;text-decoration:none">realtynmore.com</a></div>
</td></tr>

</table></td></tr></table></body></html>`

  const text = [
    `EVENING BRIEF · ${dateLabel}`,
    `Good evening, ${ownerName}. ${lead} The team put in ${hours(teamMin)}.`,
    `Attendance ${pct}% (${s.present}/${s.total}) · on time ${onTime} · late ${s.late} · reports ${s.reports} · ${s.onLeave ?? 0} on leave · ${absent.length} absent`,
    ...(items.length ? ['', 'Action items:', ...items.map((it, i) => `${i + 1}. ${it.html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')}`)] : []),
    ...(site ? ['', `Published on realtynmore.com: ${pub.length} stor${pub.length === 1 ? 'y' : 'ies'}${withViews.length ? `, ${totalViews} views so far` : ''}`, ...pub.map((x) => `- ${clock12(x.time)} · ${x.title} (${x.section}${x.views !== null ? `, ${x.views} views` : ''}) ${x.link}`)] : []),
    '',
    ...people.flatMap((p) => [
      `${p.name}${p.title ? ` (${p.title})` : ''}: ${p.checkIn ? `in ${clock(p.checkIn)}${p.late ? ' late' : ''}${p.inPlace ? ` (${p.inPlace.label})` : ''}, out ${clock(p.checkOut)}${p.outPlace ? ` (${p.outPlace.label})` : ''}, ${hours(workedMin(p))}` : p.leave ? `on leave (${p.leave.kind})` : 'absent'}`,
      ...(p.report ? [`  Done: ${p.report.done}`, ...(p.report.plan ? [`  Plan: ${p.report.plan}`] : []), ...(p.report.blockers ? [`  Blockers: ${p.report.blockers}`] : [])] : p.checkIn ? ['  No work report yet.'] : []),
      '',
    ]),
    `${appUrl}#/studio?tab=teamday`,
  ]
  return { subject, html, text: text.join('\n') }
}

/** Sends today's report (from the cron at the set time, or "Send now" in the Studio). */
export async function sendTeamEmail(env: Env, force = false, now = Date.now()): Promise<string> {
  const { teamSettings, teamDay } = await import('./team.ts')
  const s = await teamSettings(env)
  if (!force && !s.reportEmailOn) return 'team email off'
  if (!env.BREVO_API_KEY) return force ? 'Email sending isn’t connected yet (Brevo key).' : 'team email: not connected'
  const day = new Date(now + IST_MS).toISOString().slice(0, 10)
  const mins = Number(new Date(now + IST_MS).toISOString().slice(11, 13)) * 60 + Number(new Date(now + IST_MS).toISOString().slice(14, 16))
  const [h, m] = s.reportEmailTime.split(':').map(Number)
  const key = `state:team-email:${day}`
  if (!force && (mins < h * 60 + m || (await env.SUBS.get(key)))) return 'team email not due'
  const data = (await teamDay(env, day)) as unknown as TeamDayData
  // A day off with nobody working sends nothing.
  if (!force && data.summary.present === 0 && data.summary.reports === 0) {
    await env.SUBS.put(key, 'skipped', { expirationTtl: 2 * 86400 })
    return 'team email skipped (nobody worked today)'
  }
  // The last earlier day anyone worked (skips Sundays and holidays), for "vs yesterday".
  let prev: PrevDay | null = null
  for (let back = 1; back <= 4 && !prev; back++) {
    const pd = new Date(now + IST_MS - back * 86400000).toISOString().slice(0, 10)
    const p = (await teamDay(env, pd).catch(() => null)) as unknown as TeamDayData | null
    if (p && p.summary.present > 0) prev = { day: pd, present: p.summary.present, total: p.summary.total, late: p.summary.late, reports: p.summary.reports, minutes: p.people.reduce((n, x) => n + (x.checkIn ? x.minutes : 0), 0) }
  }
  const site = await publishedOn(env, day, prev?.day ?? new Date(now + IST_MS - 86400000).toISOString().slice(0, 10)).catch(() => null)
  const mail = buildTeamEmail(data, env.APP_URL, now, prev, site)
  const { sendRaw } = await import('./newsletter.ts')
  const r = await sendRaw(env, { to: s.reportEmail, subject: mail.subject, html: mail.html, text: mail.text, tag: 'team-report' })
  if (r === 'ok') {
    if (!force) await env.SUBS.put(key, '1', { expirationTtl: 2 * 86400 })
    return `Team report sent to ${s.reportEmail}`
  }
  return r === 'quota' ? 'Today’s email limit is used up.' : 'The email service refused the message.'
}
