'use client'

import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { format, parseISO, isValid, addDays } from 'date-fns'
import type { Booking, Profile, ScheduleDestGroup } from '@/types'
import { saveScheduleDestGroups } from '@/app/bookings/actions'
import { getWeekNum, getWeekStartDate, getWeekLabel } from './BookingTable'
import { saveScheduleBlankWeeks } from '@/app/bookings/actions'

// ── 열 정의 (고객사 송부 양식과 동일 순서) ──────────────────────────
const COLS = [
  { key: 'dest',      label: '도착지',            w: 200 },
  { key: 'carrier',   label: '선사',              w: 90  },
  { key: 'vessel',    label: '선명',              w: 320 },
  { key: 'etd_first', label: '부산출항(최초)',    w: 110 },
  { key: 'etd_curr',  label: '부산출항(변경)',    w: 110 },
  { key: 'sliding',   label: '슬라이딩 지연일수', w: 110 },
  { key: 'doc',       label: '서류마감',          w: 110 },
  { key: 'eta',       label: 'P.O.D ETA',         w: 110 },
  { key: 'qty',       label: '부킹수량',          w: 90  },
  { key: 'week',      label: '주차',              w: 80  },
] as const

// 부킹수량 (20ft=0.5, 40ft=1) — rfOff면 RF(리퍼) 컨테이너 제외
export function qtyOf(b: Booking, rfOff: boolean): number {
  if (b.booking_entries && b.booking_entries.length > 0) {
    return b.booking_entries.reduce((sum, e) => {
      if (rfOff && /rf|reefer|리퍼/i.test(e.ctr_type || '')) return sum
      return sum + (e.ctr_qty || 0) * ((e.ctr_type || '').startsWith('20') ? 0.5 : 1)
    }, 0)
  }
  const q20 = (b.qty_20_normal || 0) + (b.qty_20_dg || 0) + (rfOff ? 0 : (b.qty_20_reefer || 0))
  const q40 = (b.qty_40_normal || 0) + (b.qty_40_dg || 0) + (rfOff ? 0 : (b.qty_40_reefer || 0))
  return q20 * 0.5 + q40
}

// 도착지명에 (RF)가 붙은 리퍼 전용 도착지 — RF해제 시 제외
export const RF_DEST_RE = /\(\s*RF\s*\)/i

export const fmtQty = (n: number) => n === 0 ? '' : (n % 1 === 0 ? String(n) : n.toFixed(1))

const HEADER_BG = '#FFC000'
const HEADER_FG = '#C00000'
const LINE = '#000000'

export function fmtKo(d: string | null | undefined): string {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? format(p, 'MM월 dd일') : '' } catch { return '' }
}

interface SchedRow {
  cells: Record<string, string>
  srcDest: string
  etdIso: string
  handlerId: string
  month: string
  src: Booking | null
  weekNum: number | null
  blank?: boolean
}

interface DisplayRow extends SchedRow {
  groupLabel: string
  groupStart: boolean
  groupEnd: boolean
  groupSpan: number   // groupStart 행에만 유효
}

interface Props {
  bookings: Booking[]
  profiles: Profile[]
  initialGroups: ScheduleDestGroup[]
  initialBlankWeeks?: Record<string, number[]>
  destinationSortOrder?: string[]
}

export default function ScheduleNewTab({
  bookings, profiles, initialGroups, initialBlankWeeks = {}, destinationSortOrder = [],
}: Props) {
  const [groups, setGroups] = useState<ScheduleDestGroup[]>(initialGroups)
  const [blankWeeks, setBlankWeeks] = useState<Record<string, number[]>>(initialBlankWeeks)
  const [weekCfgOpen, setWeekCfgOpen] = useState(false)
  const [handlerIds, setHandlerIds] = useState<string[]>([])          // 빈 배열 = 전체
  // 기본값 = 오늘 +10일이 속한 달 (전부 불러오지 않도록)
  const [month, setMonth] = useState<string>(() => format(addDays(new Date(), 10), 'yyyy-MM'))
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null)
  const [filterSearch, setFilterSearch] = useState('')
  const [mapOpen, setMapOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [rfOff, setRfOff] = useState(true)         // RF해제(기본 ON): 리퍼만인 행 제외
  const [showBlank, setShowBlank] = useState(true)  // 비어있는 주차를 BLANK SAILING으로 표시(기본 ON)

  // 범위 선택
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null)
  const [focusCell, setFocusCell] = useState<{ r: number; c: number } | null>(null)
  const draggingRef = useRef(false)
  const tableWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const up = () => { draggingRef.current = false }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // ── 원본 → 스케줄 행 변환 ────────────────────────────────────────
  const allRows = useMemo<SchedRow[]>(() => bookings.map(b => {
    const vessel = [b.vessel_name, b.voyage].filter(Boolean).join(' / ')
    return {
      cells: {
        dest: b.final_destination || '',
        carrier: b.carrier || '',
        vessel,
        etd_first: fmtKo(b.proforma_etd),
        etd_curr: fmtKo(b.updated_etd || b.proforma_etd),
        sliding: '',
        doc: fmtKo(b.doc_cutoff_date),
        eta: fmtKo(b.eta),
        qty: '',
        week: getWeekNum(b.proforma_etd) !== null ? `${getWeekNum(b.proforma_etd)}주차` : '',
      },
      srcDest: b.final_destination || '',
      etdIso: b.proforma_etd || '',
      handlerId: b.forwarder_handler_id || '',
      month: b.proforma_etd ? b.proforma_etd.slice(0, 7) : '',
      src: b,
      weekNum: getWeekNum(b.proforma_etd),
    }
  }), [bookings])

  // 담당자 · 월 필터
  const baseRows = useMemo(() => allRows.filter(r => {
    if (handlerIds.length > 0 && !handlerIds.includes(r.handlerId)) return false
    if (month && r.month !== month) return false
    // RF해제: 도착지명에 (RF)가 들어간 리퍼 전용 도착지 제외
    if (rfOff && RF_DEST_RE.test(r.srcDest)) return false
    return true
  }), [allRows, handlerIds, month, rfOff])

  // 열 필터 적용
  const filteredRows = useMemo(() => baseRows.filter(r => {
    for (const [col, allowed] of Object.entries(colFilters)) {
      if (!allowed || allowed.length === 0) continue
      if (!allowed.includes(r.cells[col] || '')) return false
    }
    return true
  }), [baseRows, colFilters])

  // 도착지 매핑 → 그룹 라벨
  const labelOf = useMemo(() => {
    const map = new Map<string, string>()
    groups.forEach(g => g.members.forEach(m => {
      const k = (m || '').trim().toUpperCase()
      if (k && !map.has(k)) map.set(k, g.label)
    }))
    return (dest: string) => map.get((dest || '').trim().toUpperCase()) || dest || '(미지정)'
  }, [groups])

  // 해당 월에 걸친 주차 (기본값)
  const monthWeeks = useMemo(() => {
    const set = new Set<number>()
    if (month) {
      const [y, m] = month.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      for (let d = 1; d <= lastDay; d++) {
        const w = getWeekNum(`${month}-${String(d).padStart(2, '0')}`)
        if (w !== null) set.add(w)
      }
    } else {
      for (const r of filteredRows) if (r.weekNum !== null) set.add(r.weekNum)
    }
    return [...set].sort((a, b) => a - b)
  }, [month, filteredRows])

  // BLANK SAILING 판정 기준 주차 — 월별 사용자 설정이 있으면 그것을 사용
  const targetWeeks = useMemo(() => {
    const saved = month ? blankWeeks[month] : undefined
    return Array.isArray(saved) ? [...saved].sort((a, b) => a - b) : monthWeeks
  }, [month, blankWeeks, monthWeeks])

  // 그룹핑 + 중복 제거 + 정렬 → 표시 행
  const displayRows = useMemo<DisplayRow[]>(() => {
    const byLabel = new Map<string, SchedRow[]>()
    for (const r of filteredRows) {
      const label = labelOf(r.srcDest)
      if (rfOff && RF_DEST_RE.test(label)) continue
      if (!byLabel.has(label)) byLabel.set(label, [])
      byLabel.get(label)!.push(r)
    }
    // 그룹 순서: 매핑에 정의된 순서 → 도착지 정렬순서 → 가나다
    const groupOrder = (label: string) => {
      const gi = groups.findIndex(g => g.label === label)
      if (gi >= 0) return gi
      const di = destinationSortOrder.indexOf(label)
      return di >= 0 ? 1000 + di : 100000
    }
    const labels = [...byLabel.keys()].sort((a, b) => {
      const d = groupOrder(a) - groupOrder(b)
      return d !== 0 ? d : a.localeCompare(b, 'ko')
    })

    const out: DisplayRow[] = []
    for (const label of labels) {
      // 같은 그룹 안에서 선사+선명이 같으면 한 행으로 (도착지만 다른 부킹 → 수량은 합산)
      const seen = new Map<string, { row: SchedRow; srcs: Booking[] }>()
      for (const r of byLabel.get(label)!) {
        const key = `${r.cells.carrier}|${r.cells.vessel}`
        const cur = seen.get(key)
        if (!cur) { seen.set(key, { row: r, srcs: r.src ? [r.src] : [] }); continue }
        if (r.src) cur.srcs.push(r.src)
        if (r.etdIso && (!cur.row.etdIso || r.etdIso < cur.row.etdIso)) cur.row = r
      }
      const rows: SchedRow[] = [...seen.values()]
        .map(({ row, srcs }) => {
          const qtyAll = srcs.reduce((s, b) => s + qtyOf(b, false), 0)
          const qtyNet = rfOff ? srcs.reduce((s, b) => s + qtyOf(b, true), 0) : qtyAll
          return { row: { ...row, cells: { ...row.cells, qty: fmtQty(qtyNet) } }, qtyAll, qtyNet }
        })
        // RF해제: 리퍼만으로 구성된 행은 아예 제외
        .filter(({ qtyAll, qtyNet }) => !(rfOff && qtyAll > 0 && qtyNet === 0))
        .map(({ row }) => row)
      // 비어있는 주차 → BLANK SAILING 행 추가
      if (showBlank) {
        const present = new Set(rows.map(r => r.weekNum).filter(w => w !== null) as number[])
        for (const w of targetWeeks) {
          if (present.has(w)) continue
          rows.push({
            cells: { dest: '', carrier: '', vessel: 'BLANK SAILING', etd_first: '', etd_curr: '', sliding: '', doc: '', eta: '', qty: '', week: `${w}주차` },
            srcDest: '', etdIso: getWeekStartDate(w), handlerId: '', month: '',
            src: null, weekNum: w, blank: true,
          })
        }
      }
      rows.sort((a, b) => {
        if (a.etdIso !== b.etdIso) return (a.etdIso || '9999').localeCompare(b.etdIso || '9999')
        return a.cells.vessel.localeCompare(b.cells.vessel)
      })
      rows.forEach((r, i) => out.push({
        ...r,
        groupLabel: label,
        groupStart: i === 0,
        groupEnd: i === rows.length - 1,
        groupSpan: i === 0 ? rows.length : 0,
      }))
    }
    return out
  }, [filteredRows, labelOf, groups, destinationSortOrder, rfOff, showBlank, targetWeeks])

  // ── 셀 값 (병합된 도착지는 그룹 첫 행에만) ───────────────────────
  const cellText = (rowIdx: number, colKey: string, forCopy = false, selTop = -1): string => {
    const row = displayRows[rowIdx]
    if (!row) return ''
    if (colKey === 'dest') {
      // 엑셀 병합과 동일: 그룹 첫 행(또는 선택 시작 행)에만 값
      if (row.groupStart || (forCopy && rowIdx === selTop)) return row.groupLabel
      return ''
    }
    return row.cells[colKey] || ''
  }

  // ── 필터 옵션 ────────────────────────────────────────────────────
  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const c of COLS) {
      const set = new Set<string>()
      for (const r of baseRows) set.add(c.key === 'dest' ? labelOf(r.srcDest) : (r.cells[c.key] || ''))
      m[c.key] = [...set].sort((a, b) => a.localeCompare(b, 'ko'))
    }
    return m
  }, [baseRows, labelOf])

  // ── 범위 선택 ────────────────────────────────────────────────────
  const selRange = useMemo(() => {
    if (!anchor || !focusCell) return null
    return {
      r1: Math.min(anchor.r, focusCell.r), r2: Math.max(anchor.r, focusCell.r),
      c1: Math.min(anchor.c, focusCell.c), c2: Math.max(anchor.c, focusCell.c),
    }
  }, [anchor, focusCell])

  const buildSelectionData = () => {
    if (!selRange) return null
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const lines: string[] = []
    const htmlRows: string[] = []
    for (let r = selRange.r1; r <= selRange.r2; r++) {
      const cells: string[] = []
      for (let c = selRange.c1; c <= selRange.c2; c++) {
        cells.push(cellText(r, COLS[c].key, true, selRange.r1))
      }
      lines.push(cells.join('\t'))
      htmlRows.push('<tr>' + cells.map(v => `<td>${esc(v)}</td>`).join('') + '</tr>')
    }
    if (lines.length === 0) return null
    return { plain: lines.join('\n'), html: `<table>${htmlRows.join('')}</table>` }
  }
  const buildRef = useRef(buildSelectionData)
  buildRef.current = buildSelectionData

  // Ctrl+C — 네이티브 copy 이벤트에 직접 주입 (엑셀 붙여넣기 호환)
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const ae = document.activeElement
      if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return
      const data = buildRef.current()
      if (!data) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', data.plain)
      e.clipboardData?.setData('text/html', data.html)
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [])

  const copySelection = async () => {
    const data = buildRef.current()
    if (!data) { alert('먼저 표에서 범위를 드래그해 선택하세요.'); return }
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([data.plain], { type: 'text/plain' }),
          'text/html': new Blob([data.html], { type: 'text/html' }),
        })])
      } else {
        await navigator.clipboard.writeText(data.plain)
      }
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  // 키보드: 방향키 이동 · Shift 확장 · Ctrl+A 전체선택
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (displayRows.length === 0) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setAnchor({ r: 0, c: 0 })
      setFocusCell({ r: displayRows.length - 1, c: COLS.length - 1 })
      return
    }
    const dirs: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    }
    const d = dirs[e.key]
    if (!d) return
    e.preventDefault()
    const cur = focusCell || anchor || { r: 0, c: 0 }
    const next = {
      r: Math.max(0, Math.min(displayRows.length - 1, cur.r + d[0])),
      c: Math.max(0, Math.min(COLS.length - 1, cur.c + d[1])),
    }
    setFocusCell(next)
    if (!e.shiftKey) setAnchor(next)
  }

  // ── 엑셀 다운로드 (양식 그대로) ──────────────────────────────────
  const exportExcel = () => {
    import('xlsx-js-style').then((mod) => {
      const XLSX = (mod as unknown as { default: typeof import('xlsx-js-style') }).default ?? mod
      const header = COLS.map(c => c.label)
      const aoa: (string | number)[][] = [header, ...displayRows.map((_, r) => COLS.map(c => {
        const v = cellText(r, c.key)
        return c.key === 'qty' && v !== '' && !isNaN(Number(v)) ? Number(v) : v
      }))]
      const ws = XLSX.utils.aoa_to_sheet(aoa)

      const thin = { style: 'thin', color: { rgb: '000000' } } as const
      const medium = { style: 'medium', color: { rgb: '000000' } } as const

      for (let c = 0; c < COLS.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c })
        if (!ws[addr]) ws[addr] = { t: 's', v: header[c] }
        ws[addr].s = {
          font: { bold: true, sz: 11, name: '맑은 고딕', color: { rgb: 'C00000' } },
          fill: { patternType: 'solid', fgColor: { rgb: 'FFC000' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: { top: medium, bottom: medium, left: thin, right: thin },
        }
      }
      displayRows.forEach((row, i) => {
        for (let c = 0; c < COLS.length; c++) {
          const addr = XLSX.utils.encode_cell({ r: i + 1, c })
          if (!ws[addr]) ws[addr] = { t: 's', v: '' }
          const isBlankVessel = row.blank && COLS[c].key === 'vessel'
          ws[addr].s = {
            font: isBlankVessel
              ? { sz: 10, name: '맑은 고딕', bold: true, color: { rgb: 'B45309' } }
              : { sz: 10, name: '맑은 고딕' },
            ...(row.blank ? { fill: { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } } } : {}),
            alignment: { horizontal: 'center', vertical: 'center', wrapText: c === 0 },
            border: {
              top: row.groupStart ? medium : thin,
              bottom: row.groupEnd ? medium : thin,
              left: c === 0 ? medium : thin,
              right: c === COLS.length - 1 ? medium : thin,
            },
          }
        }
      })
      // 도착지 열 병합
      const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
      displayRows.forEach((row, i) => {
        if (row.groupStart && row.groupSpan > 1) {
          merges.push({ s: { r: i + 1, c: 0 }, e: { r: i + row.groupSpan, c: 0 } })
        }
      })
      ws['!merges'] = merges
      ws['!cols'] = COLS.map(c => ({ wch: Math.round(c.w / 8) }))
      ws['!rows'] = [{ hpt: 26 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '주요스케줄')
      XLSX.writeFile(wb, `주요스케줄_${format(new Date(), 'yyyyMMdd')}.xlsx`, { cellStyles: true })
    })
  }

  // ── 월 옵션 ──────────────────────────────────────────────────────
  const monthOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of allRows) if (r.month) set.add(r.month)
    return [...set].sort()
  }, [allRows])

  const activeHandlers = useMemo(
    () => profiles.filter(p => p.is_active !== false && allRows.some(r => r.handlerId === p.id)),
    [profiles, allRows],
  )

  const filterCount = Object.values(colFilters).filter(v => v && v.length > 0).length

  return (
    <div className="space-y-3">
      {/* 필터 바 */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 w-14">담당자</span>
          <button onClick={() => setHandlerIds([])}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              handlerIds.length === 0 ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}>전체</button>
          {activeHandlers.map(p => {
            const on = handlerIds.includes(p.id)
            return (
              <button key={p.id}
                onClick={() => setHandlerIds(prev => on ? prev.filter(i => i !== p.id) : [...prev, p.id])}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}>{p.name}</button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 w-14">출항월</span>
          <select value={month} onChange={e => setMonth(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">전체</option>
            {monthOptions.map(m => (
              <option key={m} value={m}>{m.replace('-', '년 ')}월</option>
            ))}
          </select>
          <span className="text-[11px] text-slate-400">PROFORMA ETD 기준</span>
          <button onClick={() => setRfOff(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
              rfOff ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
            title="RF(리퍼) 컨테이너를 부킹수량 합계에서 제외">
            RF해제 {rfOff ? 'ON' : 'OFF'}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 px-2 py-1.5 rounded-lg border border-slate-200 bg-white cursor-pointer select-none"
            title="선택한 월 중 배가 없는 주차를 BLANK SAILING으로 표시">
            <input type="checkbox" checked={showBlank} onChange={e => setShowBlank(e.target.checked)} />
            BLANK SAILING 표시
          </label>
          {showBlank && (
            <button onClick={() => { if (!month) { alert('출항월을 먼저 선택하세요.'); return } setWeekCfgOpen(true) }}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                month && blankWeeks[month] ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
              title="BLANK SAILING으로 표시할 주차를 직접 지정 (월별 저장)">
              주차 설정 ({targetWeeks.length}){month && blankWeeks[month] ? ' ✎' : ''}
            </button>
          )}
          <div className="flex-1" />
          {filterCount > 0 && (
            <button onClick={() => setColFilters({})}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">
              열 필터 {filterCount}개 해제
            </button>
          )}
          <button onClick={() => setMapOpen(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 font-medium">
            도착지 매핑 ({groups.length})
          </button>
          <button onClick={copySelection}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 font-medium">
            {copied ? '복사됨!' : '선택영역 복사'}
          </button>
          <button onClick={exportExcel}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium shadow-sm">
            엑셀 다운로드
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          셀을 드래그하면 범위 선택 · Ctrl+C로 엑셀에 그대로 붙여넣기 · 방향키 이동(Shift로 범위 확장) · Ctrl+A 전체선택 · 열 제목의 ▼로 필터
        </p>
      </div>

      {/* 표 */}
      <div ref={tableWrapRef} tabIndex={0} onKeyDown={onKeyDown}
        className="overflow-auto bg-white rounded-lg outline-none"
        style={{ maxHeight: 'calc(100vh - 260px)' }}>
        <table className="text-[13px]" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>{COLS.map(c => <col key={c.key} style={{ width: c.w }} />)}</colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              {COLS.map(c => (
                <th key={c.key}
                  style={{
                    background: HEADER_BG, color: HEADER_FG,
                    border: `1px solid ${LINE}`, padding: '4px 6px',
                    fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap',
                  }}>
                  <div className="flex items-center justify-center gap-1 relative">
                    <span>{c.label}</span>
                    <button
                      onClick={() => { setOpenFilterCol(openFilterCol === c.key ? null : c.key); setFilterSearch('') }}
                      className="w-4 h-4 flex items-center justify-center bg-white border border-slate-400 rounded-[2px] text-[8px] text-slate-700 hover:bg-slate-100 leading-none"
                      title="필터">▼</button>
                    {openFilterCol === c.key && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setOpenFilterCol(null)} />
                        <div className="absolute top-full right-0 mt-1 z-40 bg-white border border-slate-300 rounded-lg shadow-xl p-2 w-56 text-left font-normal"
                          style={{ color: '#0f172a' }}>
                          <input autoFocus value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
                            placeholder="검색" className="w-full text-xs border border-slate-200 rounded px-2 py-1 mb-1.5" />
                          <div className="flex gap-1 mb-1.5">
                            <button onClick={() => setColFilters(p => { const n = { ...p }; delete n[c.key]; return n })}
                              className="flex-1 text-[11px] py-1 rounded bg-slate-100 hover:bg-slate-200">전체</button>
                            <button onClick={() => setColFilters(p => ({ ...p, [c.key]: [] }))}
                              className="flex-1 text-[11px] py-1 rounded bg-slate-100 hover:bg-slate-200">해제</button>
                          </div>
                          <div className="max-h-56 overflow-auto space-y-0.5">
                            {(filterOptions[c.key] || [])
                              .filter(v => !filterSearch || v.toLowerCase().includes(filterSearch.toLowerCase()))
                              .map(v => {
                                const cur = colFilters[c.key]
                                const checked = !cur || cur.length === 0 ? true : cur.includes(v)
                                return (
                                  <label key={v} className="flex items-center gap-1.5 text-xs px-1 py-0.5 hover:bg-slate-50 rounded cursor-pointer">
                                    <input type="checkbox" checked={checked}
                                      onChange={() => setColFilters(p => {
                                        const all = filterOptions[c.key] || []
                                        const cur2 = p[c.key] && p[c.key].length > 0 ? p[c.key] : all
                                        const next = cur2.includes(v) ? cur2.filter(x => x !== v) : [...cur2, v]
                                        return { ...p, [c.key]: next }
                                      })} />
                                    <span className="truncate">{v || '(빈값)'}</span>
                                  </label>
                                )
                              })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="text-center text-slate-400 py-8 text-sm"
                  style={{ border: `1px solid ${LINE}` }}>
                  조건에 맞는 스케줄이 없습니다.
                </td>
              </tr>
            )}
            {displayRows.map((row, r) => (
              <tr key={`${row.groupLabel}_${r}`}>
                {COLS.map((c, ci) => {
                  if (c.key === 'dest' && !row.groupStart) return null
                  const sel = selRange && r >= selRange.r1 && r <= selRange.r2 && ci >= selRange.c1 && ci <= selRange.c2
                  const isDest = c.key === 'dest'
                  return (
                    <td key={c.key}
                      rowSpan={isDest && row.groupSpan > 1 ? row.groupSpan : undefined}
                      onMouseDown={e => {
                        if (e.button !== 0) return
                        draggingRef.current = true
                        tableWrapRef.current?.focus()
                        if (e.shiftKey && anchor) setFocusCell({ r, c: ci })
                        else { setAnchor({ r, c: ci }); setFocusCell({ r, c: ci }) }
                      }}
                      onMouseEnter={() => { if (draggingRef.current) setFocusCell({ r, c: ci }) }}
                      style={{
                        border: `1px solid ${LINE}`,
                        borderTop: row.groupStart ? `2px solid ${LINE}` : `1px solid ${LINE}`,
                        borderBottom: row.groupEnd ? `2px solid ${LINE}` : `1px solid ${LINE}`,
                        padding: '3px 6px',
                        textAlign: 'center',
                        verticalAlign: 'middle',
                        whiteSpace: isDest ? 'pre-line' : 'nowrap',
                        background: sel ? '#cfe2ff' : row.blank ? '#FEF3C7' : '#ffffff',
                        cursor: 'cell',
                        userSelect: 'none',
                        fontWeight: isDest || (row.blank && c.key === 'vessel') ? 600 : 400,
                        color: row.blank && c.key === 'vessel' ? '#B45309' : undefined,
                      }}>
                      {cellText(r, c.key)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        총 {displayRows.length}행 · 도착지 {new Set(displayRows.map(r => r.groupLabel)).size}개 그룹
        {selRange && ` · 선택 ${selRange.r2 - selRange.r1 + 1}행 × ${selRange.c2 - selRange.c1 + 1}열`}
      </p>

      {weekCfgOpen && month && (
        <BlankWeekModal
          month={month}
          defaultWeeks={monthWeeks}
          selected={targetWeeks}
          isCustom={Array.isArray(blankWeeks[month])}
          onClose={() => setWeekCfgOpen(false)}
          onSaved={next => { setBlankWeeks(next); setWeekCfgOpen(false) }}
          allWeeks={blankWeeks}
        />
      )}

      {mapOpen && (
        <DestMappingModal
          groups={groups}
          allDests={[...new Set(allRows.map(r => r.srcDest).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'))}
          onClose={() => setMapOpen(false)}
          onSaved={g => { setGroups(g); setMapOpen(false) }}
        />
      )}
    </div>
  )
}

// ── BLANK SAILING 주차 설정 모달 (월별 저장) ────────────────────────

export function BlankWeekModal({ month, defaultWeeks, selected, isCustom, allWeeks, onClose, onSaved }: {
  month: string
  defaultWeeks: number[]
  selected: number[]
  isCustom: boolean
  allWeeks: Record<string, number[]>
  onClose: () => void
  onSaved: (next: Record<string, number[]>) => void
}) {
  const [picked, setPicked] = useState<number[]>(selected)
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  // 후보 주차 = 해당 월의 주차 ± 1주 (앞뒤 주차도 추가할 수 있게)
  const candidates = useMemo(() => {
    const base = defaultWeeks.length > 0 ? defaultWeeks : selected
    if (base.length === 0) return []
    const min = Math.min(...base) - 1
    const max = Math.max(...base) + 1
    const out: number[] = []
    for (let w = min; w <= max; w++) if (w > 0) out.push(w)
    return out
  }, [defaultWeeks, selected])

  const toggle = (w: number) =>
    setPicked(p => p.includes(w) ? p.filter(x => x !== w) : [...p, w].sort((a, b) => a - b))

  const save = (reset = false) => {
    const next = { ...allWeeks }
    if (reset) delete next[month]
    else next[month] = [...picked].sort((a, b) => a - b)
    setErr(null)
    startTransition(async () => {
      const { error } = await saveScheduleBlankWeeks(next)
      if (error) { setErr(error); return }
      onSaved(next)
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">{month.replace('-', '년 ')}월 BLANK SAILING 주차</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            체크한 주차 중 배가 없는 주차가 BLANK SAILING으로 표시됩니다. 저장하면 이 월에만 적용됩니다.
            {isCustom && <span className="text-amber-700 font-medium"> (현재 사용자 설정 적용 중)</span>}
          </p>
        </div>
        <div className="p-4 space-y-1.5 max-h-[50vh] overflow-auto">
          {candidates.map(w => {
            const isDefault = defaultWeeks.includes(w)
            return (
              <label key={w} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={picked.includes(w)} onChange={() => toggle(w)} />
                <span className={isDefault ? 'text-slate-800' : 'text-slate-400'}>{getWeekLabel(w)}</span>
                {!isDefault && <span className="text-[10px] text-slate-400">(다른 월)</span>}
              </label>
            )
          })}
          {candidates.length === 0 && <p className="text-sm text-slate-400 text-center py-4">주차를 계산할 수 없습니다.</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
          {err && <span className="text-xs text-red-600 mr-auto">{err}</span>}
          <button onClick={() => save(true)} disabled={isPending}
            className="text-sm px-3 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 mr-auto">기본값으로</button>
          <button onClick={onClose} className="btn-secondary text-sm">취소</button>
          <button onClick={() => save(false)} disabled={isPending} className="btn-primary text-sm">
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 도착지 매핑 모달 ────────────────────────────────────────────────

export function DestMappingModal({ groups, allDests, onClose, onSaved }: {
  groups: ScheduleDestGroup[]
  allDests: string[]
  onClose: () => void
  onSaved: (g: ScheduleDestGroup[]) => void
}) {
  const [draft, setDraft] = useState<ScheduleDestGroup[]>(groups.map(g => ({ ...g, members: [...g.members] })))
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const used = new Set(draft.flatMap(g => g.members.map(m => m.trim().toUpperCase())))

  const update = (i: number, patch: Partial<ScheduleDestGroup>) =>
    setDraft(p => p.map((g, gi) => gi === i ? { ...g, ...patch } : g))

  const move = (i: number, dir: -1 | 1) => setDraft(p => {
    const n = [...p]
    const j = i + dir
    if (j < 0 || j >= n.length) return p
    ;[n[i], n[j]] = [n[j], n[i]]
    return n
  })

  const save = () => {
    const clean = draft
      .map(g => ({ label: g.label.trim(), members: g.members.map(m => m.trim()).filter(Boolean) }))
      .filter(g => g.label && g.members.length > 0)
    setErr(null)
    startTransition(async () => {
      const { error } = await saveScheduleDestGroups(clean)
      if (error) { setErr(error); return }
      onSaved(clean)
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">도착지 매핑</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            이름이 달라도 같은 그룹으로 묶어 하나의 병합 셀로 표시합니다. 표시명은 줄바꿈으로 여러 줄 입력할 수 있습니다.
          </p>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {draft.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">매핑이 없습니다. 아래 &lsquo;그룹 추가&rsquo;로 만들어 보세요.</p>
          )}
          {draft.map((g, i) => (
            <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-start gap-2">
                <textarea value={g.label} onChange={e => update(i, { label: e.target.value })}
                  rows={Math.max(2, g.label.split('\n').length)}
                  placeholder={'표시명 (줄바꿈 가능)\n예: ONTARIO(LA)\nJEFFERSON(LA)'}
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-2 py-1.5 font-medium resize-y" />
                <div className="flex flex-col gap-1">
                  <button onClick={() => move(i, -1)} className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200">↑</button>
                  <button onClick={() => move(i, 1)} className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200">↓</button>
                  <button onClick={() => setDraft(p => p.filter((_, gi) => gi !== i))}
                    className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">삭제</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allDests.map(d => {
                  const on = g.members.some(m => m.trim().toUpperCase() === d.trim().toUpperCase())
                  const takenByOther = !on && used.has(d.trim().toUpperCase())
                  return (
                    <button key={d} disabled={takenByOther}
                      onClick={() => update(i, {
                        members: on ? g.members.filter(m => m.trim().toUpperCase() !== d.trim().toUpperCase()) : [...g.members, d],
                      })}
                      className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                        on ? 'bg-violet-600 text-white border-violet-600'
                          : takenByOther ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}>{d}</button>
                  )
                })}
              </div>
            </div>
          ))}
          <button onClick={() => setDraft(p => [...p, { label: '', members: [] }])}
            className="w-full text-sm py-2 border border-dashed border-slate-300 rounded-lg text-slate-500 hover:bg-slate-50">
            + 그룹 추가
          </button>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          {err && <span className="text-xs text-red-600 mr-auto">{err}</span>}
          <button onClick={onClose} className="btn-secondary text-sm">취소</button>
          <button onClick={save} disabled={isPending} className="btn-primary text-sm">
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
