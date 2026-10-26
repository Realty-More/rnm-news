import { useEffect } from 'react'

export function usePageTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · Realtynmore` : 'Realtynmore'
  }, [title])
}
