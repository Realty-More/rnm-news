// "Monthly Report" for Palash sir: on the 1st of every month at 9 AM IST, a detailed email about the
// month that ended. Same look as the Evening Brief (dark header, gold accents, email-safe tables).
//   1. Headline numbers: attendance, hours, reports, stories published, YouTube uploads, app reads.
//   2. The team, person by person: days present, late, leave, absent, hours, reports, tasks done/open,
//      average check-in.
//   3. Tasks (given, done, still open, overdue) and leave taken (by person and type).
//   4. Website: stories published, views, busiest sections, top stories.
//   5. YouTube: uploads (videos and Shorts), views, top uploads.
//   6. The app: screen views, stories read, top searches.
// Also from R&M Newsroom → Team today → Monthly report (Preview / Send now).
import type { Env } from './index.ts'

const IST_MS = 5.5 * 3600000
const C = { gold: '#FAA61B', ink: '#141416', mute: '#6B6B70', line: '#ECEBE6', soft: '#F7F6F2', green: '#2E9D5B', orange: '#E0782F', red: '#D9502E', blue: '#3B7DDD' }
const F = { sans: 'Arial,Helvetica,sans-serif', serif: "Georgia,'Times New Roman',serif" }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const hours = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m` : '–')
const num = (n: number) => n.toLocaleString('en-IN')
const istMonth = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 7)
export const prevMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`
}
const monthLabel = (m: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`))
/** UTC start/end of an IST month, as "YYYY-MM-DDTHH:MM:SS". */
const monthBounds = (m: string) => {
  const start = Date.parse(`${m}-01T00:00:00Z`) - IST_MS
  const [y, mo] = m.split('-').map(Number)
  const end = Date.UTC(y, mo, 1) - IST_MS
  const iso = (x: number) => new Date(x).toISOString().slice(0, 19)
  return { from: iso(start), to: iso(end) }
}

interface Person {
  id: string
  name: string
  present: number
  late: number
  reports: number
  minutes: number
  avgCheckIn: string | null
  workingDays: number
  leave: number
  leaveByKind: Record<string, number>
  absent: number
  tasksDone: number
  tasksOpen: number
  tasksOverdue: number
}
export interface MonthData {
  month: string
  people: Person[]
  tasks: { given: number; done: number; open: number; overdue: number; topDone: { title: string; who: string }[] }
  leaves: { name: string; kind: string; from: string; to: string; days: number; status: string }[]
  site: { stories: number; prevStories: number; views: number; sections: { name: string; n: number }[]; top: { title: string; link: string; views: number; section: string }[] }
  yt: { uploads: number; prevUploads: number; shorts: number; views: number; top: { id: string; title: string; views: number; short: boolean }[] }
  app: { views: number; prevViews: number; reads: number; prevReads: number; searches: { q: string; n: number }[] }
}

/** Everything for one month (pure database reads). */
export async function monthData(env: Env, month: string): Promise<MonthData> {
  const { teamMonth } = await import('./team.ts')
  const { LEAVE_KINDS } = await import('./work.ts')
  const pm = prevMonth(month)
  const b = monthBounds(month)
  const pb = monthBounds(pm)
  const monthEnd = `${month}-31`
  const [team, tasks, leaves, posts, prevPosts, vids, prevVids, pages, prevPages, opens, prevOpens, searches] = await Promise.all([
    teamMonth(env, month),
    env.DB.prepare('SELECT title, assignee_id, assignee_name, status, due, created_at, done_at FROM tasks WHERE substr(created_at, 1, 7) = ? OR substr(done_at, 1, 7) = ? OR status = ?')
      .bind(month, month, 'open')
      .all<{ title: string; assignee_id: string; assignee_name: string; status: string; due: string | null; created_at: string; done_at: string | null }>(),
    env.DB.prepare("SELECT name, kind, from_day, to_day, half, status FROM leaves WHERE status IN ('approved', 'pending') AND from_day <= ? AND to_day >= ? ORDER BY from_day")
      .bind(monthEnd, `${month}-01`)
      .all<{ name: string; kind: string; from_day: string; to_day: string; half: number; status: string }>(),
    env.DB.prepare('SELECT title, link, section, views FROM webposts WHERE published >= ? AND published < ? ORDER BY views DESC').bind(b.from, b.to).all<{ title: string; link: string; section: string; views: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM webposts WHERE published >= ? AND published < ?').bind(pb.from, pb.to).first<{ n: number }>(),
    env.DB.prepare('SELECT id, title, short, views FROM yt_videos WHERE published >= ? AND published < ? ORDER BY views DESC').bind(b.from, b.to).all<{ id: string; title: string; short: number | null; views: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM yt_videos WHERE published >= ? AND published < ?').bind(pb.from, pb.to).first<{ n: number }>(),
    env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM pages WHERE substr(day, 1, 7) = ?').bind(month).first<{ n: number }>(),
    env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM pages WHERE substr(day, 1, 7) = ?').bind(pm).first<{ n: number }>(),
    env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM opens WHERE substr(day, 1, 7) = ?').bind(month).first<{ n: number }>(),
    env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM opens WHERE substr(day, 1, 7) = ?').bind(pm).first<{ n: number }>(),
    env.DB.prepare('SELECT q, SUM(n) AS n FROM searches WHERE substr(day, 1, 7) = ? GROUP BY q ORDER BY n DESC LIMIT 6').bind(month).all<{ q: string; n: number }>(),
  ])
  const today = new Date(Date.now() + IST_MS).toISOString().slice(0, 10)
  const t = tasks.results
  const inMonth = (iso: string | null) => !!iso && iso.slice(0, 7) === month
  const doneIn = t.filter((x) => x.status === 'done' && inMonth(x.done_at))
  const openNow = t.filter((x) => x.status === 'open')
  const overdue = openNow.filter((x) => x.due && x.due < today)
  const people: Person[] = (team.rows as Omit<Person, 'tasksDone' | 'tasksOpen' | 'tasksOverdue'>[]).map((r) => ({
    ...r,
    tasksDone: doneIn.filter((x) => x.assignee_id === r.id).length,
    tasksOpen: openNow.filter((x) => x.assignee_id === r.id).length,
    tasksOverdue: overdue.filter((x) => x.assignee_id === r.id).length,
  }))
  const sec = new Map<string, number>()
  for (const p of posts.results) sec.set(p.section || 'News', (sec.get(p.section || 'News') ?? 0) + 1)
  const dayCount = (from: string, to: string, half: number) => {
    const a = Math.max(Date.parse(`${from}T00:00:00Z`), Date.parse(`${month}-01T00:00:00Z`))
    const [y, mo] = month.split('-').map(Number)
    const z = Math.min(Date.parse(`${to}T00:00:00Z`), Date.UTC(y, mo, 0))
    const n = Math.max(0, Math.round((z - a) / 86400000) + 1)
    return half ? 0.5 : n
  }
  return {
    month,
    people,
    tasks: {
      given: t.filter((x) => inMonth(x.created_at)).length,
      done: doneIn.length,
      open: openNow.length,
      overdue: overdue.length,
      topDone: doneIn.slice(0, 8).map((x) => ({ title: x.title, who: x.assignee_name })),
    },
    leaves: leaves.results.map((l) => ({ name: l.name, kind: (LEAVE_KINDS as Record<string, string>)[l.kind] ?? l.kind, from: l.from_day, to: l.to_day, days: dayCount(l.from_day, l.to_day, l.half), status: l.status })),
    site: {
      stories: posts.results.length,
      prevStories: prevPosts?.n ?? 0,
      views: posts.results.reduce((n, p) => n + (p.views || 0), 0),
      sections: [...sec].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 6),
      top: posts.results.slice(0, 5).map((p) => ({ title: p.title, link: p.link, views: p.views || 0, section: p.section || 'News' })),
    },
    yt: {
      uploads: vids.results.length,
      prevUploads: prevVids?.n ?? 0,
      shorts: vids.results.filter((v) => v.short === 1).length,
      views: vids.results.reduce((n, v) => n + (v.views || 0), 0),
      top: vids.results.slice(0, 5).map((v) => ({ id: v.id, title: v.title, views: v.views || 0, short: v.short === 1 })),
    },
    app: { views: pages?.n ?? 0, prevViews: prevPages?.n ?? 0, reads: opens?.n ?? 0, prevReads: prevOpens?.n ?? 0, searches: searches.results },
  }
}

const ytLink = (id: string, short: boolean) => (short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`)
const fmtDay = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))

/** The email (pure). */
export function buildMonthEmail(d: MonthData, appUrl: string, ownerName = 'Palash'): { subject: string; html: string; text: string } {
  const label = monthLabel(d.month)
  const ppl = d.people
  const workSlots = ppl.reduce((n, p) => n + Math.max(0, p.workingDays - p.leave), 0)
  const present = ppl.reduce((n, p) => n + p.present, 0)
  const attPct = workSlots ? Math.min(100, Math.round((present / workSlots) * 100)) : 0
  const minutes = ppl.reduce((n, p) => n + p.minutes, 0)
  const reports = ppl.reduce((n, p) => n + p.reports, 0)
  const late = ppl.reduce((n, p) => n + p.late, 0)
  const absent = ppl.reduce((n, p) => n + p.absent, 0)
  const change = (now: number, before: number) => {
    if (!before) return ''
    const pct = Math.round(((now - before) / before) * 100)
    return pct === 0 ? 'same as last month' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs last month`
  }
  const subject = `Monthly Report · ${label} · ${attPct}% attendance · ${d.site.stories} stories · ${d.yt.uploads} videos`
  const metric = (title: string, value: string, sub: string, first = false) =>
    `<td class="m" width="33%" valign="top" style="padding:18px 14px 18px ${first ? '0' : '16px'};${first ? '' : 'border-left:1px solid #2A2A2E;'}border-bottom:1px solid #2A2A2E"><div class="st" style="font:700 9.5px ${F.sans};letter-spacing:1.6px;text-transform:uppercase;color:#8D8D92;white-space:nowrap">${title}</div><div class="mv" style="margin-top:8px;font:400 27px/1 ${F.serif};color:#FFFFFF">${value}</div><div class="ms" style="margin-top:7px;font:12px ${F.sans};color:#B9B9BD">${sub}</div></td>`
  const section = (title: string, right = '') =>
    `<tr><td class="px" style="padding:30px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font:700 11px ${F.sans};letter-spacing:2px;text-transform:uppercase;color:${C.ink};border-bottom:2px solid ${C.ink};padding-bottom:8px">${title}</td><td align="right" style="font:12px ${F.sans};color:${C.mute};border-bottom:2px solid ${C.ink};padding-bottom:8px">${right}</td></tr></table></td></tr>`
  const bar = (v: number, max: number, color: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:10px;background:#F1F0EC;border-radius:3px;font-size:0;line-height:0"><div style="width:${max ? Math.max(3, Math.round((v / max) * 100)) : 0}%;height:10px;background:${color};border-radius:3px;font-size:0;line-height:0">&nbsp;</div></td></tr></table>`

  // Highlights and concerns, most important first.
  const notes: { tone: 'good' | 'warn'; text: string }[] = []
  const best = [...ppl].filter((p) => p.workingDays).sort((a, b) => b.present - a.present || b.reports - a.reports)[0]
  if (best && best.present) notes.push({ tone: 'good', text: `${best.name}: ${best.present} days in, ${best.reports} reports.` })
  const topStory = d.site.top[0]
  if (topStory) notes.push({ tone: 'good', text: `Most read story: “${topStory.title}” (${num(topStory.views)} views).` })
  for (const p of ppl.filter((x) => x.absent >= 2).sort((a, b) => b.absent - a.absent)) notes.push({ tone: 'warn', text: `${p.name} was absent ${p.absent} working day${p.absent === 1 ? '' : 's'} without leave.` })
  for (const p of ppl.filter((x) => x.late >= 3).sort((a, b) => b.late - a.late)) notes.push({ tone: 'warn', text: `${p.name} was late ${p.late} times.` })
  const noReports = ppl.filter((x) => x.present >= 3 && x.reports < x.present * 0.6)
  for (const p of noReports) notes.push({ tone: 'warn', text: `${p.name} sent ${p.reports} reports for ${p.present} days in.` })
  if (d.tasks.overdue) notes.push({ tone: 'warn', text: `${d.tasks.overdue} task${d.tasks.overdue === 1 ? ' is' : 's are'} overdue right now.` })

  const th = (t: string, align = 'left', cls = '') => `<td class="th${cls ? ` ${cls}` : ''}" align="${align}" style="padding:8px 6px;font:700 9.5px ${F.sans};letter-spacing:1px;text-transform:uppercase;color:${C.mute};border-bottom:1px solid ${C.line};white-space:nowrap">${t}</td>`
  const tdc = (v: string, align = 'center', color: string = C.ink, bold = false, cls = 'tc') => `<td class="${cls}" align="${align}" style="padding:10px 6px;font:${bold ? 700 : 400} 13px ${F.sans};color:${color};border-bottom:1px solid ${C.line};white-space:nowrap">${v}</td>`
  const teamRows = [...ppl]
    .sort((a, b) => b.present - a.present || a.name.localeCompare(b.name))
    .map(
      (p) =>
        `<tr>${tdc(`<b>${esc(p.name)}</b>${p.avgCheckIn ? `<br><span style="font-size:11px;color:${C.mute}">avg in ${p.avgCheckIn}</span>` : ''}`, 'left')}${tdc(`${p.present}/${p.workingDays}`, 'center', C.ink, true)}${tdc(String(p.late || '–'), 'center', p.late ? C.orange : C.mute)}${tdc(p.leave ? String(p.leave) : '–', 'center', p.leave ? C.blue : C.mute, false, 'tc hm')}${tdc(String(p.absent || '–'), 'center', p.absent ? C.red : C.mute)}${tdc(hours(p.minutes), 'center', C.ink, false, 'tc hm')}${tdc(String(p.reports))}${tdc(`${p.tasksDone}${p.tasksOpen ? `<span style="color:${C.mute}">/${p.tasksOpen}</span>` : ''}`)}</tr>`,
    )
    .join('')
  const hmax = Math.max(1, ...ppl.map((p) => p.minutes))
  const hoursRows = [...ppl]
    .filter((p) => p.minutes)
    .sort((a, b) => b.minutes - a.minutes)
    .map((p) => `<tr><td width="32%" style="padding:5px 10px 5px 0;font:600 13px ${F.sans};color:${C.ink};white-space:nowrap">${esc(p.name)}</td><td style="padding:5px 0">${bar(p.minutes, hmax, C.green)}</td><td width="70" align="right" style="padding:5px 0 5px 10px;font:700 13px ${F.sans};color:${C.ink};white-space:nowrap">${hours(p.minutes)}</td></tr>`)
    .join('')
  const smax = Math.max(1, ...d.site.sections.map((s) => s.n))
  const list = (items: string[]) => items.map((x, i) => `<tr><td width="26" valign="top" style="padding:9px 0;${i ? `border-top:1px solid ${C.line};` : ''}font:700 13px ${F.sans};color:${C.gold}">${i + 1}</td><td style="padding:9px 0;${i ? `border-top:1px solid ${C.line};` : ''}font:14px/1.45 ${F.sans};color:#2A2A2E">${x}</td></tr>`).join('')
  const logo = `${appUrl}brand/logo_white.png`
  const lead = `In ${label} the team was in ${attPct}% of working days and put in ${hours(minutes)}, sent ${reports} reports, finished ${d.tasks.done} task${d.tasks.done === 1 ? '' : 's'}, published ${d.site.stories} stor${d.site.stories === 1 ? 'y' : 'ies'} on the website and ${d.yt.uploads} video${d.yt.uploads === 1 ? '' : 's'} on YouTube.`

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title>
<style>@media only screen and (max-width:520px){.m{padding:14px 6px 14px 8px!important}.mv{font-size:20px!important}.st{letter-spacing:.8px!important;white-space:normal!important}.ms{font-size:11px!important}.px{padding-left:16px!important;padding-right:16px!important}.hl{font-size:25px!important}.hm{display:none!important}.th{letter-spacing:0!important;white-space:normal!important;font-size:9px!important;padding-left:3px!important;padding-right:3px!important}.tc{font-size:12px!important;padding-left:3px!important;padding-right:3px!important}}</style></head>
<body style="margin:0;padding:0;background:#E9E6DF;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#E9E6DF">${esc(lead)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E9E6DF"><tr><td align="center" style="padding:28px 10px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#FFFFFF;border-radius:4px;overflow:hidden;box-shadow:0 14px 40px rgba(20,20,22,.10)">

<tr><td class="px" style="background:#0F0F11;padding:26px 36px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle"><img src="${esc(logo)}" width="104" height="58" alt="Realty &amp; More" style="display:block;border:0;width:104px;height:auto"></td>
<td valign="middle" align="right"><div style="font:700 10px ${F.sans};letter-spacing:3px;text-transform:uppercase;color:${C.gold}">Monthly Report</div><div style="margin-top:5px;font:12px ${F.sans};color:#8D8D92">${esc(label)}</div></td>
</tr></table>
<div style="margin-top:30px;width:36px;height:2px;background:${C.gold};font-size:0;line-height:0">&nbsp;</div>
<div class="hl" style="margin-top:16px;font:400 30px/1.2 ${F.serif};color:#FFFFFF">${esc(label)} at Realty &amp; More</div>
<div style="margin-top:10px;font:15px/1.6 ${F.sans};color:#C9C9CC">Dear ${esc(ownerName)}, here is the month at a glance. ${esc(lead)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #2A2A2E;table-layout:fixed"><tr>
${metric('Attendance', `${attPct}%`, `${late} late · ${absent} absent`, true)}${metric('Hours worked', hours(minutes), `${reports} daily reports`)}${metric('Tasks done', String(d.tasks.done), `${d.tasks.open} open · ${d.tasks.overdue} overdue`)}
</tr><tr>
${metric('Website stories', String(d.site.stories), change(d.site.stories, d.site.prevStories) || `${num(d.site.views)} views`, true)}${metric('YouTube uploads', String(d.yt.uploads), change(d.yt.uploads, d.yt.prevUploads) || `${num(d.yt.views)} views`)}${metric('App stories read', num(d.app.reads), change(d.app.reads, d.app.prevReads) || `${num(d.app.views)} screen views`)}
</tr></table>
</td></tr>

${section('Highlights &amp; concerns', notes.length ? `${notes.length}` : '')}
<tr><td class="px" style="padding:8px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${
    notes.length
      ? notes
          .map(
            (n, i) =>
              `<tr><td width="30" valign="top" style="padding:10px 0;${i ? `border-top:1px solid ${C.line};` : ''}"><div style="width:20px;height:20px;border-radius:50%;background:${n.tone === 'good' ? '#E3F4EA' : '#FDECE6'};color:${n.tone === 'good' ? C.green : C.red};font:700 11px/20px ${F.sans};text-align:center">${n.tone === 'good' ? '★' : '!'}</div></td><td style="padding:10px 0;${i ? `border-top:1px solid ${C.line};` : ''}font:14px/1.5 ${F.sans};color:#2A2A2E">${esc(n.text)}</td></tr>`,
          )
          .join('')
      : `<tr><td style="padding:12px 0;font:14px ${F.sans};color:${C.mute}">A quiet month: nothing stood out.</td></tr>`
  }</table></td></tr>

${section('The team', `${ppl.length} people`)}
<tr><td class="px" style="padding:6px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>${th('Name')}${th('Days in', 'center')}${th('Late', 'center')}${th('Leave', 'center', 'hm')}${th('Absent', 'center')}${th('Hours', 'center', 'hm')}${th('Reports', 'center')}${th('Tasks', 'center')}</tr>
${teamRows || `<tr><td colspan="8" style="padding:14px 0;font:14px ${F.sans};color:${C.mute}">No team members.</td></tr>`}
</table></td></tr>
${hoursRows ? `<tr><td class="px" style="padding:18px 36px 0"><div style="font:700 10px ${F.sans};letter-spacing:1.4px;text-transform:uppercase;color:#8D8D92">Hours worked</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${hoursRows}</table></td></tr>` : ''}

${section('Tasks', `${d.tasks.given} given this month`)}
<tr><td class="px" style="padding:8px 36px 0;font:14px/1.6 ${F.sans};color:#2A2A2E">${d.tasks.done} done · ${d.tasks.open} still open${d.tasks.overdue ? ` · <b style="color:${C.red}">${d.tasks.overdue} overdue</b>` : ''}</td></tr>
${d.tasks.topDone.length ? `<tr><td class="px" style="padding:4px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list(d.tasks.topDone.map((x) => `${esc(x.title)} <span style="color:${C.mute}">· ${esc(x.who)}</span>`))}</table></td></tr>` : ''}

${section('Leave', d.leaves.length ? `${d.leaves.reduce((n, l) => n + l.days, 0)} days` : '')}
<tr><td class="px" style="padding:6px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${
    d.leaves.length
      ? d.leaves
          .map(
            (l, i) =>
              `<tr><td style="padding:9px 0;${i ? `border-top:1px solid ${C.line};` : ''}font:600 13.5px ${F.sans};color:${C.ink}">${esc(l.name)}</td><td style="padding:9px 6px;${i ? `border-top:1px solid ${C.line};` : ''}font:13px ${F.sans};color:#2A2A2E">${esc(l.kind)}</td><td style="padding:9px 6px;${i ? `border-top:1px solid ${C.line};` : ''}font:13px ${F.sans};color:#2A2A2E;white-space:nowrap">${fmtDay(l.from)}${l.to !== l.from ? ` – ${fmtDay(l.to)}` : ''}</td><td align="right" style="padding:9px 0;${i ? `border-top:1px solid ${C.line};` : ''}font:700 12px ${F.sans};color:${l.status === 'approved' ? C.green : C.orange};white-space:nowrap">${l.days} day${l.days === 1 ? '' : 's'}${l.status === 'pending' ? ' · waiting' : ''}</td></tr>`,
          )
          .join('')
      : `<tr><td style="padding:12px 0;font:14px ${F.sans};color:${C.mute}">No leave this month.</td></tr>`
  }</table></td></tr>

${section('realtynmore.com', `${d.site.stories} stories · ${num(d.site.views)} views`)}
${d.site.sections.length ? `<tr><td class="px" style="padding:10px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${d.site.sections.map((s) => `<tr><td width="32%" style="padding:4px 10px 4px 0;font:13px ${F.sans};color:${C.ink};white-space:nowrap">${esc(s.name)}</td><td style="padding:4px 0">${bar(s.n, smax, C.gold)}</td><td width="40" align="right" style="padding:4px 0 4px 10px;font:700 13px ${F.sans};color:${C.ink}">${s.n}</td></tr>`).join('')}</table></td></tr>` : ''}
<tr><td class="px" style="padding:8px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${
    d.site.top.length ? list(d.site.top.map((s) => `<a href="${esc(s.link)}" style="color:#2A2A2E;text-decoration:none">${esc(s.title)}</a> <span style="color:${C.mute}">· ${esc(s.section)} · ${num(s.views)} views</span>`)) : `<tr><td style="padding:12px 0;font:14px ${F.sans};color:${C.mute}">No stories published.</td></tr>`
  }</table></td></tr>

${section('YouTube', `${d.yt.uploads} uploads · ${d.yt.shorts} Shorts · ${num(d.yt.views)} views`)}
<tr><td class="px" style="padding:8px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${
    d.yt.top.length ? list(d.yt.top.map((v) => `<a href="${esc(ytLink(v.id, v.short))}" style="color:#2A2A2E;text-decoration:none">${esc(v.title)}</a> <span style="color:${C.mute}">· ${v.short ? 'Short' : 'Video'} · ${num(v.views)} views</span>`)) : `<tr><td style="padding:12px 0;font:14px ${F.sans};color:${C.mute}">No uploads this month.</td></tr>`
  }</table></td></tr>

${section('The Realtynmore app', `${num(d.app.views)} screen views`)}
<tr><td class="px" style="padding:8px 36px 0;font:14px/1.6 ${F.sans};color:#2A2A2E">${num(d.app.reads)} stories read in the app${change(d.app.reads, d.app.prevReads) ? ` (${change(d.app.reads, d.app.prevReads)})` : ''}.${d.app.searches.length ? `<br>Top searches: ${d.app.searches.map((s) => `“${esc(s.q)}” (${s.n})`).join(', ')}.` : ''}</td></tr>

<tr><td class="px" align="center" style="padding:30px 36px 36px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#141416;border-radius:2px"><a href="${esc(appUrl)}#/studio?tab=attendance" style="display:inline-block;padding:14px 30px;font:700 12px ${F.sans};letter-spacing:1.6px;text-transform:uppercase;color:${C.gold};text-decoration:none">Open the monthly attendance &rarr;</a></td></tr></table>
</td></tr>

<tr><td class="px" style="background:#0F0F11;padding:26px 36px;text-align:center">
<img src="${esc(logo)}" width="72" height="40" alt="Realty &amp; More" style="display:inline-block;border:0;width:72px;height:auto">
<div style="margin-top:14px;font:11.5px/1.7 ${F.sans};color:#8D8D92">Confidential · prepared for ${esc(ownerName)}. Sent automatically on the 1st of every month by the Realtynmore app.<br><a href="https://realtynmore.com" style="color:#B9B9BD;text-decoration:none">realtynmore.com</a></div>
</td></tr>
</table></td></tr></table></body></html>`

  const text = [
    `MONTHLY REPORT · ${label}`,
    `Dear ${ownerName}, ${lead}`,
    '',
    ...(notes.length ? ['Highlights & concerns:', ...notes.map((n) => `- ${n.text}`), ''] : []),
    'The team (days in / late / leave / absent / hours / reports / tasks done):',
    ...ppl.map((p) => `- ${p.name}: ${p.present}/${p.workingDays} · ${p.late} late · ${p.leave} leave · ${p.absent} absent · ${hours(p.minutes)} · ${p.reports} reports · ${p.tasksDone} tasks`),
    '',
    `Tasks: ${d.tasks.given} given, ${d.tasks.done} done, ${d.tasks.open} open, ${d.tasks.overdue} overdue`,
    `Leave: ${d.leaves.map((l) => `${l.name} ${l.kind} ${l.from}${l.to !== l.from ? `–${l.to}` : ''} (${l.days})`).join('; ') || 'none'}`,
    '',
    `realtynmore.com: ${d.site.stories} stories, ${num(d.site.views)} views`,
    ...d.site.top.map((s) => `- ${s.title} (${num(s.views)} views) ${s.link}`),
    '',
    `YouTube: ${d.yt.uploads} uploads (${d.yt.shorts} Shorts), ${num(d.yt.views)} views`,
    ...d.yt.top.map((v) => `- ${v.title} (${num(v.views)} views) ${ytLink(v.id, v.short)}`),
    '',
    `App: ${num(d.app.views)} screen views, ${num(d.app.reads)} stories read`,
    `${appUrl}#/studio?tab=attendance`,
  ]
  return { subject, html, text: text.join('\n') }
}

/** On the 1st at 9 AM IST (cron), or "Send now". `month` defaults to the month that just ended. */
export async function sendMonthEmail(env: Env, force = false, month?: string, now = Date.now()): Promise<string> {
  const { teamSettings } = await import('./team.ts')
  const s = await teamSettings(env)
  if (!force && !s.reportEmailOn) return 'monthly report off'
  const ist = new Date(now + IST_MS).toISOString()
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : prevMonth(istMonth(now))
  const key = `state:month-email:${m}`
  if (!force && (ist.slice(8, 10) !== '01' || ist.slice(11, 16) < '09:00' || (await env.SUBS.get(key)))) return 'monthly report not due'
  if (!env.BREVO_API_KEY) return force ? 'Email sending isn’t connected yet (Brevo key).' : 'monthly report: not connected'
  const mail = buildMonthEmail(await monthData(env, m), env.APP_URL)
  const { sendRaw } = await import('./newsletter.ts')
  const r = await sendRaw(env, { to: s.reportEmail, subject: mail.subject, html: mail.html, text: mail.text, tag: 'month-report' })
  if (r === 'ok') {
    if (!force) await env.SUBS.put(key, '1', { expirationTtl: 40 * 86400 })
    return `Monthly report for ${monthLabel(m)} sent to ${s.reportEmail}`
  }
  return r === 'quota' ? 'Today’s email limit is used up.' : 'The email service refused the message.'
}
