import { useEffect } from 'react'

export function usePageTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · R&M News` : 'Realty & More News'
  }, [title])
}
