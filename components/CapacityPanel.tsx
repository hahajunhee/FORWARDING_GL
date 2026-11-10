'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Booking } from '@/types'
import { formatContainers } from './BookingTable'
import { calcSelection, cellKey, sumCells, unitQty, type CapData, type CapGroup, type FcMode } from '@/lib/capacity'

const md = (d: string | null | undefined) => (d ? d.slice(5).replace('-', '/') : '-')
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString()

function GroupRows({ g, qty, setQty }: {
  g: CapGroup
  qty: Record<string, number>
  setQty: (f: (q: Record<string, number>) => Record<string, number>) => void
}) {
  return (
    <>
      {g.rows.map(b => (
        <tr key={b.id} className="border-t border-slate-100">
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
        <td colSpan={7}>
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

/**
 * 예상선복확인 패널
 *  ① 미선적 현황에서 PDC×선사 칸을 직접 골라 현재 잔량을 합산
 *  ② 아래 부킹 표에서 체크한 모선(여러 개)만 대상으로
 *  ③ 서류마감 순으로 이월/추가(예상 출하)/확보를 계산해 잔량·부족을 보여준다
 */
export default function CapacityPanel({ bookings, selectedIds }: { bookings: Booking[]; selectedIds: Set<string> }) {
  const [data, setData] = useState<CapData | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(true)
  const [cells, setCells] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<FcMode>('pdc')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [copied, setCopied] = useState(false)

  // 마지막 선택 복원(이 브라우저에서만)
  useEffect(() => {
    try {
      setOpen(localStorage.getItem('capPanelOpen') !== '0')
      const c = JSON.parse(localStorage.getItem('capCells') || '[]'); if (Array.isArray(c)) setCells(new Set(c))
      const m = localStorage.getItem('capMode'); if (m === 'pdc' || m === 'cells') setMode(m)
    } catch { /* 저장소 없음 */ }
  }, [])
  const persist = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* 저장소 없음 */ } }
  const toggleOpen = () => setOpen(o => { persist('capPanelOpen', o ? '0' : '1'); return !o })
  const setCellsP = (f: (s: Set<string>) => Set<string>) => setCells(s => { const n = f(s); persist('capCells', JSON.stringify([...n])); return n })

  const load = useCallback(() => {
    setLoading(true); setErr('')
    fetch('/api/capacity', { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (ok && j?.current) setData(j as CapData); else setErr(j?.error || '불러오지 못했습니다.') })
      .catch(() => setErr('미선적 서버에 연결하지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 10 * 60 * 1000); return () => clearInterval(t) }, [load])

  // 표에 보이는 칸: 현재 잔량이 있거나 예상 출하가 있는 PDC×선사
  const grid = useMemo(() => {
    if (!data) return null
    const has = (p: string, c: string) => (data.current[p]?.[c] || 0) > 0 || (data.rate[p]?.[c] || 0) > 0
    const carriers = data.carriers.filter(c => data.pdcs.some(p => has(p, c)))
    const pdcs = data.pdcs.filter(p => carriers.some(c => has(p, c)))
    return { pdcs, carriers, has }
  }, [data])

  const toggleCell = (p: string, c: string) => setCellsP(s => { const n = new Set(s); const k = cellKey(p, c); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const toggleMany = (keys: string[]) => setCellsP(s => {
    const n = new Set(s); const all = keys.every(k => n.has(k))
    keys.forEach(k => (all ? n.delete(k) : n.add(k))); return n
  })

  const picked = useMemo(() => bookings.filter(b => selectedIds.has(b.id)), [bookings, selectedIds])
  const validCells = useMemo(() => new Set([...cells].filter(k => { const [p, c] = k.split('|'); return !!grid?.has(p, c) })), [cells, grid])
  const sums = useMemo(() => (data ? sumCells(data, validCells, mode) : null), [data, validCells, mode])
  const result = useMemo(
    () => (data && picked.length > 0 ? calcSelection({ rows: picked, data, cells: validCells, mode, qty }) : null),
    [data, picked, validCells, mode, qty])

  // 표 복사: 화면과 같은 구조(11열, 병합·색·테두리)를 HTML로 복사 → 엑셀/워드에 붙여넣으면 열 위치와 테두리가 그대로 유지된다.
  // 같은 내용을 탭 구분 텍스트로도 함께 담아, 메모장 등에는 텍스트로 붙는다.
  const copyTable = async () => {
    if (!result) return
    type C = { t: string; span?: number; bg?: string; fg?: string; bold?: boolean; align?: 'left' | 'center' | 'right' }
    const NCOL = 11
    const head: C[] = ['모선명', 'VOYAGE', '서류마감', 'PROFORMA ETD', 'UPDATED ETD', 'ETA', '컨테이너', '확보수량', '추가(누적발생)', '잔량', '부킹번호']
      .map(t => ({ t, bg: '#2f5597', fg: '#ffffff', bold: true, align: 'center' as const }))
    const rows: C[][] = [head]
    const bal = (n: number): C => ({ t: n > 0 ? `부족 ${n}대` : n < 0 ? `여유 ${-n}대` : '딱 맞음', bg: '', fg: n > 0 ? '#dc2626' : '#059669', bold: true, align: 'center' })
    const c = (t: string, o: Partial<C> = {}): C => ({ t, align: 'center', ...o })

    rows.push([c('초기 잔량 (선택한 PDC×선사의 현재 마감 안 친 컨테이너 합)', { span: 7, bg: '#f1f5f9', bold: true }),
      c('-', { bg: '#f1f5f9' }), c('-', { bg: '#f1f5f9' }), c(String(result.initial), { bg: '#f1f5f9', bold: true }), c('-', { bg: '#f1f5f9' })])
    for (const g of result.groups) {
      for (const b of g.rows) {
        rows.push([c(b.vessel_name, { align: 'left' }), c(b.voyage || ''), c(md(b.doc_cutoff_date)), c(md(b.proforma_etd)), c(md(b.updated_etd)), c(md(b.eta)),
          c(formatContainers(b)), c(String(qty[b.id] ?? unitQty(b))), c('-'), c('-'), c(b.booking_no || '', { align: 'left' })])
      }
      const gb = bal(g.balance); gb.bg = '#fef3c7'
      rows.push([c(`${md(g.cutoff)} 마감 (계산구간 ${g.days}일${g.workDays !== g.days ? `·영업 ${g.workDays}일` : ''}, 이월 ${g.carryIn}대)`, { span: 7, bg: '#fef3c7', bold: true }),
        c(String(g.secured), { bg: '#fef3c7', bold: true }), c(String(g.add), { bg: '#fef3c7', bold: true }), gb, c('-', { bg: '#fef3c7' })])
    }
    const fb: C = result.finalShort > 0
      ? { t: `최종 부족 ${result.finalShort}대`, bg: '#e2e8f0', fg: '#dc2626', bold: true, align: 'center' }
      : { t: '부족 없음', bg: '#e2e8f0', fg: '#059669', bold: true, align: 'center' }
    rows.push([c('전체 합계 (확보/추가) · 최종 잔량', { span: 7, bg: '#e2e8f0', bold: true }),
      c(String(result.totalSecured), { bg: '#e2e8f0', bold: true }), c(String(result.totalAdd), { bg: '#e2e8f0', bold: true }), fb, c('-', { bg: '#e2e8f0' })])

    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const widths = [150, 70, 70, 90, 90, 60, 130, 70, 100, 100, 150]
    const html = '<table style="border-collapse:collapse;font-family:Malgun Gothic,sans-serif;font-size:11pt">'
      + '<colgroup>' + widths.map(w => `<col width="${w}">`).join('') + '</colgroup>'
      + rows.map(r => '<tr>' + r.map(x =>
        `<td${x.span ? ` colspan="${x.span}"` : ''} style="border:1px solid #000;padding:3px 6px;text-align:${x.align || 'left'};`
        + `${x.bg ? `background:${x.bg};` : ''}${x.fg ? `color:${x.fg};` : ''}${x.bold ? 'font-weight:bold;' : ''}">${esc(x.t)}</td>`).join('') + '</tr>').join('')
      + '</table>'
    // 텍스트판: 병합된 칸 뒤는 빈 칸으로 채워 11열을 항상 맞춘다
    const text = rows.map(r => r.flatMap(x => [x.t, ...Array((x.span || 1) - 1).fill('')]).slice(0, NCOL).join('\t')).join('\n')

    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })])
    } catch {
      await navigator.clipboard.writeText(text)   // HTML 복사를 막는 환경이면 텍스트만
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="border border-slate-200 rounded-lg bg-white mb-2 flex-shrink-0">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-t-lg">
        <button type="button" onClick={toggleOpen} className="text-sm font-bold text-slate-700">
          {open ? '▼' : '▶'} 선복 확인 <span className="font-normal text-slate-400 text-xs">(미선적 현황 연동)</span>
        </button>
        <span className="text-xs text-slate-400 ml-2">
          {data ? `기준 ${data.today}${data.built_at ? ' · 집계 ' + data.built_at.replace('_', ' ') : ''}` : loading ? '불러오는 중…' : ''}
        </span>
        <div className="ml-auto text-xs text-slate-500">
          선택 모선 <b className="text-indigo-600">{picked.length}</b>건
          <button type="button" onClick={load} className="ml-2 px-2 py-1 border border-slate-300 rounded hover:bg-white">새로고침</button>
        </div>
      </div>

      {open && (
        <div className="p-3 space-y-3 max-h-[58vh] overflow-auto">
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</div>}

          {data && grid && (
            <div>
              <div className="text-xs font-bold text-slate-700 mb-1">
                ① 미선적 현황에서 합산할 칸 선택 <span className="font-normal text-slate-400">— PDC×선사 칸을 체크하면 현재 잔량이 합산됩니다 (행/열 머리의 체크는 전체 선택)</span>
              </div>
              <div className="overflow-auto border border-slate-200 rounded max-h-64">
                <table className="text-xs border-collapse">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">PDC</th>
                      {grid.carriers.map(c => {
                        const keys = grid.pdcs.filter(p => grid.has(p, c)).map(p => cellKey(p, c))
                        return (
                          <th key={c} className="px-2 py-1 text-center">
                            <label className="inline-flex items-center gap-1 cursor-pointer">
                              <input type="checkbox" checked={keys.length > 0 && keys.every(k => cells.has(k))} onChange={() => toggleMany(keys)} />{c}
                            </label>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.pdcs.map(p => {
                      const rowKeys = grid.carriers.filter(c => grid.has(p, c)).map(c => cellKey(p, c))
                      return (
                        <tr key={p} className="border-t border-slate-100">
                          <td className="px-2 py-1 whitespace-nowrap">
                            <label className="inline-flex items-center gap-1 cursor-pointer font-medium">
                              <input type="checkbox" checked={rowKeys.length > 0 && rowKeys.every(k => cells.has(k))} onChange={() => toggleMany(rowKeys)} />{p}
                            </label>
                          </td>
                          {grid.carriers.map(c => {
                            const k = cellKey(p, c)
                            if (!grid.has(p, c)) return <td key={c} className="px-2 text-center text-slate-300">-</td>
                            const on = cells.has(k)
                            return (
                              <td key={c} className={`px-2 py-1 text-center cursor-pointer ${on ? 'bg-indigo-100' : 'hover:bg-slate-50'}`} onClick={() => toggleCell(p, c)}>
                                <input type="checkbox" checked={on} onChange={() => toggleCell(p, c)} onClick={e => e.stopPropagation()} />{' '}
                                <b>{data.current[p]?.[c] || 0}</b>
                                {(data.rate[p]?.[c] || 0) > 0 && <span className="text-purple-600 ml-1">+{fmt1(data.rate[p][c])}/일</span>}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs">
                <span>선택 칸 <b>{validCells.size}</b>개 → 초기 잔량 <b className="text-indigo-700 text-sm">{sums?.initial ?? 0}</b>대</span>
                <span className="text-slate-500">예상 출하 기준:</span>
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={mode === 'pdc'} onChange={() => { setMode('pdc'); persist('capMode', 'pdc') }} />
                  선택한 PDC 전체(모든 선사)
                </label>
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={mode === 'cells'} onChange={() => { setMode('cells'); persist('capMode', 'cells') }} />
                  선택한 칸만
                </label>
                <span className="text-purple-700">하루 예상 출하 <b>{fmt1(sums?.perDay ?? 0)}</b>대 (영업일 기준)</span>
                {validCells.size > 0 && (
                  <button type="button" className="px-2 py-0.5 border border-slate-300 rounded hover:bg-slate-50" onClick={() => setCellsP(() => new Set())}>선택 해제</button>
                )}
              </div>
            </div>
          )}

          {data && (
            <div>
              <div className="text-xs font-bold text-slate-700 mb-1">
                ② 결과표 <span className="font-normal text-slate-400">— 아래 부킹 표에서 모선(행)의 체크박스를 선택하세요 (여러 개 가능)</span>
                {result && <button type="button" onClick={copyTable} className="ml-3 px-2 py-0.5 border border-slate-300 rounded hover:bg-slate-50 font-normal">{copied ? '복사됨 ✓' : '표 복사 (엑셀/워드 붙여넣기용)'}</button>}
              </div>

              {picked.length === 0 && (
                <div className="text-xs text-slate-400 border border-dashed border-slate-300 rounded px-3 py-4 text-center">
                  선택된 모선이 없습니다. 아래 표 왼쪽 체크박스로 계산할 모선을 골라 주세요.
                </div>
              )}
              {picked.length > 0 && validCells.size === 0 && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1.5 mb-1">
                  ①에서 합산할 PDC×선사 칸을 먼저 선택하세요. (지금은 초기 잔량 0으로 계산됩니다)
                </div>
              )}
              {result && (
                <>
                  {result.noCutoff.length > 0 && (
                    <div className="text-xs text-amber-700 mb-1">서류마감일이 비어 있어 제외: {result.noCutoff.map(b => b.vessel_name || b.booking_no).join(', ')}</div>
                  )}
                  {result.past.length > 0 && (
                    <div className="text-xs text-slate-500 mb-1">마감 완료/서류마감 지남으로 제외: {result.past.map(b => `${b.vessel_name}(${md(b.doc_cutoff_date)})`).join(', ')}</div>
                  )}
                  <div className="overflow-auto border border-slate-200 rounded">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-[#2f5597] text-white">
                        <tr>
                          {['모선명', 'VOYAGE', '서류마감', 'PROFORMA ETD', 'UPDATED ETD', 'ETA', '컨테이너', '확보수량', '추가(누적발생)', '잔량', '부킹번호'].map(h => (
                            <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-slate-100 font-bold text-center">
                          <td colSpan={7}>초기 잔량 <span className="font-normal text-slate-500">(선택한 PDC×선사의 현재 마감 안 친 컨테이너 합)</span></td>
                          <td>-</td><td>-</td><td>{result.initial}</td><td>-</td>
                        </tr>
                        {result.groups.map(g => <GroupRows key={g.cutoff} g={g} qty={qty} setQty={setQty} />)}
                        <tr className="bg-slate-200 font-bold text-center">
                          <td colSpan={7}>전체 합계 (확보/추가) · 최종 잔량</td>
                          <td>{result.totalSecured}</td>
                          <td>{result.totalAdd}</td>
                          <td className={result.finalShort > 0 ? 'text-red-600' : 'text-emerald-600'}>
                            {result.finalShort > 0 ? `최종 부족 ${result.finalShort}대` : '부족 없음'}
                          </td>
                          <td>-</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    잔량 = 이월 + 추가 − 확보 (부족만 다음 모선으로 이월). 서류마감 이후에 발생하는 출하는 그 모선에 싣지 못하고 다음 모선 구간으로 넘어갑니다.
                    추가 = 하루 예상 출하 × 구간 영업일. 확보수량은 직접 고칠 수 있습니다.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
