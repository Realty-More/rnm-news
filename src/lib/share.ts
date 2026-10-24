import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

export async function shareLink(title: string, url: string): Promise<ShareResult> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text: title, url, dialogTitle: 'Share' })
      return 'shared'
    } catch {
      return 'cancelled'
    }
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text: title, url })
      return 'shared'
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
