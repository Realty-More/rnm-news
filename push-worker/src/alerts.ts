// Work alerts for the team: a phone notification (on devices where Newsroom notifications are on)
// and an email (to everyone who has added one).
//   • Managers (the owner and everyone with full access): new leave requests and finished tasks.
//   • A team member: a task given to them, and the decision on their leave.
// Emails go through Brevo (sendRaw), the same as the daily team email. Nothing here may break the
// action that triggered it, so every step swallows its own errors.
import type { Env } from './index.ts'
import type { Notice } from './push.ts'

const STAFF_PREFIX = 'staff-sub:'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The email of a team id: "ph:<mobile>" team logins, "rd:<n>" app accounts. */
export async function emailOfPerson(env: Env, personId: string): Promise<string | null> {
  if (personId.startsWith('ph:')) return (await env.DB.prepare("SELECT email FROM accounts WHERE phone = ? AND status = 'active'").bind(personId.slice(3)).first<{ email: string | null }>())?.email ?? null
  if (personId.startsWith('rd:')) return (await env.DB.prepare('SELECT email FROM readers WHERE id = ?').bind(Number(personId.slice(3))).first<{ email: string | null }>())?.email ?? null
  return null
}

/** The owner and everyone with full access: team ids (for phone alerts) and emails. */
async function managers(env: Env): Promise<{ ids: Set<string>; emails: Set<string> }> {
  const [accts, links, { listEditors }] = await Promise.all([
    env.DB.prepare("SELECT phone, role, email FROM accounts WHERE role IN ('owner', 'admin') AND status = 'active'").all<{ phone: string; role: string; email: string | null }>(),
    env.DB.prepare("SELECT l.reader_id, r.email FROM staff_links l JOIN readers r ON r.id = l.reader_id WHERE l.role = 'admin' AND l.person_id IS NULL").all<{ reader_id: number; email: string | null }>(),
    import('./owner.ts'),
  ])
  const keys = (await listEditors(env)).filter((e) => e.active && e.admin)
  const ids = new Set<string>([...accts.results.filter((a) => a.role === 'admin').map((a) => `ph:${a.phone}`), ...links.results.map((l) => `rd:${l.reader_id}`), ...keys.map((k) => k.id)])
  const emails = new Set<string>([...accts.results, ...links.results].map((x) => (x.email ?? '').trim().toLowerCase()).filter((e) => e.includes('@')))
  return { ids, emails }
}

function mailOf(env: Env, title: string, lines: string[], path: string) {
  const link = `${(env.APP_URL || 'https://realty-more.github.io/rnm-news/').replace(/\/?$/, '/')}${path}`
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#141416">
<p style="font:700 12px Arial;letter-spacing:2px;color:#A87412;text-transform:uppercase;margin:0">R&amp;M Newsroom</p>
<h1 style="font:400 24px Georgia,serif;margin:10px 0 14px">${esc(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 8px;font-size:15px;line-height:1.5">${esc(l)}</p>`).join('')}
<p style="margin:20px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#141416;color:#fff;text-decoration:none;padding:11px 18px;border-radius:999px;font:700 14px Arial">Open in R&amp;M Newsroom</a></p>
<p style="color:#6B6B70;font-size:12px;margin-top:22px">Realtynmore · this alert went to the people who need to act on it.</p></div>`
  return { html, text: `${title}\n\n${lines.join('\n')}\n\n${link}` }
}

async function email(env: Env, to: Iterable<string>, subject: string, title: string, lines: string[], path: string, tag: string) {
  const list = [...new Set(to)].slice(0, 10)
  if (!list.length) return
  const { sendRaw } = await import('./newsletter.ts')
  const m = mailOf(env, title, lines, path)
  await Promise.all(list.map((addr) => sendRaw(env, { to: addr, subject, html: m.html, text: m.text, tag }).catch(() => null)))
}

async function pushTo(env: Env, ids: Set<string>, notice: Notice) {
  if (!ids.size) return
  const { deliver } = await import('./push.ts')
  await deliver(env, STAFF_PREFIX, (st) => (ids.has((st as { person?: string }).person ?? '') ? [notice] : [])).catch(() => null)
}

/** To the owner and everyone with full access (not to `except`, the person who did it). */
export async function alertManagers(env: Env, a: { title: string; body: string; lines: string[]; path: string; tag: string; except?: string }) {
  try {
    const m = await managers(env)
    if (a.except) m.ids.delete(a.except)
    const except = a.except ? await emailOfPerson(env, a.except) : null
    if (except) m.emails.delete(except.toLowerCase())
    const notice: Notice = { title: a.title, body: a.body, url: `#${a.path.replace(/^#?/, '')}`, tag: a.tag }
    const { toOwners } = await import('./owner.ts')
    await Promise.all([toOwners(env, notice).catch(() => null), pushTo(env, m.ids, notice), email(env, m.emails, a.title, a.title, a.lines, a.path, a.tag.split('-')[0])])
  } catch {
    /* an alert never breaks the action */
  }
}

/** To one team member: their devices, and their email if they added one. */
export async function alertPerson(env: Env, personId: string, a: { title: string; body: string; lines: string[]; path: string; tag: string }) {
  try {
    const notice: Notice = { title: a.title, body: a.body, url: `#${a.path.replace(/^#?/, '')}`, tag: a.tag }
    const addr = await emailOfPerson(env, personId)
    await Promise.all([pushTo(env, new Set([personId]), notice), addr ? email(env, [addr], a.title, a.title, a.lines, a.path, a.tag.split('-')[0]) : null])
  } catch {
    /* an alert never breaks the action */
  }
}
