// "Listen" uses the phone's built-in text-to-speech (Web Speech API): free, works without an account.
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon.tsx'

type State = 'idle' | 'playing' | 'paused'

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang === 'en-IN') ??
    voices.find((v) => v.lang.startsWith('en-GB')) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null
  )
}

/** Splits text into sentence groups; long single utterances get cut off on some phones. */
export function chunkText(text: string, max = 220): string[] {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) ?? []
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function ListenButton({ title, getText }: { title: string; getText: () => string }) {
  const [state, setState] = useState<State>('idle')
  const queue = useRef<string[]>([])
  const run = useRef(0)

  useEffect(() => () => {
    run.current++
    if (supported()) window.speechSynthesis.cancel()
  }, [])

  if (!supported()) return null

  const speakNext = (token: number) => {
    if (token !== run.current) return
    const next = queue.current.shift()
    if (!next) {
      setState('idle')
      return
    }
    const u = new SpeechSynthesisUtterance(next)
    const voice = pickVoice()
    if (voice) u.voice = voice
    u.lang = voice?.lang ?? 'en-IN'
    u.rate = 1
    u.onend = () => speakNext(token)
    u.onerror = () => setState('idle')
    window.speechSynthesis.speak(u)
  }

  const start = () => {
    const synth = window.speechSynthesis
    synth.cancel()
    queue.current = chunkText(`${title}. ${getText()}`)
    const token = ++run.current
    setState('playing')
    speakNext(token)
  }

  const toggle = () => {
    const synth = window.speechSynthesis
    if (state === 'idle') return start()
    if (state === 'playing') {
      synth.pause()
      setState('paused')
    } else {
      synth.resume()
      setState('playing')
    }
  }

  const stop = () => {
    run.current++
    window.speechSynthesis.cancel()
    setState('idle')
  }

  return (
    <>
      <button className={`btn ghost ${state !== 'idle' ? 'on' : ''}`} onClick={toggle} aria-label={state === 'playing' ? 'Pause listening' : 'Listen to this article'}>
        <Icon name={state === 'playing' ? 'pause' : 'headphones'} size={18} /> {state === 'idle' ? 'Listen' : state === 'playing' ? 'Pause' : 'Resume'}
      </button>
      {state !== 'idle' && (
        <button className="btn ghost" onClick={stop} aria-label="Stop listening">
          <Icon name="stop" size={16} />
        </button>
      )}
    </>
  )
}
