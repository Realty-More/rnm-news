// Team profiles: each person can set their display name, designation and a photo (DP) or an avatar.
// Photos are made small on the phone (256 px JPEG) before upload and kept in D1.
import type { Env } from './index.ts'
import type { Who } from './owner.ts'

export const AVATARS = ['🧑‍💼', '👩‍💼', '👨‍💼', '🧑‍💻', '👩‍💻', '👨‍💻', '📰', '🎥', '🎙️', '📷', '🏙️', '🏗️', '🦁', '🐯', '🦊', '🐼', '🌟', '🚀', '🌸', '☕'] as const
const MAX_PHOTO = 120_000 // characters of the data URL (about 90 KB of image)

export interface Profile {
  title: string
  photo: string
  avatar: string
}

const personId = (who: Who) => who.id ?? 'owner'

export function cleanProfile(b: Record<string, unknown>): { name?: string; title?: string; photo?: string; avatar?: string } {
  const out: { name?: string; title?: string; photo?: string; avatar?: string } = {}
  if (b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : ''
    if (name.length < 2 || name.length > 40) throw new Error('Name should be 2 to 40 characters.')
    out.name = name
  }
  if (b.title !== undefined) out.title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  if (b.photo !== undefined) {
    if (b.photo === '' || b.photo === null) out.photo = ''
    else if (typeof b.photo === 'string' && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(b.photo) && b.photo.length <= MAX_PHOTO) out.photo = b.photo
    else throw new Error('That photo is too large or not an image. Try another photo.')
  }
  if (b.avatar !== undefined) {
    if (b.avatar === '' || b.avatar === null) out.avatar = ''
    else if (typeof b.avatar === 'string' && (AVATARS as readonly string[]).includes(b.avatar)) out.avatar = b.avatar
    else throw new Error('Pick one of the avatars.')
  }
  return out
}

export async function getProfile(env: Env, id: string): Promise<Profile> {
  const r = await env.DB.prepare('SELECT title, photo, avatar FROM profiles WHERE person_id = ?').bind(id).first<Profile>()
  return { title: r?.title ?? '', photo: r?.photo ?? '', avatar: r?.avatar ?? '' }
}

export async function allProfiles(env: Env): Promise<Map<string, Profile>> {
  const { results } = await env.DB.prepare('SELECT person_id, title, photo, avatar FROM profiles').all<Profile & { person_id: string }>()
  return new Map(results.map((r) => [r.person_id, { title: r.title ?? '', photo: r.photo ?? '', avatar: r.avatar ?? '' }]))
}

export async function myProfile(env: Env, who: Who) {
  return { name: who.name, role: who.role, canRename: who.role !== 'owner', ...(await getProfile(env, personId(who))), avatars: AVATARS }
}

/** Saves the signed-in person's profile; a new name also shows on their open tasks and today's attendance. */
export async function saveProfile(env: Env, who: Who, body: unknown) {
  const p = cleanProfile((body ?? {}) as Record<string, unknown>)
  const id = personId(who)
  if (p.name !== undefined && p.name !== who.name) {
    if (who.role === 'owner') throw new Error('The owner’s name stays Palash Roy.')
    if (who.phone) await env.DB.prepare('UPDATE accounts SET name = ? WHERE phone = ?').bind(p.name, who.phone).run()
    else if (id.startsWith('rd:')) await env.DB.prepare('UPDATE readers SET name = ? WHERE id = ?').bind(p.name, Number(id.slice(3))).run()
    else if (id.startsWith('ph:')) await env.DB.prepare('UPDATE accounts SET name = ? WHERE phone = ?').bind(p.name, id.slice(3)).run()
    else {
      const { renameEditor } = await import('./owner.ts')
      await renameEditor(env, id, p.name)
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE tasks SET assignee_name = ? WHERE assignee_id = ? AND status = 'open'").bind(p.name, id),
      env.DB.prepare('UPDATE attendance SET name = ? WHERE person_id = ? AND day >= ?').bind(p.name, id, new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)),
    ])
  }
  const cur = await getProfile(env, id)
  const next = { title: p.title ?? cur.title, photo: p.photo ?? cur.photo, avatar: p.avatar ?? cur.avatar }
  await env.DB.prepare('INSERT INTO profiles (person_id, title, photo, avatar, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(person_id) DO UPDATE SET title = excluded.title, photo = excluded.photo, avatar = excluded.avatar, updated_at = excluded.updated_at')
    .bind(id, next.title, next.photo, next.avatar, new Date().toISOString())
    .run()
  return { ok: true, name: p.name ?? who.name, ...next }
}
