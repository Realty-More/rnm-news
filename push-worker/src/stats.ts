// Anonymous usage counts (Cloudflare D1, free plan): daily article opens and screen views.
// No user ids, no IP addresses, no cookies: only (day, article/screen, count).
import { fetchByIds } from './site.ts'
import { subscriberCount } from './push.ts'
import type { Env } from './index.ts'

export const PAGES = ['home', 'news', 'categories', 'category', 'search', 'article', 'videos', 'shorts', 'podcasts', 'saved', 'settings'] as const

const today = () => new Date().toISOString().slice(0, 10)

export type Hit = { kind: 'open'; postId: number } | { kind: 'page'; page: (typeof PAGES)[number] }

export function parseHit(body: unknown): Hit | null {
  const b = (body ?? {}) as { kind?: unknown; postId?: unknown; page?: unknown }
  if (b.kind === 'open' && Number.isInteger(b.postId) && (b.postId as number) > 0 && (b.postId as number) < 1e9) return { kind: 'open', postId: b.postId as number }
  if (b.kind === 'page' && typeof b.page === 'string' && (PAGES as readonly string[]).includes(b.page)) return { kind: 'page', page: b.page as (typeof PAGES)[number] }
  return null
}

export async function recordHit(env: Env, hit: Hit) {
  if (hit.kind === 'open') {
    await env.DB.prepare('INSERT INTO opens (day, post_id, n) VALUES (?1, ?2, 1) ON CONFLICT(day, post_id) DO UPDATE SET n = n + 1').bind(today(), hit.postId).run()
  } else {
    await env.DB.prepare('INSERT INTO pages (day, page, n) VALUES (?1, ?2, 1) ON CONFLICT(day, page) DO UPDATE SET n = n + 1').bind(today(), hit.page).run()
  }
}

/** Most-opened articles in the app over the last 2 days (at least 2 opens each). */
export async function trending(env: Env, limit = 10): Promise<{ id: number; opens: number }[]> {
  const { results } = await env.DB.prepare(
    "SELECT post_id AS id, SUM(n) AS opens FROM opens WHERE day >= date('now', '-2 day') GROUP BY post_id HAVING opens >= 2 ORDER BY opens DESC LIMIT ?1",
  )
    .bind(limit)
    .all<{ id: number; opens: number }>()
  return results
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Private stats page for the company (needs ?key=STATS_KEY). */
export async function statsPage(env: Env): Promise<string> {
  const days = await env.DB.prepare(
    "SELECT day, SUM(n) AS views FROM pages WHERE day >= date('now', '-13 day') GROUP BY day ORDER BY day DESC",
  ).all<{ day: string; views: number }>()
  const opensByDay = await env.DB.prepare(
    "SELECT day, SUM(n) AS opens FROM opens WHERE day >= date('now', '-13 day') GROUP BY day",
  ).all<{ day: string; opens: number }>()
  const screens = await env.DB.prepare(
    "SELECT page, SUM(n) AS views FROM pages WHERE day >= date('now', '-6 day') GROUP BY page ORDER BY views DESC",
  ).all<{ page: string; views: number }>()
  const top = await env.DB.prepare(
    "SELECT post_id AS id, SUM(n) AS opens FROM opens WHERE day >= date('now', '-6 day') GROUP BY post_id ORDER BY opens DESC LIMIT 20",
  ).all<{ id: number; opens: number }>()
  const posts = await fetchByIds(env.SITE_API, top.results.map((r) => r.id)).catch(() => [])
  const title = new Map(posts.map((p) => [p.id, p]))
  const opensMap = new Map(opensByDay.results.map((r) => [r.day, r.opens]))
  const subs = await subscriberCount(env)

  const rows = (items: string[][]) => items.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>R&amp;M News app stats</title><meta name="robots" content="noindex">
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f4f4f2;color:#141416}main{max-width:860px;margin:0 auto;padding:20px 16px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;margin:28px 0 8px;border-left:4px solid #FBA519;padding-left:8px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.card{background:#fff;border-radius:12px;padding:14px}.card b{display:block;font-size:26px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}td{padding:8px 10px;border-bottom:1px solid #e4e4e0;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}
a{color:#141416}small{color:#6b6b70}</style></head><body><main>
<h1>R&amp;M News: app stats</h1><small>Anonymous counts from the app. No personal data. Updated live.</small>
<div class="cards" style="margin-top:16px">
<div class="card"><small>Alert subscribers</small><b>${subs}</b></div>
<div class="card"><small>Screen views, 7 days</small><b>${screens.results.reduce((a, r) => a + r.views, 0)}</b></div>
<div class="card"><small>Article opens, 7 days</small><b>${top.results.reduce((a, r) => a + r.opens, 0)}+</b></div>
</div>
<h2>Top articles in the app (7 days)</h2><table>${rows(
    top.results.map((r) => {
      const p = title.get(r.id)
      return [p ? `<a href="${esc(p.link ?? '#')}" target="_blank" rel="noopener">${esc(p.title)}</a>` : `Post ${r.id}`, String(r.opens)]
    }),
  ) || '<tr><td>No data yet</td><td></td></tr>'}</table>
<h2>Daily (14 days)</h2><table><tr><td><b>Day</b></td><td><b>Screen views · Article opens</b></td></tr>${rows(days.results.map((d) => [d.day, `${d.views} · ${opensMap.get(d.day) ?? 0}`]))}</table>
<h2>Screens (7 days)</h2><table>${rows(screens.results.map((s) => [esc(s.page), String(s.views)]))}</table>
</main></body></html>`
}
