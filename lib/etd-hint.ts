// 부킹장 표의 "+3" 표시 계산 (브라우저·서버 공용, 순수 함수)
import type { EtdHintCand } from '@/app/bookings/etdSyncActions'

export interface EtdHint {
  diff: number        // 터미널 ETD - 현재 UPDATED ETD (일)
  etd: string         // 터미널 ETD 날짜
  source: string      // 터미널
  n: number           // 비교한 후보 수 (기본 터미널 후보가 있으면 그 안에서)
  tip: string         // 마우스 올렸을 때 표시할 후보 목록
}

export function dayDiff(a: string, b: string): number {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number)
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000)
}

/** 후보 중 기본 터미널(★) 우선 → 현재 ETD와 가까운 것 하나를 골라 차이를 계산. 후보가 없거나 차이가 0이면 null. */
export function bestHint(current: string, cands: EtdHintCand[] | undefined, pref: string[]): EtdHint | null {
  if (!cands || cands.length === 0) return null
  const inPref = cands.filter(c => pref.includes(c.s))
  const pool = inPref.length > 0 ? inPref : cands
  const best = [...pool].sort((x, y) => Math.abs(dayDiff(current, x.e)) - Math.abs(dayDiff(current, y.e)))[0]
  const diff = dayDiff(current, best.e)
  if (diff === 0) return null
  const tip = [
    `터미널 스케줄: ${best.s} ${best.e}${best.t ? ' ' + best.t : ''}${best.v ? ' (' + best.v + ')' : ''}`,
    ...(cands.length > 1 ? ['— 후보 ' + cands.length + '건 —', ...cands.map(c => `${pref.includes(c.s) ? '★' : ' '} ${c.s} ${c.e}${c.t ? ' ' + c.t : ''}${c.v ? ' (' + c.v + ')' : ''}`)] : []),
  ].join('\n')
  return { diff, etd: best.e, source: best.s, n: pool.length, tip }
}
