'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, isValid } from 'date-fns'
import type { Booking, Profile, CustomList, BookingEntry } from '@/types'
import { DEFAULT_DESTINATIONS } from '@/types'
import { bulkSaveBookings } from '@/app/bookings/actions'
import { addCustomListItem } from '@/app/settings/actions'
import { calcTotalQty, calcCiQtyTotal, fmtQtyNum } from './BookingTable'

// ── 분할 계산 ───────────────────────────────────────────────────────

interface Part {
  dest: string
  cis: string[]
  qtyLines: string[]
  vesselLines: string[]
  entries: BookingEntry[]
  prorated: boolean   // 컨테이너 수량을 비율로 나눈 경우
}

interface Candidate {
  booking: Booking
  parts: Part[]
  kind: 'split' | 'dest'   // split: 여러 행으로 분할 / dest: 도착지만 변경
  rowQty: number           // 부킹수량 (컨테이너 기준)
  ciTotal: number          // CI_수량(총합)
  mismatch: boolean        // 둘이 다르면 쪼개기 불가
}

const round3 = (n: number) => Math.round(n * 1000) / 1000
const numOf = (v: string) => {
  const m = (v || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : NaN
}
const multOf = (ctrType: string) => (ctrType || '').startsWith('20') ? 0.5 : 1

const cisOf = (e: BookingEntry): string[] =>
  (e.cis ?? (e.ci ? [e.ci] : [])).map(c => (c || '').trim()).filter(Boolean)

const lines = (v: string | null | undefined): string[] =>
  (v || '').split('\n').map(s => s.trim())

function buildParts(b: Booking): Part[] {
  const entries = b.booking_entries || []
  // 부킹의 C/I 목록 (입력 순서) — CI_도착지/CI_수량/CI_모선명 각 줄과 1:1 대응
  const flat: { ci: string; ei: number }[] = []
  entries.forEach((e, ei) => cisOf(e).forEach(ci => flat.push({ ci, ei })))
  if (flat.length === 0) return []

  const dLines = lines(b.ci_dest)
  const qLines = lines(b.ci_qty)
  const vLines = lines(b.ci_vessel)
  if (dLines.every(v => !v)) return []

  const baseDest = (b.final_destination || '').trim()
  const destAt = (i: number) => (dLines[i] || '').trim() || baseDest

  // 도착지별 그룹 (첫 등장 순서 유지)
  const order: string[] = []
  const byDest = new Map<string, { cis: string[]; qtyLines: string[]; vesselLines: string[]; ciIdx: number[] }>()
  flat.forEach((f, i) => {
    const d = destAt(i)
    if (!byDest.has(d)) { byDest.set(d, { cis: [], qtyLines: [], vesselLines: [], ciIdx: [] }); order.push(d) }
    const g = byDest.get(d)!
    g.cis.push(f.ci)
    g.qtyLines.push(qLines[i] || '')
    g.vesselLines.push(vLines[i] || '')
    g.ciIdx.push(i)
  })

  // C/I별 수량 (CI_수량 각 줄)
  const qtyOfCi = new Map<string, number>()
  flat.forEach((f, i) => {
    const n = numOf(qLines[i] || '')
    if (!isNaN(n)) qtyOfCi.set(f.ci.toUpperCase(), (qtyOfCi.get(f.ci.toUpperCase()) || 0) + n)
  })

  // 엔트리(부킹번호)를 도착지별로 배분
  // 컨테이너 수량은 해당 C/I의 CI_수량 합과 일치하도록 재계산 (부킹수량 = CI_수량(총합))
  return order.map(dest => {
    const g = byDest.get(dest)!
    const mine = new Set(g.cis.map(c => c.toUpperCase()))
    const partEntries: BookingEntry[] = []
    let prorated = false
    entries.forEach(e => {
      const all = cisOf(e)
      if (all.length === 0) {
        // C/I가 없는 부킹번호는 첫 파트(원래 도착지)에 남긴다
        if (dest === order[0]) partEntries.push({ ...e })
        return
      }
      const sub = all.filter(c => mine.has(c.toUpperCase()))
      if (sub.length === 0) return
      const ciSum = sub.reduce((s, c) => s + (qtyOfCi.get(c.toUpperCase()) ?? NaN), 0)
      if (!isNaN(ciSum) && ciSum > 0) {
        // CI_수량 기준으로 컨테이너 수량 산출 (20ft=0.5, 40ft=1)
        partEntries.push({ ...e, ctr_qty: round3(ciSum / multOf(e.ctr_type)), cis: sub })
        if (sub.length !== all.length) prorated = true
      } else if (sub.length === all.length) {
        partEntries.push({ ...e, cis: sub })
      } else {
        prorated = true
        partEntries.push({ ...e, ctr_qty: round3(((e.ctr_qty || 0) * sub.length) / all.length), cis: sub })
      }
    })
    return { dest, cis: g.cis, qtyLines: g.qtyLines, vesselLines: g.vesselLines, entries: partEntries, prorated }
  })
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '-'
  try { const p = parseISO(d); return isValid(p) ? format(p, 'MM/dd') : '-' } catch { return '-' }
}

const containersOf = (entries: BookingEntry[]) =>
  entries.map(e => `${e.ctr_type}×${e.ctr_qty}`).join(' / ') || '-'

const bookingNosOf = (entries: BookingEntry[]) =>
  entries.map(e => e.no).filter(Boolean).join(' / ') || '-'

// ── 부킹수량 수정 (컨테이너 수량 직접 편집 → DB 저장) ────────────────

function QtyEditor({ booking, ciTotal, onSaved }: {
  booking: Booking
  ciTotal: number
  onSaved: () => void
}) {
  const [entries, setEntries] = useState<BookingEntry[]>(
    (booking.booking_entries || []).map(e => ({ ...e })))
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const total = entries.reduce((s, e) => s + (e.ctr_qty || 0) * multOf(e.ctr_type), 0)
  const ok = Math.abs(total - ciTotal) <= 0.0001

  const setQty = (i: number, v: string) =>
    setEntries(p => p.map((e, ei) => ei === i ? { ...e, ctr_qty: Number(v) || 0 } : e))

  const save = () => {
    setErr(null)
    startTransition(async () => {
      const { errors } = await bulkSaveBookings([{ id: booking.id, data: { booking_entries: entries } }], [])
      if (Object.keys(errors).length > 0) { setErr(Object.values(errors)[0]); return }
      onSaved()
    })
  }

  return (
    <div className="px-3 py-2.5 bg-red-50/60 border-b border-red-100 space-y-2">
      <p className="text-[11px] text-red-700 font-medium">
        부킹수량과 CI_수량(총합)이 달라 쪼갤 수 없습니다. 아래에서 컨테이너 수량을 수정하고 저장하세요. (20ft = 0.5, 40ft = 1)
      </p>
      <div className="flex flex-wrap items-end gap-3">
        {entries.map((e, i) => (
          <div key={i} className="flex flex-col">
            <label className="text-[10px] text-slate-500 mb-0.5">
              {e.no || '(부킹번호 없음)'} · {e.ctr_type}
              {cisOf(e).length > 0 && <span className="text-emerald-600"> · {cisOf(e).join(', ')}</span>}
            </label>
            <input type="number" step="0.5" min={0} value={e.ctr_qty ?? 0}
              onChange={ev => setQty(i, ev.target.value)}
              className="w-24 text-sm border border-slate-300 rounded-lg px-2 py-1" />
          </div>
        ))}
        {entries.length === 0 && <span className="text-xs text-slate-500">컨테이너 정보가 없습니다. 부킹장에서 부킹번호·컨테이너를 먼저 입력하세요.</span>}
        <div className="flex items-center gap-2 ml-auto">
          <span className={`text-xs font-bold ${ok ? 'text-emerald-600' : 'text-red-600'}`}>
            부킹수량 {fmtQtyNum(total)} / CI_수량(총합) {fmtQtyNum(ciTotal)}
          </span>
          <button onClick={save} disabled={isPending || entries.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 disabled:opacity-40">
            {isPending ? '저장 중...' : '수량 저장'}
          </button>
        </div>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}

// ── 컴포넌트 ────────────────────────────────────────────────────────

interface Props {
  bookings: Booking[]
  profiles: Profile[]
  customLists: CustomList[]
}

export default function SplitTab({ bookings, profiles, customLists }: Props) {
  const router = useRouter()
  const [scanned, setScanned] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [handlerIds, setHandlerIds] = useState<string[]>([])
  const [month, setMonth] = useState('')
  const [destSearch, setDestSearch] = useState('')
  const [onlySplit, setOnlySplit] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)

  const registered = useMemo(() => {
    const c = customLists.filter(l => l.list_type === 'destination').map(l => l.name)
    return c.length > 0 ? c : [...DEFAULT_DESTINATIONS]
  }, [customLists])
  const registeredSet = useMemo(
    () => new Set(registered.map(d => d.trim().toUpperCase())), [registered])

  // 대상 후보 (C/I + CI_도착지가 있고, 실제로 바뀌는 행)
  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = []
    for (const b of bookings) {
      const parts = buildParts(b)
      if (parts.length === 0) continue
      const base = (b.final_destination || '').trim()
      const rowQty = calcTotalQty(b)
      const ciTotal = calcCiQtyTotal(b) ?? 0
      const mismatch = Math.abs(rowQty - ciTotal) > 0.0001
      if (parts.length === 1) {
        if (parts[0].dest === base) continue      // 변화 없음
        out.push({ booking: b, parts, kind: 'dest', rowQty, ciTotal, mismatch })
      } else {
        out.push({ booking: b, parts, kind: 'split', rowQty, ciTotal, mismatch })
      }
    }
    return out
  }, [bookings])

  const monthOptions = useMemo(() => {
    const s = new Set<string>()
    for (const c of candidates) if (c.booking.proforma_etd) s.add(c.booking.proforma_etd.slice(0, 7))
    return [...s].sort()
  }, [candidates])

  const visible = useMemo(() => candidates.filter(c => {
    if (handlerIds.length > 0 && !handlerIds.includes(c.booking.forwarder_handler_id || '')) return false
    if (month && (c.booking.proforma_etd || '').slice(0, 7) !== month) return false
    if (onlySplit && c.kind !== 'split') return false
    if (destSearch) {
      const q = destSearch.toUpperCase()
      const hit = (c.booking.final_destination || '').toUpperCase().includes(q)
        || c.parts.some(p => p.dest.toUpperCase().includes(q))
        || (c.booking.vessel_name || '').toUpperCase().includes(q)
      if (!hit) return false
    }
    return true
  }), [candidates, handlerIds, month, destSearch, onlySplit])

  const activeHandlers = useMemo(
    () => profiles.filter(p => candidates.some(c => c.booking.forwarder_handler_id === p.id)),
    [profiles, candidates])

  // 수량 불일치 행은 선택 자체가 불가 (쪼개기 전에 반드시 확인)
  const selected = useMemo(
    () => visible.filter(c => checked.has(c.booking.id) && !c.mismatch), [visible, checked])

  const newDests = useMemo(() => {
    const s = new Set<string>()
    for (const c of selected) {
      for (const p of c.parts) {
        const d = p.dest.trim()
        if (d && !registeredSet.has(d.toUpperCase())) s.add(d)
      }
    }
    return [...s]
  }, [selected, registeredSet])

  const scan = () => {
    setScanned(true)
    setChecked(new Set())
    setResult(null)
  }

  const selectable = useMemo(() => visible.filter(c => !c.mismatch), [visible])
  const toggleAll = () => {
    if (selectable.length > 0 && selectable.every(c => checked.has(c.booking.id))) setChecked(new Set())
    else setChecked(new Set(selectable.map(c => c.booking.id)))
  }

  // ── 실행 ──────────────────────────────────────────────────────────
  const runSplit = (addDests: boolean) => {
    const edits: { id: string; data: Record<string, unknown> }[] = []
    const inserts: { tempId: string; data: Record<string, unknown> }[] = []

    selected.forEach((c, ci) => {
      const b = c.booking
      c.parts.forEach((p, pi) => {
        const data: Record<string, unknown> = {
          final_destination: p.dest,
          booking_entries: p.entries,
          ci_qty: p.qtyLines.join('\n'),
          ci_dest: p.dest,
          ci_vessel: p.vesselLines.join('\n'),
        }
        if (pi === 0) {
          edits.push({ id: b.id, data })
        } else {
          inserts.push({
            tempId: `split-${ci}-${pi}`,
            data: {
              ...data,
              booking_no: p.entries[0]?.no || b.booking_no || '',
              discharge_port: b.discharge_port || '',
              carrier: b.carrier || '',
              vessel_name: b.vessel_name || '',
              voyage: b.voyage || '',
              secured_space: b.secured_space || '',
              mqc: b.mqc || '',
              customer_doc_handler: b.customer_doc_handler || '',
              forwarder_handler_id: b.forwarder_handler_id,
              doc_cutoff_date: b.doc_cutoff_date,
              proforma_etd: b.proforma_etd,
              updated_etd: b.updated_etd,
              eta: b.eta,
              qty_20_normal: 0, qty_20_dg: 0, qty_20_reefer: 0,
              qty_40_normal: 0, qty_40_dg: 0, qty_40_reefer: 0,
              con_pickup_qty: b.con_pickup_qty || 0,
              remarks: b.remarks || '',
              extra_data: { ...(b.extra_data || {}) },
              is_closed: b.is_closed ?? null,
            },
          })
        }
      })
    })

    startTransition(async () => {
      if (addDests && newDests.length > 0) {
        for (const d of newDests) await addCustomListItem('destination', d)
      }
      const { errors } = await bulkSaveBookings(edits, inserts)
      if (Object.keys(errors).length > 0) {
        setResult('실패: ' + Object.values(errors)[0])
        return
      }
      setConfirmOpen(false)
      setChecked(new Set())
      setResult(`완료: 부킹 ${selected.length}건 → ${edits.length + inserts.length}행으로 분할${addDests && newDests.length > 0 ? ` · 최종도착지 ${newDests.length}건 설정에 추가` : ''}`)
      router.refresh()
    })
  }

  // ── 화면 ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={scan} className="btn-primary text-sm">쪼갤 대상 조회</button>
          {scanned && (
            <span className="text-xs text-slate-500">
              대상 {candidates.length}건 (분할 {candidates.filter(c => c.kind === 'split').length} · 도착지만 변경 {candidates.filter(c => c.kind === 'dest').length})
            </span>
          )}
          <div className="flex-1" />
          {scanned && (
            <>
              <span className="text-xs text-slate-500">선택 {selected.length}건</span>
              <button onClick={() => setConfirmOpen(true)} disabled={selected.length === 0}
                className="text-sm px-3 py-2 rounded-lg bg-rose-600 text-white font-medium disabled:opacity-40 hover:bg-rose-700">
                선택 항목 쪼개기
              </button>
            </>
          )}
        </div>

        {scanned && (
          <>
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
              <span className="text-xs font-bold text-slate-500 w-14">담당자</span>
              <button onClick={() => setHandlerIds([])}
                className={`text-xs px-2.5 py-1 rounded-lg border ${handlerIds.length === 0 ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>전체</button>
              {activeHandlers.map(p => {
                const on = handlerIds.includes(p.id)
                return (
                  <button key={p.id} onClick={() => setHandlerIds(prev => on ? prev.filter(i => i !== p.id) : [...prev, p.id])}
                    className={`text-xs px-2.5 py-1 rounded-lg border ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{p.name}</button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500 w-14">출항월</span>
              <select value={month} onChange={e => setMonth(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                <option value="">전체</option>
                {monthOptions.map(m => <option key={m} value={m}>{m.replace('-', '년 ')}월</option>)}
              </select>
              <input value={destSearch} onChange={e => setDestSearch(e.target.value)}
                placeholder="도착지 · 모선명 검색"
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-52" />
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={onlySplit} onChange={e => setOnlySplit(e.target.checked)} />
                분할되는 건만
              </label>
              <button onClick={toggleAll} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
                {selectable.length > 0 && selectable.every(c => checked.has(c.booking.id)) ? '전체 해제' : '전체 선택'}
              </button>
              <span className="text-[11px] text-slate-400">
                표시 {visible.length}건
                {visible.length - selectable.length > 0 && (
                  <span className="text-red-500 font-medium"> · 수량 확인 필요 {visible.length - selectable.length}건</span>
                )}
              </span>
            </div>
          </>
        )}

        {result && (
          <div className={`text-xs px-3 py-2 rounded-lg ${result.startsWith('완료') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{result}</div>
        )}
        {!scanned && (
          <p className="text-xs text-slate-500">
            C/I가 입력되어 있고 <b>CI_도착지</b> 값이 있는 부킹을 찾아, CI_도착지가 서로 다르면 도착지별로 행을 나눕니다.
            나눠진 행의 <b>최종도착지</b>는 해당 CI_도착지 값으로 바뀌며, 부킹장 탭에도 그대로 반영됩니다.
          </p>
        )}
      </div>

      {/* 대상 목록 — 전/후 비교 */}
      {scanned && (
        <div className="space-y-2">
          {visible.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
              쪼갤 대상이 없습니다. (C/I와 CI_도착지가 입력된 부킹만 대상입니다)
            </div>
          )}
          {visible.map(c => {
            const b = c.booking
            const on = checked.has(b.id)
            return (
              <div key={b.id} className={`bg-white border rounded-xl overflow-hidden transition-colors ${
                c.mismatch ? 'border-red-300' : on ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-slate-200'
              }`}>
                <div className={`flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-100 ${c.mismatch ? 'bg-red-50 cursor-not-allowed' : 'bg-slate-50 cursor-pointer'}`}
                  onClick={() => {
                    if (c.mismatch) return
                    setChecked(prev => { const n = new Set(prev); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n })
                  }}>
                  <input type="checkbox" checked={on && !c.mismatch} disabled={c.mismatch} onChange={() => {}} className="pointer-events-none" />
                  <span className="text-xs font-bold text-slate-700">#{b.seq_no ?? '-'}</span>
                  <span className="text-xs text-slate-500">{b.carrier} · {b.vessel_name} / {b.voyage}</span>
                  <span className="text-xs text-slate-400">ETD {fmtDate(b.proforma_etd)} · 마감 {fmtDate(b.doc_cutoff_date)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${c.kind === 'split' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                    {c.kind === 'split' ? `${c.parts.length}행으로 분할` : '도착지만 변경'}
                  </span>
                  {c.parts.some(p => p.prorated) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-800 font-bold" title="한 부킹번호의 C/I가 여러 도착지에 걸쳐 있어 컨테이너 수량을 비율로 나눴습니다">수량 비율분할</span>
                  )}
                  <span className={`text-[11px] font-medium ${c.mismatch ? 'text-red-600' : 'text-slate-500'}`}>
                    CI_수량(총합) {fmtQtyNum(c.ciTotal)} / 부킹수량 {fmtQtyNum(c.rowQty)}
                  </span>
                  {c.mismatch && (
                    <span className="text-[11px] font-bold text-red-600">⚠ 값이 일치하지 않습니다. 확인 바랍니다.</span>
                  )}
                </div>
                {c.mismatch && (
                  <QtyEditor booking={b} ciTotal={c.ciTotal} onSaved={() => router.refresh()} />
                )}
                <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                  {/* 전 */}
                  <div className="p-3">
                    <p className="text-[11px] font-bold text-slate-400 mb-1.5">쪼개기 전</p>
                    <table className="w-full text-xs">
                      <tbody>
                        <tr><td className="text-slate-400 w-24 py-0.5">최종도착지</td><td className="font-semibold text-slate-800">{b.final_destination || '-'}</td></tr>
                        <tr><td className="text-slate-400 py-0.5">부킹번호</td><td className="font-mono text-slate-700">{bookingNosOf(b.booking_entries || [])}</td></tr>
                        <tr><td className="text-slate-400 py-0.5">컨테이너</td><td className="text-slate-700">{containersOf(b.booking_entries || [])}</td></tr>
                        <tr><td className="text-slate-400 py-0.5 align-top">C/I</td>
                          <td className="font-mono text-emerald-700 whitespace-pre-line">
                            {(b.booking_entries || []).flatMap(cisOf).join('\n') || '-'}
                          </td></tr>
                        <tr><td className="text-slate-400 py-0.5 align-top">CI_도착지</td>
                          <td className="text-slate-700 whitespace-pre-line">{b.ci_dest || '-'}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  {/* 후 */}
                  <div className="p-3 bg-indigo-50/30">
                    <p className="text-[11px] font-bold text-indigo-500 mb-1.5">쪼갠 후 ({c.parts.length}행)</p>
                    <div className="space-y-2">
                      {c.parts.map((p, i) => (
                        <div key={i} className="border border-indigo-100 rounded-lg p-2 bg-white">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white font-bold">{i + 1}행</span>
                            <span className="text-xs font-semibold text-slate-800">{p.dest || '(도착지 없음)'}</span>
                            {!registeredSet.has(p.dest.trim().toUpperCase()) && p.dest && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-bold">미등록</span>
                            )}
                            {i === 0 && <span className="text-[10px] text-slate-400">(기존 행 수정)</span>}
                            {i > 0 && <span className="text-[10px] text-emerald-600 font-medium">(신규 행)</span>}
                          </div>
                          <table className="w-full text-xs">
                            <tbody>
                              <tr><td className="text-slate-400 w-20 py-0.5">부킹번호</td><td className="font-mono text-slate-700">{bookingNosOf(p.entries)}</td></tr>
                              <tr><td className="text-slate-400 py-0.5">컨테이너</td><td className="text-slate-700">{containersOf(p.entries)}</td></tr>
                              <tr><td className="text-slate-400 py-0.5">C/I</td><td className="font-mono text-emerald-700">{p.cis.join(', ')}</td></tr>
                              <tr><td className="text-slate-400 py-0.5">CI_수량</td><td className="text-slate-700">{p.qtyLines.filter(Boolean).join(', ') || '-'}</td></tr>
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 실행 확인 */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !isPending && setConfirmOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200">
              <h3 className="font-bold text-slate-900">쪼개기 실행</h3>
            </div>
            <div className="p-5 space-y-3 text-sm text-slate-700">
              <p>
                선택한 <b>{selected.length}건</b>의 부킹을 <b>{selected.reduce((s, c) => s + c.parts.length, 0)}행</b>으로 나눕니다.
                <br />
                <span className="text-xs text-slate-500">
                  기존 행 {selected.length}건은 첫 번째 도착지로 수정되고, 나머지 {selected.reduce((s, c) => s + c.parts.length - 1, 0)}행이 새로 생성됩니다.
                  각 행의 최종도착지는 CI_도착지 값으로 바뀝니다.
                </span>
              </p>
              {newDests.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-orange-800 mb-1">설정에 등록되지 않은 최종도착지가 있습니다</p>
                  <p className="text-xs text-orange-700">{newDests.join(', ')}</p>
                  <p className="text-xs text-orange-600 mt-1">설정(최종도착지 목록)에 추가하시겠습니까?</p>
                </div>
              )}
              {result && result.startsWith('실패') && <p className="text-xs text-red-600">{result}</p>}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} disabled={isPending} className="btn-secondary text-sm">취소</button>
              {newDests.length > 0 ? (
                <>
                  <button onClick={() => runSplit(false)} disabled={isPending}
                    className="text-sm px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
                    아니오 (추가 없이 쪼개기)
                  </button>
                  <button onClick={() => runSplit(true)} disabled={isPending} className="btn-primary text-sm">
                    {isPending ? '처리 중...' : '예 (추가 후 쪼개기)'}
                  </button>
                </>
              ) : (
                <button onClick={() => runSplit(false)} disabled={isPending} className="btn-primary text-sm">
                  {isPending ? '처리 중...' : '쪼개기 실행'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
