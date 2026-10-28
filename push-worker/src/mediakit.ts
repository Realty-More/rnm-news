// Media kit (owner and full-access staff only; other employees never see it): the rate-card PDFs and private share links for advertisers.
//   Files: each PDF is kept in KV (kit:file:<id>) with a first-page cover picture (kit:cover:<id>);
//   the details are in D1 (kit_files). Nothing about the kit is in the public app.
//   Links: /k/<token> is a branded page made for one advertiser, showing only the kits picked for them.
//   It stops working on its expiry date or when the owner stops it. Opens, page views and downloads
//   are logged (link previews made by WhatsApp and other apps are not counted), and the first open
//   and first download send a notification to the owner's phone.
import type { Env } from './index.ts'
import { toOwners, type Who } from './owner.ts'

const MAX_PDF = 20 * 1024 * 1024
const MAX_COVER = 400_000
const MAX_FILES = 8
const DAY = 86400000
/** A reload within this time is the same visit. */
const VISIT_MS = 30 * 60000
export const VALID_DAYS = [7, 15, 30, 90] as const

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const isFileId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{8,24}$/.test(v)
export const isToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{22}$/.test(v)

function randomId(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface KitFile {
  id: string
  title: string
  file_name: string
  size: number
  pages: number
  sort: number
  has_cover: number
  by_name: string
  updated_at: string
}

export interface KitLink {
  token: string
  company: string
  person: string
  phone: string
  files: string
  client_id: number | null
  by_name: string
  created_at: string
  expires_at: string
  revoked: number
  preview: number
  opens: number
  downloads: number
  first_open: string | null
  last_open: string | null
}

export interface KitSettings {
  contactName: string
  contactTitle: string
  contactPhone: string
  contactEmail: string
  intro: string
}

const DEFAULT_SETTINGS: KitSettings = {
  contactName: '',
  contactTitle: 'Advertising & Partnerships',
  contactPhone: '',
  contactEmail: 'desk@realtynmore.com',
  intro:
    'Thank you for your interest in partnering with Realty & More. Below are our current advertising and partnership offerings across the print magazine, realtynmore.com, YouTube, podcasts and social media. We would be glad to put together a plan for your brand.',
}

export async function kitSettings(env: Env): Promise<KitSettings> {
  const saved = await env.SUBS.get<Partial<KitSettings>>('kit:settings', 'json').catch(() => null)
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
}

export async function saveKitSettings(env: Env, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const email = text(b.contactEmail, 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email address does not look right.')
  const phone = text(b.contactPhone, 30)
  if (phone && phone.replace(/\D/g, '').length < 10) throw new Error('Write the full mobile number.')
  const intro = typeof b.intro === 'string' ? b.intro.trim().slice(0, 600) : DEFAULT_SETTINGS.intro
  const s: KitSettings = { contactName: text(b.contactName, 80), contactTitle: text(b.contactTitle, 80), contactPhone: phone, contactEmail: email, intro: intro || DEFAULT_SETTINGS.intro }
  await env.SUBS.put('kit:settings', JSON.stringify(s))
  return { ok: true, settings: s }
}

/* ---------- Studio: files ---------- */

export async function kitBook(env: Env) {
  const [files, links, settings] = await Promise.all([
    env.DB.prepare('SELECT * FROM kit_files ORDER BY sort, updated_at').all<KitFile>(),
    env.DB.prepare('SELECT * FROM kit_links WHERE preview = 0 ORDER BY created_at DESC LIMIT 300').all<KitLink>(),
    kitSettings(env),
  ])
  // Covers come along as small pictures, so the Studio needs no extra signed requests to show them.
  const withCovers = await Promise.all(
    files.results.map(async (f) => {
      const pic = f.has_cover ? await env.SUBS.get(`kit:cover:${f.id}`, 'arrayBuffer') : null
      return { ...f, cover: pic ? `data:image/jpeg;base64,${toBase64(new Uint8Array(pic))}` : null }
    }),
  )
  return { now: new Date().toISOString(), files: withCovers, links: links.results.map((l) => ({ ...l, files: parseFiles(l.files) })), settings, validDays: VALID_DAYS }
}

function toBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

const parseFiles = (s: string): string[] => {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.filter(isFileId) : []
  } catch {
    return []
  }
}

/** Saves an uploaded PDF (raw body; title and page count in the query string). `id` replaces that file. */
export async function uploadKit(env: Env, req: Request, url: URL, who: Who) {
  const body = await req.arrayBuffer()
  if (body.byteLength === 0) throw new Error('The file is empty.')
  if (body.byteLength > MAX_PDF) throw new Error('PDFs up to 20 MB, please.')
  const head = new TextDecoder().decode(new Uint8Array(body, 0, Math.min(1024, body.byteLength)))
  if (!head.includes('%PDF-')) throw new Error('Upload a PDF file.')
  const name = (url.searchParams.get('name') ?? 'media-kit.pdf').replace(/[^\w .()&,+-]/g, '_').slice(0, 140)
  const title = text(url.searchParams.get('title'), 90) || name.replace(/\.pdf$/i, '')
  const pages = Math.max(0, Math.min(500, Number(url.searchParams.get('pages')) || 0))
  const now = new Date().toISOString()
  const given = url.searchParams.get('id')
  if (given) {
    if (!isFileId(given) || !(await env.DB.prepare('SELECT id FROM kit_files WHERE id = ?').bind(given).first())) throw new Error('That media kit file was not found.')
    await env.SUBS.put(`kit:file:${given}`, body)
    await env.DB.prepare('UPDATE kit_files SET title = ?, file_name = ?, size = ?, pages = ?, has_cover = 0, by_name = ?, updated_at = ? WHERE id = ?').bind(title, name, body.byteLength, pages, who.name, now, given).run()
    return { id: given }
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM kit_files').first<{ n: number }>()
  if ((count?.n ?? 0) >= MAX_FILES) throw new Error(`Up to ${MAX_FILES} media kit files. Remove one first.`)
  const id = randomId(9).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12).padEnd(8, '0')
  const sort = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM kit_files').first<{ s: number }>()
  await env.SUBS.put(`kit:file:${id}`, body)
  await env.DB.prepare('INSERT INTO kit_files (id, title, file_name, size, pages, sort, has_cover, by_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)').bind(id, title, name, body.byteLength, pages, sort?.s ?? 1, who.name, now).run()
  return { id }
}

/** First-page picture of a kit (a JPEG made in the app). */
export async function uploadCover(env: Env, req: Request, url: URL) {
  const id = url.searchParams.get('id')
  if (!isFileId(id) || !(await env.DB.prepare('SELECT id FROM kit_files WHERE id = ?').bind(id).first())) throw new Error('That media kit file was not found.')
  const body = await req.arrayBuffer()
  const b = new Uint8Array(body)
  if (body.byteLength > MAX_COVER || b[0] !== 0xff || b[1] !== 0xd8) throw new Error('The cover picture could not be saved.')
  await env.SUBS.put(`kit:cover:${id}`, body)
  await env.DB.prepare('UPDATE kit_files SET has_cover = 1 WHERE id = ?').bind(id).run()
  return { ok: true }
}

export async function updateKit(env: Env, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  if (!isFileId(b.id)) throw new Error('That media kit file was not found.')
  const title = text(b.title, 90)
  if (title.length < 3) throw new Error('Write a name for this media kit.')
  await env.DB.prepare('UPDATE kit_files SET title = ? WHERE id = ?').bind(title, b.id).run()
  return { ok: true }
}

/** Moves a kit one place up or down (the order the advertiser sees). */
export async function moveKit(env: Env, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const { results } = await env.DB.prepare('SELECT id FROM kit_files ORDER BY sort, updated_at').all<{ id: string }>()
  const ids = results.map((r) => r.id)
  const i = ids.indexOf(String(b.id))
  const j = i + (b.dir === 'up' ? -1 : 1)
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true }
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  await env.DB.batch(ids.map((id, n) => env.DB.prepare('UPDATE kit_files SET sort = ? WHERE id = ?').bind(n + 1, id)))
  return { ok: true }
}

export async function removeKit(env: Env, body: unknown) {
  const id = (body as { id?: unknown })?.id
  if (!isFileId(id)) throw new Error('That media kit file was not found.')
  await Promise.all([env.SUBS.delete(`kit:file:${id}`), env.SUBS.delete(`kit:cover:${id}`)])
  await env.DB.prepare('DELETE FROM kit_files WHERE id = ?').bind(id).run()
  return { ok: true }
}

/* ---------- Studio: share links ---------- */

export function cleanLink(body: unknown, fileIds: string[], now = Date.now()) {
  const b = (body ?? {}) as Record<string, unknown>
  const company = text(b.company, 100)
  if (company.length < 2) throw new Error('Write the company name (it shows on the page as "Prepared for …").')
  const phone = text(b.phone, 30).replace(/[^\d+]/g, '')
  if (phone && phone.replace(/\D/g, '').length < 10) throw new Error('Write the full mobile number, or leave it empty.')
  const files = Array.isArray(b.files) ? b.files.filter((f): f is string => isFileId(f) && fileIds.includes(f)) : []
  if (!files.length) throw new Error('Pick at least one media kit to share.')
  const days = VALID_DAYS.includes(Number(b.days) as (typeof VALID_DAYS)[number]) ? Number(b.days) : 15
  const clientId = Number.isInteger(Number(b.clientId)) && Number(b.clientId) > 0 ? Number(b.clientId) : null
  return { company, person: text(b.person, 80), phone, files: [...new Set(files)], clientId, expires: new Date(now + days * DAY).toISOString() }
}

export async function createLink(env: Env, body: unknown, who: Who, base: string, preview = false) {
  const { results } = await env.DB.prepare('SELECT id FROM kit_files').all<{ id: string }>()
  const ids = results.map((r) => r.id)
  const l = preview ? { company: text((body as { company?: unknown })?.company, 100) || 'Preview', person: '', phone: '', files: ids, clientId: null, expires: new Date(Date.now() + DAY).toISOString() } : cleanLink(body, ids)
  if (!l.files.length) throw new Error('Add a media kit PDF first.')
  const token = randomId(16).slice(0, 22)
  await env.DB.prepare('INSERT INTO kit_links (token, company, person, phone, files, client_id, by_name, created_at, expires_at, preview) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(token, l.company, l.person, l.phone, JSON.stringify(l.files), l.clientId, who.name, new Date().toISOString(), l.expires, preview ? 1 : 0)
    .run()
  return { token, url: `${base}/k/${token}`, expires: l.expires }
}

export async function changeLink(env: Env, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  if (!isToken(b.token)) throw new Error('That link was not found.')
  if (b.action === 'stop') await env.DB.prepare('UPDATE kit_links SET revoked = 1 WHERE token = ?').bind(b.token).run()
  else if (b.action === 'restart') await env.DB.prepare('UPDATE kit_links SET revoked = 0 WHERE token = ?').bind(b.token).run()
  else if (b.action === 'extend') {
    const days = VALID_DAYS.includes(Number(b.days) as (typeof VALID_DAYS)[number]) ? Number(b.days) : 15
    // From today if it already ran out, else from its current end.
    const row = await env.DB.prepare('SELECT expires_at FROM kit_links WHERE token = ?').bind(b.token).first<{ expires_at: string }>()
    if (!row) throw new Error('That link was not found.')
    const from = Math.max(Date.now(), Date.parse(row.expires_at))
    await env.DB.prepare('UPDATE kit_links SET expires_at = ?, revoked = 0 WHERE token = ?').bind(new Date(from + days * DAY).toISOString(), b.token).run()
  } else if (b.action === 'remove') {
    await env.DB.batch([env.DB.prepare('DELETE FROM kit_views WHERE token = ?').bind(b.token), env.DB.prepare('DELETE FROM kit_links WHERE token = ?').bind(b.token)])
  } else throw new Error('Unknown action.')
  return { ok: true }
}

export async function linkViews(env: Env, token: string) {
  if (!isToken(token)) throw new Error('That link was not found.')
  const { results } = await env.DB.prepare('SELECT at, kind, file_id AS fileId, device, place FROM kit_views WHERE token = ? ORDER BY at DESC LIMIT 200').bind(token).all()
  return { views: results }
}

/* ---------- the advertiser's page ---------- */

/** Link previews (WhatsApp, Telegram, email scanners…) fetch the page too; they are not opens. */
export const isBot = (ua: string) => !ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|skype|discord|embedly|vkshare|quora link|pinterest|outlook|google-?(read|safety)|proofpoint|mimecast|barracuda|headless|lighthouse|curl|wget|python|okhttp|go-http|node-fetch|axios|java\//i.test(ua)

export function deviceOf(ua: string): string {
  const kind = /ipad|tablet/i.test(ua) ? 'Tablet' : /mobi|iphone|android/i.test(ua) ? 'Phone' : 'Computer'
  const os = /iphone|ipad|ios/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : ''
  return os ? `${kind} · ${os}` : kind
}

const placeOf = (req: Request) => {
  const cf = (req as Request & { cf?: { city?: string; region?: string; country?: string } }).cf
  return [cf?.city, cf?.country && cf.country !== 'IN' ? cf.country : cf?.region].filter(Boolean).join(', ').slice(0, 80) || null
}

type LinkState = { link: KitLink; files: KitFile[] } | { gone: 'expired' | 'stopped' | 'missing'; link?: KitLink }

async function openLink(env: Env, token: string): Promise<LinkState> {
  if (!isToken(token)) return { gone: 'missing' }
  const link = await env.DB.prepare('SELECT * FROM kit_links WHERE token = ?').bind(token).first<KitLink>()
  if (!link) return { gone: 'missing' }
  if (link.revoked) return { gone: 'stopped', link }
  if (Date.parse(link.expires_at) < Date.now()) return { gone: 'expired', link }
  const ids = parseFiles(link.files)
  const { results } = await env.DB.prepare(`SELECT * FROM kit_files WHERE id IN (${ids.map(() => '?').join(',') || "''"}) ORDER BY sort, updated_at`).bind(...ids).all<KitFile>()
  if (!results.length) return { gone: 'missing', link }
  return { link, files: results }
}

/** Logs a visit, a page view or a download; the first open and first download notify the owner. */
async function track(env: Env, req: Request, link: KitLink, kind: 'open' | 'view' | 'download', file?: KitFile) {
  const ua = req.headers.get('User-Agent') ?? ''
  if (link.preview || isBot(ua) || req.method !== 'GET') return
  const now = new Date()
  const recent = await env.DB.prepare('SELECT at FROM kit_views WHERE token = ? AND kind = ? AND COALESCE(file_id, \'\') = ? ORDER BY at DESC LIMIT 1')
    .bind(link.token, kind, file?.id ?? '')
    .first<{ at: string }>()
  if (recent && now.getTime() - Date.parse(recent.at) < VISIT_MS) return
  const stmts = [env.DB.prepare('INSERT INTO kit_views (token, at, kind, file_id, device, place) VALUES (?, ?, ?, ?, ?, ?)').bind(link.token, now.toISOString(), kind, file?.id ?? null, deviceOf(ua), placeOf(req))]
  if (kind === 'open') stmts.push(env.DB.prepare('UPDATE kit_links SET opens = opens + 1, first_open = COALESCE(first_open, ?), last_open = ? WHERE token = ?').bind(now.toISOString(), now.toISOString(), link.token))
  if (kind === 'download') stmts.push(env.DB.prepare('UPDATE kit_links SET downloads = downloads + 1, last_open = ? WHERE token = ?').bind(now.toISOString(), link.token))
  await env.DB.batch(stmts)
  const first = kind === 'open' ? !link.first_open : kind === 'download' ? link.downloads === 0 : false
  if (first) {
    const who = link.person ? `${link.person} (${link.company})` : link.company
    await toOwners(env, {
      title: kind === 'open' ? 'Media kit opened' : 'Media kit downloaded',
      body: kind === 'open' ? `${who} just opened the media kit you shared.` : `${who} downloaded “${file?.title ?? 'the media kit'}”.`,
      url: '#/studio?tab=mediakit',
      tag: `kit-${kind}-${link.token}`,
    }).catch(() => {})
  }
}

const istDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
const sizeOf = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

const STYLE = `
:root{--bg:#f6f5f1;--card:#fff;--ink:#141416;--mute:#64646a;--line:#e3e1da;--accent:#fba519;--deep:#f58220;--band:#141416;--serif:'Playfair Display',Georgia,serif;--sans:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--sans)}
a{color:inherit}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
.top{background:var(--band);color:#f4f4f2}
.top .wrap{display:flex;align-items:center;justify-content:space-between;height:68px}
.top img{height:38px;width:auto;display:block}
.conf{font-size:11px;letter-spacing:.14em;text-transform:uppercase;border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:5px 12px;color:#d9d9d4}
.hero{background:var(--band);color:#f4f4f2;padding:44px 0 92px;position:relative;overflow:hidden}
.hero:after{content:'';position:absolute;right:-120px;top:-60px;width:420px;height:420px;border-radius:50%;background:radial-gradient(closest-side,rgba(251,165,25,.22),transparent);pointer-events:none}
.eyebrow{margin:0 0 14px;color:var(--accent);font-size:12.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase}
h1{font-family:var(--serif);font-weight:700;font-size:clamp(34px,6vw,56px);line-height:1.08;margin:0 0 18px;max-width:14ch}
.for{margin:0 0 18px;font-size:17px;color:#d9d9d4}.for strong{color:#fff;font-weight:600}
.intro{margin:0;max-width:62ch;color:#bdbdb8;font-size:15.5px}
.kits{display:grid;gap:22px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));margin-top:-58px;position:relative;z-index:1}
.kit{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04),0 18px 40px rgba(20,20,22,.08);display:flex;flex-direction:column}
.cover{all:unset;cursor:pointer;display:block;aspect-ratio:1/1.1;background:#ecebe6 center top/cover no-repeat;border-bottom:1px solid var(--line);position:relative}
.cover:focus-visible{outline:3px solid var(--accent);outline-offset:-3px}
.cover span{position:absolute;left:14px;bottom:14px;background:rgba(20,20,22,.82);color:#fff;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px}
.kit-body{padding:20px 22px 22px;display:flex;flex-direction:column;gap:6px;flex:1}
.kit h2{font-family:var(--serif);font-size:22px;line-height:1.25;margin:0}
.meta{color:var(--mute);font-size:13.5px;margin:0}
.btns{display:flex;gap:10px;margin-top:auto;padding-top:14px;flex-wrap:wrap}
.btn{appearance:none;border:1px solid var(--ink);background:transparent;color:var(--ink);font:600 14.5px var(--sans);padding:11px 18px;border-radius:999px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:8px;min-height:44px}
.btn.primary{background:var(--ink);color:#fff}
.btn:hover{border-color:var(--deep)}.btn.primary:hover{background:#000}
.contact{margin:46px 0 0;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px;display:grid;gap:18px;grid-template-columns:1fr auto;align-items:center}
.contact h3{font-family:var(--serif);font-size:24px;margin:0 0 4px}
.contact p{margin:0;color:var(--mute)}
.contact .who{color:var(--ink);font-weight:600}
.contact .btns{margin:0;padding:0}
.btn.wa{border-color:#1f9d55;color:#147a41}
footer{color:var(--mute);font-size:13px;text-align:center;padding:40px 20px 48px}
footer p{margin:4px 0}
.gone{max-width:560px;margin:70px auto;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:34px 28px;text-align:center}
.gone h1{color:var(--ink);font-size:32px;max-width:none;margin:0 0 12px}
#viewer{position:fixed;inset:0;background:#2a2a2e;z-index:10;display:flex;flex-direction:column}
#viewer[hidden]{display:none}
.vbar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--band);color:#fff}
.vbar strong{flex:1;font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vbar .btn{border-color:rgba(255,255,255,.35);color:#fff;padding:8px 14px;min-height:40px;font-size:13.5px}
#count{color:#cfcfca;font-size:13px;white-space:nowrap}
#pages{flex:1;overflow:auto;padding:16px 10px 40px;display:flex;flex-direction:column;align-items:center;gap:14px;-webkit-overflow-scrolling:touch}
#pages .pg{background:#fff;width:min(100%,900px);box-shadow:0 4px 24px rgba(0,0,0,.35);position:relative}
#pages canvas{display:block;width:100%;height:auto}
.vmsg{color:#ddd;margin:40px auto;text-align:center}
@media (max-width:640px){.hero{padding:30px 0 84px}.contact{grid-template-columns:1fr}.top img{height:32px}.vbar .hide-s{display:none}}
`

function shell(title: string, body: string, head = '', logo = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#141416">
<title>${esc(title)}</title>${head}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body>
<header class="top"><div class="wrap"><img src="${esc(logo)}" alt="Realty &amp; More" width="66" height="38"><span class="conf">Confidential</span></div></header>
${body}</body></html>`
}

const html = (s: string, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } })

function contactBlock(s: KitSettings): string {
  const digits = s.contactPhone.replace(/\D/g, '')
  const wa = digits ? (digits.length === 10 ? `91${digits}` : digits) : ''
  const btns = [
    s.contactPhone && `<a class="btn primary" href="tel:${esc(s.contactPhone.replace(/[^\d+]/g, ''))}">Call</a>`,
    wa && `<a class="btn wa" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>`,
    s.contactEmail && `<a class="btn" href="mailto:${esc(s.contactEmail)}?subject=${encodeURIComponent('Advertising with Realty & More')}">Email</a>`,
  ].filter(Boolean)
  return `<section class="contact"><div><h3>Let’s plan your campaign</h3>
<p>${s.contactName ? `<span class="who">${esc(s.contactName)}</span>${s.contactTitle ? ` · ${esc(s.contactTitle)}` : ''}<br>` : ''}${[s.contactPhone, s.contactEmail].filter(Boolean).map(esc).join(' · ')}</p></div>
<div class="btns">${btns.join('')}</div></section>`
}

export async function kitPage(env: Env, req: Request, token: string, ctx: ExecutionContext): Promise<Response> {
  const [state, s] = await Promise.all([openLink(env, token), kitSettings(env)])
  const logo = `${env.APP_URL}brand/logo_white.png`
  if ('gone' in state) {
    const msg =
      state.gone === 'expired' ? 'This media kit link has expired.' : state.gone === 'stopped' ? 'This media kit link is no longer active.' : 'This media kit link is not valid.'
    return html(
      shell(
        'Realty & More Media Kit',
        `<main class="wrap"><div class="gone"><p class="eyebrow">Realty &amp; More</p><h1>${msg}</h1><p class="meta">For the latest media kit and rates, please get in touch with us.</p></div>${contactBlock(s)}</main>
<footer><p>© Realty &amp; More · <a href="https://realtynmore.com">realtynmore.com</a></p></footer>`,
        '',
        logo,
      ),
      state.gone === 'missing' ? 404 : 410,
    )
  }
  const { link, files } = state
  ctx.waitUntil(track(env, req, link, 'open').catch(() => {}))
  const base = new URL(req.url).origin
  const cover = files.find((f) => f.has_cover)
  const ogTitle = `Realty & More Media Kit · Prepared for ${link.company}`
  const head = `
<meta property="og:type" content="website"><meta property="og:site_name" content="Realty &amp; More">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="Advertising and partnership offerings across print, digital, video and podcasts.">
${cover ? `<meta property="og:image" content="${esc(`${base}/k/${link.token}/c/${cover.id}`)}">` : ''}
<meta name="twitter:card" content="summary_large_image">`
  const cards = files
    .map(
      (f) => `<article class="kit">
<button class="cover" data-view="${f.id}" data-title="${esc(f.title)}" aria-label="View ${esc(f.title)}" style="${f.has_cover ? `background-image:url('/k/${link.token}/c/${f.id}')` : ''}"><span>View</span></button>
<div class="kit-body"><h2>${esc(f.title)}</h2><p class="meta">${f.pages ? `${f.pages} pages · ` : ''}PDF · ${sizeOf(f.size)}</p>
<div class="btns"><button class="btn primary" data-view="${f.id}" data-title="${esc(f.title)}">View</button><a class="btn" href="/k/${link.token}/f/${f.id}?dl=1" download>Download</a></div></div></article>`,
    )
    .join('')
  const body = `<section class="hero"><div class="wrap">
<p class="eyebrow">Media Kit · Advertising &amp; Partnerships</p>
<h1>Partner with Realty &amp; More</h1>
<p class="for">Prepared for <strong>${esc(link.company)}</strong>${link.person ? ` · Attention: ${esc(link.person)}` : ''}</p>
<p class="intro">${esc(s.intro)}</p></div></section>
<main class="wrap"><section class="kits">${cards}</section>${contactBlock(s)}</main>
<footer><p>Shared privately with ${esc(link.company)} · valid until ${istDay(link.expires_at)}</p><p>Rates and availability are subject to confirmation. © Realty &amp; More · <a href="https://realtynmore.com">realtynmore.com</a></p></footer>
<div id="viewer" hidden role="dialog" aria-modal="true" aria-label="Media kit">
<div class="vbar"><strong id="vtitle"></strong><span id="count"></span><a id="vdl" class="btn" download>Download</a><button id="vclose" class="btn" type="button">Close</button></div>
<div id="pages"></div></div>
<script type="module">
const V = document.getElementById('viewer'), P = document.getElementById('pages'), C = document.getElementById('count')
let lib, doc, io
async function pdfjs() {
  if (!lib) {
    lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs')
    lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'
  }
  return lib
}
function close() {
  V.hidden = true; document.body.style.overflow = ''; io && io.disconnect(); doc && doc.destroy(); doc = null; P.innerHTML = ''
  if (location.hash === '#view') history.back()
}
async function open(id, title) {
  const src = '/k/${link.token}/f/' + id
  document.getElementById('vtitle').textContent = title
  document.getElementById('vdl').href = src + '?dl=1'
  P.innerHTML = '<p class="vmsg">Opening…</p>'; C.textContent = ''
  V.hidden = false; document.body.style.overflow = 'hidden'
  if (location.hash !== '#view') history.pushState(null, '', '#view')
  try {
    const L = await pdfjs()
    doc = await L.getDocument({ url: src, disableAutoFetch: false }).promise
    P.innerHTML = ''
    const first = await doc.getPage(1), vp1 = first.getViewport({ scale: 1 })
    const pages = []
    for (let n = 1; n <= doc.numPages; n++) {
      const d = document.createElement('div'); d.className = 'pg'; d.dataset.n = n
      d.style.aspectRatio = vp1.width + ' / ' + vp1.height
      P.appendChild(d); pages.push(d)
    }
    C.textContent = doc.numPages + ' pages'
    const draw = async (d) => {
      if (d.dataset.done) return; d.dataset.done = '1'
      const page = await doc.getPage(Number(d.dataset.n))
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(3, (d.clientWidth * (window.devicePixelRatio || 1)) / base.width)
      const vp = page.getViewport({ scale })
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height
      d.style.aspectRatio = ''; d.appendChild(c)
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
    }
    let chain = Promise.resolve()
    io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) chain = chain.then(() => draw(e.target)).catch(() => {}) }), { root: P, rootMargin: '600px 0px' })
    pages.forEach((d) => io.observe(d))
    // Page number: the page at the middle of the screen.
    const at = () => { const mid = P.scrollTop + P.clientHeight / 2; const cur = pages.find((d) => d.offsetTop + d.offsetHeight > mid) || pages[pages.length - 1]; C.textContent = cur.dataset.n + ' / ' + doc.numPages }
    P.onscroll = at; at()
  } catch (e) {
    P.innerHTML = '<p class="vmsg">This preview could not open here. <a href="' + src + '" style="color:#fba519">Open the PDF</a></p>'
  }
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => open(b.dataset.view, b.dataset.title)))
document.getElementById('vclose').addEventListener('click', close)
addEventListener('popstate', () => { if (!V.hidden) close() })
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !V.hidden) close() })
</script>`
  return html(shell(`Media Kit · ${link.company} · Realty & More`, body, head, logo))
}

/** A kit's PDF (inline for the viewer, or ?dl=1 to save it) or its cover picture, for a valid link only. */
export async function kitAsset(env: Env, req: Request, token: string, kind: 'f' | 'c', fileId: string, ctx: ExecutionContext): Promise<Response> {
  const state = await openLink(env, token)
  const file = 'gone' in state ? undefined : state.files.find((f) => f.id === fileId)
  if ('gone' in state || !file) return new Response('This link is not active.', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  if (kind === 'c') {
    const pic = await env.SUBS.get(`kit:cover:${file.id}`, 'arrayBuffer')
    if (!pic) return new Response('Not found', { status: 404 })
    return new Response(pic, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=600' } })
  }
  const pdf = await env.SUBS.get(`kit:file:${file.id}`, 'arrayBuffer')
  if (!pdf) return new Response('Not found', { status: 404 })
  const dl = new URL(req.url).searchParams.has('dl')
  ctx.waitUntil(track(env, req, state.link, dl ? 'download' : 'view', file).catch(() => {}))
  const name = `${file.title.replace(/[^\w &()-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Realty and More Media Kit'}.pdf`
  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Length': String(pdf.byteLength),
    },
  })
}
