import { describe, expect, it } from 'vitest'
import { buildPushPayload } from '@block65/webcrypto-web-push'
import { buildNotices, isValidSubscription, newSince, type NewsItem } from './index.ts'

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
  const latest: NewsItem[] = [5, 4, 3, 2, 1].map((id) => ({ id, title: `Story ${id}` }))

  it('finds posts above the last notified one', () => {
    expect(newSince(latest, 3).map((p) => p.id)).toEqual([5, 4])
    expect(newSince(latest, 5)).toEqual([])
  })
  it('sends nothing on the very first run', () => {
    expect(newSince(latest, null)).toEqual([])
  })
  it('falls back to higher ids when the last post is gone', () => {
    expect(newSince(latest, 0).length).toBe(5)
    expect(newSince([{ id: 9, title: 'x' }, { id: 7, title: 'y' }], 8).map((p) => p.id)).toEqual([9])
  })
  it('makes one notice per post, or one summary when many arrive', () => {
    expect(buildNotices(latest.slice(0, 2)).map((n) => n.url)).toEqual(['#/article/5', '#/article/4'])
    const many = buildNotices(latest)
    expect(many).toHaveLength(1)
    expect(many[0].title).toContain('5 new stories')
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
