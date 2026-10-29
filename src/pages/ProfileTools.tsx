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
      <OwnerLogin />
      <OwnerKey />
      <LoginEmail />
    </Panel>
  )
}

/**
 * The owner, logged in with the owner key: add a mobile number, email (optional) and his own password,
 * then sign in with the number like the team. The key keeps working too.
 */
function OwnerLogin() {
  const res = useAsync('studio:owner-login', (s) => studio<{ can: boolean; viaKey?: boolean; phone?: string; email?: string }>('me/owner-login', undefined, s))
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ phone: '', email: '', password: '', again: '' })
  const [busy, setBusy] = useState(false)
  const d = res.data
  if (!d?.can || !d.viaKey) return null
  const has = !!d.phone
  const shown = d.phone ? `+91 ${d.phone.slice(0, 5)} ${d.phone.slice(5)}` : ''
  const mismatch = !!f.again && f.again !== f.password
  const start = () => {
    setF({ phone: d.phone ?? '', email: d.email ?? '', password: '', again: '' })
    setOpen((o) => !o)
  }
  const save = async () => {
    setBusy(true)
    try {
      const r = await studioPost<{ phone: string; email: string }>('me/owner-login', { phone: f.phone, email: f.email, password: f.password })
      toast(`Saved. Next time sign in with ${r.email ? 'your mobile number or email' : 'your mobile number'} and this password.`)
      setOpen(false)
      res.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="profile-email owner-login">
      <div className="profile-email-head">
        <span>
          <b>Mobile login</b>
          <small>
            {has
              ? `${shown}${d.email ? ` · ${d.email}` : ''} · sign in with it and your password on the Sign in page. Your owner key still works.`
              : 'You sign in with the owner key. Add your mobile number, email and a password to sign in with your number instead.'}
          </small>
        </span>
        <button className={`btn small ${has ? 'ghost' : ''}`} onClick={start} aria-expanded={open}>
          {has ? 'Change' : 'Add mobile & password'}
        </button>
      </div>
      {open && (
        <form
          className="profile-email-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label>
            Mobile number
            <span className="phone-field">
              <span>+91</span>
              <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^\d ]/g, '').slice(0, 12) })} placeholder="10-digit mobile" inputMode="numeric" autoComplete="tel-national" required />
            </span>
          </label>
          <label>
            Email <small>(optional, for “Forgot password?” codes)</small>
            <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@realtynmore.com" autoComplete="email" />
          </label>
          <label>
            {has ? 'New password' : 'Choose a password'} <small>(8+ characters, letters and numbers)</small>
            <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" minLength={8} required />
          </label>
          <label>
            Type it again
            <input type="password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} autoComplete="new-password" required />
          </label>
          {mismatch && <p className="meta warn-text">The two passwords are not the same.</p>}
          <div className="action-row">
            <button className="btn small" disabled={busy || mismatch || f.password.length < 8 || f.phone.replace(/\D/g, '').length < 10}>
              {busy ? 'Saving…' : 'Save mobile login'}
            </button>
            <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * Palash sir's own login key: signs in only as him (Sign in → Team login key). He makes it here with
 * his password; it is shown once. A new key replaces the old one.
 */
function OwnerKey() {
  const res = useAsync('studio:owner-key', (s) => studio<{ can: boolean; has?: boolean; created?: string; lastUsed?: string }>('me/login-key', undefined, s))
  const [open, setOpen] = useState<'' | 'make' | 'remove'>('')
  const [pw, setPw] = useState('')
  const [made, setMade] = useState('')
  const [busy, setBusy] = useState(false)
  const d = res.data
  if (!d?.can) return null
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
  const run = async (action: 'make' | 'remove') => {
    setBusy(true)
    try {
      const r = await studioPost<{ key?: string }>('me/login-key', { action, password: pw })
      if (r.key) setMade(r.key)
      else toast('Login key removed. It no longer works.')
      setOpen('')
      setPw('')
      res.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="profile-email owner-key">
      <div className="profile-email-head">
        <span>
          <b>My login key</b>
          <small>
            {d.has
              ? `Made ${when(d.created)} · ${d.lastUsed ? `last used ${when(d.lastUsed)}` : 'not used yet'}. Sign in page → Team login key. Only you can sign in with it.`
              : 'A key that signs in only as you: Sign in page → Team login key. Handy on a new phone or laptop.'}
          </small>
        </span>
        <span className="owner-key-btns">
          <button className={`btn small ${d.has ? 'ghost' : ''}`} onClick={() => setOpen((o) => (o === 'make' ? '' : 'make'))} aria-expanded={open === 'make'}>
            {d.has ? 'New key' : 'Make key'}
          </button>
          {d.has && (
            <button className="btn ghost small" onClick={() => setOpen((o) => (o === 'remove' ? '' : 'remove'))} aria-expanded={open === 'remove'}>
              Remove
            </button>
          )}
        </span>
      </div>
      {made && (
        <div className="akeys-new" role="status">
          <strong>Your login key</strong>
          <code>{made}</code>
          <p className="meta">Shown only once. Copy it and keep it private (not in a group chat). Lost or shared by mistake? Make a new key or tap Remove.</p>
          <div className="action-row">
            <button className="btn small" onClick={() => void navigator.clipboard?.writeText(made).then(() => toast('Key copied'))}>
              Copy key
            </button>
            <button className="btn ghost small" onClick={() => setMade('')}>
              Done
            </button>
          </div>
        </div>
      )}
      {open && (
        <form
          className="profile-email-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run(open)
          }}
        >
          <p className="meta">{open === 'make' ? (d.has ? 'A new key replaces the old one: the old key stops working.' : 'Your key is shown once after this.') : 'The key stops working at once, on every device.'}</p>
          <label>
            Your password <small>(to confirm it’s you)</small>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
          </label>
          <div className="action-row">
            <button className={`btn small ${open === 'remove' ? 'danger' : ''}`} disabled={busy || !pw}>
              {busy ? 'Working…' : open === 'make' ? 'Make my key' : 'Remove key'}
            </button>
            <button type="button" className="btn ghost small" onClick={() => setOpen('')}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/** The email on my team login: sign in with it, and get a reset code if I forget my password. */
function LoginEmail() {
  const res = useAsync('studio:me-email', (s) => studio<{ email: string; canChange: boolean }>('me/email', undefined, s))
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  if (!res.data?.canChange) return null
  const current = res.data.email
  const save = async (value: string) => {
    setBusy(true)
    try {
      await studioPost('me/email', { email: value, password: pw })
      toast(value ? 'Email saved. You can now sign in with it too.' : 'Email removed')
      setOpen(false)
      setPw('')
      res.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="profile-email">
      <div className="profile-email-head">
        <span>
          <b>Login email</b>
          <small>{current ? `${current} · sign in with it, or get a reset code if you forget your password` : 'Not added yet. Add one to sign in with it and reset your password yourself.'}</small>
        </span>
        <button className="btn ghost small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {current ? 'Change' : 'Add email'}
        </button>
      </div>
      {open && (
        <form
          className="profile-email-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save(email)
          }}
        >
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={current || 'you@example.com'} autoComplete="email" required />
          </label>
          <label>
            Your password <small>(to confirm it’s you)</small>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
          </label>
          <div className="action-row">
            <button className="btn small" disabled={busy}>
              {busy ? 'Saving…' : 'Save email'}
            </button>
            {current && (
              <button type="button" className="btn ghost small" disabled={busy || !pw} onClick={() => void save('')}>
                Remove email
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
