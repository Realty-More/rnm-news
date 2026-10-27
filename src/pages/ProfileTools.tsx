// "My profile" in the Studio: display name, designation, and a photo (DP) or an avatar.
import { useEffect, useRef, useState } from 'react'
import { PersonAvatar } from '../components/PersonAvatar.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { useAsync } from '../lib/hooks.ts'
import { refreshRole, studio, studioPost } from '../lib/owner.ts'
import { Panel } from './StudioTools.tsx'

interface Me {
  name: string
  role: string
  canRename: boolean
  title: string
  photo: string
  avatar: string
  avatars: string[]
}

/** A square, centre-cropped JPEG small enough to store (about 256 px, under ~90 KB). */
export async function squarePhoto(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('That file is not a photo.'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    for (const q of [0.85, 0.75, 0.6, 0.45]) {
      const data = canvas.toDataURL('image/jpeg', q)
      if (data.length <= 110_000) return data
    }
    throw new Error('That photo is too large. Try another one.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ProfilePanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const res = useAsync('studio:me-profile', (s) => studio<Me>('me/profile', undefined, s))
  const [f, setF] = useState<{ name: string; title: string; photo: string; avatar: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (res.data) setF({ name: res.data.name, title: res.data.title, photo: res.data.photo, avatar: res.data.avatar })
  }, [res.data])
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data || !f) return <SkeletonList count={1} />
  const me = res.data

  const pick = async (fl: File | undefined) => {
    if (!fl) return
    try {
      setF({ ...f, photo: await squarePhoto(fl), avatar: '' })
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const save = async () => {
    setBusy(true)
    try {
      await studioPost('me/profile', { ...(me.canRename ? { name: f.name } : {}), title: f.title, photo: f.photo, avatar: f.avatar })
      await refreshRole()
      toast('Profile saved')
      res.reload()
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="My profile" note="Your name, designation and picture show to the team and the owner in the Studio.">
      <div className="profile-edit">
        <div className="profile-pic">
          <PersonAvatar name={f.name} photo={f.photo} avatar={f.avatar} size={96} />
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <button className="btn ghost small" onClick={() => file.current?.click()}>
            📷 {f.photo ? 'Change photo' : 'Upload photo'}
          </button>
          {(f.photo || f.avatar) && (
            <button className="link-btn" onClick={() => setF({ ...f, photo: '', avatar: '' })}>
              Remove picture
            </button>
          )}
        </div>
        <div className="profile-fields">
          <label>
            Name
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!me.canRename} maxLength={40} />
          </label>
          <label>
            Designation <small>(optional)</small>
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Content Writer, Video Editor" maxLength={60} />
          </label>
          <span className="profile-or">Or pick an avatar</span>
          <div className="avatar-grid" role="radiogroup" aria-label="Avatar">
            {me.avatars.map((a) => (
              <button key={a} role="radio" aria-checked={!f.photo && f.avatar === a} className={!f.photo && f.avatar === a ? 'on' : ''} onClick={() => setF({ ...f, avatar: a, photo: '' })}>
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="action-row">
        <button className="btn" disabled={busy || f.name.trim().length < 2} onClick={save}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Panel>
  )
}
