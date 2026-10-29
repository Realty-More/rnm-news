// Realtynmore app server (Cloudflare Workers free plan).
//   POST /subscribe, /unsubscribe     breaking-news alerts (KV)
//   POST /hit, GET /trending          anonymous usage counts and "Trending in app" (D1)
//   POST /auth/signup|login|logout    Studio accounts: mobile number + password, owner approves staff
//   POST /auth/delete                 delete my account (mobile number + password)
//   POST /reader/*                    reader accounts: sign up, sign in, sync saved stories and feed choices
//   GET  /magazine/pdf/<id>           R&M Magazine PDF from realtynmore.com, in parts, for the in-app reader
//   POST /ai/ask                      "Ask R&M": answers from realtynmore.com stories only (Workers AI)
//   GET  /a/<id>                      share preview page that opens the story in the app
//   GET  /k/<token>                   private media kit page for one advertiser (expires; opens are logged)
//   GET  /site/config                 Editor's Pick and announcement banner for the app
//   GET  /market/*                    Nifty Realty list and news behind stock moves
//   /editor/*                         Content Studio (owner key or an editor key)
//   GET  /stats?key=…                 private stats page for the owner
//   cron every 10 minutes             new-story alerts, website uptime check, 9 AM morning brief
//   cron hourly at :07                website view counts per story (Post Views Counter) and YouTube views/likes
//   /editor/mag/*                     private magazine mailing list and quarterly dispatch (team only)
//   /editor/reels/*                   daily and weekly market-close reel data (NSE official closes) and reference files
import { checkAndNotify, subKey, subscribe } from './push.ts'
import { sharePage } from './share.ts'
import { parseHit, recordHit, statsPage, trending } from './stats.ts'
import { ideas, keywords, overview, SEEDS, seoAudit } from './editor.ts'
import { competitors } from './competitors.ts'
import { marketNews, niftyRealty } from './market.ts'
import {
  authenticate,
  full,
  setKeyAccess,
  checkSite,
  createEditor,
  customPush,
  deleteIdea,
  listEditors,
  listIdeas,
  morningBrief,
  performance,
  pushLog,
  registerOwnerDevice,
  revokeEditor,
  sameKey,
  saveIdea,
  saveSiteConfig,
  siteConfig,
  uptimeSummary,
  type Who,
} from './owner.ts'
import { createIssue, dispatchOf, magazineBook, removeContact, saveContact, setDispatch } from './magazine.ts'
import { ask, write } from './ai.ts'
import { magazinePdf } from './magazine-pdf.ts'
import { addSubscriber, candidates, savePicks, confirmPage, newsletterBook, newsletterTick, previewIssue, removeSubscriber, saveNlSettings, sendNow, sendTest, subscribe as nlSubscribe, unsubscribePage } from './newsletter.ts'
import { addPayment, adsBook, removeClient, removeDeal, removePayment, saveClient, saveDeal, updateDeal } from './ads.ts'
import { getProfile, myProfile, saveProfile } from './profile.ts'
import { readerDelete, readerForgot, readerLogin, readerLogout, readerMe, readerProfile, readerReset, readerSignup, readerSync } from './reader.ts'
import { getDraft, listDrafts, pressImage, pressToStory, removeDraft, savePressImage, setImageRole } from './press.ts'
import { changeLink, createLink, kitAsset, kitBook, kitPage, kitPdf, linkViews, moveKit, removeKit, saveKitSettings, updateKit, uploadCover, uploadKit } from './mediakit.ts'
import { sendTeamEmail } from './teamEmail.ts'
import { addStaffLogin, keyToMobile, mergeKeyIntoAccount, mustChangePassword, changePassword, deleteAccount, listAccounts, login, logout, manageAccount, signup } from './accounts.ts'
import { allLeaves, cancelLeave, createTask, decideLeave, deleteTask, listTasks, myLeaves, requestLeave, updateTask } from './work.ts'
import { autoCapture, captureDay, dailyData, downloadRef, listRefs, removeRef, uploadRef, weeklyData } from './reels.ts'
import { collectYouTube, youTubeStats } from './youtube.ts'
import { collectViews, seoCompare, webTraffic } from './website.ts'
import { assignablePeople, attendanceNudges, checkIn, teamSettings, checkOut, myHistory, myToday, registerStaffDevice, reportReminders, saveTeamSettings, submitReport, teamDay, teamMonth } from './team.ts'

export interface Env {
  SUBS: KVNamespace
  DB: D1Database
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  ALLOWED_ORIGINS: string
  SITE_API: string
  APP_URL: string
  /** Brevo API key for the weekly newsletter (secret; sending is off without it). */
  BREVO_API_KEY?: string
  /** Public address of this server for newsletter links (defaults to the workers.dev address). */
  NEWSLETTER_URL?: string
  STATS_KEY: string
  AI: Ai
  /** Secret mixed into password hashes (wrangler secret put AUTH_PEPPER). */
  AUTH_PEPPER?: string
}

export { buildNotices, isValidSubscription, matching, newSince } from './push.ts'
export type { NewsItem } from './site.ts'

const MAX_BODY = 4096
// Bump when studio/market logic changes, so old cached results are not served.
const STUDIO_CACHE = 8

function cors(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  return origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', Vary: 'Origin' }
    : {}
}

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

async function readJson(req: Request, max = MAX_BODY): Promise<unknown> {
  const text = await req.text()
  if (text.length > max) throw new Error('That is too much to send at once. If it is a photo, try a smaller one.')
  return text ? JSON.parse(text) : {}
}

/** Serves `make()` from the edge cache for `ttl` seconds (cache key never includes a key or user). */
async function cachedJson(url: URL, ctx: ExecutionContext, headers: Record<string, string>, ttl: number, make: () => Promise<unknown>) {
  const key = new Request(`${url.origin}${url.pathname}${url.search}${url.search ? '&' : '?'}v=${STUDIO_CACHE}`)
  const hit = await caches.default.match(key)
  if (hit) return new Response(hit.body, { headers: { ...Object.fromEntries(hit.headers), ...headers } })
  const res = json(await make(), 200, { 'Cache-Control': `public, max-age=${ttl}` })
  ctx.waitUntil(caches.default.put(key, res.clone()))
  return new Response(res.body, { headers: { ...Object.fromEntries(res.headers), ...headers } })
}

const TEAM_ONLY = new Set(['/editor/me/checkin', '/editor/me/checkout', '/editor/me/report', '/editor/me/device', '/editor/me/leave'])
const OWNER_ONLY = new Set(['/editor/yt', '/editor/yt/refresh', '/editor/overview', '/editor/push-log', '/editor/uptime', '/editor/performance', '/editor/web/traffic', '/editor/web/seo', '/editor/push', '/editor/site', '/editor/owner-device'])

/** Content Studio for the owner and editors. Team management is owner-only. */
async function studio(req: Request, url: URL, env: Env, ctx: ExecutionContext, headers: Record<string, string>, who: Who): Promise<Response> {
  const { pathname } = url
  const ownerOnly = () => json({ error: 'Only the owner can do this.' }, 403, headers)
  // Business numbers, traffic, notifications and site settings are for the owner (Palash Roy) only.
  if (!full(who) && OWNER_ONLY.has(pathname) && !(req.method === 'GET' && pathname === '/editor/site')) return ownerOnly()
  // Check-in, daily report and report reminders are for team members; the owner is not tracked as staff.
  if (who.role === 'owner' && TEAM_ONLY.has(pathname)) return json({ error: 'Attendance and daily reports are for team members.' }, 403, headers)
  // Ad sales (advertisers, deal values, payments) and the newsletter are for the owner and full-access staff only.
  if ((pathname.startsWith('/editor/ads') || pathname.startsWith('/editor/newsletter')) && !full(who)) return ownerOnly()
  // The media kit (rate cards and share links to advertisers): owner and full-access staff, not other employees.
  if (pathname.startsWith('/editor/kit') && !full(who)) return ownerOnly()
  try {
    if (req.method === 'GET') {
      switch (pathname) {
        case '/editor/ping': {
          // mustChange: still on a password the owner gave them; profile: their photo or avatar for the header.
          const [mustChange, profile] = await Promise.all([mustChangePassword(env, who.phone), getProfile(env, who.id ?? 'owner')])
          return json({ ok: true, role: who.role, name: who.name, mustChange, photo: profile.photo, avatar: profile.avatar, title: profile.title }, 200, { ...headers, 'Cache-Control': 'no-store' })
        }
        case '/editor/me/profile':
          return json(await myProfile(env, who), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/overview':
          return json(await overview(env), 200, headers)
        case '/editor/ideas':
          return cachedJson(url, ctx, headers, 30 * 60, () => ideas(env))
        case '/editor/keywords': {
          const seeds = (url.searchParams.get('seeds') ?? '')
            .split(',')
            .map((s) => s.trim().toLowerCase().slice(0, 60))
            .filter(Boolean)
          return cachedJson(url, ctx, headers, 12 * 60 * 60, () => keywords(seeds.length ? seeds : SEEDS))
        }
        case '/editor/competitors':
          return cachedJson(url, ctx, headers, 60 * 60, () => competitors(env))
        case '/editor/seo':
          return cachedJson(url, ctx, headers, 6 * 60 * 60, () => seoAudit(env))
        case '/editor/push-log':
          return json(await pushLog(env), 200, headers)
        case '/editor/uptime':
          return json(await uptimeSummary(env), 200, headers)
        case '/editor/performance': {
          const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days')) || 7))
          return json(await performance(env, days), 200, headers)
        }
        case '/editor/calendar':
          return json(await listIdeas(env), 200, headers)
        case '/editor/site':
          return json(await siteConfig(env), 200, headers)
        case '/editor/team':
          return full(who) ? json({ editors: await listEditors(env) }, 200, headers) : ownerOnly()
        case '/editor/me/today':
          return json(await myToday(env, who), 200, headers)
        case '/editor/me/history':
          return json(await myHistory(env, who), 200, headers)
        case '/editor/reels/daily':
          return json(await dailyData(env, url.searchParams.get('day') ?? undefined), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/reels/weekly':
          return json(await weeklyData(env, url.searchParams.get('day') ?? undefined), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/reels/refs':
          return json(await listRefs(env), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/reels/ref':
          return downloadRef(env, url.searchParams.get('id') ?? '', headers)
        case '/editor/ads':
          return json(await adsBook(env), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/newsletter':
          return json(await newsletterBook(env), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/kit':
          return json(await kitBook(env), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/kit/pdf':
          return kitPdf(env, url.searchParams.get('id') ?? '', headers)
        case '/editor/kit/views':
          return json(await linkViews(env, url.searchParams.get('token') ?? ''), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/press/image':
          return pressImage(env, url, headers)
        case '/editor/press/drafts':
          return json(await listDrafts(env), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/press/draft':
          return json(await getDraft(env, Number(url.searchParams.get('id'))), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/newsletter/candidates':
          return json(await candidates(env, url.searchParams.get('q') ?? ''), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/newsletter/preview':
          return json(await previewIssue(env), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/mag/book':
          return json(await magazineBook(env), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/mag/dispatch':
          return json(await dispatchOf(env, url.searchParams.get('issue') ?? ''), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/yt':
          return json(await youTubeStats(env), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/web/traffic':
          return json(await webTraffic(env), 200, headers)
        case '/editor/web/seo':
          return cachedJson(url, ctx, headers, 12 * 60 * 60, () => seoCompare(env))
        case '/editor/accounts':
          return full(who) ? json(await listAccounts(env), 200, { ...headers, 'Cache-Control': 'no-store' }) : ownerOnly()
        case '/editor/tasks':
          return json(await listTasks(env, who, url.searchParams.get('scope') ?? 'mine'), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/people':
          return full(who) ? json({ people: await assignablePeople(env) }, 200, headers) : ownerOnly()
        case '/editor/me/leaves':
          return json(await myLeaves(env, who), 200, { ...headers, 'Cache-Control': 'no-store' })
        case '/editor/leaves':
          return full(who) ? json(await allLeaves(env, url.searchParams.get('month') ?? ''), 200, { ...headers, 'Cache-Control': 'no-store' }) : ownerOnly()
        case '/editor/team/settings':
          return full(who) ? json({ settings: await teamSettings(env) }, 200, { ...headers, 'Cache-Control': 'no-store' }) : ownerOnly()
        case '/editor/team/day':
          return full(who) ? json(await teamDay(env, url.searchParams.get('date') ?? ''), 200, headers) : ownerOnly()
        case '/editor/team/month':
          return full(who) ? json(await teamMonth(env, url.searchParams.get('month') ?? ''), 200, headers) : ownerOnly()
      }
      return json({ error: 'not found' }, 404, headers)
    }

    // File uploads send the raw file, not JSON.
    if (pathname === '/editor/reels/ref-upload') return json(await uploadRef(env, req, url, who), 200, headers)
    if (pathname === '/editor/press/image') return json(await savePressImage(env, req, url), 200, headers)
    if (pathname === '/editor/kit/upload') return json(await uploadKit(env, req, url, who), 200, headers)
    if (pathname === '/editor/kit/cover') return json(await uploadCover(env, req, url), 200, headers)
    // A profile photo (small JPEG as text) is the one bigger body the Studio sends.
    const body = await readJson(req, pathname === '/editor/me/profile' ? 160_000 : pathname === '/editor/press/story' ? 120_000 : MAX_BODY)
    switch (pathname) {
      case '/editor/push':
        return json(await customPush(env, body, who), 200, headers)
      case '/editor/site':
        return json(await saveSiteConfig(env, body), 200, headers)
      case '/editor/owner-device':
        return json({ ok: await registerOwnerDevice(env, body, who) }, 200, headers)
      case '/editor/calendar':
        return json(await saveIdea(env, body, who), 200, headers)
      case '/editor/calendar/delete':
        return json({ ok: await deleteIdea(env, Number((body as { id?: unknown }).id)) }, 200, headers)
      case '/editor/brief-now':
        return full(who) ? json({ result: await morningBrief(env, true) }, 200, headers) : ownerOnly()
      case '/editor/team': {
        if (!full(who)) return ownerOnly()
        const name = String((body as { name?: unknown }).name ?? '')
        return json(await createEditor(env, name), 200, headers)
      }
      case '/editor/me/checkin':
        return json(await checkIn(env, who, body), 200, headers)
      case '/editor/me/checkout':
        return json(await checkOut(env, who, body), 200, headers)
      case '/editor/me/report':
        return json(await submitReport(env, who, body), 200, headers)
      case '/editor/me/device':
        return json({ ok: await registerStaffDevice(env, who, body) }, 200, headers)
      case '/editor/me/profile':
        return json(await saveProfile(env, who, body), 200, headers)
      case '/editor/accounts/add':
        return json(await addStaffLogin(env, body, who), 200, { ...headers, 'Cache-Control': 'no-store' })
      case '/editor/team/email-now':
        return full(who) ? json({ result: await sendTeamEmail(env, true) }, 200, headers) : ownerOnly()
      case '/editor/team/to-mobile':
        return json(await keyToMobile(env, body, who), 200, { ...headers, 'Cache-Control': 'no-store' })
      case '/editor/team/merge':
        return json(await mergeKeyIntoAccount(env, body, who), 200, headers)
      case '/editor/accounts/approve':
      case '/editor/accounts/reject':
      case '/editor/accounts/remove':
      case '/editor/accounts/reset':
      case '/editor/accounts/grant':
      case '/editor/accounts/ungrant':
      case '/editor/accounts/signout':
        return full(who) ? json(await manageAccount(env, pathname.split('/').pop()!, body, who), 200, headers) : ownerOnly()
      case '/editor/me/password':
        return json(await changePassword(env, body, who, req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''), 200, headers)
      case '/editor/tasks':
        return full(who) ? json(await createTask(env, who, body, await assignablePeople(env)), 200, headers) : ownerOnly()
      case '/editor/tasks/update':
        return json(await updateTask(env, who, body), 200, headers)
      case '/editor/tasks/delete':
        return full(who) ? json(await deleteTask(env, body), 200, headers) : ownerOnly()
      case '/editor/me/leave':
        return json(await requestLeave(env, who, body), 200, headers)
      case '/editor/me/leave/cancel':
        return json(await cancelLeave(env, who, body), 200, headers)
      case '/editor/leaves/decide':
        return full(who) ? json(await decideLeave(env, who, body), 200, headers) : ownerOnly()
      case '/editor/ai/write':
        return json(await write(env, body, who), 200, headers)
      case '/editor/reels/ref-remove':
        return full(who) ? json(await removeRef(env, String((body as { id?: unknown }).id ?? '')), 200, headers) : ownerOnly()
      case '/editor/reels/capture': {
        if (!full(who)) return ownerOnly()
        const day = String((body as { day?: unknown }).day ?? '')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'Pick a date.' }, 400, headers)
        return json({ result: await captureDay(env, day) }, 200, headers)
      }
      case '/editor/press/story':
        return json(await pressToStory(env, body, who), 200, headers)
      case '/editor/kit/file':
        return json(await updateKit(env, body), 200, headers)
      case '/editor/kit/move':
        return json(await moveKit(env, body), 200, headers)
      case '/editor/kit/remove':
        return json(await removeKit(env, body), 200, headers)
      case '/editor/kit/settings':
        return json(await saveKitSettings(env, body), 200, headers)
      case '/editor/kit/link':
        return json(await createLink(env, body, who, url.origin), 200, { ...headers, 'Cache-Control': 'no-store' })
      case '/editor/kit/preview':
        return json(await createLink(env, body, who, url.origin, true), 200, { ...headers, 'Cache-Control': 'no-store' })
      case '/editor/kit/link/change':
        return json(await changeLink(env, body), 200, headers)
      case '/editor/press/image-role':
        return json(await setImageRole(env, body), 200, headers)
      case '/editor/press/remove':
        return json(await removeDraft(env, body), 200, headers)
      case '/editor/newsletter/settings':
        return json(await saveNlSettings(env, body), 200, headers)
      case '/editor/newsletter/picks':
        return json(await savePicks(env, body), 200, headers)
      case '/editor/newsletter/test':
        return json(await sendTest(env, body), 200, headers)
      case '/editor/newsletter/send-now':
        return json(await sendNow(env, who), 200, headers)
      case '/editor/newsletter/subscriber':
        return json(await addSubscriber(env, body), 200, headers)
      case '/editor/newsletter/subscriber/remove':
        return json(await removeSubscriber(env, body), 200, headers)
      case '/editor/ads/client':
        return json(await saveClient(env, body, who), 200, headers)
      case '/editor/ads/client/remove':
        return json(await removeClient(env, body), 200, headers)
      case '/editor/ads/deal':
        return json(await saveDeal(env, body, who), 200, headers)
      case '/editor/ads/deal/update':
        return json(await updateDeal(env, body), 200, headers)
      case '/editor/ads/deal/remove':
        return json(await removeDeal(env, body), 200, headers)
      case '/editor/ads/payment':
        return json(await addPayment(env, body, who), 200, headers)
      case '/editor/ads/payment/remove':
        return json(await removePayment(env, body), 200, headers)
      case '/editor/mag/contact':
        return json(await saveContact(env, body, who), 200, headers)
      case '/editor/mag/contact/remove':
        return full(who) ? json(await removeContact(env, Number((body as { id?: unknown }).id), who), 200, headers) : ownerOnly()
      case '/editor/mag/issue':
        return full(who) ? json(await createIssue(env, body), 200, headers) : ownerOnly()
      case '/editor/mag/dispatch':
        return json(await setDispatch(env, body, who), 200, headers)
      case '/editor/yt/refresh':
        return json({ result: await collectYouTube(env) }, 200, headers)
      case '/editor/web/refresh': {
        // Owner can pull fresh counts; at most once every 5 minutes.
        if (!full(who)) return ownerOnly()
        if (await env.SUBS.get('web:refresh-lock')) return json({ result: 'Updated a moment ago; try again in a few minutes.' }, 200, headers)
        await env.SUBS.put('web:refresh-lock', '1', { expirationTtl: 300 })
        return json({ result: await collectViews(env) }, 200, headers)
      }
      case '/editor/team/settings':
        return full(who) ? json(await saveTeamSettings(env, body), 200, headers) : ownerOnly()
      case '/editor/team/remind-now':
        return full(who) ? json({ result: await reportReminders(env, true) }, 200, headers) : ownerOnly()
      case '/editor/team/revoke': {
        const id = String((body as { id?: unknown }).id ?? '')
        if (!full(who)) return ownerOnly()
        return json({ ok: await revokeEditor(env, id) }, 200, headers)
      }
      case '/editor/team/access': {
        if (!full(who)) return json({ error: 'Only the owner or full-access staff can change full access.' }, 403, headers)
        const b = body as { id?: unknown; admin?: unknown }
        return json({ ok: await setKeyAccess(env, String(b.id ?? ''), b.admin === true) }, 200, headers)
      }
    }
    return json({ error: 'not found' }, 404, headers)
  } catch (err) {
    return json({ error: (err as Error).message }, 502, headers)
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    const { pathname } = url
    const origin = req.headers.get('Origin')
    const headers = cors(origin, env)
    // Browsers always send Origin on these requests, so only listed sites may call from a browser.
    // The Android app's native HTTP sends none; with bearer tokens and no cookies that is safe.
    const allowedCaller = !!headers['Access-Control-Allow-Origin'] || origin === null
    // Newsletter confirm and unsubscribe links open from email (no app origin), including one-click unsubscribe.
    if (pathname === '/newsletter/confirm' && req.method === 'GET') return confirmPage(env, url)
    if (pathname === '/newsletter/unsubscribe' && (req.method === 'GET' || req.method === 'POST')) return unsubscribePage(env, req, url)
    // Magazine PDFs are public and read part by part by the app's PDF reader (any origin, Range header).
    const mag = /^\/magazine\/pdf\/(\d{1,9})$/.exec(pathname)
    if (mag) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Max-Age': '86400' } })
      if (req.method === 'GET') return magazinePdf(env, req, Number(mag[1]), ctx)
    }
    // Media kit links sent to advertisers (WhatsApp, email): the page, its PDFs and cover pictures.
    const kit = /^\/k\/([A-Za-z0-9_-]{22})(?:\/(f|c)\/([a-z0-9]{8,24}))?\/?$/.exec(pathname)
    if (kit && (req.method === 'GET' || req.method === 'HEAD')) return kit[2] ? kitAsset(env, req, kit[1], kit[2] as 'f' | 'c', kit[3], ctx) : kitPage(env, req, kit[1], ctx)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

    if (pathname.startsWith('/editor/')) {
      if (req.method !== 'GET' && !allowedCaller) return json({ error: 'not allowed' }, 403, headers)
      const key = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
      const who = await authenticate(key, env, ctx)
      if (!who) return json({ error: 'owner or editor key required' }, 401, headers)
      return studio(req, url, env, ctx, headers, who)
    }

    if (req.method === 'GET') {
      if (pathname === '/') return json({ ok: true, service: 'Realtynmore app server' }, 200, headers)
      if (pathname === '/vapid') return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, headers)
      const share = /^\/a\/(\d{1,9})$/.exec(pathname)
      if (share) return sharePage(env, Number(share[1]))
      if (pathname === '/site/config') return json(await siteConfig(env), 200, { ...headers, 'Cache-Control': 'public, max-age=60' })
      if (pathname === '/market/nifty-realty') return cachedJson(url, ctx, headers, 86400, () => niftyRealty())
      if (pathname === '/market/news') return cachedJson(url, ctx, headers, 1800, () => marketNews(env))
      if (pathname === '/trending') return cachedJson(url, ctx, headers, 300, async () => ({ items: await trending(env).catch(() => []) }))
      if (pathname === '/stats') {
        if (!sameKey(url.searchParams.get('key') ?? '', env.STATS_KEY ?? '')) return new Response('Not found', { status: 404 })
        return new Response(await statsPage(env), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
      }
      return json({ error: 'not found' }, 404, headers)
    }

    if (req.method !== 'POST' || !allowedCaller) return json({ error: 'not allowed' }, 403, headers)
    let body: unknown
    try {
      // Syncing saved stories is the one bigger body readers send.
      body = await readJson(req, pathname === '/reader/sync' ? 400_000 : MAX_BODY)
    } catch {
      return json({ error: 'bad request' }, 400, headers)
    }
    if (pathname === '/subscribe') {
      return (await subscribe(env, body)) ? json({ ok: true }, 200, headers) : json({ error: 'invalid subscription' }, 400, headers)
    }
    if (pathname === '/unsubscribe') {
      const endpoint = (body as { endpoint?: unknown }).endpoint
      if (typeof endpoint !== 'string') return json({ error: 'bad request' }, 400, headers)
      await env.SUBS.delete(await subKey(endpoint))
      return json({ ok: true }, 200, headers)
    }
    if (pathname === '/newsletter/subscribe') {
      try {
        return json(await nlSubscribe(env, req, body), 200, { ...headers, 'Cache-Control': 'no-store' })
      } catch (err) {
        return json({ error: (err as Error).message }, 400, headers)
      }
    }
    // Reader accounts (never open R&M Newsroom; see reader.ts).
    if (pathname.startsWith('/reader/')) {
      try {
        const run: Record<string, () => Promise<unknown>> = {
          '/reader/signup': () => readerSignup(env, req, body),
          '/reader/login': () => readerLogin(env, req, body),
          '/reader/logout': () => readerLogout(env, req),
          '/reader/me': () => readerMe(env, req),
          '/reader/sync': () => readerSync(env, req, body),
          '/reader/profile': () => readerProfile(env, req, body),
          '/reader/delete': () => readerDelete(env, req, body),
          '/reader/forgot': () => readerForgot(env, req, body),
          '/reader/reset': () => readerReset(env, req, body),
        }
        if (!run[pathname]) return json({ error: 'not found' }, 404, headers)
        return json(await run[pathname](), 200, { ...headers, 'Cache-Control': 'no-store' })
      } catch (err) {
        return json({ error: (err as Error).message }, 400, headers)
      }
    }
    if (pathname === '/auth/delete') {
      try {
        return json(await deleteAccount(env, req, body), 200, { ...headers, 'Cache-Control': 'no-store' })
      } catch (err) {
        return json({ error: (err as Error).message }, 400, headers)
      }
    }
    if (pathname === '/auth/signup' || pathname === '/auth/login' || pathname === '/auth/logout') {
      try {
        const out =
          pathname === '/auth/signup'
            ? await signup(env, req, body)
            : pathname === '/auth/login'
              ? await login(env, req, body)
              : await logout(env, req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '')
        return json(out, 200, { ...headers, 'Cache-Control': 'no-store' })
      } catch (err) {
        return json({ error: (err as Error).message }, 400, headers)
      }
    }
    if (pathname === '/ai/ask') {
      try {
        return json(await ask(env, req, body, ctx), 200, headers)
      } catch (err) {
        return json({ error: (err as Error).message }, 429, headers)
      }
    }
    if (pathname === '/hit') {
      const hit = parseHit(body)
      if (!hit) return json({ error: 'bad request' }, 400, headers)
      ctx.waitUntil(recordHit(env, hit).catch(() => {}))
      return json({ ok: true }, 200, headers)
    }
    return json({ error: 'not found' }, 404, headers)
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const run = (name: string, job: () => Promise<string>) => job().then((r) => console.log(name, r), (e) => console.log(name, 'failed', (e as Error).message))
    // Its own hourly run, so the ~45 site requests don't share the 50-request limit with alerts.
    if (event.cron === '7 * * * *') return ctx.waitUntil(Promise.all([run('views', () => collectViews(env)), run('youtube', () => collectYouTube(env))]))
    ctx.waitUntil(Promise.all([run('alerts', () => checkAndNotify(env)), run('uptime', () => checkSite(env)), run('brief', () => morningBrief(env)), run('reminders', () => reportReminders(env)), run('nudges', () => attendanceNudges(env)), run('newsletter', () => newsletterTick(env)), run('team-email', () => sendTeamEmail(env)), run('market', () => autoCapture(env))]))
  },
} satisfies ExportedHandler<Env>
