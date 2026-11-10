// 예상선복확인: 미선적 현황(PDC×선사 잔량·예상 출하) vs 부킹장 확보 선복 — 순수 계산 (브라우저 공용)
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
export interface CapMap {
  pdc: Record<string, string[]>       // 미선적 PDC → 부킹장 최종도착지들
  carrier: Record<string, string[]>   // 미선적 선사 → 부킹장 선사들
}
export const EMPTY_CAPMAP: CapMap = { pdc: {}, carrier: {} }

const nk = (s: string | null | undefined) => (s || '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '')

// 선사 이름 표기 차이(미선적: MSK / 부킹장: MAERSK) 기본 별칭 — 유저 매핑이 있으면 그게 우선
const CARRIER_ALIAS: string[][] = [
  ['MSK', 'MAERSK', 'MAERSKLINE'], ['YM', 'YANGMING'], ['CMA', 'CMACGM'], ['SM', 'SMLINE'],
  ['EVG', 'EVERGREEN'], ['HDM', 'HYUNDAI', 'HMM'], ['COS', 'COSCO'], ['MSC'], ['ONE'], ['ZIM'], ['HPL', 'HAPAGLLOYD', 'HAPAG'],
]
const aliasGroup = (k: string) => CARRIER_ALIAS.find(g => g.includes(k))

/** 미선적 선사(siteCar)가 부킹장 선사(bookCar)와 같은 선사인가 */
export function carrierMatch(siteCar: string, bookCar: string, map: CapMap): boolean {
  const user = map.carrier[siteCar]
  if (user && user.length > 0) return user.some(c => nk(c) === nk(bookCar))
  const a = nk(siteCar), b = nk(bookCar)
  if (!a || !b) return false
  if (a === b) return true
  const g = aliasGroup(a)
  return !!g && g.includes(b)
}

/** 미선적 PDC가 부킹장 최종도착지와 대응되는가 (유저 매핑 우선, 없으면 이름이 같을 때만 자동) */
export function pdcMatch(pdc: string, dest: string, map: CapMap): boolean {
  const user = map.pdc[pdc]
  if (user && user.length > 0) return user.some(d => nk(d) === nk(dest))
  return !!nk(pdc) && nk(pdc) === nk(dest)
}

export function unitQty(b: Booking): number {
  if (b.booking_entries && b.booking_entries.length > 0) return b.booking_entries.reduce((s, e) => s + (e.ctr_qty || 0), 0)
  return (b.qty_20_normal || 0) + (b.qty_20_dg || 0) + (b.qty_20_reefer || 0) + (b.qty_40_normal || 0) + (b.qty_40_dg || 0) + (b.qty_40_reefer || 0)
}

const ms = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) }
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10)
export const calDays = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86400000)

/** (from, to] 구간의 비휴일 일수 */
export function workDays(from: string, to: string, holidays: Set<string>): number {
  let n = 0
  for (let t = ms(from) + 86400000; t <= ms(to); t += 86400000) if (!holidays.has(ymd(t))) n++
  return n
}

export interface CapGroup {
  cutoff: string
  rows: Booking[]
  days: number          // 계산구간(달력일)
  workDays: number      // 그중 비휴일
  carryIn: number       // 이월(앞 구간에서 못 태운 대수)
  add: number           // 이 구간에 새로 발생하는 예상 출하
  secured: number       // 확보수량 합
  balance: number       // 이월+추가-확보  (+ 부족 / - 여유)
}
export interface CapResult {
  initial: number
  pdcs: string[]            // 대응된 PDC
  siteCarriers: string[]    // 대응된 미선적 선사
  perDay: number            // 비휴일 1일 예상 출하(합)
  groups: CapGroup[]
  totalSecured: number
  totalAdd: number
  finalShort: number        // 마지막 이후 남는 부족(>0) — 0이면 부족 없음
  finalSpare: number        // 총 여유(확보했지만 못 채우는 대수의 합)
  skippedNoCutoff: number   // 서류마감일이 없어 계산에서 빠진 부킹 수
}

/** 해당 (선사, 최종도착지)에서 아직 마감 전인 부킹 목록 */
export function openBookings(bookings: Booking[], carrier: string, dest: string, today: string) {
  const all = bookings.filter(b => !b.is_closed && nk(b.carrier) === nk(carrier) && nk(b.final_destination) === nk(dest))
  const withCut = all.filter(b => b.doc_cutoff_date && b.doc_cutoff_date >= today)
  return {
    rows: withCut.sort((a, b) => (a.doc_cutoff_date! < b.doc_cutoff_date! ? -1 : a.doc_cutoff_date! > b.doc_cutoff_date! ? 1 : (a.updated_etd || a.proforma_etd || '').localeCompare(b.updated_etd || b.proforma_etd || ''))),
    noCutoff: all.filter(b => !b.doc_cutoff_date).length,
  }
}

/**
 * 규칙: ① 같은 선사만 ② 매핑된 PDC=최종도착지일 때만 ③ 서류마감 이후 출하분은 그 모선에 못 실음
 * → 서류마감일 순으로 구간을 나눠, 구간 안에서 발생한 출하만 그 구간 모선에 배정한다.
 *   잔량 = 이월 + 추가 − 확보  (양수=부족, 음수=여유). 여유는 다음 모선으로 넘어가지 않고 부족만 이월된다.
 */
export function calcCapacity(opts: {
  bookings: Booking[]; carrier: string; dest: string; data: CapData; map: CapMap
  qty?: Record<string, number>; excluded?: Set<string>
}): CapResult {
  const { bookings, carrier, dest, data, map } = opts
  const hol = new Set(data.holidays)
  const siteCarriers = data.carriers.filter(c => carrierMatch(c, carrier, map))
  const pdcs = data.pdcs.filter(p => pdcMatch(p, dest, map))
  let initial = 0, perDay = 0
  for (const p of pdcs) for (const c of siteCarriers) { initial += data.current[p]?.[c] || 0; perDay += data.rate[p]?.[c] || 0 }

  const { rows, noCutoff } = openBookings(bookings, carrier, dest, data.today)
  const use = rows.filter(b => !opts.excluded?.has(b.id))
  const byCut = new Map<string, Booking[]>()
  for (const b of use) { const k = b.doc_cutoff_date!; if (!byCut.has(k)) byCut.set(k, []); byCut.get(k)!.push(b) }

  const groups: CapGroup[] = []
  let carry = initial, prev = data.today, totalSecured = 0, totalAdd = 0, spare = 0
  for (const cutoff of [...byCut.keys()].sort()) {
    const gr = byCut.get(cutoff)!
    const days = Math.max(0, calDays(prev, cutoff))
    const wd = cutoff > prev ? workDays(prev, cutoff, hol) : 0
    const add = Math.round(perDay * wd)
    const secured = gr.reduce((s, b) => s + (opts.qty?.[b.id] ?? unitQty(b)), 0)
    const balance = carry + add - secured
    groups.push({ cutoff, rows: gr, days, workDays: wd, carryIn: carry, add, secured, balance })
    totalSecured += secured; totalAdd += add
    if (balance < 0) spare += -balance
    carry = Math.max(balance, 0)
    if (cutoff > prev) prev = cutoff
  }
  return { initial, pdcs, siteCarriers, perDay, groups, totalSecured, totalAdd, finalShort: carry, finalSpare: spare, skippedNoCutoff: noCutoff }
}
