// 예상선복확인: 미선적 현황(PDC×선사 잔량·예상 출하) vs 부킹장에서 유저가 체크한 모선의 확보 선복 — 순수 계산 (브라우저 공용)
import type { Booking } from '@/types'

export interface CapData {
  ok?: boolean
  today: string
  holidays: string[]
  pdcs: string[]
  carriers: string[]
  current: Record<string, Record<string, number>>   // pdc → 선사 → 현재 미선적 대수
  rate: Record<string, Record<string, number>>      // pdc → 선사 → 비휴일 1일 예상 출하 대수
  built_at?: string
}

export const cellKey = (pdc: string, carrier: string) => `${pdc}|${carrier}`

/** 저장해두고 다시 불러오는 시뮬레이션 한 건 */
export interface CapSim {
  id: string
  name: string
  savedAt: string
  bookingIds: string[]
  cells: string[]
  mode: FcMode
  qty: Record<string, number>
  addOverride: Record<string, number>
  cutoffOffset: number
}
export type FcMode = 'pdc' | 'cells'   // 예상 출하 기준: 선택한 PDC 전체(모든 선사) / 선택한 칸만

export function unitQty(b: Booking): number {
  if (b.booking_entries && b.booking_entries.length > 0) return b.booking_entries.reduce((s, e) => s + (e.ctr_qty || 0), 0)
  return (b.qty_20_normal || 0) + (b.qty_20_dg || 0) + (b.qty_20_reefer || 0) + (b.qty_40_normal || 0) + (b.qty_40_dg || 0) + (b.qty_40_reefer || 0)
}

const ms = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) }
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10)
export const calDays = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86400000)
/** n일 이동한 날짜 (YYYY-MM-DD) */
export const shiftDay = (d: string, n: number) => ymd(ms(d) + n * 86400000)
/** 계산구간 끝을 마감일에서 며칠 당길지 (0 = 마감일 당일까지) */
export const CUTOFF_OFFSETS = [0, -1, -2, -3] as const
export type CutoffOffset = 0 | -1 | -2 | -3

/** (from, to] 구간의 비휴일 일수 */
export function workDays(from: string, to: string, holidays: Set<string>): number {
  let n = 0
  for (let t = ms(from) + 86400000; t <= ms(to); t += 86400000) if (!holidays.has(ymd(t))) n++
  return n
}

/** 유저가 고른 칸들의 현재 잔량 합 / 하루 예상 출하 합 */
export function sumCells(data: CapData, cells: Set<string>, mode: FcMode) {
  let initial = 0, perDay = 0
  const pdcs = new Set<string>()
  for (const k of cells) {
    const [pdc, car] = k.split('|')
    initial += data.current[pdc]?.[car] || 0
    pdcs.add(pdc)
    if (mode === 'cells') perDay += data.rate[pdc]?.[car] || 0
  }
  if (mode === 'pdc') for (const p of pdcs) for (const v of Object.values(data.rate[p] || {})) perDay += v
  return { initial, perDay, pdcs: [...pdcs].sort() }
}

export interface CapGroup {
  cutoff: string
  rows: Booking[]
  days: number          // 계산구간(달력일)
  workDays: number      // 그중 비휴일
  carryIn: number       // 이월(앞 구간에서 못 태운 대수)
  add: number           // 이 구간에 새로 발생하는 예상 출하 (사용자가 고쳤으면 그 값)
  addAuto: number       // 자동 계산값 (하루 예상 출하 × 구간 영업일)
  secured: number       // 확보수량 합
  balance: number       // 이월+추가-확보  (+ 부족 / - 여유)
}
export interface CapResult {
  initial: number
  perDay: number
  pdcs: string[]
  groups: CapGroup[]
  totalSecured: number
  totalAdd: number
  finalShort: number    // 마지막 모선 이후 남는 부족(>0) — 0이면 부족 없음
  finalSpare: number    // 여유 합계(확보했지만 못 채우는 대수)
  noCutoff: Booking[]   // 서류마감일이 없어 계산에서 빠진 모선
  past: Booking[]       // 이미 마감된/서류마감이 지난 모선(계산 제외)
}

/**
 * 서류마감일 순으로 구간을 나눠, 구간 안에서 발생한 출하만 그 구간의 모선에 배정한다.
 *   잔량 = 이월 + 추가 − 확보  (양수=부족, 음수=여유). 부족만 다음 모선으로 이월된다.
 *   구간 끝은 서류마감일 + cutoffOffset (기본 -1 = 마감 전일) — 그 이후 발생분은 다음 구간 몫.
 */
export function calcSelection(opts: {
  rows: Booking[]; data: CapData; cells: Set<string>; mode: FcMode
  qty?: Record<string, number>
  cutoffOffset?: number           // 0 ~ -3 (기본 -1: 마감 전일까지)
  addOverride?: Record<string, number>   // 서류마감일 → 직접 지정한 '추가' 대수
}): CapResult {
  const { rows, data, cells, mode } = opts
  const off = Math.min(0, Math.max(-3, Math.round(opts.cutoffOffset ?? -1)))
  const hol = new Set(data.holidays)
  const { initial, perDay, pdcs } = sumCells(data, cells, mode)

  const noCutoff = rows.filter(b => !b.doc_cutoff_date)
  const past = rows.filter(b => b.doc_cutoff_date && (b.is_closed || b.doc_cutoff_date < data.today))
  const use = rows.filter(b => b.doc_cutoff_date && !b.is_closed && b.doc_cutoff_date >= data.today)
  const byCut = new Map<string, Booking[]>()
  for (const b of use) { const k = b.doc_cutoff_date!; if (!byCut.has(k)) byCut.set(k, []); byCut.get(k)!.push(b) }

  const groups: CapGroup[] = []
  let carry = initial, prev = data.today, totalSecured = 0, totalAdd = 0, spare = 0
  for (const cutoff of [...byCut.keys()].sort()) {
    const gr = byCut.get(cutoff)!.sort((a, b) => (a.updated_etd || a.proforma_etd || '').localeCompare(b.updated_etd || b.proforma_etd || ''))
    // 구간 끝 = 마감일 + 오프셋 (기본 -1 → 마감 전일까지만 그 모선에 배정)
    const end = shiftDay(cutoff, off)
    const days = Math.max(0, calDays(prev, end))
    const wd = end > prev ? workDays(prev, end, hol) : 0
    const addAuto = Math.round(perDay * wd)
    const ov = opts.addOverride?.[cutoff]
    const add = typeof ov === 'number' && Number.isFinite(ov) ? Math.max(0, Math.round(ov)) : addAuto
    const secured = gr.reduce((s, b) => s + (opts.qty?.[b.id] ?? unitQty(b)), 0)
    const balance = carry + add - secured
    groups.push({ cutoff, rows: gr, days, workDays: wd, carryIn: carry, add, addAuto, secured, balance })
    totalSecured += secured; totalAdd += add
    if (balance < 0) spare += -balance
    carry = Math.max(balance, 0)
    if (end > prev) prev = end
  }
  return { initial, perDay, pdcs, groups, totalSecured, totalAdd, finalShort: carry, finalSpare: spare, noCutoff, past }
}
