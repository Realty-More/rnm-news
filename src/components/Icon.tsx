const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  news: 'M4 5h13v14H5a1 1 0 0 1-1-1zM17 8h3v10a1 1 0 0 1-1 1h-2M7.5 8.5h6M7.5 12h6M7.5 15.5h4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20',
  play: 'M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5zM10 9v6l5-3z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7',
  bookmark: 'M6 3.5h12V21l-6-4.5L6 21z',
  share: 'M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.6M14.8 10.3A10 10 0 0 1 19 12.9M2 9.3a15 15 0 0 1 4.6-2.8M11 5a15 15 0 0 1 11 4.3M12 20h.01',
  close: 'M6 6l12 12M18 6 6 18',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  trash: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  settings:'M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M6 6h12v12H6z',
  text: 'M4 7V5h11v2M9.5 5v14M7.5 19h4M14 12v-1.5h6V12M17 10.5V19M15.5 19h3',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l3 2',
  flame: 'M12 21c-3.9 0-7-2.9-7-6.7 0-2.7 1.7-4.6 3.2-6.1.4 1.7 1.3 2.8 2.3 3.3C10 8 11.2 5.2 13.7 3c.3 3.1 5.3 5.4 5.3 11.3 0 3.8-3.1 6.7-7 6.7z',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22, filled = false, className }: { name: IconName; size?: number; filled?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
