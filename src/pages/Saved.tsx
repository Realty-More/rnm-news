import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { PostCard } from '../components/PostCard.tsx'
import { EmptyState } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { listSaved, onSavedChange, removeSaved, type SavedPost } from '../lib/saved.ts'
import { usePageTitle } from './usePageTitle.ts'

export function Saved() {
  usePageTitle('Saved')
  const [items, setItems] = useState<SavedPost[] | null>(null)

  useEffect(() => {
    const load = () => void listSaved().then(setItems, () => setItems([]))
    load()
    return onSavedChange(load)
  }, [])

  return (
    <div className="page">
      <div className="page-head">
        <h1>Saved</h1>
        <p className="page-sub">Stored on this device and readable offline</p>
      </div>
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Nothing saved yet">
          Tap <Icon name="bookmark" size={14} /> Save on any story to keep it here. <Link to="/news">Browse news</Link>
        </EmptyState>
      ) : (
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
      )}
    </div>
  )
}
