// Market-close data for the daily and weekly reel scripts (Content Studio, team only).
//   Prices: NSE's official end-of-day files (index closes and the full bhavcopy), saved every
//   evening after NSE publishes them. Only closing prices; nothing intraday, nothing estimated.
//   News: realtynmore.com's own stories for the day or week.
//   References: files the team uploads for a week (CSV, Word, PDF, images), kept in KV.
import { decode } from './site.ts'
import { niftyRealty } from './market.ts'
import type { Env } from './index.ts'
import type { Who } from './owner.ts'

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RM-News-App/1.0)' }
const IST = 5.5 * 3600000
export const INDICES = ['Nifty 50', 'Nifty Realty', 'Nifty Bank', 'Nifty Midcap 100', 'Nifty Smallcap 100']

/** Listed developers outside the index, tracked for the weekly "broader watchlist" (NSE symbols). */
export const WATCHLIST: [string, string][] = [
  ['SIGNATURE', 'Signature Global'], ['MAHLIFE', 'Mahindra Lifespace'], ['SUNTECK', 'Sunteck Realty'], ['KOLTEPATIL', 'Kolte-Patil'],
  ['PURVA', 'Puravankara'], ['ASHIANA', 'Ashiana Housing'], ['ARVSMART', 'Arvind SmartSpaces'], ['RUSTOMJEE', 'Keystone Realtors'],
  ['AJMERA', 'Ajmera Realty'], ['EMBDL', 'Embassy Developments'], ['OMAXE', 'Omaxe'], ['SURAJEST', 'Suraj Estate'],
  ['ARKADE', 'Arkade Developers'], ['HUBTOWN', 'Hubtown'], ['MARATHON', 'Marathon Nextgen'], ['TARC', 'TARC'],
  ['MAXESTATES', 'Max Estates'], ['SHRIRAMPPS', 'Shriram Properties'], ['RAYMONDREL', 'Raymond Realty'], ['DBREALTY', 'Valor Estate'],
  ['ELDEHSG', 'Eldeco Housing'], ['LOTUSDEV', 'Sri Lotus Developers'],
]

/** "2026-10-23" → "23102026" (NSE file names). */
export const nseStamp = (day: string) => day.slice(8, 10) + day.slice(5, 7) + day.slice(0, 4)
export const istToday = (now = Date.now()) => new Date(now + IST).toISOString().slice(0, 10)

const num = (s: string | undefined) => {
  const n = Number((s ?? '').trim())
  return Number.isFinite(n) ? n : null
}

export interface IndexRow { name: string; open: number | null; high: number | null; low: number | null; close: number; pts: number | null; pct: number | null }
export interface StockRow { symbol: string; series: string; prev: number; open: number | null; high: number | null; low: number | null; close: number }

/** NSE ind_close_all CSV → the indices we report on. */
export function parseIndexFile(csv: string): IndexRow[] {
  const out: IndexRow[] = []
  // NSE mixes cases ("NIFTY Midcap 100"); store our spelling.
  const wanted = new Map(INDICES.map((n) => [n.toLowerCase(), n]))
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const c = line.split(',')
    const name = wanted.get(c[0]?.trim().toLowerCase() ?? '')
    if (!name) continue
    const close = num(c[5])
    if (close === null) continue
    out.push({ name, open: num(c[2]), high: num(c[3]), low: num(c[4]), close, pts: num(c[6]), pct: num(c[7]) })
  }
  return out
}

/** NSE bhavcopy (sec_bhavdata_full) → closes for the given symbols (EQ, or BE when not in EQ). */
export function parseBhavcopy(csv: string, symbols: Set<string>): StockRow[] {
  const found = new Map<string, StockRow>()
  for (const line of csv.split('\n')) {
    const comma = line.indexOf(',')
    const sym = line.slice(0, comma).trim()
    if (!symbols.has(sym)) continue
    const c = line.split(',').map((x) => x.trim())
    const series = c[1]
    if (series !== 'EQ' && series !== 'BE') continue
    if (found.get(sym)?.series === 'EQ') continue
    const prev = num(c[3])
    const close = num(c[8])
    if (prev === null || close === null) continue
    found.set(sym, { symbol: sym, series, prev, open: num(c[4]), high: num(c[5]), low: num(c[6]), close })
  }
  return [...found.values()]
}

/** Saves one trading day's official closes. Returns a short status. */
export async function captureDay(env: Env, day: string): Promise<string> {
  const stamp = nseStamp(day)
  const idx = await fetch(`https://nsearchives.nseindia.com/content/indices/ind_close_all_${stamp}.csv`, { headers: UA })
  if (idx.status === 404) return `${day}: not published (holiday or too early)`
  if (!idx.ok) throw new Error(`NSE index file ${idx.status}`)
  const indices = parseIndexFile(await idx.text())
  if (!indices.length) return `${day}: no index rows`
  const list = await niftyRealty()
  const symbols = new Set([...list.stocks.map((s) => s.symbol), ...WATCHLIST.map(([s]) => s)])
  const bhav = await fetch(`https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${stamp}.csv`, { headers: UA })
  if (!bhav.ok) return `${day}: price file not published yet`
  const stocks = parseBhavcopy(await bhav.text(), symbols)
  await env.DB.batch([
    ...indices.map((r) =>
      env.DB.prepare('INSERT OR REPLACE INTO mkt_index (day, name, open, high, low, close, pts, pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(day, r.name, r.open, r.high, r.low, r.close, r.pts, r.pct),
    ),
    ...stocks.map((s) =>
      env.DB.prepare('INSERT OR REPLACE INTO mkt_stock (day, symbol, series, prev, open, high, low, close) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(day, s.symbol, s.series, s.prev, s.open, s.high, s.low, s.close),
    ),
    env.DB.prepare('INSERT OR REPLACE INTO mkt_meta (k, v) VALUES (?, ?)').bind('constituents', JSON.stringify(list.stocks)),
  ])
  await env.SUBS.put(`mkt:done:${day}`, '1', { expirationTtl: 60 * 60 * 24 * 10 })
  return `${day}: ${indices.length} indices, ${stocks.length} stocks`
}

/** Cron (every 10 min): after 6:40 PM IST on weekdays, saves today's closes once NSE has them. */
export async function autoCapture(env: Env, now = Date.now()): Promise<string> {
  const ist = new Date(now + IST)
  const day = istToday(now)
  const wd = ist.getUTCDay()
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  if (wd === 0 || wd === 6 || mins < 18 * 60 + 40) return 'not yet'
  if (await env.SUBS.get(`mkt:done:${day}`)) return 'done'
  // Try every 10 minutes until 11:30 PM, then stop (holiday).
  if (mins > 23 * 60 + 30) return 'gave up for today'
  return captureDay(env, day)
}

interface NewsItem { id: number; title: string; link: string; date: string; excerpt: string; views: number | null }

async function storiesBetween(env: Env, fromDay: string, toDay: string): Promise<NewsItem[]> {
  const after = new Date(Date.parse(`${fromDay}T00:00:00Z`) - IST).toISOString().slice(0, 19)
  const before = new Date(Date.parse(`${toDay}T23:59:59Z`) - IST).toISOString().slice(0, 19)
  const res = await fetch(`${env.SITE_API}/posts?per_page=40&after=${after}&before=${before}&_fields=id,title,link,date_gmt,excerpt`, { headers: UA })
  if (!res.ok) return []
  const rows = (await res.json()) as { id: number; title: { rendered: string }; link: string; date_gmt: string; excerpt: { rendered: string } }[]
  const ids = rows.map((r) => r.id)
  const views = new Map<number, number>()
  if (ids.length) {
    const { results } = await env.DB.prepare(`SELECT post_id, views FROM webposts WHERE post_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ post_id: number; views: number }>()
    for (const r of results) views.set(r.post_id, r.views)
  }
  return rows.map((r) => ({
    id: r.id,
    title: decode(r.title.rendered),
    link: r.link,
    date: `${r.date_gmt}Z`,
    excerpt: decode(r.excerpt.rendered.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(),
    views: views.get(r.id) ?? null,
  }))
}

async function namesFor(env: Env) {
  const meta = await env.DB.prepare("SELECT v FROM mkt_meta WHERE k = 'constituents'").first<{ v: string }>()
  const constituents = meta ? (JSON.parse(meta.v) as { symbol: string; name: string }[]) : []
  return { constituents, names: new Map([...constituents.map((c) => [c.symbol, c.name] as const), ...WATCHLIST]) }
}

/** Trading days saved so far (newest first). */
export async function savedDays(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT DISTINCT day FROM mkt_index WHERE name = 'Nifty Realty' ORDER BY day DESC LIMIT 400").all<{ day: string }>()
  return results.map((r) => r.day)
}

/** Everything the daily script needs for one trading day. */
export async function dailyData(env: Env, day?: string) {
  const days = await savedDays(env)
  const d = day && days.includes(day) ? day : days[0]
  if (!d) return { days, day: null }
  const [{ results: indices }, { results: history }, { results: stocks }, { constituents, names }, news] = await Promise.all([
    env.DB.prepare('SELECT name, open, high, low, close, pts, pct FROM mkt_index WHERE day = ?').bind(d).all<IndexRow>(),
    env.DB.prepare("SELECT day, close, pct FROM mkt_index WHERE name = 'Nifty Realty' AND day <= ? ORDER BY day DESC LIMIT 20").bind(d).all<{ day: string; close: number; pct: number }>(),
    env.DB.prepare('SELECT symbol, series, prev, open, high, low, close FROM mkt_stock WHERE day = ?').bind(d).all<StockRow>(),
    namesFor(env),
    storiesBetween(env, d, d),
  ])
  const inIndex = new Set(constituents.map((c) => c.symbol))
  const rows = stocks.map((s) => ({ ...s, name: names.get(s.symbol) ?? s.symbol, index: inIndex.has(s.symbol) }))
  return { days, day: d, indices, history, stocks: rows, news, source: `NSE official files for ${d}: ind_close_all_${nseStamp(d)}.csv and sec_bhavdata_full_${nseStamp(d)}.csv` }
}

/** Monday of the week that contains `day`. */
export function weekStart(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`)
  const wd = new Date(t).getUTCDay() || 7
  return new Date(t - (wd - 1) * 86400000).toISOString().slice(0, 10)
}

/** Everything the weekly script needs: the week's sessions against the previous week's last close. */
export async function weeklyData(env: Env, day?: string) {
  const days = await savedDays(env)
  const anchor = day ?? days[0]
  if (!anchor) return { days, weeks: [], week: null }
  const mon = weekStart(anchor)
  const fri = new Date(Date.parse(`${mon}T00:00:00Z`) + 4 * 86400000).toISOString().slice(0, 10)
  const sessions = days.filter((x) => x >= mon && x <= fri).sort()
  const base = days.find((x) => x < mon) ?? null
  const weeks = [...new Set(days.map(weekStart))]
  if (!sessions.length || !base) return { days, weeks, week: mon, sessions, base, ready: false }
  const last = sessions[sessions.length - 1]
  const all = [base, ...sessions]
  const ph = all.map(() => '?').join(',')
  const [{ results: indices }, { results: stocks }, { constituents, names }, news] = await Promise.all([
    env.DB.prepare(`SELECT day, name, open, high, low, close, pts, pct FROM mkt_index WHERE day IN (${ph}) ORDER BY day`).bind(...all).all<IndexRow & { day: string }>(),
    env.DB.prepare('SELECT day, symbol, close FROM mkt_stock WHERE day IN (?, ?)').bind(base, last).all<{ day: string; symbol: string; close: number }>(),
    namesFor(env),
    storiesBetween(env, mon, fri),
  ])
  const inIndex = new Set(constituents.map((c) => c.symbol))
  const startClose = new Map(stocks.filter((s) => s.day === base).map((s) => [s.symbol, s.close]))
  const moves = stocks
    .filter((s) => s.day === last && startClose.has(s.symbol))
    .map((s) => ({ symbol: s.symbol, name: names.get(s.symbol) ?? s.symbol, index: inIndex.has(s.symbol), from: startClose.get(s.symbol)!, to: s.close }))
  return { days, weeks, week: mon, sessions, base, last, ready: true, indices, moves, news, source: `NSE official files for ${all.join(', ')}` }
}

/* ---------- references the team uploads ---------- */

const MAX_FILE = 5 * 1024 * 1024
const TYPES = /\.(csv|xlsx?|docx?|pdf|txt|png|jpe?g|webp)$/i

export async function listRefs(env: Env) {
  const { results } = await env.DB.prepare('SELECT id, name, type, size, week, kind, note, by_name AS byName, at FROM reel_refs ORDER BY at DESC LIMIT 200').all()
  return { refs: results }
}

/** Saves an uploaded reference file (raw body; details in query string). */
export async function uploadRef(env: Env, req: Request, url: URL, who: Who) {
  const name = (url.searchParams.get('name') ?? '').replace(/[^\w .()&,+-]/g, '_').slice(0, 140)
  if (!name || !TYPES.test(name)) throw new Error('Upload a CSV, Excel, Word, PDF, text or image file.')
  const body = await req.arrayBuffer()
  if (body.byteLength === 0) throw new Error('The file is empty.')
  if (body.byteLength > MAX_FILE) throw new Error('Files up to 5 MB, please.')
  const kind = ['daily', 'weekly', 'other'].includes(url.searchParams.get('kind') ?? '') ? url.searchParams.get('kind')! : 'other'
  const week = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('week') ?? '') ? weekStart(url.searchParams.get('week')!) : weekStart(istToday())
  const id = crypto.randomUUID()
  await env.SUBS.put(`ref:${id}`, body, { metadata: { name } })
  await env.DB.prepare('INSERT INTO reel_refs (id, name, type, size, week, kind, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, name, req.headers.get('Content-Type') ?? 'application/octet-stream', body.byteLength, week, kind, (url.searchParams.get('note') ?? '').slice(0, 200) || null, who.name, new Date().toISOString())
    .run()
  return { id }
}

export async function downloadRef(env: Env, id: string, headers: Record<string, string>): Promise<Response> {
  const row = await env.DB.prepare('SELECT name, type FROM reel_refs WHERE id = ?').bind(id).first<{ name: string; type: string }>()
  const data = row ? await env.SUBS.get(`ref:${id}`, 'arrayBuffer') : null
  if (!row || !data) return new Response('Not found', { status: 404, headers })
  return new Response(data, {
    headers: { ...headers, 'Content-Type': row.type, 'Content-Disposition': `attachment; filename="${row.name}"`, 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Content-Disposition' },
  })
}

export async function removeRef(env: Env, id: string) {
  await env.SUBS.delete(`ref:${id}`)
  await env.DB.prepare('DELETE FROM reel_refs WHERE id = ?').bind(id).run()
  return { ok: true }
}
