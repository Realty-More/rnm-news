// AI writer in the Content Studio: headlines, meta descriptions, captions, Hindi and reel-script polish,
// from a story or any pasted text. The server tells the model to use only facts in the text.
import { useState } from 'react'
import { Icon } from '../components/Icon.tsx'
import { toast } from '../components/Toast.tsx'
import { useAsync } from '../lib/hooks.ts'
import { studioPost } from '../lib/owner.ts'
import { fetchPost, fetchPosts } from '../lib/wp.ts'
import { Panel } from './StudioTools.tsx'

const TASKS: { key: string; label: string }[] = [
  { key: 'headlines', label: 'Headlines' },
  { key: 'meta', label: 'Meta description' },
  { key: 'instagram', label: 'Instagram caption' },
  { key: 'linkedin', label: 'LinkedIn post' },
  { key: 'whatsapp', label: 'WhatsApp post' },
  { key: 'summary', label: '3-point summary' },
  { key: 'hindi', label: 'Hindi' },
  { key: 'polish', label: 'Polish reel script' },
]

const plain = (html: string) => {
  const d = document.createElement('div')
  d.innerHTML = html
  return (d.textContent ?? '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function AiWriterTab() {
  const latest = useAsync('studio:ai-latest', (s) => fetchPosts({ perPage: 10 }, s))
  const [text, setText] = useState('')
  const [task, setTask] = useState('headlines')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (id: string) => {
    if (!id) return
    try {
      const p = await fetchPost(id)
      if (p) setText(`${p.title}\n\n${plain(p.content ?? p.excerpt)}`.slice(0, 8000))
    } catch {
      toast('Could not load the story')
    }
  }
  const run = async () => {
    setBusy(true)
    setOut('')
    try {
      const r = await studioPost<{ text: string }>('ai/write', { task, text })
      setOut(r.text)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(out)
      toast('Copied')
    } catch {
      toast('Copy is blocked here; select the text instead')
    }
  }

  return (
    <>
      <Panel title="AI writer" note="Pick a story or paste text (a story, notes or a reel script), choose what you need, and edit the draft before publishing. The AI is told to use only facts from your text; always check numbers and names.">
        <select className="wide-select ai-pick" defaultValue="" onChange={(e) => void load(e.target.value)} aria-label="Load a recent story">
          <option value="">Load one of the latest stories…</option>
          {(latest.data?.posts ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <textarea className="ai-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Or paste text here…" rows={8} aria-label="Text" />
        <div className="chips ai-tasks" role="radiogroup" aria-label="What to write">
          {TASKS.map((k) => (
            <button key={k.key} role="radio" aria-checked={task === k.key} className={`chip ${task === k.key ? 'active' : ''}`} onClick={() => setTask(k.key)}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="action-row">
          <button className="btn" disabled={busy || text.trim().length < 40} onClick={run}>
            <Icon name="sparkle" size={16} /> {busy ? 'Writing…' : 'Write'}
          </button>
        </div>
      </Panel>
      {out && (
        <Panel title="Draft" note="AI-written. Check every fact against the story before you use it.">
          <textarea className="ai-text ai-out" value={out} onChange={(e) => setOut(e.target.value)} rows={Math.max(6, out.split('\n').length + 1)} aria-label="Draft" />
          <div className="action-row">
            <button className="btn" onClick={copy}>
              Copy
            </button>
            <button className="btn ghost" onClick={run} disabled={busy}>
              <Icon name="refresh" size={15} /> Try again
            </button>
          </div>
        </Panel>
      )}
    </>
  )
}
