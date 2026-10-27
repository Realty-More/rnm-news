// Daily team report by email to the owner (default palash@realtynmore.com, 19:30 IST):
// for each person, check-in and check-out times and place, hours, mode, the work report, tasks and leave.
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

/** The email (pure, for tests). */
export function buildTeamEmail(d: TeamDayData, appUrl: string): { subject: string; html: string; text: string } {
  const dateLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d.day}T00:00:00Z`))
  const absent = d.people.filter((p) => !p.checkIn && !p.leave)
  const s = d.summary
  const subject = `Team report ${d.day.slice(8)}/${d.day.slice(5, 7)}: ${s.present}/${s.total} in${s.late ? `, ${s.late} late` : ''}${absent.length ? `, ${absent.length} absent` : ''}, ${s.reports} reports`
  // Present people first (by check-in), then on leave, then absent.
  const order = (p: DayPerson) => (p.checkIn ? 0 : p.leave ? 1 : 2)
  const people = [...d.people].sort((a, b) => order(a) - order(b) || (a.checkIn ?? '').localeCompare(b.checkIn ?? '') || a.name.localeCompare(b.name))

  const chip = (label: string, value: string | number, color: string) =>
    `<td style="padding:10px 12px;background:#f7f6f2;border-radius:8px;text-align:center"><div style="font:700 22px Georgia,serif;color:${color}">${value}</div><div style="font-size:12px;color:#6b6b70">${label}</div></td>`
  const cards = people
    .map((p) => {
      const status = p.checkIn
        ? `<span style="color:#1b7f3b;font-weight:700">Present</span>${p.late ? ' · <span style="color:#c62828;font-weight:700">Late</span>' : ''}`
        : p.leave
          ? `<span style="color:#3b7ddd;font-weight:700">On leave</span> · ${esc(p.leave.kind)}${p.leave.half ? ' (half day)' : ''}`
          : '<span style="color:#c62828;font-weight:700">Absent</span>'
      const place = (pl: DayPerson['inPlace']) =>
        pl ? ` · <a href="${map(pl)}" style="color:${pl.office ? '#1b7f3b' : '#c62828'};text-decoration:none">📍 ${esc(pl.label)}</a>` : p.checkIn ? ' · <span style="color:#9a9aa0">no location</span>' : ''
      const times = p.checkIn
        ? `<p style="margin:6px 0 0;font-size:14px">In <b>${clock(p.checkIn)}</b>${place(p.inPlace)}<br>Out <b>${clock(p.checkOut)}</b>${p.checkOut ? place(p.outPlace) : ' · still checked in'}<br>Hours <b>${hours(p.minutes)}</b>${p.mode ? ` · ${esc(MODE[p.mode] ?? p.mode)}` : ''}${p.start ? ` · shift ${p.start}–${p.end}` : ''}${p.note ? `<br>Note: ${esc(p.note)}` : ''}</p>`
        : ''
      const r = p.report
      const report = r
        ? `<div style="margin-top:8px;padding:10px 12px;background:#f7f6f2;border-radius:8px;font-size:14px;line-height:1.5"><b>Done today</b><br>${para(r.done)}${r.plan ? `<br><b>Plan for tomorrow</b><br>${para(r.plan)}` : ''}${r.blockers ? `<br><b style="color:#c62828">Blockers</b><br>${para(r.blockers)}` : ''}${r.links ? `<br><b>Links</b><br>${para(r.links)}` : ''}</div>`
        : p.checkIn
          ? '<p style="margin:6px 0 0;font-size:13px;color:#c62828">No work report yet.</p>'
          : ''
      const t = p.tasks
      const tasks =
        t && (t.done.length || t.open || t.overdue)
          ? `<p style="margin:6px 0 0;font-size:13px">Tasks: ${t.done.length} done${t.done.length ? ` (${t.done.map(esc).join('; ')})` : ''} · ${t.open} open${t.overdue ? ` · <b style="color:#c62828">${t.overdue} overdue</b>` : ''}</p>`
          : ''
      return `<tr><td style="padding:14px 0;border-top:1px solid #ecebe6"><b style="font-size:16px">${esc(p.name)}</b>${p.title ? ` <span style="color:#6b6b70;font-size:13px">· ${esc(p.title)}</span>` : ''}<br><span style="font-size:13px">${status}</span>${times}${report}${tasks}</td></tr>`
    })
    .join('')

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f2f1ed;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#0e0e10;padding:18px 22px;color:#fff"><b style="color:#FAA61B;font-size:12px;letter-spacing:1.5px">REALTYNMORE · DAILY TEAM REPORT</b><br><span style="font:700 22px Georgia,serif">${esc(dateLabel)}</span></td></tr>
<tr><td style="padding:18px 22px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
${chip('Checked in', `${s.present}/${s.total}`, '#1b7f3b')}${chip('Late', s.late, s.late ? '#c62828' : '#1a1a1a')}${chip('Reports', s.reports, '#1a1a1a')}${chip('On leave', s.onLeave ?? 0, '#3b7ddd')}${chip('Absent', absent.length, absent.length ? '#c62828' : '#1a1a1a')}
</tr></table></td></tr>
<tr><td style="padding:4px 22px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards || '<tr><td style="padding:14px 0;color:#6b6b70">No team members yet.</td></tr>'}</table></td></tr>
<tr><td style="padding:14px 22px 22px;text-align:center"><a href="${esc(appUrl)}#/studio?tab=teamday" style="display:inline-block;background:#FAA61B;color:#1a1a1a;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:999px">Open Team today</a>
<p style="margin:12px 0 0;font-size:12px;color:#6b6b70">Sent every evening by the Realtynmore app. Change the time or address in Studio → Team today → Daily team report.</p></td></tr>
</table></td></tr></table></body></html>`

  const text = [
    `Daily team report · ${dateLabel}`,
    `${s.present}/${s.total} checked in · ${s.late} late · ${s.reports} reports · ${s.onLeave ?? 0} on leave · ${absent.length} absent`,
    '',
    ...people.flatMap((p) => [
      `${p.name}${p.title ? ` (${p.title})` : ''}: ${p.checkIn ? `in ${clock(p.checkIn)}${p.late ? ' late' : ''}${p.inPlace ? ` (${p.inPlace.label})` : ''}, out ${clock(p.checkOut)}${p.outPlace ? ` (${p.outPlace.label})` : ''}, ${hours(p.minutes)}` : p.leave ? `on leave (${p.leave.kind})` : 'absent'}`,
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
  const mail = buildTeamEmail(data, env.APP_URL)
  const { sendRaw } = await import('./newsletter.ts')
  const r = await sendRaw(env, { to: s.reportEmail, subject: mail.subject, html: mail.html, text: mail.text, tag: 'team-report' })
  if (r === 'ok') {
    if (!force) await env.SUBS.put(key, '1', { expirationTtl: 2 * 86400 })
    return `Team report sent to ${s.reportEmail}`
  }
  return r === 'quota' ? 'Today’s email limit is used up.' : 'The email service refused the message.'
}
