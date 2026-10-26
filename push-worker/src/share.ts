// Smart share links: /a/<postId> shows a rich preview (title + photo) in WhatsApp and other apps,
// then sends the reader to the story in the Realtynmore app.
import { fetchByIds } from './site.ts'
import type { Env } from './index.ts'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export async function sharePage(env: Env, id: number): Promise<Response> {
  const [post] = await fetchByIds(env.SITE_API, [id]).catch(() => [])
  const target = `${env.APP_URL}#/article/${id}`
  if (!post) return Response.redirect(env.APP_URL, 302)
  const title = esc(post.title)
  const desc = esc(post.excerpt.slice(0, 200))
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Realtynmore</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Realty &amp; More">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
${post.image ? `<meta property="og:image" content="${esc(post.image)}">` : ''}
<meta property="og:url" content="${esc(target)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${esc(post.link ?? target)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<style>body{font:16px system-ui,sans-serif;background:#141416;color:#f4f4f2;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:20px}a{color:#FBA519}</style>
</head><body><p>Opening <a href="${esc(target)}">${title}</a> in Realtynmore…</p>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
