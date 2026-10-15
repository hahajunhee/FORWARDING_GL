'use client'

import { useState, useMemo, useTransition } from 'react'
import type { Booking } from '@/types'
import type { TransitMap } from '@/lib/eta'
import { transitKey, diffDaysIso } from '@/lib/eta'
import { saveEtaTransitDays } from '@/app/bookings/actions'

interface Row { carrier: string; port: string; days: number }

function toRows(map: TransitMap): Row[] {
  return Object.entries(map || {}).map(([k, days]) => {
    const [carrier, port] = k.split('|')
    return { carrier: carrier || '', port: port || '', days: Number(days) || 0 }
  }).sort((a, b) => (a.carrier + a.port).localeCompare(b.carrier + b.port, 'ko'))
}

// 기존 부킹에서 (선사+양하항)별 UPDATED ETD → ETA 일수의 중앙값을 추출
function deriveFromBookings(bookings: Booking[]): Row[] {
  const buckets = new Map<string, number[]>()
  for (const b of bookings) {
    const d = diffDaysIso(b.updated_etd, b.eta)
    if (d === null || d <= 0 || d > 120) continue
    if (!b.carrier || !b.discharge_port) continue
    const k = transitKey(b.carrier, b.discharge_port)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(d)
  }
  const out: Row[] = []
  for (const [k, list] of buckets) {
    list.sort((a, b) => a - b)
    const mid = list[Math.floor(list.length / 2)]
    const [carrier, port] = k.split('|')
    out.push({ carrier, port, days: mid })
  }
  return out.sort((a, b) => (a.carrier + a.port).localeCompare(b.carrier + b.port, 'ko'))
}

export default function EtaTransitModal({ bookings, initial, carriers, ports, onClose, onSaved }: {
  bookings: Booking[]
  initial: TransitMap
  carriers: string[]
  ports: string[]
  onClose: () => void
  onSaved: (next: TransitMap) => void
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initial))
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const derived = useMemo(() => deriveFromBookings(bookings), [bookings])

  const update = (i: number, patch: Partial<Row>) =>
    setRows(p => p.map((r, ri) => ri === i ? { ...r, ...patch } : r))

  const applyDerived = () => {
    setRows(prev => {
      const byKey = new Map(prev.map(r => [transitKey(r.carrier, r.port), r]))
      for (const d of derived) {
        const k = transitKey(d.carrier, d.port)
        if (!byKey.has(k)) byKey.set(k, d)   // 직접 입력한 값은 덮어쓰지 않음
      }
      return [...byKey.values()].sort((a, b) => (a.carrier + a.port).localeCompare(b.carrier + b.port, 'ko'))
    })
  }

  const save = () => {
    const map: TransitMap = {}
    for (const r of rows) {
      if (!r.carrier && !r.port) continue       // 선사·양하항 둘 다 비면 무시
      if (!Number.isFinite(r.days) || r.days <= 0) continue
      map[transitKey(r.carrier, r.port)] = Math.round(r.days)
    }
    setErr(null)
    startTransition(async () => {
      const { error } = await saveEtaTransitDays(map)
      if (error) { setErr(error); return }
      onSaved(map)
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">ETA 자동계산 설정</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            UPDATED ETD를 바꾸면 <b>선사 + 양하항</b>에 맞는 운송일수를 더해 ETA가 자동으로 채워집니다.
            (예: CMA · LAX · 14일 → UPDATED ETD 10/12면 ETA 10/26)
            <br />선사나 양하항 한쪽만 입력하면 그 조건의 공통값으로 쓰이고, 둘 다 맞는 규칙이 우선합니다.
          </p>
        </div>

        <div className="px-5 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <button onClick={applyDerived}
            className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 font-medium">
            현재 데이터에서 추출 ({derived.length}건)
          </button>
          <span className="text-[11px] text-slate-400">
            기존 부킹의 UPDATED ETD ~ ETA 간격 중앙값을 조합별로 채웁니다. 직접 입력한 값은 유지됩니다.
          </span>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="text-left py-1.5">선사</th>
                <th className="text-left py-1.5">양하항</th>
                <th className="w-28 py-1.5">운송일수</th>
                <th className="w-12 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 pr-2">
                    <input list="eta-carriers" value={r.carrier} onChange={e => update(i, { carrier: e.target.value })}
                      placeholder="(전체)" className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input list="eta-ports" value={r.port} onChange={e => update(i, { port: e.target.value })}
                      placeholder="(전체)" className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1" />
                  </td>
                  <td className="py-1.5 text-center">
                    <input type="number" min={1} max={120} value={r.days}
                      onChange={e => update(i, { days: Number(e.target.value) || 0 })}
                      className="w-20 text-sm border border-slate-200 rounded-lg px-2 py-1 text-center" />
                  </td>
                  <td className="py-1.5 text-center">
                    <button onClick={() => setRows(p => p.filter((_, ri) => ri !== i))}
                      className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">삭제</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-slate-400 text-sm">
                  규칙이 없습니다. 아래에서 추가하거나 &lsquo;현재 데이터에서 추출&rsquo;을 눌러보세요.
                </td></tr>
              )}
            </tbody>
          </table>
          <datalist id="eta-carriers">{carriers.map(c => <option key={c} value={c} />)}</datalist>
          <datalist id="eta-ports">{ports.map(p => <option key={p} value={p} />)}</datalist>

          <button onClick={() => setRows(p => [...p, { carrier: '', port: '', days: 14 }])}
            className="w-full mt-3 text-sm py-2 border border-dashed border-slate-300 rounded-lg text-slate-500 hover:bg-slate-50">
            + 규칙 추가
          </button>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          {err && <span className="text-xs text-red-600 mr-auto">{err}</span>}
          <span className="text-xs text-slate-400 mr-auto">{rows.length}개 규칙</span>
          <button onClick={onClose} className="btn-secondary text-sm">취소</button>
          <button onClick={save} disabled={isPending} className="btn-primary text-sm">
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
