// R&M Magazine reader: passes a magazine PDF from realtynmore.com to the app.
// The website sends PDFs in parts (HTTP ranges) but without the cross-site header a browser app
// needs, so the app reads them through here. Only PDFs in realtynmore.com's own media library are
// served, part by part, and Cloudflare's cache keeps repeat reads off the website's hosting.
import type { Env } from './index.ts'

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RM-News-App/1.0)' }

/** The PDF's address on realtynmore.com for a media id, or null if it isn't one of the site's PDFs. */
export async function magazineSource(env: Env, id: number, ctx: ExecutionContext): Promise<string | null> {
  const key = new Request(`https://magazine.cache/media/${id}`)
  const hit = await caches.default.match(key)
  if (hit) return (await hit.text()) || null
  const res = await fetch(`${env.SITE_API}/media/${id}?_fields=source_url,mime_type`, { headers: UA })
  let url = ''
  if (res.ok) {
    const m = (await res.json()) as { source_url?: string; mime_type?: string }
    const ok = m.mime_type === 'application/pdf' && typeof m.source_url === 'string' && /^https:\/\/(www\.)?realtynmore\.com\/wp-content\/uploads\/[^?#]+\.pdf$/i.test(m.source_url)
    url = ok ? m.source_url! : ''
  }
  ctx.waitUntil(caches.default.put(key, new Response(url, { headers: { 'Cache-Control': 'max-age=86400' } })))
  return url || null
}

export async function magazinePdf(env: Env, req: Request, id: number, ctx: ExecutionContext): Promise<Response> {
  const src = await magazineSource(env, id, ctx)
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges' }
  if (!src) return new Response('Not found', { status: 404, headers: cors })
  const range = req.headers.get('Range')
  const res = await fetch(src, { headers: { ...UA, ...(range ? { Range: range } : {}) }, cf: { cacheEverything: true, cacheTtl: 86400 } } as RequestInit)
  const headers: Record<string, string> = { ...cors, 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' }
  for (const h of ['Content-Length', 'Content-Range']) {
    const v = res.headers.get(h)
    if (v) headers[h] = v
  }
  return new Response(res.body, { status: res.status, headers })
}
