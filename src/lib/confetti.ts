// Small celebrations for the Newsroom (on-time check-in, a full day, the whole team in on time).
// No library: one short canvas burst in the brand colours that removes itself. Skipped for people who
// ask their phone for less motion.

const COLORS = ['#FBA519', '#F2711C', '#FFD36B', '#2E9D5B', '#3B7DDD', '#FFFFFF']

const calm = () => typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A short confetti burst from the top of the screen (about 2 seconds). */
export function confetti(pieces = 140) {
  if (calm() || typeof document === 'undefined') return
  const canvas = document.createElement('canvas')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = window.innerWidth
  const h = window.innerHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: `${w}px`, height: `${h}px`, pointerEvents: 'none', zIndex: '400' })
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas.remove()
  ctx.scale(dpr, dpr)
  const parts = Array.from({ length: pieces }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.4,
    y: -10 - Math.random() * 40,
    vx: (Math.random() - 0.5) * 9,
    vy: 3 + Math.random() * 6,
    size: 5 + Math.random() * 6,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    round: Math.random() < 0.3,
  }))
  const t0 = performance.now()
  const frame = (t: number) => {
    const k = (t - t0) / 2200
    ctx.clearRect(0, 0, w, h)
    for (const p of parts) {
      p.vy += 0.16
      p.vx *= 0.99
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4)
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      if (p.round) {
        ctx.beginPath()
        ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2)
        ctx.fill()
      } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      ctx.restore()
    }
    if (k < 1) requestAnimationFrame(frame)
    else canvas.remove()
  }
  requestAnimationFrame(frame)
}

/** A short vibration on phones that support it. */
export function buzz(pattern: number | number[] = 30) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* not supported */
  }
}

/** True the first time `key` is seen today on this device (so a celebration shows once a day). */
export function firstToday(key: string): boolean {
  const k = `rnm-cele:${key}:${new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)}`
  try {
    if (localStorage.getItem(k)) return false
    localStorage.setItem(k, '1')
  } catch {
    /* private mode: still celebrate */
  }
  return true
}
