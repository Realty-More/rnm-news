import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { PostCard } from '../components/PostCard.tsx'
import { EmptyState } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { timeAgo } from '../lib/format.ts'
import { clearHistory, onHistoryChange, readHistory, type HistoryItem } from '../lib/history.ts'
import { listSaved, onSavedChange, removeSaved, type SavedPost } from '../lib/saved.ts'
import { usePageTitle } from './usePageTitle.ts'

export function Saved() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'history' ? 'history' : 'saved'
  usePageTitle(tab === 'history' ? 'History' : 'Saved')

  return (
    <div className="page">
      <div className="page-head">
        <h1>Library</h1>
        <p className="page-sub">Stored on this device only</p>
      </div>
      <div className="segmented wide" role="tablist" aria-label="Library">
        <button role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? 'on' : ''} onClick={() => setParams({}, { replace: true })}>
          <Icon name="bookmark" size={16} /> Saved
        </button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setParams({ tab: 'history' }, { replace: true })}>
          <Icon name="history" size={16} /> History
        </button>
      </div>
      {tab === 'saved' ? <SavedList /> : <HistoryList />}
    </div>
  )
}

function SavedList() {
  const [items, setItems] = useState<SavedPost[] | null>(null)
  useEffect(() => {
    const load = () => void listSaved().then(setItems, () => setItems([]))
    load()
    return onSavedChange(load)
  }, [])

  if (items === null) return null
  if (items.length === 0) {
    return (
      <EmptyState title="Nothing saved yet">
        Tap <Icon name="bookmark" size={14} /> Save on any story to keep it here, readable offline. <Link to="/news">Browse news</Link>
      </EmptyState>
    )
  }
  return (
    <div className="row-list feed">
      {items.map((p) => (
        <div className="saved-item" key={p.id}>
          <PostCard post={p} />
          <button
            className="icon-btn"
            aria-label={`Remove ${p.title}`}
            onClick={async () => {
              await removeSaved(p.id)
              toast('Removed from Saved')
            }}
          >
            <Icon name="trash" size={18} />
          </button>
        </div>
      ))}
    </div>
  )
}

function HistoryList() {
  const [items, setItems] = useState<HistoryItem[]>(readHistory)
  useEffect(() => onHistoryChange(() => setItems(readHistory())), [])

  if (items.length === 0) return <EmptyState title="No reading history yet">Stories you open will appear here.</EmptyState>
  return (
    <>
      <div className="feed-tools">
        <button className="link-btn" onClick={() => (clearHistory(), toast('Reading history cleared'))}>
          <Icon name="trash" size={15} /> Clear history
        </button>
      </div>
      <div className="row-list feed">
        {items.map((h) => (
          <div key={h.post.id} className="history-item">
            <PostCard post={h.post} />
            <p className="history-meta">
              Read {timeAgo(h.readAt)} · {h.progress >= 0.85 ? 'Finished' : `${Math.round(h.progress * 100)}% read`}
            </p>
          </div>
        ))}
      </div>
    </>
  )
}
