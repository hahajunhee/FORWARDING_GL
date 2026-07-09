'use client'

import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { format, parseISO, isValid, differenceInCalendarDays } from 'date-fns'
import type { Booking, ShanghaiMgmtRow } from '@/types'
import { calcTotalQty } from './BookingTable'
import { saveShanghaiMgmt } from '@/app/bookings/actions'

const TITLE = '▶ 모비스 AS) MPA 주요 PDC 스케줄 현황 보고'

// ── 날짜 헬퍼 ─────────────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, '0')

// 다양한 입력 → {mm,dd}
function parseMMDD(raw: string): { mm: number; dd: number } | null {
  if (!raw) return null
  const s = raw.trim()
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return { mm: +iso[2], dd: +iso[3] }
  const k = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/)
  if (k) return { mm: +k[1], dd: +k[2] }
  const sep = s.match(/^(\d{1,2})[./-](\d{1,2})$/)
  if (sep) return { mm: +sep[1], dd: +sep[2] }
  const digits = s.replace(/\D/g, '')
  if (digits.length === 8) return { mm: +digits.slice(4, 6), dd: +digits.slice(6, 8) } // YYYYMMDD
  if (digits.length === 4) return { mm: +digits.slice(0, 2), dd: +digits.slice(2, 4) } // MMDD
  if (digits.length === 3) return { mm: +digits.slice(0, 1), dd: +digits.slice(1, 3) } // MDD
  return null
}
function validMMDD(p: { mm: number; dd: number } | null): p is { mm: number; dd: number } {
  return !!p && p.mm >= 1 && p.mm <= 12 && p.dd >= 1 && p.dd <= 31
}
// 날짜면 "MM월 DD일", 아니면 원문 유지(예: "상해 SKIP")
function normalizeKDate(raw: string): string {
  const p = parseMMDD(raw)
  return validMMDD(p) ? `${pad2(p.mm)}월 ${pad2(p.dd)}일` : raw.trim()
}
function kToDate(raw: string): Date | null {
  const p = parseMMDD(raw)
  if (!validMMDD(p)) return null
  return new Date(new Date().getFullYear(), p.mm - 1, p.dd)
}
function kToISO(raw: string): string {
  const p = parseMMDD(raw)
  if (!validMMDD(p)) return ''
  return `${new Date().getFullYear()}-${pad2(p.mm)}-${pad2(p.dd)}`
}
function diffDaysK(fStr: string, gStr: string): number | null {
  const f = kToDate(fStr), g = kToDate(gStr)
  if (!f || !g) return null
  return Math.round((g.getTime() - f.getTime()) / 86400000)
}
function busanDelay(b?: Booking): number | null {
  if (!b?.proforma_etd || !b?.updated_etd) return null
  const a = parseISO(b.proforma_etd), c = parseISO(b.updated_etd)
  if (!isValid(a) || !isValid(c)) return null
  return differenceInCalendarDays(c, a)
}
function toExcelDate(d: string | null | undefined): Date | string {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? p : '' } catch { return '' }
}

type LocalRow = {
  key: string
  booking_seq_no: number | null
  first_departure: string   // F
  current_departure: string // G
  berthing: string          // K (접안일 수동)
}

// 수동 편집 열 순서 (엑셀형 이동/붙여넣기 기준)
const EDITABLE: (keyof Omit<LocalRow, 'key' | 'booking_seq_no'>)[] = ['first_departure', 'current_departure', 'berthing']

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
      berthing: r.berthing || '',
    }))
  )
  const [input, setInput] = useState('')
  const [notFound, setNotFound] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  // 엑셀형 셀 이동용 ref 맵
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const focusCell = (rowIdx: number, col: string) => {
    requestAnimationFrame(() => {
      const el = inputRefs.current[`${rowIdx}:${col}`]
      if (el) { el.focus(); el.select() }
    })
  }
  const handleNav = (e: React.KeyboardEvent, rowIdx: number, col: string) => {
    const cIdx = EDITABLE.indexOf(col as typeof EDITABLE[number])
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault(); focusCell(Math.min(rowIdx + 1, rows.length - 1), col)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); focusCell(Math.max(rowIdx - 1, 0), col)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        if (cIdx > 0) focusCell(rowIdx, EDITABLE[cIdx - 1])
        else if (rowIdx > 0) focusCell(rowIdx - 1, EDITABLE[EDITABLE.length - 1])
      } else {
        if (cIdx < EDITABLE.length - 1) focusCell(rowIdx, EDITABLE[cIdx + 1])
        else if (rowIdx < rows.length - 1) focusCell(rowIdx + 1, EDITABLE[0])
      }
    }
  }
  // 엑셀에서 복사한 값 붙여넣기 (여러 행/열 채우기)
  const handleCellPaste = (e: React.ClipboardEvent, rowIdx: number, col: string) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const lines = text.replace(/\r/g, '').split('\n')
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    if (lines.length === 1 && !lines[0].includes('\t')) return // 단일 값은 기본 붙여넣기 허용
    e.preventDefault()
    const startC = EDITABLE.indexOf(col as typeof EDITABLE[number])
    setRows(prev => {
      const next = prev.map(r => ({ ...r }))
      lines.forEach((line, ri) => {
        line.split('\t').forEach((val, ci) => {
          const tr = rowIdx + ri
          const tc = EDITABLE[startC + ci]
          if (tr < next.length && tc) next[tr][tc] = normalizeKDate(val)
        })
      })
      return next
    })
  }

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
      if (existing.has(n)) continue
      existing.add(n)
      additions.push({ key: nextKey(), booking_seq_no: n, first_departure: '', current_departure: '', berthing: '' })
    }
    if (additions.length > 0) setRows(prev => [...prev, ...additions])
    setNotFound(missing)
    setInput('')
  }
  const addBlankRow = () => setRows(prev => [...prev, { key: nextKey(), booking_seq_no: null, first_departure: '', current_departure: '', berthing: '' }])
  const updateRow = (key: string, field: keyof Omit<LocalRow, 'key' | 'booking_seq_no'>, value: string) =>
    setRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r))
  const removeRow = (key: string) => setRows(prev => prev.filter(r => r.key !== key))
  const moveRow = (idx: number, dir: -1 | 1) => setRows(prev => {
    const next = [...prev]; const j = idx + dir
    if (j < 0 || j >= next.length) return prev
    ;[next[idx], next[j]] = [next[j], next[idx]]
    return next
  })

  const handleSave = () => {
    setSaveError(null)
    startTransition(async () => {
      setSaveState('saving')
      const result = await saveShanghaiMgmt(rows.map(r => ({
        booking_seq_no: r.booking_seq_no,
        first_departure: r.first_departure,
        current_departure: r.current_departure,
        berthing: r.berthing,
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

      const groupRow = ['법인', '법인/대리점', '도착지', '선사', '선명',
        '상해 / 닝보(PUS 직전 PORT 기준)', '', '', '부산', '', '', '', '', '',
        'MQC (/WK)', '확보 선복', '실 매김 물량']
      const subRow = ['', '', '', '', '', '최초 출항일', '현재 출항일', '지연일',
        '부산출항(최초)', '부산출항(현재 ETD)', '접안일', '지연일', '서류마감', 'P.O.D ETA', '', '', '']
      const titleRow = [TITLE, ...Array(16).fill('')]

      const delayNums: { h: number | null; l: number | null }[] = []
      const dataRows = rows.map(r => {
        const b = r.booking_seq_no != null ? bySeq.get(r.booking_seq_no) : undefined
        const h = diffDaysK(r.first_departure, r.current_departure)
        const l = busanDelay(b)
        delayNums.push({ h, l })
        return [
          'MPA', 'MPA',
          b?.final_destination || '', b?.carrier || '', b?.vessel_name || '',
          r.first_departure, r.current_departure, h ?? '',
          toExcelDate(b?.proforma_etd), toExcelDate(b?.updated_etd), r.berthing,
          l ?? '',
          toExcelDate(b?.doc_cutoff_date), toExcelDate(b?.eta),
          b?.mqc || '', b?.secured_space || '', b ? (calcTotalQty(b) || '') : '',
        ]
      })

      const aoa = [titleRow, groupRow, subRow, ...dataRows]
      const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })

      const thin = { style: 'thin', color: { rgb: 'B0B0B0' } }
      const border = { top: thin, bottom: thin, left: thin, right: thin }
      const mk = (bg: string, fg: string) => ({
        font: { bold: true, color: { rgb: fg }, sz: 10, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border,
      })
      const navyHeader = mk('1F4E79', 'FFFFFF')
      const orangeHeader = mk('ED7D31', 'FFFFFF')
      const groupShanghai = mk('F8CBAD', '833C00')
      const groupBusan = mk('FFE699', '7F6000')
      const titleStyle = { font: { bold: true, sz: 13, color: { rgb: '1F4E79' }, name: '맑은 고딕' }, alignment: { horizontal: 'left', vertical: 'center' } }
      const dataBase = (opts: { delay?: boolean; date?: boolean } = {}) => ({
        font: { sz: 10, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: opts.delay ? 'FFF2CC' : 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center' }, border,
        ...(opts.date ? { numFmt: 'mm"월" dd"일"' } : {}),
      })

      const orangeCols = new Set([14, 15, 16])
      for (let c = 0; c <= 16; c++) {
        const gAddr = XLSX.utils.encode_cell({ r: 1, c })
        const sAddr = XLSX.utils.encode_cell({ r: 2, c })
        if (ws[gAddr]) ws[gAddr].s = (c >= 5 && c <= 7) ? groupShanghai : (c >= 8 && c <= 13) ? groupBusan : orangeCols.has(c) ? orangeHeader : navyHeader
        if (ws[sAddr]) ws[sAddr].s = navyHeader
      }
      const tAddr = XLSX.utils.encode_cell({ r: 0, c: 0 })
      if (ws[tAddr]) ws[tAddr].s = titleStyle

      for (let ri = 0; ri < N; ri++) {
        const { h, l } = delayNums[ri]
        for (let c = 0; c <= 16; c++) {
          const addr = XLSX.utils.encode_cell({ r: ri + 3, c })
          if (!ws[addr]) ws[addr] = { t: 's', v: '' }
          const isDate = [8, 9, 12, 13].includes(c)
          const delayCell = (c === 7 && (h ?? 0) > 0) || (c === 11 && (l ?? 0) > 0)
          ws[addr].s = dataBase({ delay: delayCell, date: isDate })
        }
      }

      const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 16 } },
        { s: { r: 1, c: 5 }, e: { r: 1, c: 7 } },
        { s: { r: 1, c: 8 }, e: { r: 1, c: 13 } },
      ]
      for (const c of [0, 1, 2, 3, 4, 14, 15, 16]) merges.push({ s: { r: 1, c }, e: { r: 2, c } })
      if (N > 1) merges.push({ s: { r: 3, c: 0 }, e: { r: 3 + N - 1, c: 0 } })
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
      ws['!cols'] = [6, 10, 16, 12, 18, 11, 11, 7, 12, 14, 12, 7, 11, 11, 9, 9, 11].map(w => ({ wch: w }))
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

  return (
    <div className="space-y-4">
      {/* 작성방법 안내 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-bold text-blue-900">📌 작성방법</h3>
        <p className="text-xs text-blue-800">상해 / 닝보의 <b>최초·현재 출항일</b>과 <b>접안 터미널</b>은 아래 사이트에서 조회하세요.</p>
        <ul className="text-xs space-y-1 text-blue-800">
          <li>· 상해 스케줄 / 접안터미널 조회: <a href="https://www.fob001.cn/guestbook/cbxx.php" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium break-all">www.fob001.cn/guestbook/cbxx.php</a></li>
          <li>· 닝보 스케줄 / 접안터미널 조회: <a href="https://www.fob001.cn/nb/indexnbvsl.php" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium break-all">www.fob001.cn/nb/indexnbvsl.php</a></li>
        </ul>
        <p className="text-[11px] text-blue-700/80 leading-relaxed">
          · 날짜 셀은 <b>0807</b>처럼 입력하면 <b>08월 07일</b>로 자동 변환됩니다 (📅 아이콘으로 달력 선택도 가능).
          · <b>지연일</b>은 자동 계산됩니다 — 상해=현재출항일−최초출항일, 부산=부산출항(현재 ETD)−부산출항(최초).
          · <b>Enter/Tab/방향키</b>로 셀 이동, 엑셀에서 복사한 값 <b>붙여넣기(Ctrl+V)</b> 지원.
        </p>
      </div>

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
            <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium whitespace-nowrap">추가</button>
            <button onClick={addBlankRow} className="px-4 py-1 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200 transition-colors whitespace-nowrap">빈 행</button>
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
                  <th className={`${th} bg-[#7F3E0C]`}>지연일<br /><span className="text-[9px] font-normal opacity-80">자동</span></th>
                  <th className={`${th} ${thNavy}`}>부산출항<br />(최초)</th>
                  <th className={`${th} ${thNavy}`}>부산출항<br />(현재 ETD)</th>
                  <th className={`${th} ${thNavy}`}>접안일</th>
                  <th className={`${th} bg-[#7F3E0C]`}>지연일<br /><span className="text-[9px] font-normal opacity-80">자동</span></th>
                  <th className={`${th} ${thNavy}`}>서류마감</th>
                  <th className={`${th} ${thNavy}`}>P.O.D<br />ETA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const b = r.booking_seq_no != null ? bySeq.get(r.booking_seq_no) : undefined
                  const missing = r.booking_seq_no != null && !b
                  const hDelay = diffDaysK(r.first_departure, r.current_departure)
                  const lDelay = busanDelay(b)
                  const dash = <span className="text-gray-300">-</span>
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
                      <td className={`${td} text-gray-800`}>{b?.final_destination || dash}</td>
                      <td className={`${td} text-gray-700`}>{b?.carrier || dash}</td>
                      <td className={`${td} text-gray-700`}>{b?.vessel_name || dash}</td>
                      {/* F 최초출항일 (수동 날짜) */}
                      <td className="px-1 py-1 border border-gray-200">
                        <DateCell value={r.first_departure} onCommit={v => updateRow(r.key, 'first_departure', v)}
                          onNav={e => handleNav(e, idx, 'first_departure')} onPaste={e => handleCellPaste(e, idx, 'first_departure')}
                          refCb={el => { inputRefs.current[`${idx}:first_departure`] = el }} />
                      </td>
                      {/* G 현재출항일 (수동 날짜) */}
                      <td className="px-1 py-1 border border-gray-200">
                        <DateCell value={r.current_departure} onCommit={v => updateRow(r.key, 'current_departure', v)}
                          onNav={e => handleNav(e, idx, 'current_departure')} onPaste={e => handleCellPaste(e, idx, 'current_departure')}
                          refCb={el => { inputRefs.current[`${idx}:current_departure`] = el }} />
                      </td>
                      {/* H 지연일 (자동) */}
                      <td className={`${td} font-semibold ${(hDelay ?? 0) > 0 ? 'bg-amber-50 text-amber-700' : 'text-gray-500'}`}>{hDelay == null ? dash : hDelay}</td>
                      {/* I,J 자동 날짜 */}
                      <td className={`${td} text-gray-700`}>{fmtCell(b?.proforma_etd) || dash}</td>
                      <td className={`${td} text-gray-700`}>{fmtCell(b?.updated_etd) || dash}</td>
                      {/* K 접안일 (수동 날짜) */}
                      <td className="px-1 py-1 border border-gray-200">
                        <DateCell value={r.berthing} onCommit={v => updateRow(r.key, 'berthing', v)}
                          onNav={e => handleNav(e, idx, 'berthing')} onPaste={e => handleCellPaste(e, idx, 'berthing')}
                          refCb={el => { inputRefs.current[`${idx}:berthing`] = el }} />
                      </td>
                      {/* L 지연일 (자동) */}
                      <td className={`${td} font-semibold ${(lDelay ?? 0) > 0 ? 'bg-amber-50 text-amber-700' : 'text-gray-500'}`}>{lDelay == null ? dash : lDelay}</td>
                      {/* M,N 자동 날짜 */}
                      <td className={`${td} text-gray-700`}>{fmtCell(b?.doc_cutoff_date) || dash}</td>
                      <td className={`${td} text-gray-700`}>{fmtCell(b?.eta) || dash}</td>
                      {/* O,P,Q 자동 */}
                      <td className={`${td} text-gray-700`}>{b?.mqc || dash}</td>
                      <td className={`${td} text-gray-700`}>{b?.secured_space || dash}</td>
                      <td className={`${td} font-semibold text-blue-700`}>{b ? (calcTotalQty(b) || dash) : dash}</td>
                      {/* 삭제 */}
                      <td className={td}><button onClick={() => removeRow(r.key)} className="text-gray-300 hover:text-red-500 transition-colors">✕</button></td>
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

// 자동 날짜 셀 표시 (MM월 DD일)
function fmtCell(d: string | null | undefined): string {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? format(p, "MM'월' dd'일'") : '' } catch { return '' }
}

// ── 날짜 셀 (캘린더 + 0807 빠른입력 + 자유입력) — 모듈 스코프로 remount 방지 ──
function DateCell({ value, onCommit, onNav, onPaste, refCb }: {
  value: string
  onCommit: (v: string) => void
  onNav: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent) => void
  refCb: (el: HTMLInputElement | null) => void
}) {
  const [local, setLocal] = useState(value)
  const dateRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setLocal(value) }, [value])
  const commit = () => { const n = normalizeKDate(local); if (n !== local) setLocal(n); if (n !== value) onCommit(n) }
  return (
    <div className="flex items-center gap-0.5 relative">
      <input ref={refCb} value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); onNav(e) }}
        onPaste={onPaste}
        placeholder="MM월 DD일"
        className="w-[76px] border border-gray-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
      <button type="button" tabIndex={-1} onMouseDown={e => e.preventDefault()}
        onClick={() => { const el = dateRef.current; if (el) { if (el.showPicker) { try { el.showPicker() } catch { el.click() } } else el.click() } }}
        className="text-gray-300 hover:text-blue-500 text-xs leading-none" title="달력에서 선택">📅</button>
      <input ref={dateRef} type="date" tabIndex={-1} value={kToISO(local)}
        onChange={e => { if (e.target.value) { const n = normalizeKDate(e.target.value); setLocal(n); onCommit(n) } }}
        className="absolute right-0 bottom-0 w-4 h-4 opacity-0 pointer-events-none" />
    </div>
  )
}
