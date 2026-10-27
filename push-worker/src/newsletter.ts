// Weekly email newsletter ("The week in real estate").
//   Readers subscribe in the app with their email; a confirmation link (double opt-in) makes them
//   active, and every email has a one-click unsubscribe link.
//   Each week (default Saturday 10:00 IST) the issue is built from the week's most-read stories,
//   the latest R&M Magazine issue, the latest video and the Nifty Realty week, then sent in small
//   batches by the 10-minute cron, never more than the daily cap (Brevo's free plan: 300 a day).
//   Sending needs the BREVO_API_KEY secret; until it is set, sign-ups wait as "pending".
import type { Env } from './index.ts'
import type { Who } from './owner.ts'
import { fetchByIds, fetchLatest, type NewsItem } from './site.ts'

const IST_MS = 5.5 * 3600000
const istDay = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10)
const istClock = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(11, 16)
const BATCH = 12 // emails per cron run (the free plan allows 50 outgoing requests per run, shared)
const CONFIRM_BATCH = 4

export interface NlSettings {
  auto: boolean
  day: number // 0 Sunday … 6 Saturday
  time: string // "HH:MM" IST
  fromName: string
  fromEmail: string
  replyTo: string
  address: string
  intro: string
  dailyCap: number
}
const DEFAULTS: NlSettings = { auto: true, day: 6, time: '10:00', fromName: 'Realty & More', fromEmail: 'newsletter@realtynmore.com', replyTo: 'desk@realtynmore.com', address: '', intro: '', dailyCap: 300 }

export const isEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 120 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(v)
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const token = () => {
  const b = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** ISO week id for an IST day, e.g. "2026-10-31" → "2026-W44". */
export function weekId(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  const wd = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - wd)
  const y = d.getUTCFullYear()
  const week = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)
  return `${y}-W${String(week).padStart(2, '0')}`
}

export async function nlSettings(env: Env): Promise<NlSettings> {
  return { ...DEFAULTS, ...((await env.SUBS.get<Partial<NlSettings>>('newsletter:settings', 'json')) ?? {}) }
}

export async function saveNlSettings(env: Env, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const cur = await nlSettings(env)
  const next: NlSettings = {
    auto: typeof b.auto === 'boolean' ? b.auto : cur.auto,
    day: Number.isInteger(b.day) && (b.day as number) >= 0 && (b.day as number) <= 6 ? (b.day as number) : cur.day,
    time: typeof b.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time) ? b.time : cur.time,
    fromName: text(b.fromName, 60) || cur.fromName,
    fromEmail: b.fromEmail === undefined ? cur.fromEmail : isEmail(b.fromEmail) ? b.fromEmail.toLowerCase() : cur.fromEmail,
    replyTo: b.replyTo === undefined ? cur.replyTo : isEmail(b.replyTo) ? b.replyTo.toLowerCase() : cur.replyTo,
    address: b.address === undefined ? cur.address : text(b.address, 200),
    intro: b.intro === undefined ? cur.intro : text(b.intro, 600),
    dailyCap: Number.isInteger(b.dailyCap) && (b.dailyCap as number) >= 10 && (b.dailyCap as number) <= 100000 ? (b.dailyCap as number) : cur.dailyCap,
  }
  if (b.fromEmail !== undefined && !isEmail(b.fromEmail)) throw new Error('The “from” email doesn’t look right.')
  await env.SUBS.put('newsletter:settings', JSON.stringify(next))
  return { ok: true, settings: next }
}

/* ---------- sending (Brevo transactional API) ---------- */

interface Mail {
  to: string
  name?: string
  subject: string
  html: string
  text: string
  unsubUrl?: string
  tag: string
}
type SendResult = 'ok' | 'quota' | 'error' | 'off'

async function countMail(env: Env, kind: string) {
  await env.DB.prepare('INSERT INTO news_mail (day, kind, n) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET n = n + 1').bind(istDay(), kind).run()
}
async function sentToday(env: Env): Promise<number> {
  return (await env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM news_mail WHERE day = ?').bind(istDay()).first<{ n: number }>())?.n ?? 0
}

async function sendMail(env: Env, s: NlSettings, m: Mail): Promise<SendResult> {
  if (!env.BREVO_API_KEY) return 'off'
  if ((await sentToday(env)) >= s.dailyCap) return 'quota'
  const headers: Record<string, string> = {}
  if (m.unsubUrl) {
    headers['List-Unsubscribe'] = `<${m.unsubUrl}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: s.fromName, email: s.fromEmail },
      replyTo: { email: s.replyTo, name: s.fromName },
      to: [{ email: m.to, ...(m.name ? { name: m.name } : {}) }],
      subject: m.subject,
      htmlContent: m.html,
      textContent: m.text,
      tags: [m.tag],
      ...(Object.keys(headers).length ? { headers } : {}),
    }),
  }).catch(() => null)
  if (!res) return 'error'
  if (res.ok) {
    await countMail(env, m.tag)
    return 'ok'
  }
  // 402: out of credits; 429: too many requests. Both mean "try again later".
  return res.status === 402 || res.status === 429 ? 'quota' : 'error'
}

const workerUrl = (req: Request | null, env: Env) => env.NEWSLETTER_URL || (req ? new URL(req.url).origin : 'https://rnm-news-push.realtynmore.workers.dev')

function confirmMail(s: NlSettings, base: string, to: string, name: string, tok: string): Mail {
  const link = `${base}/newsletter/confirm?t=${tok}`
  const hi = name ? `Hi ${esc(name.split(' ')[0])},` : 'Hello,'
  return {
    to,
    name,
    tag: 'confirm',
    subject: 'Confirm your Realty & More weekly newsletter',
    text: `${hi.replace(/&amp;/g, '&')}\n\nPlease confirm you want the Realty & More weekly newsletter (every week: the top real estate stories, the latest R&M Magazine and videos):\n${link}\n\nIf you didn't ask for this, ignore this email and you won't hear from us.\n\nRealty & More · realtynmore.com`,
    html: shell(
      s,
      `<p style="margin:0 0 14px;font-size:16px">${hi}</p>
       <p style="margin:0 0 18px;font-size:16px;line-height:1.6">Please confirm you want the <b>Realty &amp; More weekly newsletter</b>: the week's top real estate stories, the latest R&amp;M Magazine and videos, once a week.</p>
       <p style="margin:0 0 22px"><a href="${link}" style="display:inline-block;background:#FAA61B;color:#1a1a1a;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px">Yes, subscribe me</a></p>
       <p style="margin:0;color:#6b6b70;font-size:13px">If you didn't ask for this, just ignore this email and you won't hear from us.</p>`,
      '',
    ),
  }
}

/* ---------- the weekly issue ---------- */

export interface IssueData {
  week: string
  dateLabel: string
  intro: string
  stories: NewsItem[]
  magazine: { title: string; cover: string; link: string } | null
  video: { title: string; link: string; thumb: string } | null
  market: { close: number; weekPct: number } | null
  appUrl: string
}

const utm = (link: string, week: string) => {
  try {
    const u = new URL(link)
    if (/realtynmore\.com$/.test(u.hostname) || u.hostname === 'realty-more.github.io') {
      u.searchParams.set('utm_source', 'newsletter')
      u.searchParams.set('utm_medium', 'email')
      u.searchParams.set('utm_campaign', week)
    }
    return u.toString()
  } catch {
    return link
  }
}
// Cut at a word boundary; never split an emoji (a surrogate pair) at the cut.
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/[\uD800-\uDBFF]$/, '').replace(/\s+\S*$/, '')}…` : s)

/** The common frame: logo, content, footer with the unsubscribe link (placeholder {{UNSUB}}). */
function shell(s: NlSettings, body: string, footer: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Realty &amp; More</title></head>
<body style="margin:0;padding:0;background:#f2f1ed;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ed"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#0e0e10;padding:20px 24px"><img src="https://realty-more.github.io/rnm-news/brand/logo_white.png" alt="Realty &amp; More" width="110" style="display:block;height:auto;border:0"></td></tr>
<tr><td style="padding:26px 24px 8px">${body}</td></tr>
<tr><td style="padding:18px 24px 26px;border-top:1px solid #ecebe6;color:#6b6b70;font-size:12px;line-height:1.6">${footer}
<p style="margin:8px 0 0">${esc(s.fromName)}${s.address ? ` · ${esc(s.address)}` : ''} · <a href="https://realtynmore.com" style="color:#6b6b70">realtynmore.com</a> · <a href="mailto:${esc(s.replyTo)}" style="color:#6b6b70">${esc(s.replyTo)}</a></p></td></tr>
</table></td></tr></table></body></html>`
}

/** Builds one week's email (pure, for tests). Per-reader unsubscribe links replace {{UNSUB}}. */
export function buildIssue(d: IssueData, s: NlSettings): { subject: string; html: string; text: string } {
  const lead = d.stories[0]
  const subject = clip(`The week in real estate: ${lead ? lead.title : d.dateLabel}`, 110)
  const storyHtml = d.stories
    .map((p, i) => {
      const link = esc(utm(p.link ?? `${d.appUrl}#/article/${p.id}`, d.week))
      const img = i === 0 && p.image ? `<a href="${link}"><img src="${esc(p.image)}" alt="" width="552" style="display:block;width:100%;height:auto;border-radius:8px;margin:0 0 12px;border:0"></a>` : ''
      return `<tr><td style="padding:0 0 22px">${img}
<a href="${link}" style="color:#1a1a1a;text-decoration:none;font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:${i === 0 ? 24 : 19}px;line-height:1.3">${esc(p.title)}</a>
${p.excerpt ? `<p style="margin:6px 0 0;font-size:15px;line-height:1.55;color:#3a3a3f">${esc(clip(p.excerpt, i === 0 ? 260 : 170))}</p>` : ''}
<p style="margin:6px 0 0"><a href="${link}" style="color:#c97a00;font-weight:700;font-size:14px;text-decoration:none">Read the story →</a></p></td></tr>`
    })
    .join('')
  const market = d.market
    ? `<tr><td style="padding:4px 0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f2;border-radius:8px"><tr><td style="padding:14px 16px;font-size:14px">
<b style="font-size:12px;letter-spacing:1px;color:#6b6b70">NIFTY REALTY THIS WEEK</b><br>
<span style="font-size:22px;font-weight:700">${d.market.close.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
<span style="font-weight:700;color:${d.market.weekPct >= 0 ? '#1b7f3b' : '#c62828'}">&nbsp;${d.market.weekPct >= 0 ? '▲' : '▼'} ${Math.abs(d.market.weekPct).toFixed(2)}%</span>
&nbsp;<a href="${esc(utm(`${d.appUrl}#/markets`, d.week))}" style="color:#c97a00;font-size:13px">See realty stocks →</a></td></tr></table></td></tr>`
    : ''
  const mag = d.magazine
    ? `<tr><td style="padding:4px 0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e10;border-radius:8px"><tr>
<td width="120" style="padding:14px"><a href="${esc(utm(d.magazine.link, d.week))}"><img src="${esc(d.magazine.cover)}" alt="R&amp;M Magazine cover" width="100" style="display:block;width:100px;height:auto;border-radius:4px;border:0"></a></td>
<td style="padding:14px 14px 14px 0;color:#ffffff"><b style="font-size:12px;letter-spacing:1px;color:#FAA61B">R&amp;M MAGAZINE</b><br><span style="font-family:Georgia,serif;font-size:20px;font-weight:700">${esc(d.magazine.title)}</span><br>
<a href="${esc(utm(d.magazine.link, d.week))}" style="display:inline-block;margin-top:10px;background:#FAA61B;color:#1a1a1a;text-decoration:none;font-weight:700;font-size:14px;padding:9px 18px;border-radius:999px">Read free in the app</a></td></tr></table></td></tr>`
    : ''
  const video = d.video
    ? `<tr><td style="padding:4px 0 22px"><b style="font-size:12px;letter-spacing:1px;color:#6b6b70">WATCH</b><br>
<a href="${esc(d.video.link)}"><img src="${esc(d.video.thumb)}" alt="" width="552" style="display:block;width:100%;height:auto;border-radius:8px;margin:8px 0;border:0"></a>
<a href="${esc(d.video.link)}" style="color:#1a1a1a;text-decoration:none;font-weight:700;font-size:16px">▶ ${esc(d.video.title)}</a></td></tr>`
    : ''
  const intro = d.intro ? `<p style="margin:0 0 20px;font-size:16px;line-height:1.6">${esc(d.intro).replace(/\n/g, '<br>')}</p>` : ''
  const body = `<p style="margin:0 0 4px;font-size:12px;letter-spacing:1.5px;color:#c97a00;font-weight:700">THE WEEK IN REAL ESTATE · ${esc(d.dateLabel.toUpperCase())}</p>
<h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2">This week's top stories</h1>
${intro}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${storyHtml}${market}${mag}${video}
<tr><td style="padding:4px 0 10px;text-align:center"><a href="${esc(utm(d.appUrl, d.week))}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:999px">Open the Realtynmore app</a></td></tr></table>`
  const footer = `You're getting this because you subscribed to the Realty &amp; More weekly newsletter. <a href="{{UNSUB}}" style="color:#6b6b70">Unsubscribe</a> in one click.`
  const lines = [
    `THE WEEK IN REAL ESTATE · ${d.dateLabel}`,
    '',
    ...(d.intro ? [d.intro, ''] : []),
    ...d.stories.flatMap((p) => [p.title, utm(p.link ?? `${d.appUrl}#/article/${p.id}`, d.week), '']),
    ...(d.market ? [`Nifty Realty this week: ${d.market.close} (${d.market.weekPct >= 0 ? '+' : ''}${d.market.weekPct.toFixed(2)}%)`, ''] : []),
    ...(d.magazine ? [`R&M Magazine ${d.magazine.title}, read free: ${utm(d.magazine.link, d.week)}`, ''] : []),
    ...(d.video ? [`Watch: ${d.video.title} ${d.video.link}`, ''] : []),
    `Unsubscribe: {{UNSUB}}`,
  ]
  return { subject, html: shell(s, body, footer), text: lines.join('\n') }
}

/** Gathers this week's content from the app's own data. */
export async function gatherIssue(env: Env, s: NlSettings, now = Date.now()): Promise<IssueData> {
  const day = istDay(now)
  const since = istDay(now - 7 * 86400000)
  const [web, opens, vid, mkt] = await Promise.all([
    env.DB.prepare('SELECT post_id AS id, views FROM webposts WHERE published >= ? ORDER BY views DESC LIMIT 15').bind(since).all<{ id: number; views: number }>(),
    env.DB.prepare('SELECT post_id AS id, SUM(n) AS n FROM opens WHERE day >= ? GROUP BY post_id ORDER BY n DESC LIMIT 15').bind(since).all<{ id: number; n: number }>(),
    env.DB.prepare('SELECT id, title, thumb FROM yt_videos WHERE (short IS NULL OR short = 0) ORDER BY published DESC LIMIT 1').first<{ id: string; title: string; thumb: string }>(),
    env.DB.prepare("SELECT day, close FROM mkt_index WHERE name = 'Nifty Realty' ORDER BY day DESC LIMIT 6").all<{ day: string; close: number }>(),
  ])
  // Most read: website views plus app opens (weighted, the app audience is smaller).
  const score = new Map<number, number>()
  for (const w of web.results) score.set(w.id, (score.get(w.id) ?? 0) + w.views)
  for (const o of opens.results) score.set(o.id, (score.get(o.id) ?? 0) + o.n * 5)
  const ids = [...score].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id)
  let stories = ids.length >= 3 ? await fetchByIds(env.SITE_API, ids).catch(() => []) : []
  if (stories.length < 3) stories = (await fetchLatest(env.SITE_API).catch(() => [])).slice(0, 6)
  let magazine: IssueData['magazine'] = null
  try {
    const r = await fetch(`${env.APP_URL}data/magazine.json`)
    const m = r.ok ? (((await r.json()) as { issues: { id: number; title: string; cover: string }[] }).issues ?? [])[0] : undefined
    if (m) magazine = { title: m.title, cover: `${env.APP_URL}${m.cover}`, link: `${env.APP_URL}#/magazine/${m.id}` }
  } catch {
    /* no magazine box this week */
  }
  const rows = mkt.results
  const market = rows.length >= 2 ? { close: rows[0].close, weekPct: ((rows[0].close - rows[rows.length - 1].close) / rows[rows.length - 1].close) * 100 } : null
  return {
    week: weekId(day),
    dateLabel: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`)),
    intro: s.intro,
    stories,
    magazine,
    video: vid ? { title: vid.title, link: `https://www.youtube.com/watch?v=${vid.id}`, thumb: vid.thumb || `https://i.ytimg.com/vi/${vid.id}/hqdefault.jpg` } : null,
    market,
    appUrl: env.APP_URL,
  }
}

/* ---------- readers: subscribe, confirm, unsubscribe ---------- */

interface Sub {
  id: number
  email: string
  name: string
  status: 'pending' | 'active' | 'unsubscribed'
  token: string
  source: string
  created_at: string
  confirm_sent_at: string | null
  confirmed_at: string | null
  unsub_at: string | null
}

async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24)
}

export async function subscribe(env: Env, req: Request, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  if (!isEmail(email)) throw new Error('Please enter a valid email address.')
  const name = text(b.name, 60)
  // At most 5 sign-ups an hour from one network.
  const ipKey = `nl-ip:${await sha(req.headers.get('CF-Connecting-IP') ?? 'x')}:${new Date().toISOString().slice(0, 13)}`
  const n = Number((await env.SUBS.get(ipKey)) ?? 0)
  if (n >= 5) throw new Error('Too many sign-ups from here. Please try again in an hour.')
  await env.SUBS.put(ipKey, String(n + 1), { expirationTtl: 3600 })
  const now = new Date().toISOString()
  const cur = await env.DB.prepare('SELECT * FROM news_subs WHERE email = ?').bind(email).first<Sub>()
  if (cur?.status === 'active') return { status: 'already' }
  const tok = token()
  if (cur) await env.DB.prepare("UPDATE news_subs SET status = 'pending', token = ?, name = COALESCE(NULLIF(?, ''), name), confirm_sent_at = NULL, unsub_at = NULL WHERE id = ?").bind(tok, name, cur.id).run()
  else
    await env.DB.prepare("INSERT INTO news_subs (email, name, status, token, source, created_at) VALUES (?, ?, 'pending', ?, ?, ?)")
      .bind(email, name, tok, text(b.source, 20) || 'app', now)
      .run()
  const s = await nlSettings(env)
  const r = await sendMail(env, s, confirmMail(s, workerUrl(req, env), email, name, tok))
  if (r === 'ok') {
    await env.DB.prepare('UPDATE news_subs SET confirm_sent_at = ? WHERE email = ?').bind(now, email).run()
    return { status: 'check-email' }
  }
  return { status: 'pending' }
}

const page = (title: string, msg: string, extra = '') =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Realty &amp; More</title>
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#f2f1ed;color:#1a1a1a}main{max-width:480px;margin:10vh auto;padding:28px;background:#fff;border-radius:12px}h1{font:700 26px Georgia,serif;margin:0 0 10px}a.b,button{display:inline-block;margin-top:14px;padding:12px 22px;border-radius:999px;border:0;background:#FAA61B;color:#1a1a1a;font:700 15px system-ui;text-decoration:none;cursor:pointer}</style></head>
<body><main><h1>${esc(title)}</h1><p>${msg}</p>${extra}</main></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
  )

export async function confirmPage(env: Env, url: URL) {
  const t = url.searchParams.get('t') ?? ''
  const sub = /^[\w-]{20,64}$/.test(t) ? await env.DB.prepare('SELECT * FROM news_subs WHERE token = ?').bind(t).first<Sub>() : null
  if (!sub) return page('Link not valid', 'This confirmation link has expired or was already replaced. Please subscribe again in the app.')
  if (sub.status !== 'active') await env.DB.prepare("UPDATE news_subs SET status = 'active', confirmed_at = ?, unsub_at = NULL WHERE id = ?").bind(new Date().toISOString(), sub.id).run()
  return page('You’re subscribed', `Thank you! <b>${esc(sub.email)}</b> will get the Realty &amp; More weekly newsletter.`, `<a class="b" href="${esc(env.APP_URL)}">Open the app</a>`)
}

/** GET shows a button (link scanners must not unsubscribe people); POST unsubscribes, including one-click from mail apps. */
export async function unsubscribePage(env: Env, req: Request, url: URL) {
  const t = url.searchParams.get('t') ?? ''
  const sub = /^[\w-]{20,64}$/.test(t) ? await env.DB.prepare('SELECT * FROM news_subs WHERE token = ?').bind(t).first<Sub>() : null
  if (!sub) return page('Link not valid', 'We couldn’t find this subscription. It may already be removed.')
  if (req.method === 'POST') {
    await env.DB.prepare("UPDATE news_subs SET status = 'unsubscribed', unsub_at = ? WHERE id = ?").bind(new Date().toISOString(), sub.id).run()
    return page('Unsubscribed', `<b>${esc(sub.email)}</b> won’t get the weekly newsletter any more. You can subscribe again in the app at any time.`)
  }
  if (sub.status === 'unsubscribed') return page('Already unsubscribed', `<b>${esc(sub.email)}</b> is not on the newsletter list.`)
  return page('Unsubscribe?', `Stop the Realty &amp; More weekly newsletter for <b>${esc(sub.email)}</b>?`, `<form method="post"><button>Yes, unsubscribe</button></form>`)
}

/* ---------- the weekly cron ---------- */

async function sendIssueBatch(env: Env, s: NlSettings, base: string): Promise<string> {
  const issue = await env.DB.prepare("SELECT id, subject, html, text, created_at FROM news_issues WHERE status = 'sending' ORDER BY id LIMIT 1").first<{ id: number; subject: string; html: string; text: string; created_at: string }>()
  if (!issue) return ''
  const room = Math.max(0, s.dailyCap - (await sentToday(env)))
  if (!room) return 'daily cap reached'
  const { results } = await env.DB.prepare(
    "SELECT id, email, name, token FROM news_subs WHERE status = 'active' AND confirmed_at <= ? AND id NOT IN (SELECT sub_id FROM news_sends WHERE issue_id = ?) ORDER BY id LIMIT ?",
  )
    .bind(issue.created_at, issue.id, Math.min(BATCH, room))
    .all<{ id: number; email: string; name: string; token: string }>()
  if (!results.length) {
    const sent = (await env.DB.prepare('SELECT COUNT(*) AS n FROM news_sends WHERE issue_id = ? AND ok = 1').bind(issue.id).first<{ n: number }>())?.n ?? 0
    await env.DB.prepare("UPDATE news_issues SET status = 'sent', sent_at = ?, sent = ? WHERE id = ?").bind(new Date().toISOString(), sent, issue.id).run()
    return `issue ${issue.id} finished (${sent})`
  }
  let ok = 0
  for (const r of results) {
    const unsub = `${base}/newsletter/unsubscribe?t=${r.token}`
    const res = await sendMail(env, s, { to: r.email, name: r.name, subject: issue.subject, html: issue.html.replaceAll('{{UNSUB}}', unsub), text: issue.text.replaceAll('{{UNSUB}}', unsub), unsubUrl: unsub, tag: 'weekly' })
    if (res === 'quota' || res === 'off') break
    await env.DB.prepare('INSERT OR IGNORE INTO news_sends (issue_id, sub_id, day, ok) VALUES (?, ?, ?, ?)').bind(issue.id, r.id, istDay(), res === 'ok' ? 1 : 0).run()
    if (res === 'ok') ok++
  }
  return `sent ${ok}`
}

export async function createIssue(env: Env, s: NlSettings, by: string, now = Date.now()) {
  const data = await gatherIssue(env, s, now)
  const exists = await env.DB.prepare('SELECT id FROM news_issues WHERE week = ?').bind(data.week).first()
  if (exists) throw new Error('This week’s newsletter has already been created.')
  if (!data.stories.length) throw new Error('No stories found to send.')
  const issue = buildIssue(data, s)
  await env.DB.prepare("INSERT INTO news_issues (week, subject, html, text, status, created_by, created_at) VALUES (?, ?, ?, ?, 'sending', ?, ?)")
    .bind(data.week, issue.subject, issue.html, issue.text, by, new Date(now).toISOString())
    .run()
  // The editor's note is for one issue only.
  if (s.intro) await env.SUBS.put('newsletter:settings', JSON.stringify({ ...s, intro: '' }))
  return { week: data.week, subject: issue.subject }
}

/** Every 10 minutes: start the week's issue at the set time, then send in batches within the daily cap. */
export async function newsletterTick(env: Env, now = Date.now()): Promise<string> {
  if (!env.BREVO_API_KEY) return 'not connected'
  const s = await nlSettings(env)
  const out: string[] = []
  const day = istDay(now)
  if (s.auto && new Date(`${day}T00:00:00Z`).getUTCDay() === s.day && istClock(now) >= s.time) {
    const week = weekId(day)
    if (!(await env.DB.prepare('SELECT id FROM news_issues WHERE week = ?').bind(week).first())) {
      const subs = (await env.DB.prepare("SELECT COUNT(*) AS n FROM news_subs WHERE status = 'active'").first<{ n: number }>())?.n ?? 0
      if (subs) out.push(`created ${(await createIssue(env, s, 'auto', now).catch((e) => ({ subject: (e as Error).message }))).subject}`)
    }
  }
  const base = workerUrl(null, env)
  // Sign-ups that came in before sending was connected get their confirmation email now.
  const { results: waiting } = await env.DB.prepare("SELECT email, name, token FROM news_subs WHERE status = 'pending' AND confirm_sent_at IS NULL ORDER BY id LIMIT ?").bind(CONFIRM_BATCH).all<{ email: string; name: string; token: string }>()
  for (const w of waiting) {
    const r = await sendMail(env, s, confirmMail(s, base, w.email, w.name, w.token))
    if (r !== 'ok') break
    await env.DB.prepare('UPDATE news_subs SET confirm_sent_at = ? WHERE email = ?').bind(new Date().toISOString(), w.email).run()
  }
  if (waiting.length) out.push(`confirmations ${waiting.length}`)
  const batch = await sendIssueBatch(env, s, base)
  if (batch) out.push(batch)
  return out.join(', ') || 'nothing to send'
}

/* ---------- Studio ---------- */

export async function newsletterBook(env: Env) {
  const [s, counts, subs, issues, today] = await Promise.all([
    nlSettings(env),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM news_subs GROUP BY status').all<{ status: string; n: number }>(),
    env.DB.prepare('SELECT id, email, name, status, source, created_at, confirmed_at, unsub_at FROM news_subs ORDER BY id DESC LIMIT 5000').all(),
    env.DB.prepare('SELECT i.id, i.week, i.subject, i.status, i.created_by, i.created_at, i.sent_at, (SELECT COUNT(*) FROM news_sends x WHERE x.issue_id = i.id AND x.ok = 1) AS sent FROM news_issues i ORDER BY i.id DESC LIMIT 30').all(),
    sentToday(env),
  ])
  const c = Object.fromEntries(counts.results.map((r) => [r.status, r.n]))
  return { connected: !!env.BREVO_API_KEY, settings: s, counts: { active: c.active ?? 0, pending: c.pending ?? 0, unsubscribed: c.unsubscribed ?? 0 }, sentToday: today, subscribers: subs.results, issues: issues.results, week: weekId(istDay()) }
}

export async function previewIssue(env: Env) {
  const s = await nlSettings(env)
  const issue = buildIssue(await gatherIssue(env, s), s)
  return { subject: issue.subject, html: issue.html.replaceAll('{{UNSUB}}', '#') }
}

export async function sendTest(env: Env, body: unknown) {
  const to = (body as { email?: unknown })?.email
  if (!isEmail(to)) throw new Error('Enter the email address for the test.')
  if (!env.BREVO_API_KEY) throw new Error('Email sending isn’t connected yet. Add the Brevo key first (see the steps on this screen).')
  const s = await nlSettings(env)
  const issue = buildIssue(await gatherIssue(env, s), s)
  const r = await sendMail(env, s, { to, subject: `[Test] ${issue.subject}`, html: issue.html.replaceAll('{{UNSUB}}', '#'), text: issue.text.replaceAll('{{UNSUB}}', '#'), tag: 'test' })
  if (r !== 'ok') throw new Error(r === 'quota' ? 'Today’s email limit is used up. Try tomorrow.' : 'The email service refused the message. Check the sender email is verified in Brevo.')
  return { ok: true }
}

export async function sendNow(env: Env, who: Who) {
  if (!env.BREVO_API_KEY) throw new Error('Email sending isn’t connected yet.')
  const r = await createIssue(env, await nlSettings(env), who.name)
  return { ...r, note: 'Sending has started. It goes out in small batches over the next hour (and the next days if the daily limit is reached).' }
}

export async function addSubscriber(env: Env, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  if (!isEmail(email)) throw new Error('Enter a valid email address.')
  if (b.consent !== true) throw new Error('Only add people who asked to receive the newsletter.')
  const cur = await env.DB.prepare('SELECT status FROM news_subs WHERE email = ?').bind(email).first<{ status: string }>()
  if (cur?.status === 'active') throw new Error('Already subscribed.')
  if (cur?.status === 'unsubscribed') throw new Error('This person unsubscribed. They can subscribe again themselves in the app.')
  if (!cur)
    await env.DB.prepare("INSERT INTO news_subs (email, name, status, token, source, created_at) VALUES (?, ?, 'pending', ?, 'studio', ?)").bind(email, text(b.name, 60), token(), new Date().toISOString()).run()
  return { ok: true, note: 'Added. They get a confirmation email and join once they confirm.' }
}

export async function removeSubscriber(env: Env, body: unknown) {
  const id = Number((body as { id?: unknown })?.id)
  if (!Number.isInteger(id) || id <= 0) throw new Error('Pick a subscriber.')
  await env.DB.batch([env.DB.prepare('DELETE FROM news_sends WHERE sub_id = ?').bind(id), env.DB.prepare('DELETE FROM news_subs WHERE id = ?').bind(id)])
  return { ok: true }
}
