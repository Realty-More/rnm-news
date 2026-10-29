// Public RealtyNMore links (taken from realtynmore.com) and the WhatsApp Channel.
import type { IconName } from '../components/Icon.tsx'

/** WhatsApp Channel invite link (repo variable WHATSAPP_CHANNEL at build time). Empty = join card hidden. */
export const WHATSAPP_CHANNEL: string = import.meta.env.VITE_WHATSAPP_CHANNEL ?? ''

export const SOCIALS: { name: string; url: string; icon: IconName }[] = [
  { name: 'YouTube', url: 'https://www.youtube.com/channel/UCwcl1hjjTWT2h5a6PTghlGw', icon: 'youtube' },
  { name: 'Instagram', url: 'https://www.instagram.com/realtynmore/', icon: 'instagram' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/company/realty-n-more/', icon: 'linkedin' },
  { name: 'X', url: 'https://x.com/realtynmoretv', icon: 'xlogo' },
  { name: 'Facebook', url: 'https://www.facebook.com/realtynmoreIN/', icon: 'facebook' },
]

/** Opens WhatsApp with a ready message; the reader picks a chat, group, broadcast list or channel. */
export const whatsappShareUrl = (message: string) => `https://wa.me/?text=${encodeURIComponent(message)}`

/**
 * Google OAuth web client ID for "Continue with Google" (a public ID, not a secret; it must match
 * GOOGLE_CLIENT_ID on the app server). Empty = the Google button is hidden.
 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
