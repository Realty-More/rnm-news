import { describe, expect, it } from 'vitest'
import { seenLabel } from '../pages/EmployeesTools.tsx'

describe('employee last seen', () => {
  const now = Date.parse('2026-10-27T13:00:00Z') // 18:30 IST
  it('reads like a person would say it', () => {
    expect(seenLabel(null, now)).toBe('Never')
    expect(seenLabel('2026-10-27T12:57:00Z', now)).toBe('Online now')
    expect(seenLabel('2026-10-27T12:40:00Z', now)).toBe('20 min ago')
    expect(seenLabel('2026-10-27T05:00:00Z', now)).toMatch(/^Today 10:30/)
    expect(seenLabel('2026-10-26T10:00:00Z', now)).toBe('Yesterday')
    expect(seenLabel('2026-10-22T10:00:00Z', now)).toBe('5 days ago')
  })
})
