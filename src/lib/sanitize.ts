// Cleans WordPress article HTML before it is shown in the app.
import DOMPurify from 'dompurify'

const VIDEO_HOSTS = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//

let hooked = false
function addHooks() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'iframe') {
      const src = (node as Element).getAttribute('src') ?? ''
      if (!VIDEO_HOSTS.test(src)) node.parentNode?.removeChild(node)
    }
  })
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }
    if (el.tagName === 'IMG') {
      el.setAttribute('loading', 'lazy')
      el.setAttribute('decoding', 'async')
      el.removeAttribute('fetchpriority')
    }
    if (el.tagName === 'IFRAME') {
      el.setAttribute('loading', 'lazy')
      el.setAttribute('allow', 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen')
      el.removeAttribute('width')
      el.removeAttribute('height')
    }
  })
}

export function sanitizeArticle(html: string): string {
  addHooks()
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allowfullscreen', 'target'],
    // Inline widths from the site's editor break the mobile layout.
    FORBID_ATTR: ['style', 'id'],
    FORBID_TAGS: ['form', 'input', 'button', 'select', 'textarea', 'style', 'script', 'noscript'],
  })
  // Drop paragraphs left empty by editor spacing.
  return clean.replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/g, '')
}
