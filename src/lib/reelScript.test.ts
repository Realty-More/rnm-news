import { describe, expect, it } from 'vitest'
import { dailyScript, lede, weeklyScript, type Daily, type Weekly } from './reelScript.ts'

// Numbers from the team's own 23 Oct 2026 market-close report.
const OCT23: [string, string, number, number][] = [
  ['OBEROIRLTY', 'Oberoi Realty', 1625.2, 1612.7],
  ['DLF', 'DLF', 663.25, 657.0],
  ['SOBHA', 'Sobha', 1196.1, 1175.0],
  ['BRIGADE', 'Brigade Enterprises', 557.1, 547.0],
  ['ANANTRAJ', 'Anant Raj', 472.0, 463.0],
  ['PHOENIXLTD', 'Phoenix Mills', 1909.9, 1872.3],
  ['PRESTIGE', 'Prestige Estates', 1430.0, 1392.5],
  ['ABREL', 'Aditya Birla Real Estate', 1085.1, 1038.8],
  ['LODHA', 'Lodha Developers', 1006.4, 963.0],
  ['GODREJPROP', 'Godrej Properties', 1565.0, 1496.5],
]

const daily: Daily = {
  day: '2026-10-23',
  indices: [{ name: 'Nifty Realty', open: 802.15, high: 802.2, low: 770.95, close: 784.35, pts: -19.1, pct: -2.38 }],
  history: [
    { day: '2026-10-23', close: 784.35, pct: -2.38 },
    { day: '2026-10-22', close: 803.45, pct: -0.3 },
    { day: '2026-10-21', close: 805.85, pct: -1.25 },
    { day: '2026-10-19', close: 816.05, pct: -1.2 },
    { day: '2026-10-16', close: 825.95, pct: -0.4 },
    { day: '2026-10-15', close: 829, pct: 0.5 },
  ],
  stocks: OCT23.map(([symbol, name, prev, close]) => ({ symbol, name, index: true, prev, close })),
  news: [
    {
      id: 1,
      title: 'Godrej Properties Q2 bookings',
      link: 'https://realtynmore.com/x/',
      date: '2026-10-23T10:00:00Z',
      excerpt: 'Mumbai, October 23, 2026: Godrej Properties reported Q2 FY27 booking value of Rs. 8,008 crore from 3,658 units. More follows here.',
      views: 40,
    },
  ],
  source: 'NSE official files',
}

describe('daily reel script', () => {
  it('follows the house order: decliners first, no-gainers line, news, streak, CTA', () => {
    const s = dailyScript(daily)
    expect(s.scenes.map((x) => x.scene)).toEqual(['Opening', 'Decliners', 'Smallest declines', 'News · Godrej Properties Q2 bookings', 'Takeaway', 'CTA'])
    expect(s.scenes[0].vo).toBe('Realty stocks fell sharply on Friday. The Nifty Realty index ended at 784.35, down 2.38% from the previous close.')
    expect(s.scenes[1].vo).toBe(
      'Godrej Properties was the biggest decliner, down 4.38%. Lodha Developers fell 4.31%, Aditya Birla Real Estate lost 4.27%, and Prestige Estates slipped 2.62%. Overall, all ten realty stocks ended lower.',
    )
    expect(s.scenes[2].vo).toBe('There were no gainers today. Oberoi Realty held up best, down 0.77%, followed by DLF at 0.94% and Sobha at 1.76%.')
    expect(s.scenes[3].vo).toBe('Godrej Properties reported Q2 FY27 booking value of Rs. 8,008 crore from 3,658 units.')
    expect(s.scenes[4].vo).toBe('The takeaway: realty stocks fell for a fifth straight session, with every stock in the index lower, and three of them down more than 4%.')
    expect(s.scenes[1].screen).toBe('GODREJ PROPERTIES −4.38%  |  LODHA −4.31%  |  ADITYA BIRLA −4.27%  |  PRESTIGE ESTATES −2.62%')
  })

  it('takes the first sentence of a story without its dateline', () => {
    expect(lede('New Delhi, October 26, 2026: India’s office market shifted in Q3. More here.')).toBe('India’s office market shifted in Q3.')
  })
})

describe('weekly reel script', () => {
  const idx = (day: string, name: string, close: number, pct: number) => ({ day, name, open: null, high: null, low: null, close, pts: null, pct })
  const w: Weekly = {
    week: '2026-10-19',
    sessions: ['2026-10-19', '2026-10-21', '2026-10-22', '2026-10-23'],
    base: '2026-10-16',
    last: '2026-10-23',
    indices: [
      idx('2026-10-16', 'Nifty 50', 23146.15, 0),
      idx('2026-10-23', 'Nifty 50', 22600, -0.39),
      idx('2026-10-16', 'Nifty Realty', 825.95, 0),
      idx('2026-10-19', 'Nifty Realty', 816.05, -1.2),
      idx('2026-10-21', 'Nifty Realty', 805.85, -1.25),
      idx('2026-10-22', 'Nifty Realty', 803.45, -0.3),
      idx('2026-10-23', 'Nifty Realty', 784.35, -2.38),
      idx('2026-10-16', 'Nifty Smallcap 100', 19129.8, 0),
      idx('2026-10-23', 'Nifty Smallcap 100', 17739.45, -1),
    ],
    moves: [
      { symbol: 'SOBHA', name: 'Sobha', index: true, from: 1188.4, to: 1173.4 },
      { symbol: 'ANANTRAJ', name: 'Anant Raj', index: true, from: 511.75, to: 460.4 },
      { symbol: 'LODHA', name: 'Lodha Developers', index: true, from: 1058.7, to: 963.0 },
      { symbol: 'KOLTEPATIL', name: 'Kolte-Patil', index: false, from: 429.75, to: 458.3 },
      { symbol: 'OMAXE', name: 'Omaxe', index: false, from: 113.94, to: 98.73 },
    ],
    news: [],
    source: 'NSE',
  }

  it('matches the reference wording for a holiday-shortened week', () => {
    const s = weeklyScript(w)
    expect(s.scenes[1].vo).toBe('In a holiday-shortened week, the Nifty 50 lost 2.36 per cent to 22,600.00. Small caps fell 7.27 per cent.')
    expect(s.scenes[2].vo).toBe('The Nifty Realty index dropped 5.04 per cent to 784.35, falling in all four sessions. Friday was the worst day, down 2.38 per cent.')
    expect(s.scenes[3].vo).toBe(
      'All three index stocks fell. Anant Raj was the biggest laggard, down 10.03 per cent, followed by Lodha Developers at 9.04 per cent. Sobha held up best, down just 1.26 per cent.',
    )
    expect(s.scenes[4].vo).toBe('Among other developers, Kolte-Patil bucked the trend with a 6.64 per cent gain, while Omaxe fell 13.35 per cent.')
  })
})
