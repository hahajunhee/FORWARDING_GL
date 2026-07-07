'use client'

import { useState, useMemo, useRef, useTransition } from 'react'
import { format, parseISO, isValid } from 'date-fns'
import type { Booking, ShanghaiMgmtRow } from '@/types'
import { calcTotalQty } from './BookingTable'
import { saveShanghaiMgmt } from '@/app/bookings/actions'

const TITLE = '▶ 모비스 AS) MPA 주요 PDC 스케줄 현황 보고'

// 화면 표시용 한글 날짜 (MM월 DD일)
function fmtK(d: string | null | undefined): string {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? format(p, "MM'월' dd'일'") : '' } catch { return '' }
}
// Excel용 Date 객체 (없으면 '')
function toDate(d: string | null | undefined): Date | string {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? p : '' } catch { return '' }
}
// 지연일 강조용 — 숫자로 파싱해 양수면 true
function isDelay(v: string): boolean {
  const n = parseFloat((v || '').replace(/[^\d.-]/g, ''))
  return !isNaN(n) && n > 0
}

type LocalRow = {
  key: string
  booking_seq_no: number | null
  first_departure: string
  current_departure: string
  delay_shanghai: string
  delay_busan: string
}

interface Props {
  bookings: Booking[]
  initialRows: ShanghaiMgmtRow[]
}

export default function ShanghaiMgmtTab({ bookings, initialRows }: Props) {
  const bySeq = useMemo(() => {
    const m = new Map<number, Booking>()
    for (const b of bookings) if (b.seq_no != null) m.set(b.seq_no, b)
    return m
  }, [bookings])

  const keyCounter = useRef(0)
  const nextKey = () => `r${keyCounter.current++}`

  const [rows, setRows] = useState<LocalRow[]>(() =>
    initialRows.map(r => ({
      key: r.id,
      booking_seq_no: r.booking_seq_no,
      first_departure: r.first_departure || '',
      current_departure: r.current_departure || '',
      delay_shanghai: r.delay_shanghai || '',
      delay_busan: r.delay_busan || '',
    }))
  )
  const [input, setInput] = useState('')
  const [notFound, setNotFound] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  // 고유번호 입력 → 행 추가
  const handleAdd = () => {
    const tokens = input.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
    if (tokens.length === 0) return
    const existing = new Set(rows.map(r => r.booking_seq_no).filter(v => v != null) as number[])
    const additions: LocalRow[] = []
    const missing: string[] = []
    for (const t of tokens) {
      const n = parseInt(t, 10)
      if (isNaN(n) || !bySeq.has(n)) { missing.push(t); continue }
      if (existing.has(n)) continue // 이미 추가됨
      existing.add(n)
      additions.push({ key: nextKey(), booking_seq_no: n, first_departure: '', current_departure: '', delay_shanghai: '', delay_busan: '' })
    }
    if (additions.length > 0) setRows(prev => [...prev, ...additions])
    setNotFound(missing)
    setInput('')
  }

  const addBlankRow = () => {
    setRows(prev => [...prev, { key: nextKey(), booking_seq_no: null, first_departure: '', current_departure: '', delay_shanghai: '', delay_busan: '' }])
  }

  const updateRow = (key: string, field: keyof Omit<LocalRow, 'key' | 'booking_seq_no'>, value: string) => {
    setRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r))
  }
  const removeRow = (key: string) => setRows(prev => prev.filter(r => r.key !== key))
  const moveRow = (idx: number, dir: -1 | 1) => {
    setRows(prev => {
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  const handleSave = () => {
    setSaveError(null)
    startTransition(async () => {
      setSaveState('saving')
      const result = await saveShanghaiMgmt(rows.map(r => ({
        booking_seq_no: r.booking_seq_no,
        first_departure: r.first_departure,
        current_departure: r.current_departure,
        delay_shanghai: r.delay_shanghai,
        delay_busan: r.delay_busan,
      })))
      if (result.error) { setSaveError(result.error); setSaveState('error') }
      else { setSaveState('saved'); setTimeout(() => setSaveState('idle'), 3000) }
    })
  }

  // ── Excel 다운로드 (캡처 레이아웃 재현) ──────────────────────────
  const exportExcel = () => {
    import('xlsx-js-style').then((mod) => {
      const XLSX = (mod as unknown as { default: typeof import('xlsx-js-style') }).default ?? mod
      const N = rows.length

      // 헤더 행
      const groupRow = [
        '법인', '법인/대리점', '도착지', '선사', '선명',
        '상해 / 닝보(PUS 직전 PORT 기준)', '', '',
        '부산', '', '', '', '', '',
        'MQC (/WK)', '확보 선복', '실 매김 물량',
      ]
      const subRow = [
        '', '', '', '', '',
        '최초 출항일', '현재 출항일', '지연일',
        '부산출항(최초)', '부산출항(현재 ETD)', '접안일', '지연일', '서류마감', 'P.O.D ETA',
        '', '', '',
      ]
      const titleRow = [TITLE, ...Array(16).fill('')]

      // 데이터 행
      const dataRows = rows.map(r => {
        const b = r.booking_seq_no != null ? bySeq.get(r.booking_seq_no) : undefined
        return [
          'MPA', 'MPA',
          b?.final_destination || '', b?.carrier || '', b?.vessel_name || '',
          r.first_departure, r.current_departure, r.delay_shanghai,
          toDate(b?.proforma_etd), toDate(b?.updated_etd), toDate(b?.updated_etd_prev),
          r.delay_busan,
          toDate(b?.doc_cutoff_date), toDate(b?.eta),
          b?.mqc || '', b?.secured_space || '',
          b ? (calcTotalQty(b) || '') : '',
        ]
      })

      const aoa = [titleRow, groupRow, subRow, ...dataRows]
      const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })

      // ── 스타일 정의 ──
      const thin = { style: 'thin', color: { rgb: 'B0B0B0' } }
      const border = { top: thin, bottom: thin, left: thin, right: thin }
      const navyHeader = {
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: '1F4E79' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border,
      }
      const orangeHeader = {
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: 'ED7D31' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border,
      }
      const groupShanghai = {
        font: { bold: true, color: { rgb: '833C00' }, sz: 10, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: 'F8CBAD' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border,
      }
      const groupBusan = {
        font: { bold: true, color: { rgb: '7F6000' }, sz: 10, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: 'FFE699' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border,
      }
      const titleStyle = {
        font: { bold: true, sz: 13, color: { rgb: '1F4E79' }, name: '맑은 고딕' },
        alignment: { horizontal: 'left', vertical: 'center' },
      }
      const dataBase = (opts: { delay?: boolean; date?: boolean } = {}) => ({
        font: { sz: 10, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: opts.delay ? 'FFF2CC' : 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border,
        ...(opts.date ? { numFmt: 'mm"월" dd"일"' } : {}),
      })

      // 헤더 스타일 적용 (그룹행=row1, 서브행=row2)
      const orangeCols = new Set([14, 15, 16])
      for (let c = 0; c <= 16; c++) {
        const gAddr = XLSX.utils.encode_cell({ r: 1, c })
        const sAddr = XLSX.utils.encode_cell({ r: 2, c })
        if (ws[gAddr]) {
          ws[gAddr].s = c === 5 || c === 6 || c === 7 ? groupShanghai
            : c >= 8 && c <= 13 ? groupBusan
            : orangeCols.has(c) ? orangeHeader
            : navyHeader
        }
        if (ws[sAddr]) ws[sAddr].s = navyHeader
      }
      const tAddr = XLSX.utils.encode_cell({ r: 0, c: 0 })
      if (ws[tAddr]) ws[tAddr].s = titleStyle

      // 데이터 셀 스타일
      for (let ri = 0; ri < N; ri++) {
        const r = rows[ri]
        for (let c = 0; c <= 16; c++) {
          const addr = XLSX.utils.encode_cell({ r: ri + 3, c })
          if (!ws[addr]) ws[addr] = { t: 's', v: '' }
          const isDate = [8, 9, 10, 12, 13].includes(c)
          const delayCell = (c === 7 && isDelay(r.delay_shanghai)) || (c === 11 && isDelay(r.delay_busan))
          ws[addr].s = dataBase({ delay: delayCell, date: isDate })
        }
      }

      // ── 병합 ──
      const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 16 } },        // 타이틀
        { s: { r: 1, c: 5 }, e: { r: 1, c: 7 } },          // 상해/닝보 그룹
        { s: { r: 1, c: 8 }, e: { r: 1, c: 13 } },         // 부산 그룹
      ]
      for (const c of [0, 1, 2, 3, 4, 14, 15, 16]) merges.push({ s: { r: 1, c }, e: { r: 2, c } }) // 세로 병합 헤더
      if (N > 1) merges.push({ s: { r: 3, c: 0 }, e: { r: 3 + N - 1, c: 0 } }) // 법인(A) 전체 병합
      // 도착지(C=2), 선사(D=3) 연속 동일값 세로 병합
      for (const c of [2, 3]) {
        let i = 0
        while (i < N) {
          const b = rows[i].booking_seq_no != null ? bySeq.get(rows[i].booking_seq_no!) : undefined
          const v = c === 2 ? (b?.final_destination || '') : (b?.carrier || '')
          if (!v) { i++; continue }
          let j = i + 1
          while (j < N) {
            const bj = rows[j].booking_seq_no != null ? bySeq.get(rows[j].booking_seq_no!) : undefined
            const vj = c === 2 ? (bj?.final_destination || '') : (bj?.carrier || '')
            if (vj !== v) break
            j++
          }
          if (j - i > 1) merges.push({ s: { r: i + 3, c }, e: { r: j - 1 + 3, c } })
          i = j
        }
      }
      ws['!merges'] = merges

      // 열 너비
      ws['!cols'] = [6, 10, 16, 12, 18, 11, 11, 7, 12, 14, 12, 7, 11, 11, 9, 9, 11].map(w => ({ wch: w }))
      // 행 높이 (타이틀·그룹·서브)
      ws['!rows'] = [{ hpt: 26 }, { hpt: 18 }, { hpt: 30 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '상해발관리')
      XLSX.writeFile(wb, `상해발관리_${format(new Date(), 'yyyyMMdd')}.xlsx`, { cellStyles: true })
    })
  }

  // ── 렌더 ──────────────────────────────────────────────────────
  const th = 'px-2 py-1.5 font-bold text-white border border-blue-800/40 whitespace-nowrap text-center align-middle'
  const thNavy = 'bg-[#1F4E79]'
  const thOrange = 'bg-[#ED7D31]'
  const td = 'px-2 py-1 border border-gray-200 text-xs text-center align-middle whitespace-nowrap'
  const editInput = 'w-full min-w-[64px] border border-gray-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'

  return (
    <div className="space-y-4">
      {/* 고유번호 입력 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1 font-medium">고유번호 입력 (집중관리 대상 추가)</label>
          <p className="text-xs text-gray-400 mb-2">부킹장의 &quot;고유번호&quot; 값을 쉼표·공백·줄바꿈으로 여러 개 입력하세요.</p>
        </div>
        <div className="flex gap-2">
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAdd() }}
            placeholder="예: 12, 15, 23" rows={2}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          <div className="flex flex-col gap-1.5 self-end">
            <button onClick={handleAdd}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium whitespace-nowrap">추가</button>
            <button onClick={addBlankRow}
              className="px-4 py-1 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200 transition-colors whitespace-nowrap">빈 행</button>
          </div>
        </div>
        {notFound.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
            <p className="text-xs text-yellow-700">고유번호를 찾을 수 없습니다: <span className="font-mono font-medium">{notFound.join(', ')}</span></p>
          </div>
        )}
      </div>

      {/* 액션 */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={handleSave} disabled={isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
          {saveState === 'saving' ? '저장 중...' : '저장'}
        </button>
        {saveState === 'saved' && <span className="text-xs text-green-600 font-medium">✓ 저장됨</span>}
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        <button onClick={exportExcel} disabled={rows.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Excel 다운로드
        </button>
        <span className="text-xs text-gray-400">{rows.length}건 관리 중</span>
      </div>

      {/* 표 */}
      {rows.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
            <span className="text-sm font-bold text-gray-700">{TITLE}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th rowSpan={2} className={`${th} bg-gray-500`}>고유<br />번호</th>
                  <th rowSpan={2} className={`${th} ${thNavy}`}>법인</th>
                  <th rowSpan={2} className={`${th} ${thNavy}`}>법인/<br />대리점</th>
                  <th rowSpan={2} className={`${th} ${thNavy}`}>도착지</th>
                  <th rowSpan={2} className={`${th} ${thNavy}`}>선사</th>
                  <th rowSpan={2} className={`${th} ${thNavy}`}>선명</th>
                  <th colSpan={3} className={`${th} bg-[#C55A11]`}>상해 / 닝보(PUS 직전 PORT 기준)</th>
                  <th colSpan={6} className={`${th} bg-[#BF9000]`}>부산</th>
                  <th rowSpan={2} className={`${th} ${thOrange}`}>MQC<br />(/WK)</th>
                  <th rowSpan={2} className={`${th} ${thOrange}`}>확보<br />선복</th>
                  <th rowSpan={2} className={`${th} ${thOrange}`}>실 매김<br />물량</th>
                  <th rowSpan={2} className={`${th} bg-gray-400`}>삭제</th>
                </tr>
                <tr>
                  <th className={`${th} ${thNavy}`}>최초<br />출항일</th>
                  <th className={`${th} ${thNavy}`}>현재<br />출항일</th>
                  <th className={`${th} ${thNavy}`}>지연일</th>
                  <th className={`${th} ${thNavy}`}>부산출항<br />(최초)</th>
                  <th className={`${th} ${thNavy}`}>부산출항<br />(현재 ETD)</th>
                  <th className={`${th} ${thNavy}`}>접안일</th>
                  <th className={`${th} ${thNavy}`}>지연일</th>
                  <th className={`${th} ${thNavy}`}>서류마감</th>
                  <th className={`${th} ${thNavy}`}>P.O.D<br />ETA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const b = r.booking_seq_no != null ? bySeq.get(r.booking_seq_no) : undefined
                  const missing = r.booking_seq_no != null && !b
                  return (
                    <tr key={r.key} className="hover:bg-blue-50/30">
                      {/* 고유번호 + 순서 */}
                      <td className={`${td} bg-gray-50`}>
                        <div className="flex items-center justify-center gap-0.5">
                          <div className="flex flex-col leading-none">
                            <button onClick={() => moveRow(idx, -1)} disabled={idx === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-[9px]">▲</button>
                            <button onClick={() => moveRow(idx, 1)} disabled={idx === rows.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-[9px]">▼</button>
                          </div>
                          <span className={`font-mono font-semibold ${missing ? 'text-red-500' : 'text-gray-500'}`}>{r.booking_seq_no ?? '-'}</span>
                        </div>
                        {missing && <span className="block text-[9px] text-red-400">없음</span>}
                      </td>
                      {/* A,B 고정 */}
                      <td className={`${td} font-semibold text-gray-600 bg-slate-50`}>MPA</td>
                      <td className={`${td} font-semibold text-gray-600 bg-slate-50`}>MPA</td>
                      {/* C,D,E 자동 */}
                      <td className={`${td} text-gray-800`}>{b?.final_destination || <span className="text-gray-300">-</span>}</td>
                      <td className={`${td} text-gray-700`}>{b?.carrier || <span className="text-gray-300">-</span>}</td>
                      <td className={`${td} text-gray-700`}>{b?.vessel_name || <span className="text-gray-300">-</span>}</td>
                      {/* F,G,H 수동 */}
                      <td className="px-1 py-1 border border-gray-200"><input value={r.first_departure} onChange={e => updateRow(r.key, 'first_departure', e.target.value)} className={editInput} placeholder="-" /></td>
                      <td className="px-1 py-1 border border-gray-200"><input value={r.current_departure} onChange={e => updateRow(r.key, 'current_departure', e.target.value)} className={editInput} placeholder="-" /></td>
                      <td className={`px-1 py-1 border border-gray-200 ${isDelay(r.delay_shanghai) ? 'bg-amber-50' : ''}`}><input value={r.delay_shanghai} onChange={e => updateRow(r.key, 'delay_shanghai', e.target.value)} className={editInput} placeholder="-" /></td>
                      {/* I,J,K 자동 날짜 */}
                      <td className={`${td} text-gray-700`}>{fmtK(b?.proforma_etd) || <span className="text-gray-300">-</span>}</td>
                      <td className={`${td} text-gray-700`}>{fmtK(b?.updated_etd) || <span className="text-gray-300">-</span>}</td>
                      <td className={`${td} text-gray-700`}>{fmtK(b?.updated_etd_prev) || <span className="text-gray-300">-</span>}</td>
                      {/* L 수동 */}
                      <td className={`px-1 py-1 border border-gray-200 ${isDelay(r.delay_busan) ? 'bg-amber-50' : ''}`}><input value={r.delay_busan} onChange={e => updateRow(r.key, 'delay_busan', e.target.value)} className={editInput} placeholder="-" /></td>
                      {/* M,N 자동 날짜 */}
                      <td className={`${td} text-gray-700`}>{fmtK(b?.doc_cutoff_date) || <span className="text-gray-300">-</span>}</td>
                      <td className={`${td} text-gray-700`}>{fmtK(b?.eta) || <span className="text-gray-300">-</span>}</td>
                      {/* O,P,Q 자동 */}
                      <td className={`${td} text-gray-700`}>{b?.mqc || <span className="text-gray-300">-</span>}</td>
                      <td className={`${td} text-gray-700`}>{b?.secured_space || <span className="text-gray-300">-</span>}</td>
                      <td className={`${td} font-semibold text-blue-700`}>{b ? (calcTotalQty(b) || <span className="text-gray-300">-</span>) : <span className="text-gray-300">-</span>}</td>
                      {/* 삭제 */}
                      <td className={`${td}`}><button onClick={() => removeRow(r.key)} className="text-gray-300 hover:text-red-500 transition-colors">✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400">
          <p className="text-sm">위에서 고유번호를 입력해 집중관리 대상을 추가하세요.</p>
        </div>
      )}
    </div>
  )
}
