// Daily team report by email to the owner (default palash@realtynmore.com, 19:30 IST), in a premium
// branded layout: logo header with the day's headline, KPI tiles, a "Needs your attention" box
// (absent, late, missing reports, blockers, overdue tasks, not checked out), then a card per person
// with a day timeline bar (shift, worked, late start), times, place, the work report and tasks.
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

/** The email (pure, for tests). */
export function buildTeamEmail(d: TeamDayData, appUrl: string, now = Date.now()): { subject: string; html: string; text: string } {
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
  const subject = `Daily Team Report · ${shortDate} · ${s.present}/${s.total} in${s.late ? ` · ${s.late} late` : ''}${absent.length ? ` · ${absent.length} absent` : ''}${noReport.length ? ` · ${noReport.length} report${noReport.length === 1 ? '' : 's'} pending` : ''}`
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

  // Things the owner may want to act on.
  const attention: string[] = []
  if (absent.length) attention.push(`<b>Absent:</b> ${absent.map((p) => esc(p.name)).join(', ')}`)
  for (const p of present.filter((x) => x.late)) {
    const by = minOf(p.checkIn!) - toMin(p.start, 600)
    attention.push(`<b>${esc(p.name)}</b> came in ${by > 0 ? `${hours(by).replace(/^0h /, '')} late` : 'late'} (${clock12(p.checkIn)})`)
  }
  if (noReport.length) attention.push(`<b>No work report:</b> ${noReport.map((p) => esc(p.name)).join(', ')}`)
  for (const p of present.filter((x) => x.report?.blockers)) attention.push(`<b>${esc(p.name)} is blocked:</b> ${esc(p.report!.blockers)}`)
  for (const p of people.filter((x) => x.tasks?.overdue)) attention.push(`<b>${esc(p.name)}</b> has ${p.tasks!.overdue} overdue task${p.tasks!.overdue === 1 ? '' : 's'}`)
  for (const p of present.filter((x) => x.checkIn && !x.checkOut)) attention.push(`<b>${esc(p.name)}</b> has not checked out yet`)

  const pct = s.total ? Math.round((s.present / s.total) * 100) : 0
  // The line under the headline: what stands out, without repeating the headline.
  const bits = [
    s.late ? `${s.late} late` : '',
    noReport.length ? `${noReport.length} report${noReport.length === 1 ? '' : 's'} pending` : '',
    s.onLeave ? `${s.onLeave} on leave` : '',
    absent.length ? `${absent.length} absent` : '',
  ].filter(Boolean)
  const mood = s.total === 0 ? 'No team members yet.' : bits.length ? `${bits.join(' · ')}.` : 'Everyone on time, every report in.'
  const preheader = `${s.present} of ${s.total} in · ${mood} Team worked ${hours(teamMin)}.`

  const kpi = (label: string, value: string, color: string) =>
    `<td width="20%" valign="top" style="padding:0 3px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-top:3px solid ${color};border-radius:10px"><tr><td style="padding:12px 2px;text-align:center"><div style="font:700 ${value.length > 5 ? 15 : 24}px/1.6 Georgia,'Times New Roman',serif;color:${C.ink}${value.length > 5 ? "" : ";white-space:nowrap"}">${value}</div><div style="margin-top:4px;font:600 10px/1.3 Arial,Helvetica,sans-serif;letter-spacing:.4px;text-transform:uppercase;color:${C.mute};white-space:nowrap">${label}</div></td></tr></table></td>`

  const pill = (label: string, bg: string, fg = '#fff') => `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${bg};color:${fg};font:700 11px Arial,Helvetica,sans-serif;white-space:nowrap">${label}</span>`

  const card = (p: DayPerson) => {
    const start = toMin(p.start, 600)
    const end = toMin(p.end, 1080)
    const inAt = p.checkIn ? minOf(p.checkIn) : null
    const workTo = p.checkIn ? (p.checkOut ? minOf(p.checkOut) : isToday ? nowMin : end) : null
    const tone = p.checkIn ? C.green : p.leave ? C.purple : C.red
    const status = p.checkIn
      ? `${p.checkOut ? pill('Present', C.green) : pill('Still checked in', C.blue)}${p.late && inAt !== null ? ` ${pill(`Late +${hours(Math.max(0, inAt - start)).replace(/^0h /, '')}`, '#FCEBDD', '#A6501A')}` : ''}`
      : p.leave
        ? pill(`On leave${p.leave.half ? ' · half day' : ''}`, C.purple)
        : pill('Absent', C.red)
    const bar = daySegments(from, to, start, end, inAt, workTo, grace)
      .map((seg) => `<td width="${seg.w}%" style="height:8px;background:${seg.color};font-size:0;line-height:0">&nbsp;</td>`)
      .join('')
    const place = (pl: DayPerson['inPlace']) => (pl ? `<a href="${map(pl)}" style="color:${pl.office ? C.green : '#A6501A'};text-decoration:none">📍 ${esc(pl.label)}</a>` : '<span style="color:#9A9AA0">No location</span>')
    const fact = (label: string, value: string) => `<td valign="top" style="padding:0 14px 0 0"><div style="font:600 10.5px Arial,Helvetica,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:${C.mute}">${label}</div><div style="margin-top:2px;font:700 14px Arial,Helvetica,sans-serif;color:${C.ink}">${value}</div></td>`
    const facts = p.checkIn
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>${fact('In', clock12(p.checkIn))}${fact('Out', p.checkOut ? clock12(p.checkOut) : '–')}${fact('Hours', hours(workedMin(p)))}${p.mode ? fact('Mode', esc(MODE[p.mode] ?? p.mode)) : ''}</tr></table>
<div style="margin-top:8px;font:13px/1.5 Arial,Helvetica,sans-serif;color:${C.mute}">In: ${place(p.inPlace)}${p.checkOut ? ` &nbsp;·&nbsp; Out: ${place(p.outPlace)}` : ''}${p.note ? `<br>Note: ${esc(p.note)}` : ''}</div>`
      : p.leave
        ? `<div style="margin-top:10px;font:14px Arial,Helvetica,sans-serif;color:${C.ink}">${esc(p.leave.kind)}${p.leave.half ? ' (half day)' : ''}</div>`
        : ''
    const r = p.report
    const block = (label: string, body: string, color = C.mute) => `<div style="margin-top:8px"><div style="font:700 10.5px Arial,Helvetica,sans-serif;letter-spacing:.7px;text-transform:uppercase;color:${color}">${label}</div><div style="margin-top:2px;font:14px/1.55 Arial,Helvetica,sans-serif;color:${C.ink}">${body}</div></div>`
    const links = r?.links
      ? r.links
          .split(/\s+/)
          .filter((l) => /^https?:\/\//.test(l))
          .map((l) => `<a href="${esc(l)}" style="color:${C.blue};text-decoration:none">${esc(l.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48))}</a>`)
          .join('<br>')
      : ''
    const report = r
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:${C.soft};border-radius:10px"><tr><td style="padding:4px 14px 12px">${block('Worked on today', para(r.done))}${r.plan ? block('Plan for tomorrow', para(r.plan)) : ''}${r.blockers ? block('Blocked by', para(r.blockers), C.red) : ''}${links ? block('Links', links) : ''}</td></tr></table>`
      : p.checkIn
        ? `<div style="margin-top:12px;padding:10px 14px;border-radius:10px;background:#FFF4EC;font:600 13px Arial,Helvetica,sans-serif;color:#A6501A">No work report submitted</div>`
        : ''
    const t = p.tasks
    const tasks =
      t && (t.done.length || t.open || t.overdue)
        ? `<div style="margin-top:10px;font:13px/1.5 Arial,Helvetica,sans-serif;color:${C.mute}"><b style="color:${C.ink}">Tasks</b> &nbsp;${t.done.length} done · ${t.open} open${t.overdue ? ` · <b style="color:${C.red}">${t.overdue} overdue</b>` : ''}${t.done.length ? `<br><span style="color:${C.green}">✓ ${t.done.map(esc).join(' · ')}</span>` : ''}</div>`
        : ''
    return `<tr><td style="padding:0 0 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:12px;border-left:4px solid ${tone}"><tr><td style="padding:16px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="44" valign="middle"><div style="width:40px;height:40px;border-radius:50%;background:${avatarColor(p.name)};color:#fff;font:700 15px/40px Arial,Helvetica,sans-serif;text-align:center">${esc(initials(p.name))}</div></td>
<td valign="middle" style="padding-left:10px"><div style="font:700 16px/1.25 Arial,Helvetica,sans-serif;color:${C.ink}">${esc(p.name)}</div><div style="font:13px Arial,Helvetica,sans-serif;color:${C.mute}">${esc(p.title || 'Team member')}${p.start ? ` · Shift ${esc(p.start)}–${esc(p.end ?? '')}` : ''}</div></td>
<td valign="middle" align="right">${status}</td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-radius:999px;overflow:hidden"><tr>${bar}</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-top:3px;font:600 10px Arial,Helvetica,sans-serif;color:#9A9AA0">${hourLabel(from)}</td><td align="right" style="padding-top:3px;font:600 10px Arial,Helvetica,sans-serif;color:#9A9AA0">${hourLabel(to)}</td></tr></table>
${facts}${report}${tasks}
</td></tr></table>
</td></tr>`
  }

  const logo = `${appUrl}brand/logo_white.png`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#EFEDE7;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#EFEDE7">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFEDE7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(20,20,22,.08)">

<tr><td style="background:#141416;background-image:linear-gradient(135deg,#23201b 0%,#141416 60%);padding:22px 26px 26px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle"><a href="https://realtynmore.com" style="text-decoration:none"><img src="${esc(logo)}" width="112" height="62" alt="Realty &amp; More" style="display:block;border:0;width:112px;height:auto"></a></td>
<td valign="middle" align="right" style="font:700 11px Arial,Helvetica,sans-serif;letter-spacing:2px;color:${C.gold};text-transform:uppercase">Daily Team Report</td>
</tr></table>
<div style="margin-top:22px;font:13px Arial,Helvetica,sans-serif;color:#B9B9BD">${esc(dateLabel)}</div>
<div style="margin-top:6px;font:700 30px/1.15 Georgia,'Times New Roman',serif;color:#ffffff">${s.present} of ${s.total} <span style="color:${C.gold}">in today</span></div>
<div style="margin-top:8px;font:14px/1.5 Arial,Helvetica,sans-serif;color:#D2D2CE">${esc(mood)} The team worked <b style="color:#fff">${hours(teamMin)}</b>.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-radius:999px;overflow:hidden"><tr><td width="${Math.max(pct, 1)}%" style="height:6px;background:${C.gold};font-size:0;line-height:0">&nbsp;</td>${pct < 100 ? `<td style="height:6px;background:#34343A;font-size:0;line-height:0">&nbsp;</td>` : ''}</tr></table>
<div style="margin-top:6px;font:600 11px Arial,Helvetica,sans-serif;color:#8D8D92">${pct}% attendance</div>
</td></tr>

<tr><td style="padding:20px 18px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed"><tr>
${kpi('Present', `${s.present}/${s.total}`, C.green)}${kpi('On time', String(Math.max(0, s.present - s.late)), C.blue)}${kpi('Late', String(s.late), s.late ? C.orange : C.line)}${kpi('Reports', `${s.reports}/${s.present || s.total}`, C.gold)}${kpi('Hours', hours(teamMin), C.purple)}
</tr></table></td></tr>

${
  attention.length
    ? `<tr><td style="padding:14px 26px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7EE;border:1px solid #F6D9BC;border-left:4px solid ${C.orange};border-radius:10px"><tr><td style="padding:14px 16px">
<div style="font:700 11px Arial,Helvetica,sans-serif;letter-spacing:1.2px;text-transform:uppercase;color:#A6501A">Needs your attention</div>
${attention.map((a) => `<div style="margin-top:7px;font:14px/1.5 Arial,Helvetica,sans-serif;color:${C.ink}">•&nbsp; ${a}</div>`).join('')}
</td></tr></table></td></tr>`
    : `<tr><td style="padding:14px 26px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF8F1;border:1px solid #CBE9D5;border-left:4px solid ${C.green};border-radius:10px"><tr><td style="padding:12px 16px;font:600 14px Arial,Helvetica,sans-serif;color:#1F7A45">✓ All good today: everyone on time and every report in.</td></tr></table></td></tr>`
}

<tr><td style="padding:20px 26px 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font:700 18px Georgia,'Times New Roman',serif;color:${C.ink}">The team today</td>
<td align="right" style="font:11px Arial,Helvetica,sans-serif;color:${C.mute};white-space:nowrap"><span style="display:inline-block;width:10px;height:6px;border-radius:3px;background:#F6E3BD"></span> Shift &nbsp;<span style="display:inline-block;width:10px;height:6px;border-radius:3px;background:${C.green}"></span> Worked &nbsp;<span style="display:inline-block;width:10px;height:6px;border-radius:3px;background:${C.orange}"></span> Late</td></tr></table>
</td></tr>
<tr><td style="padding:8px 26px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${people.map(card).join('') || `<tr><td style="padding:14px 0;color:${C.mute}">No team members yet.</td></tr>`}</table></td></tr>

<tr><td align="center" style="padding:12px 26px 26px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:${C.gold}"><a href="${esc(appUrl)}#/studio?tab=teamday" style="display:inline-block;padding:13px 28px;font:700 14px Arial,Helvetica,sans-serif;color:${C.ink};text-decoration:none;border-radius:999px">Open Team today &rarr;</a></td></tr></table>
</td></tr>

<tr><td style="background:${C.soft};border-top:1px solid ${C.line};padding:18px 26px;text-align:center">
<div style="font:700 13px Georgia,'Times New Roman',serif;color:${C.ink}">Realty &amp; More</div>
<div style="margin-top:4px;font:12px/1.5 Arial,Helvetica,sans-serif;color:${C.mute}">Sent automatically every evening by the Realtynmore app · <a href="https://realtynmore.com" style="color:${C.mute}">realtynmore.com</a><br>Change the time or address in Studio → Team today → Daily team report.</div>
</td></tr>

</table></td></tr></table></body></html>`

  const text = [
    `Daily Team Report · ${dateLabel}`,
    `${s.present}/${s.total} in · ${s.late} late · ${s.reports} reports · ${s.onLeave ?? 0} on leave · ${absent.length} absent · team worked ${hours(teamMin)}`,
    ...(attention.length ? ['', 'Needs your attention:', ...attention.map((a) => `- ${a.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')}`)] : []),
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
  const mail = buildTeamEmail(data, env.APP_URL, now)
  const { sendRaw } = await import('./newsletter.ts')
  const r = await sendRaw(env, { to: s.reportEmail, subject: mail.subject, html: mail.html, text: mail.text, tag: 'team-report' })
  if (r === 'ok') {
    if (!force) await env.SUBS.put(key, '1', { expirationTtl: 2 * 86400 })
    return `Team report sent to ${s.reportEmail}`
  }
  return r === 'quota' ? 'Today’s email limit is used up.' : 'The email service refused the message.'
}
