import { useEffect, useState } from 'react'

const EVENT = 'rnm:toast'

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }))
}

export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onToast = (e: Event) => {
      clearTimeout(timer)
      setMsg({ text: (e as CustomEvent<string>).detail, key: Date.now() })
      timer = setTimeout(() => setMsg(null), 2600)
    }
    window.addEventListener(EVENT, onToast)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(EVENT, onToast)
    }
  }, [])
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {msg && (
        <div className="toast" key={msg.key}>
          {msg.text}
        </div>
      )}
    </div>
  )
}
