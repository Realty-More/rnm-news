import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'

const TRIGGER = 72

/** Touch pull-down at the top of the page to reload. Desktop users get the Refresh buttons instead. */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown> | void; children: ReactNode }) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const start = useRef<number | null>(null)
  const pullRef = useRef(0)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && !busy ? e.touches[0].clientY : null
    }
    const move = (e: TouchEvent) => {
      if (start.current === null) return
      const dy = e.touches[0].clientY - start.current
      if (dy <= 0 || window.scrollY > 0) {
        pullRef.current = 0
        setPull(0)
        return
      }
      pullRef.current = Math.min(120, dy * 0.5)
      setPull(pullRef.current)
    }
    const up = async () => {
      const reached = pullRef.current >= TRIGGER
      start.current = null
      pullRef.current = 0
      setPull(0)
      if (!reached) return
      setBusy(true)
      try {
        await onRefreshRef.current()
      } finally {
        setBusy(false)
      }
    }
    window.addEventListener('touchstart', down, { passive: true })
    window.addEventListener('touchmove', move, { passive: true })
    window.addEventListener('touchend', up)
    return () => {
      window.removeEventListener('touchstart', down)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', up)
    }
  }, [busy])

  const shown = busy ? TRIGGER * 0.75 : pull
  return (
    <>
      <div className="ptr" style={{ height: shown, opacity: busy ? 1 : Math.min(1, pull / TRIGGER) }} aria-hidden={!busy}>
        <span className={`ptr-icon ${busy ? 'spin' : ''}`} style={{ transform: busy ? undefined : `rotate(${pull * 3}deg)` }}>
          <Icon name="refresh" size={20} />
        </span>
        {busy && <span className="sr-only">Refreshing</span>}
      </div>
      {children}
    </>
  )
}
