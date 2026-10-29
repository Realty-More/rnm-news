// "My profile" in the Studio: display name, designation, and a photo (DP) or an avatar.
import { useEffect, useRef, useState } from 'react'
import { PersonAvatar } from '../components/PersonAvatar.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { useAsync } from '../lib/hooks.ts'
import { refreshRole, studio, studioPost } from '../lib/owner.ts'
import { Panel } from './StudioTools.tsx'
import { Dialog } from './EmployeesTools.tsx'

interface Me {
  name: string
  role: string
  canRename: boolean
  title: string
  photo: string
  avatar: string
  avatars: string[]
}

/** The part of the photo to keep: a square in the photo's own pixels. */
export interface Crop {
  x: number
  y: number
  size: number
}

/** A square JPEG of the chosen part of the photo, small enough to store (256 px, under ~110 KB). */
export function cropToJpeg(img: HTMLImageElement, c: Crop, size = 256): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(img, c.x, c.y, c.size, c.size, 0, 0, size, size)
  for (const q of [0.88, 0.78, 0.65, 0.5, 0.4]) {
    const data = canvas.toDataURL('image/jpeg', q)
    if (data.length <= 110_000) return data
  }
  throw new Error('That photo is too large. Try another one.')
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('That file is not a photo.'))
    i.src = url
  })

/**
 * Crop a photo to a circle: drag to move, slider (or mouse wheel / two fingers) to zoom.
 * The visible square maps back to the photo's pixels, so the saved picture is exactly what was shown.
 */
function CropDialog({ file, onDone, onCancel }: { file: File; onDone: (photo: string) => void; onCancel: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [url, setUrl] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState(300)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ id: number; x: number; y: number; px: number; py: number } | null>(null)
  const pinch = useRef<{ d: number; z: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())

  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  // The temporary link to the chosen file lives exactly as long as this effect.
  useEffect(() => {
    let alive = true
    const u = URL.createObjectURL(file)
    setUrl(u)
    loadImage(u).then(
      (i) => alive && setImg(i),
      (e) => {
        if (!alive) return
        toast((e as Error).message)
        cancelRef.current()
      },
    )
    return () => {
      alive = false
      URL.revokeObjectURL(u)
    }
  }, [file])
  useEffect(() => {
    if (box.current) setView(box.current.clientWidth)
  }, [img])

  // Scale so the photo always covers the circle; zoom on top of that.
  const base = img ? view / Math.min(img.naturalWidth, img.naturalHeight) : 1
  const k = base * zoom
  const clamp = (p: { x: number; y: number }, kk = k) =>
    img
      ? {
          x: Math.min(0, Math.max(view - img.naturalWidth * kk, p.x)),
          y: Math.min(0, Math.max(view - img.naturalHeight * kk, p.y)),
        }
      : p
  // Start centred.
  useEffect(() => {
    if (img) setPos(clamp({ x: (view - img.naturalWidth * base) / 2, y: (view - img.naturalHeight * base) / 2 }, base))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, view])

  /** Zoom around the centre of the circle. */
  const setZoomKeep = (z: number) => {
    const nz = Math.min(4, Math.max(1, z))
    const c = view / 2
    const nk = base * nz
    setPos(clamp({ x: c - ((c - pos.x) / k) * nk, y: c - ((c - pos.y) / k) * nk }, nk))
    setZoom(nz)
  }

  const down = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }
      drag.current = null
    } else drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
  }
  const move = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      setZoomKeep(pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d))
    } else if (drag.current && drag.current.id === e.pointerId) {
      setPos(clamp({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }))
    }
  }
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  const use = () => {
    if (!img) return
    try {
      onDone(cropToJpeg(img, { x: -pos.x / k, y: -pos.y / k, size: view / k }))
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <Dialog title="Crop your photo" onClose={onCancel}>
      <p className="meta">Drag to move. Use the slider (or two fingers) to zoom.</p>
      <div
        ref={box}
        className="crop-box"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => setZoomKeep(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
      >
        {img && url && <img src={url} alt="" style={{ width: img.naturalWidth, height: img.naturalHeight, transform: `translate(${pos.x}px, ${pos.y}px) scale(${k})` }} />}
      </div>
      <label className="crop-zoom">
        Zoom
        <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoomKeep(Number(e.target.value))} aria-label="Zoom" />
      </label>
      <div className="action-row">
        <button className="btn" disabled={!img} onClick={use}>
          Use photo
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}

export function ProfilePanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const res = useAsync('studio:me-profile', (s) => studio<Me>('me/profile', undefined, s))
  const [f, setF] = useState<{ name: string; title: string; photo: string; avatar: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [cropping, setCropping] = useState<File | null>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (res.data) setF({ name: res.data.name, title: res.data.title, photo: res.data.photo, avatar: res.data.avatar })
  }, [res.data])
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data || !f) return <SkeletonList count={1} />
  const me = res.data

  const pick = (fl: File | undefined) => {
    if (!fl) return
    if (!fl.type.startsWith('image/')) return toast('Please choose a photo.')
    setCropping(fl)
    if (file.current) file.current.value = ''
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
    <Panel
      title="My profile"
      note={me.role === 'owner' ? 'Your picture shows at the top of R&M Newsroom. Remove it to go back to the default photo.' : 'Your name, designation and picture show to the team and the owner in R&M Newsroom.'}
    >
      <div className="profile-edit">
        <div className="profile-pic">
          {me.role === 'owner' && !f.photo && !f.avatar ? (
            <img className="person-avatar" src="./brand/palash.jpg" alt={f.name} width={96} height={96} style={{ width: 96, height: 96 }} />
          ) : (
            <PersonAvatar name={f.name} photo={f.photo} avatar={f.avatar} size={96} />
          )}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
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
      {cropping && (
        <CropDialog
          file={cropping}
          onCancel={() => setCropping(null)}
          onDone={(photo) => {
            setF({ ...f, photo, avatar: '' })
            setCropping(null)
          }}
        />
      )}
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
