import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPosts, type Post, type PostQuery } from './wp.ts'

// Session memory cache so switching tabs is instant; the service worker handles offline copies.
const memo = new Map<string, { at: number; value: unknown }>()
const FRESH_MS = 3 * 60 * 1000

/** Drops cached results whose key starts with `prefix`, so the next render fetches again. */
export function invalidate(prefix: string) {
  for (const k of memo.keys()) if (k.startsWith(prefix)) memo.delete(k)
}

export interface AsyncState<T> {
  data: T | undefined
  error: Error | null
  loading: boolean
  reload: () => void
}

export function useAsync<T>(key: string | null, fn: (signal: AbortSignal) => Promise<T>): AsyncState<T> {
  const cached = key ? (memo.get(key)?.value as T | undefined) : undefined
  const [data, setData] = useState<T | undefined>(cached)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(key !== null && cached === undefined)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (key === null) return
    const hit = memo.get(key)
    setData(hit?.value as T | undefined)
    if (hit && nonce === 0 && Date.now() - hit.at < FRESH_MS) {
      setLoading(false)
      setError(null)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    fnRef.current(ctrl.signal).then(
      (value) => {
        memo.set(key, { at: Date.now(), value })
        setData(value)
        setLoading(false)
      },
      (err: Error) => {
        if (err.name === 'AbortError') return
        setError(err)
        setLoading(false)
      },
    )
    return () => ctrl.abort()
  }, [key, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, reload }
}

export interface InfiniteState {
  posts: Post[]
  error: Error | null
  loading: boolean
  done: boolean
  loadMore: () => void
  reload: () => void
  refresh: () => void
}

/** Paged post list (WordPress pages of 12) with load-more. */
export function useInfinitePosts(query: Omit<PostQuery, 'page'> | null): InfiniteState {
  const key = query ? JSON.stringify(query) : null
  const [posts, setPosts] = useState<Post[]>([])
  // Page is tied to the query key, so a new query always starts at page 1.
  const [paging, setPaging] = useState({ key, page: 1 })
  const page = paging.key === key ? paging.page : 1
  const [done, setDone] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const shownKey = useRef<string | null>(null)

  useEffect(() => {
    if (!key) return
    if (shownKey.current !== key) {
      shownKey.current = key
      setPosts([])
      setDone(false)
    }
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    fetchPosts({ ...JSON.parse(key), page }, ctrl.signal).then(
      ({ posts: batch, totalPages }) => {
        setPosts((prev) => {
          const ids = new Set(prev.map((p) => p.id))
          return page === 1 ? batch : [...prev, ...batch.filter((p) => !ids.has(p.id))]
        })
        setDone(batch.length === 0 || page >= totalPages)
        setLoading(false)
      },
      (err: Error) => {
        if (err.name === 'AbortError') return
        setError(err)
        setLoading(false)
      },
    )
    return () => ctrl.abort()
  }, [key, page, nonce])

  const loadMore = useCallback(() => {
    if (!loading && !done && !error) setPaging({ key, page: page + 1 })
  }, [loading, done, error, key, page])
  // Retry re-runs the failed page; a full refresh goes back to page 1.
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const refresh = useCallback(() => {
    setPaging({ key, page: 1 })
    setNonce((n) => n + 1)
  }, [key])
  return { posts, error, loading, done, loadMore, reload, refresh }
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
