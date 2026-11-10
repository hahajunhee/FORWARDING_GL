'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Booking, Profile } from '@/types'
import { formatContainers } from './BookingTable'
import { saveCapacityMap } from '@/app/bookings/capacityActions'
import {
  calcCapacity, openBookings, unitQty, EMPTY_CAPMAP,
  type CapData, type CapMap, type CapResult, type CapGroup,
} from '@/lib/capacity'

const md = (d: string | null | undefined) => (d ? d.slice(5).replace('-', '/') : '-')
const nk = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '')

function ChipSelect({ value, options, onChange, placeholder }: {
  value: string[]; options: string[]; onChange: (v: string[]) => void; placeholder: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map(v => (
        <span key={v} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5 text-xs">
          {v}
          <button type="button" className="text-indigo-400 hover:text-red-600 leading-none" onClick={() => onChange(value.filter(x => x !== v))}>×</button>
        </span>
      ))}
      <select className="text-xs border border-slate-200 rounded px-1 py-0.5 bg-white" value=""
        onChange={e => { if (e.target.value) onChange([...value, e.target.value]) }}>
        <option value="">{placeholder}</option>
        {options.filter(o => !value.includes(o)).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function GroupRows({ g, qty, setQty, excluded, setExcluded }: {
  g: CapGroup
  qty: Record<string, number>
  setQty: (f: (q: Record<string, number>) => Record<string, number>) => void
  excluded: Set<string>
  setExcluded: (f: (s: Set<string>) => Set<string>) => void
}) {
  return (
    <>
      {g.rows.map(b => (
        <tr key={b.id} className="border-t border-slate-100">
          <td className="px-2">
            <input type="checkbox" checked={!excluded.has(b.id)}
              onChange={() => setExcluded(s => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n })} />
          </td>
          <td className="px-2 py-1">{b.vessel_name}</td>
          <td className="px-2 text-center">{b.voyage}</td>
          <td className="px-2 text-center">{md(b.doc_cutoff_date)}</td>
          <td className="px-2 text-center">{md(b.proforma_etd)}</td>
          <td className="px-2 text-center">{md(b.updated_etd)}</td>
          <td className="px-2 text-center">{md(b.eta)}</td>
          <td className="px-2 text-center whitespace-nowrap">{formatContainers(b)}</td>
          <td className="px-2 text-center">
            <input type="number" min={0} className="w-16 border border-slate-300 rounded px-1 py-0.5 text-center"
              value={qty[b.id] ?? unitQty(b)}
              onChange={e => setQty(q => ({ ...q, [b.id]: Math.max(0, Number(e.target.value) || 0) }))} />
          </td>
          <td className="px-2 text-center text-slate-300">-</td>
          <td className="px-2 text-center text-slate-300">-</td>
          <td className="px-2 text-slate-600">{b.booking_no}</td>
        </tr>
      ))}
      <tr className="bg-amber-100 font-semibold text-center">
        <td colSpan={8}>
          {md(g.cutoff)} 마감{' '}
          <span className="font-normal text-slate-600">
            (계산구간 {g.days}일{g.workDays !== g.days ? `·영업 ${g.workDays}일` : ''}, 이월 {g.carryIn}대)
          </span>
        </td>
        <td>{g.secured}</td>
        <td>{g.add}</td>
        <td className={g.balance > 0 ? 'text-red-600' : 'text-emerald-600'}>
          {g.balance > 0 ? `부족 ${g.balance}대` : g.balance < 0 ? `여유 ${-g.balance}대` : '딱 맞음'}
        </td>
        <td>-</td>
      </tr>
    </>
  )
}

export default function CapacityPanel({ bookings, currentProfile }: { bookings: Booking[]; currentProfile: Profile | null }) {
  const [data, setData] = useState<CapData | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [map, setMap] = useState<CapMap>(() => ({
    pdc: currentProfile?.capacity_map?.pdc || {},
    carrier: currentProfile?.capacity_map?.carrier || {},
  }))
  const [showMap, setShowMap] = useState(false)
  const [mapMsg, setMapMsg] = useState('')
  const [open, setOpen] = useState(true)
  const [sel, setSel] = useState<{ carrier: string; dest: string } | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  useEffect(() => { try { setOpen(localStorage.getItem('capPanelOpen') !== '0') } catch { /* 저장소 없음 */ } }, [])
  const toggleOpen = () => setOpen(o => {
    try { localStorage.setItem('capPanelOpen', o ? '0' : '1') } catch { /* 저장소 없음 */ }
    return !o
  })

  const load = useCallback(() => {
    setLoading(true); setErr('')
    fetch('/api/capacity', { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (ok && j?.current) setData(j as CapData); else setErr(j?.error || '불러오지 못했습니다.') })
      .catch(() => setErr('미선적 서버에 연결하지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 10 * 60 * 1000); return () => clearInterval(t) }, [load])

  // 마감 전 부킹이 있는 (선사, 최종도착지) 조합
  const combos = useMemo(() => {
    if (!data) return []
    const seen = new Map<string, { carrier: string; dest: string }>()
    for (const b of bookings) {
      if (b.is_closed || !b.carrier || !b.final_destination || !b.doc_cutoff_date || b.doc_cutoff_date < data.today) continue
      const k = nk(b.carrier) + '|' + nk(b.final_destination)
      if (!seen.has(k)) seen.set(k, { carrier: b.carrier.trim(), dest: b.final_destination.trim() })
    }
    return [...seen.values()].sort((a, b) => a.carrier.localeCompare(b.carrier) || a.dest.localeCompare(b.dest))
  }, [bookings, data])

  const overview = useMemo(() => {
    if (!data) return []
    return combos.map(c => ({ ...c, res: calcCapacity({ bookings, carrier: c.carrier, dest: c.dest, data, map }) }))
  }, [combos, bookings, data, map])

  const detail: CapResult | null = useMemo(() => {
    if (!data || !sel) return null
    return calcCapacity({ bookings, carrier: sel.carrier, dest: sel.dest, data, map, qty, excluded })
  }, [bookings, data, map, sel, qty, excluded])
  const detailRows = useMemo(
    () => (data && sel ? openBookings(bookings, sel.carrier, sel.dest, data.today).rows : []),
    [bookings, data, sel],
  )

  const pickSel = (carrier: string, dest: string) => { setSel({ carrier, dest }); setQty({}); setExcluded(new Set()) }

  const destOptions = useMemo(
    () => [...new Set(bookings.map(b => (b.final_destination || '').trim()).filter(Boolean))].sort(), [bookings])
  const carrierOptions = useMemo(
    () => [...new Set(bookings.map(b => (b.carrier || '').trim()).filter(Boolean))].sort(), [bookings])

  const saveMap = async () => {
    setMapMsg('저장 중…')
    const r = await saveCapacityMap(map)
    setMapMsg(r.error ? `⚠ ${r.error}` : '저장했습니다.')
  }

  const copyTsv = async () => {
    if (!detail) return
    const L: string[][] = [['모선명', 'VOYAGE', '서류마감', 'PROFORMA ETD', 'UPDATED ETD', 'ETA', '컨테이너', '확보수량', '추가(누적발생)', '잔량', '부킹번호']]
    L.push(['초기 잔량', '', '', '', '', '', '', '', '', String(detail.initial), ''])
    for (const g of detail.groups) {
      for (const b of g.rows) {
        L.push([b.vessel_name, b.voyage, md(b.doc_cutoff_date), md(b.proforma_etd), md(b.updated_etd), md(b.eta),
          formatContainers(b), String(qty[b.id] ?? unitQty(b)), '', '', b.booking_no])
      }
      L.push([`${md(g.cutoff)} 마감 (계산구간 ${g.days}일, 이월 ${g.carryIn}대)`, '', '', '', '', '', '', String(g.secured), String(g.add),
        g.balance > 0 ? `부족 ${g.balance}대` : g.balance < 0 ? `여유 ${-g.balance}대` : '딱 맞음', ''])
    }
    L.push(['전체 합계', '', '', '', '', '', '', String(detail.totalSecured), String(detail.totalAdd),
      detail.finalShort > 0 ? `최종 부족 ${detail.finalShort}대` : '부족 없음', ''])
    await navigator.clipboard.writeText(L.map(r => r.join('\t')).join('\n'))
  }

  const chip = 'px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-xs font-bold'
  const verdict = (res: CapResult) => res.pdcs.length === 0
    ? <span className={chip}>PDC 미매핑</span>
    : res.siteCarriers.length === 0
      ? <span className={chip}>선사 미매칭</span>
      : res.finalShort > 0
        ? <span className="text-red-600 font-bold">최종 부족 {res.finalShort}대</span>
        : <span className="text-emerald-600 font-bold">부족 없음{res.finalSpare > 0 ? ` (여유 ${res.finalSpare})` : ''}</span>

  return (
    <div className="border border-slate-200 rounded-lg bg-white mb-2 flex-shrink-0">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-t-lg">
        <button type="button" onClick={toggleOpen} className="text-sm font-bold text-slate-700">
          {open ? '▼' : '▶'} 선복 확인 <span className="font-normal text-slate-400 text-xs">(미선적 현황 연동)</span>
        </button>
        <span className="text-xs text-slate-400 ml-2">
          {data ? `기준 ${data.today}${data.built_at ? ' · 집계 ' + data.built_at.replace('_', ' ') : ''}` : loading ? '불러오는 중…' : ''}
        </span>
        <div className="ml-auto flex gap-1">
          <button type="button" onClick={load} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-white">새로고침</button>
          <button type="button" onClick={() => setShowMap(s => !s)} className="text-xs px-2 py-1 border border-indigo-300 text-indigo-700 rounded hover:bg-indigo-50">매핑 설정</button>
        </div>
      </div>

      {open && (
        <div className="p-3 space-y-3 max-h-[58vh] overflow-auto">
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</div>}

          {showMap && data && (
            <div className="border border-indigo-200 rounded p-3 bg-indigo-50/40 space-y-3">
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">
                  ① 미선적 PDC → 부킹장 최종도착지 <span className="font-normal text-slate-400">(비워 두면 이름이 같을 때만 자동 연결)</span>
                </div>
                <div className="grid gap-1" style={{ gridTemplateColumns: 'minmax(150px,auto) 1fr' }}>
                  {data.pdcs.map(p => (
                    <div key={p} className="contents">
                      <div className="text-xs py-0.5">
                        <b>{p}</b> <span className="text-slate-400">잔량 {Object.values(data.current[p] || {}).reduce((s, v) => s + v, 0)}</span>
                      </div>
                      <ChipSelect value={map.pdc[p] || []} options={destOptions} placeholder="+ 최종도착지"
                        onChange={v => setMap(m => ({ ...m, pdc: { ...m.pdc, [p]: v } }))} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">
                  ② 미선적 선사 → 부킹장 선사 <span className="font-normal text-slate-400">(MSK↔MAERSK 등은 자동 인식, 다르면 직접 지정)</span>
                </div>
                <div className="grid gap-1" style={{ gridTemplateColumns: 'minmax(150px,auto) 1fr' }}>
                  {data.carriers.map(c => (
                    <div key={c} className="contents">
                      <div className="text-xs py-0.5"><b>{c}</b></div>
                      <ChipSelect value={map.carrier[c] || []} options={carrierOptions} placeholder="+ 부킹장 선사"
                        onChange={v => setMap(m => ({ ...m, carrier: { ...m.carrier, [c]: v } }))} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={saveMap} className="text-xs px-3 py-1 bg-indigo-600 text-white rounded">매핑 저장</button>
                <button type="button" onClick={() => setMap(EMPTY_CAPMAP)} className="text-xs px-2 py-1 border border-slate-300 rounded">전체 비우기</button>
                {mapMsg && <span className="text-xs text-slate-600">{mapMsg}</span>}
              </div>
            </div>
          )}

          {data && (
            <div>
              <div className="text-xs font-bold text-slate-700 mb-1">
                전체 현황 <span className="font-normal text-slate-400">— 마감 전 부킹이 있는 선사·최종도착지 (행을 누르면 아래에 상세)</span>
              </div>
              <div className="overflow-auto border border-slate-200 rounded max-h-52">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      {['선사', '최종도착지', '매핑 PDC', '현재 잔량', '확보 합계', '추가 예상', '결과'].map(h => (
                        <th key={h} className="px-2 py-1 text-left font-semibold text-slate-600">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overview.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-slate-400">마감 전 부킹이 없습니다.</td></tr>}
                    {overview.map(o => {
                      const on = sel && nk(sel.carrier) === nk(o.carrier) && nk(sel.dest) === nk(o.dest)
                      return (
                        <tr key={o.carrier + '|' + o.dest} onClick={() => pickSel(o.carrier, o.dest)}
                          className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50 ${on ? 'bg-indigo-50' : ''}`}>
                          <td className="px-2 py-1 font-medium">{o.carrier}</td>
                          <td className="px-2 py-1">{o.dest}</td>
                          <td className="px-2 py-1 text-slate-500">{o.res.pdcs.join(', ') || '-'}</td>
                          <td className="px-2 py-1 text-right">{o.res.initial}</td>
                          <td className="px-2 py-1 text-right">{o.res.totalSecured}</td>
                          <td className="px-2 py-1 text-right">{o.res.totalAdd}</td>
                          <td className="px-2 py-1">{verdict(o.res)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detail && sel && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="text-xs font-bold text-slate-700">
                  결과표 — {sel.carrier} → {sel.dest}
                  <span className="font-normal text-slate-400"> (PDC {detail.pdcs.join(', ') || '미매핑'} · 하루 예상 출하 {detail.perDay.toFixed(1)}대)</span>
                </div>
                <button type="button" onClick={copyTsv} className="ml-auto text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50">표 복사 (TSV)</button>
              </div>
              {detail.skippedNoCutoff > 0 && (
                <div className="text-xs text-amber-700 mb-1">서류마감일이 비어 있는 부킹 {detail.skippedNoCutoff}건은 계산에서 제외했습니다.</div>
              )}
              <div className="overflow-auto border border-slate-200 rounded">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-[#2f5597] text-white">
                    <tr>
                      {['', '모선명', 'VOYAGE', '서류마감', 'PROFORMA ETD', 'UPDATED ETD', 'ETA', '컨테이너', '확보수량', '추가(누적발생)', '잔량', '부킹번호'].map(h => (
                        <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-slate-100 font-bold text-center">
                      <td colSpan={8}>초기 잔량 <span className="font-normal text-slate-500">(현재 마감 안 친 컨테이너)</span></td>
                      <td>-</td><td>-</td><td>{detail.initial}</td><td>-</td>
                    </tr>
                    {detail.groups.map(g => (
                      <GroupRows key={g.cutoff} g={g} qty={qty} setQty={setQty} excluded={excluded} setExcluded={setExcluded} />
                    ))}
                    {detailRows.filter(b => excluded.has(b.id)).map(b => (
                      <tr key={b.id} className="text-slate-400 line-through border-t border-slate-100">
                        <td className="px-2">
                          <input type="checkbox" checked={false}
                            onChange={() => setExcluded(s => { const n = new Set(s); n.delete(b.id); return n })} />
                        </td>
                        <td className="px-2">{b.vessel_name}</td>
                        <td className="px-2 text-center">{b.voyage}</td>
                        <td className="px-2 text-center">{md(b.doc_cutoff_date)}</td>
                        <td colSpan={8} className="px-2">제외됨 (계산에서 뺌)</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-200 font-bold text-center">
                      <td colSpan={8}>전체 합계 (확보/추가) · 최종 잔량</td>
                      <td>{detail.totalSecured}</td>
                      <td>{detail.totalAdd}</td>
                      <td className={detail.finalShort > 0 ? 'text-red-600' : 'text-emerald-600'}>
                        {detail.finalShort > 0 ? `최종 부족 ${detail.finalShort}대` : '부족 없음'}
                      </td>
                      <td>-</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                규칙: 같은 선사 · 매핑된 PDC=최종도착지만 · 서류마감 이후 출하분은 그 모선에 못 실음(다음 모선으로 이월) · 마감 완료/지난 부킹 제외.
                확보수량은 직접 고칠 수 있고, 체크를 해제하면 계산에서 뺍니다.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
