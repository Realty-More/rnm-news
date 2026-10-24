import { WHATSAPP_CHANNEL } from '../lib/config.ts'
import { useT } from '../lib/i18n.ts'
import { Icon } from './Icon.tsx'

/** Invites readers to follow the RealtyNMore WhatsApp Channel (shown only when the channel link is set). */
export function WhatsAppCard() {
  const t = useT()
  if (!WHATSAPP_CHANNEL) return null
  return (
    <a className="wa-card" href={WHATSAPP_CHANNEL} target="_blank" rel="noopener noreferrer">
      <span className="wa-icon">
        <Icon name="whatsapp" size={24} />
      </span>
      <span className="wa-text">
        <strong>{t('wa.title')}</strong>
        <span>{t('wa.text')}</span>
      </span>
      <span className="btn small wa-btn">{t('wa.follow')}</span>
    </a>
  )
}
