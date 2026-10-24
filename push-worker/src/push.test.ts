import { describe, expect, it } from 'vitest'
import { buildPushPayload } from '@block65/webcrypto-web-push'
import { buildNotices, isValidSubscription, matching, newSince, type NewsItem } from './index.ts'

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const fromB64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'))
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) (out.set(p, o), (o += p.length))
  return out
}
const enc = (s: string) => new TextEncoder().encode(s)

async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** Browser side of RFC 8291 (aes128gcm), written independently of the library. */
async function decrypt(body: Uint8Array, uaKeys: CryptoKeyPair, uaPublic: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const cipher = body.slice(21 + idlen)
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256))
  const prkKey = await hmac(auth, shared)
  const ikm = await hmac(prkKey, cat(enc('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, cat(enc('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, cat(enc('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher))
  let end = plain.length - 1
  while (plain[end] === 0) end--
  expect(plain[end]).toBe(2) // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, end))
}

async function vapidKeys() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  return { subject: 'mailto:desk@realtynmore.com', publicKey: b64u(pub), privateKey: jwk.d!, verifyKey: kp.publicKey }
}

describe('web push payload', () => {
  it('encrypts so a browser can decrypt it, and signs a valid VAPID token', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const vapid = await vapidKeys()
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', expirationTime: null, keys: { p256dh: b64u(uaPublic), auth: b64u(auth) } }
    const notice = { title: 'R&M News', body: 'UP RERA approves 15 projects', url: '#/article/1', tag: 'post-1' }

    const payload = await buildPushPayload({ data: notice, options: { ttl: 60 } }, sub, vapid)
    expect(payload.headers['content-encoding']).toBe('aes128gcm')

    const text = await decrypt(new Uint8Array(payload.body as ArrayBuffer), ua, uaPublic, auth)
    expect(JSON.parse(text)).toEqual(notice)

    // VAPID: "vapid t=<jwt>, k=<public key>", ES256 over header.payload, audience = push service origin
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(payload.headers.authorization)!
    expect(m[2]).toBe(vapid.publicKey)
    const [h, p, s] = m[1].split('.')
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.sub).toBe('mailto:desk@realtynmore.com')
    expect(claims.exp * 1000).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000)
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.verifyKey, fromB64u(s), enc(`${h}.${p}`))
    expect(ok).toBe(true)
  })
})

describe('new post detection', () => {
  const latest: NewsItem[] = [5, 4, 3, 2, 1].map((id) => ({ id, title: `Story ${id}`, excerpt: '', categories: [] }))

  it('finds posts above the last notified one', () => {
    expect(newSince(latest, 3).map((p) => p.id)).toEqual([5, 4])
    expect(newSince(latest, 5)).toEqual([])
  })
  it('sends nothing on the very first run', () => {
    expect(newSince(latest, null)).toEqual([])
  })
  it('falls back to higher ids when the last post is gone', () => {
    expect(newSince(latest, 0).length).toBe(5)
    expect(newSince([{ id: 9, title: 'x', excerpt: '', categories: [] }, { id: 7, title: 'y', excerpt: '', categories: [] }], 8).map((p) => p.id)).toEqual([9])
  })
  it('makes one notice per post, or one summary when many arrive', () => {
    expect(buildNotices(latest.slice(0, 2)).map((n) => n.url)).toEqual(['#/article/5', '#/article/4'])
    const many = buildNotices(latest)
    expect(many).toHaveLength(1)
    expect(many[0].title).toContain('5 new stories')
  })
})

describe('topic filters', () => {
  const posts: NewsItem[] = [
    { id: 1, title: 'UPRERA approves 15 projects', excerpt: 'Lucknow, Oct 14', categories: [1, 439] },
    { id: 2, title: 'New tower launched', excerpt: 'Gurugram, Oct 20: a developer…', categories: [1] },
    { id: 3, title: 'Office leasing rises', excerpt: 'Mumbai, Oct 21', categories: [1, 196] },
  ]
  it('sends everything when a device has no filters', () => {
    expect(matching(posts).length).toBe(3)
  })
  it('matches chosen sections or cities (in title or summary)', () => {
    expect(matching(posts, { topics: [439], cities: [] }).map((p) => p.id)).toEqual([1])
    expect(matching(posts, { topics: [], cities: ['Gurugram'] }).map((p) => p.id)).toEqual([2])
    expect(matching(posts, { topics: [196], cities: ['gurugram'] }).map((p) => p.id)).toEqual([2, 3])
  })
})

describe('subscription validation', () => {
  const keys = { p256dh: 'BExample', auth: 'abc' }
  it('accepts real push services only', () => {
    expect(isValidSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys })).toBe(true)
    expect(isValidSubscription({ endpoint: 'https://web.push.apple.com/abc', keys })).toBe(true)
    expect(isValidSubscription({ endpoint: 'https://evil.example/hook', keys })).toBe(false)
    expect(isValidSubscription({ endpoint: 'http://fcm.googleapis.com/x', keys })).toBe(false)
    expect(isValidSubscription({ endpoint: 'https://fcm.googleapis.com/x' })).toBe(false)
  })
})

describe('content studio rules', async () => {
  const { seoIssues, covered, tokens, slugify } = await import('./editor.ts')
  const base = { title: 'Inauguration of Dindoshi–Film City Flyover to Boost Mumbai’s East–West Connectivity', content: '<p>' + 'word '.repeat(500) + '</p>', hasImage: true, seoTitle: 'Short title', metaDescription: 'A clear summary of the story that is long enough to be useful in search results, about 120 chars long.', categories: [1, 26], tags: [5] }

  it('spots a URL cut off mid-word', () => {
    expect(slugify(base.title)).toBe('inauguration-of-dindoshi-film-city-flyover-to-boost-mumbais-east-west-connectivity')
    expect(seoIssues({ ...base, slug: 'inauguration-of-dindoshi-film-city-flyover-to-boos' }).join()).toMatch(/cut off/)
    expect(seoIssues({ ...base, slug: 'dindoshi-film-city-flyover' }).join()).not.toMatch(/cut off/)
  })
  it('flags missing descriptions, thin content, images without alt and no internal links', () => {
    const issues = seoIssues({ ...base, slug: 'x', metaDescription: null, content: '<p>short</p><img src="a.jpg">', tags: [] }).join(' | ')
    expect(issues).toMatch(/No meta description/)
    expect(issues).toMatch(/Only 1 words/)
    expect(issues).toMatch(/1 image\(s\) without alt/)
    expect(issues).toMatch(/No internal links/)
    expect(issues).toMatch(/No tags/)
  })
  it('treats a rival headline as covered when key words match one of ours', () => {
    const ours = [tokens('UP RERA Approves 15 Real Estate Projects Worth Rs 1,226 Crore Across Eight Districts')]
    expect(covered('UP RERA approves 15 real estate projects in eight districts', ours)).toBe(true)
    expect(covered('DLF launches luxury tower in Gurugram sector 63', ours)).toBe(false)
  })
})

describe('trend matching', async () => {
  const { isRealEstate } = await import('./editor.ts')
  it('matches whole words only', () => {
    expect(isRealEstate('aston villa vs man city england premier league')).toBe(false)
    expect(isRealEstate('rbi keeps repo rate unchanged, home loan emi')).toBe(true)
    expect(isRealEstate('noida airport opening date')).toBe(true)
  })
})

describe('competitor comparison', async () => {
  const { topicShares, cityCounts, perDay, peakHours, advise, hotWords } = await import('./competitors.ts')
  const mk = (title: string, hoursAgo = 1) => ({ title, date: new Date(Date.now() - hoursAgo * 3600000).toISOString(), link: `https://x/${encodeURIComponent(title)}` })
  const ours = [mk('I Don’t See a Luxury Housing Bubble: Anshuman Magazine interview'), mk('CEO says demand strong in Gurugram'), mk('UP RERA approves 15 projects')]
  const theirs = [
    mk('Accenture leases 5.8 lakh sq ft in Navi Mumbai'), mk('DLF Q2 profit rises 20%'), mk('Godrej acquires 10 acre land parcel in Pune'),
    mk('Mahindra Lifespaces Q2 net profit falls 66%'), mk('Blackstone leases office in Mumbai'), mk('Lodha raises Rs 2,000 crore via QIP'),
    mk('How to check RERA registration: a guide'), mk('Prestige leases mall space in Bengaluru'),
  ]
  it('classifies headlines into topics', () => {
    const t = topicShares(theirs)
    expect(t.deals).toBeGreaterThan(40)
    expect(t.finance).toBeGreaterThan(30)
    expect(topicShares(ours).people).toBeGreaterThan(50)
  })
  it('counts cities without double-counting Navi Mumbai as Mumbai', () => {
    const c = cityCounts(theirs)
    expect(c['Navi Mumbai']).toBe(1)
    expect(c.Mumbai).toBe(1)
    expect(c.Pune).toBe(1)
  })
  it('uses exact counts when known and IST hours', () => {
    expect(perDay({ name: 'x', items: [], posts7: 21, basis: '' })).toBe(3)
    expect(peakHours([{ title: 'a', date: '2026-10-24T04:30:00Z', link: '' }])).toEqual([10])
  })
  it('advises on gaps and strengths from the numbers', () => {
    const a = advise({ name: 'RealtyNMore', items: ours, posts7: 7, basis: '' }, [{ name: 'ET', items: theirs, posts7: 35, basis: '' }])
    const all = a.map((x) => x.text).join(' | ')
    expect(all).toMatch(/publish about 5 stories a day; RealtyNMore about 1/)
    expect(all).toMatch(/Cover more deals, leasing & land/)
    expect(all).toMatch(/Your edge: interviews & opinion/)
    expect(hotWords(theirs).map((w) => w.word)).toContain('leases')
  })
})

describe('our categories count as topics', async () => {
  const { topicShares } = await import('./competitors.ts')
  it('uses RealtyNMore categories when the headline has no topic words', () => {
    const items = [{ title: 'I Don’t See a Luxury Housing Bubble in the Near Future: Anshuman Magazine', date: new Date().toISOString(), link: 'x', tags: ['people'] }]
    expect(topicShares(items).people).toBe(100)
  })
})

describe('market news', async () => {
  const { matchNews, STOCKS } = await import('./market.ts')
  const now = Date.parse('2026-10-24T12:00:00Z')
  const h = (title: string, source = 'Mint', hoursAgo = 2) => ({ title, source, link: `https://x/${title}`, date: new Date(now - hoursAgo * 3600000).toISOString() })
  it('matches headlines that name the company, newest first, ours first, within 3 days', () => {
    const r = matchNews([
      h('Mahindra Lifespace Q2 net profit falls 66%', 'ET Realty', 5),
      h('Mahindra Lifespaces posts strong H1 sales', 'RealtyNMore', 1),
      h('DLF shares slip 2% after block deal'),
      h('Old DLF story', 'Mint', 100),
      h('Realty stocks drag Nifty; realty index falls 2.6%'),
      h('Godrej Industries results'),
    ], now)
    const mah = r.stocks.find((s) => s.symbol === 'MAHLIFE')!
    expect(mah.news.map((n) => n.source)).toEqual(['RealtyNMore', 'ET Realty'])
    expect(r.stocks.find((s) => s.symbol === 'DLF')!.news.map((n) => n.title)).toEqual(['DLF shares slip 2% after block deal'])
    expect(r.stocks.find((s) => s.symbol === 'GODREJPROP')!.news).toEqual([])
    expect(r.sector.length).toBe(1)
  })
  it('covers the realty stocks shown in the app', () => {
    expect(STOCKS.map((s) => s.symbol)).toEqual(expect.arrayContaining(['DLF', 'GODREJPROP', 'LODHA', 'OBEROIRLTY', 'PRESTIGE', 'PHOENIXLTD']))
  })
})

describe('nifty realty list', async () => {
  const { parseConstituents } = await import('./market.ts')
  it('reads NSE constituent CSV', () => {
    const csv = 'Company Name,Industry,Symbol,Series,ISIN Code\r\nAditya Birla Real Estate Ltd.,Realty,ABREL,EQ,INE055A01016\r\nGodrej Properties Ltd.,Realty,GODREJPROP,EQ,INE484J01027\r\n'
    expect(parseConstituents(csv)).toEqual([
      { symbol: 'ABREL', name: 'Aditya Birla Real Estate' },
      { symbol: 'GODREJPROP', name: 'Godrej Properties' },
    ])
    expect(parseConstituents('<html>blocked</html>')).toEqual([])
  })
})

describe('owner tools', async () => {
  const { cleanNotice, cleanSiteConfig, nextMonState, briefText, cleanIdea, sameKey } = await import('./owner.ts')

  it('cleans custom notifications and maps site links into the app', () => {
    const n = cleanNotice({ title: 'Exclusive', body: 'New interview with DLF CEO', url: 'https://realtynmore.com/dlf-ceo-interview/' })
    expect(n).toMatchObject({ title: 'Exclusive', body: 'New interview with DLF CEO', url: '#/read/dlf-ceo-interview' })
    expect(cleanNotice({ body: 'Hi', url: 'https://evil.example/x' })).toMatchObject({ url: '#/', title: 'R&M News' })
    expect(cleanNotice({ title: 'x' })).toBe('Write the message text.')
  })

  it('validates Editor’s Pick and banner, and can clear them', () => {
    const empty = { pin: null, banner: null }
    expect(cleanSiteConfig({ pin: { postId: 119112 } }, empty)).toMatchObject({ pin: { postId: 119112, until: null } })
    expect(cleanSiteConfig({ pin: { postId: 'x' } }, empty)).toBe('Pick a story to pin.')
    const b = cleanSiteConfig({ banner: { text: 'R&M Podium on 5 Nov', link: 'javascript:alert(1)' } }, empty)
    expect(b).toMatchObject({ banner: { text: 'R&M Podium on 5 Nov', link: '', tone: 'accent' } })
    expect(cleanSiteConfig({ banner: null }, { pin: null, banner: { id: 'b', text: 't', link: '', until: null, tone: 'accent' } })).toMatchObject({ banner: null })
  })

  it('alerts after two failed checks and once on recovery', () => {
    const up = { down: false, fails: 0, since: null }
    const a = nextMonState(up, false, 't1')
    expect(a.alert).toBeNull()
    const b = nextMonState(a.state, false, 't2')
    expect(b.alert).toBe('down')
    expect(b.state.since).toBe('t1')
    expect(nextMonState(b.state, false, 't3').alert).toBeNull()
    expect(nextMonState(b.state, true, 't4').alert).toBe('up')
  })

  it('writes a short morning brief', () => {
    expect(briefText({ views: 420, opens: 96, top: 'DLF Q2 results', uptime: 100, gap: 'jewar airport' })).toBe(
      'Yesterday: 420 screen views, 96 stories read. Top: DLF Q2 results. Website uptime 100%. Readers searched “jewar airport” and found nothing.',
    )
  })

  it('validates calendar items', () => {
    expect(cleanIdea({ title: ' Jewar airport explainer ', status: 'writing', due: '2026-11-02' })).toMatchObject({ title: 'Jewar airport explainer', status: 'writing', due: '2026-11-02' })
    expect(cleanIdea({ title: 'x', status: 'nonsense', due: 'tomorrow' })).toMatchObject({ status: 'idea', due: null })
    expect(cleanIdea({})).toBe('Write a title.')
  })

  it('compares keys safely', () => {
    expect(sameKey('abc', 'abc')).toBe(true)
    expect(sameKey('abc', 'abd')).toBe(false)
    expect(sameKey('', '')).toBe(false)
  })
})

describe('team attendance', async () => {
  const { isLate, workedMinutes, summarizeMonth, cleanReport, istClock } = await import('./team.ts')
  const s = { startTime: '10:00', graceMin: 15, reminderTime: '18:30' }
  // 10:10 IST = 04:40 UTC, 10:20 IST = 04:50 UTC, 18:40 IST = 13:10 UTC
  it('converts to IST and marks late after start + grace', () => {
    expect(istClock('2026-10-26T04:40:00Z')).toBe('10:10')
    expect(isLate('2026-10-26T04:40:00Z', s)).toBe(false)
    expect(isLate('2026-10-26T04:50:00Z', s)).toBe(true)
    expect(isLate(null, s)).toBe(false)
  })
  it('counts worked minutes', () => {
    expect(workedMinutes('2026-10-26T04:40:00Z', '2026-10-26T13:10:00Z')).toBe(510)
    expect(workedMinutes(null, null)).toBe(0)
    // still checked in: counts up to now on the same day
    expect(workedMinutes('2026-10-26T04:40:00Z', null, Date.parse('2026-10-26T06:40:00Z'))).toBe(120)
  })
  it('summarizes a month per person', () => {
    const att = [
      { person_id: 'a', name: 'Neha', day: '2026-10-26', check_in: '2026-10-26T04:40:00Z', check_out: '2026-10-26T13:10:00Z', mode: 'office', note: '' },
      { person_id: 'a', name: 'Neha', day: '2026-10-27', check_in: '2026-10-27T04:50:00Z', check_out: '2026-10-27T12:50:00Z', mode: 'office', note: '' },
      { person_id: 'b', name: 'Ravi', day: '2026-10-26', check_in: '2026-10-26T04:30:00Z', check_out: null, mode: 'remote', note: '' },
    ]
    const rows = summarizeMonth([{ id: 'a', name: 'Neha' }, { id: 'b', name: 'Ravi' }, { id: 'c', name: 'Asha' }], att, [{ person_id: 'a', day: '2026-10-26' }], s)
    expect(rows[0]).toMatchObject({ name: 'Neha', present: 2, late: 1, reports: 1, minutes: 990, avgCheckIn: '10:15' })
    expect(rows[0].days['2026-10-27']).toEqual({ in: '10:20', out: '18:20', late: true, report: false })
    expect(rows[1]).toMatchObject({ present: 1, late: 0, minutes: 0 })
    expect(rows[2]).toMatchObject({ present: 0, avgCheckIn: null })
  })
  it('requires real report text', () => {
    expect(cleanReport({ done: 'ok' })).toBe('Write what you worked on today.')
    expect(cleanReport({ done: 'Wrote 3 RERA stories', plan: 'Interview edit' })).toMatchObject({ done: 'Wrote 3 RERA stories', plan: 'Interview edit', blockers: '' })
  })
})
