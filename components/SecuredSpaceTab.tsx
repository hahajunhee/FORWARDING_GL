'use client'

import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, isValid, addDays } from 'date-fns'
import type { Booking, Profile, ScheduleDestGroup } from '@/types'
import { getWeekNum, getWeekStartDate, calcCiQtyTotal } from './BookingTable'
import { saveEtdSnapshot, deleteEtdSnapshot } from '@/app/bookings/actions'
import { qtyOf, fmtKo, DestMappingModal, BlankWeekModal } from './ScheduleNewTab'

// 헤더 색 (양식과 동일)
const HEAD_BG = '#1F4E79'
const HEAD_FG = '#FFFFFF'
const HI_BG = '#FFFF00'
const HI_FG = '#C00000'
const LINE = '#1F3864'

interface ColDef { key: string; label: string; w: number; hi?: boolean }

const FIXED_HEAD: ColDef[] = [
  { key: 'dest',    label: '도착지',       w: 180 },
  { key: 'carrier', label: '선사',         w: 90  },
  { key: 'vessel',  label: '선명',         w: 300 },
  { key: 'petd',    label: 'Proforma ETD', w: 105 },
]
const FIXED_TAIL: ColDef[] = [
  { key: 'doc',     label: '서류마감',     w: 105 },
  { key: 'eta',     label: 'P.O.D. ETA',   w: 105 },
  { key: 'mqc',     label: 'MQC',          w: 75  },
  { key: 'secured', label: '확보선복',     w: 85  },
  { key: 'actual',  label: '실선적물량',   w: 90, hi: true },
  { key: 'week',    label: '주차',         w: 75  },
]

const num = (v: string | null | undefined): number => {
  const m = (v || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : 0
}
const dec1 = (n: number) => n.toFixed(1)
const snapLabel = (key: string) => {
  try {
    const p = parseISO(key)
    return isValid(p) ? `ETD (${format(p, 'M/d')} 기준)` : `ETD (${key})`
  } catch { return `ETD (${key})` }
}

interface SsRow {
  cells: Record<string, string>
  srcDest: string
  etdIso: string
  handlerId: string
  month: string
  weekNum: number | null
  src: Booking | null
  blank?: boolean
}
interface DisplayRow extends SsRow {
  groupLabel: string
  groupStart: boolean
  groupEnd: boolean
  groupSpan: number
}

interface Props {
  bookings: Booking[]
  profiles: Profile[]
  initialGroups: ScheduleDestGroup[]
  initialBlankWeeks?: Record<string, number[]>
  destinationSortOrder?: string[]
}

export default function SecuredSpaceTab({
  bookings, profiles, initialGroups, initialBlankWeeks = {}, destinationSortOrder = [],
}: Props) {
  const router = useRouter()
  const [groups, setGroups] = useState<ScheduleDestGroup[]>(initialGroups)
  const [blankWeeks, setBlankWeeks] = useState<Record<string, number[]>>(initialBlankWeeks)
  const [handlerIds, setHandlerIds] = useState<string[]>([])
  // PROFORMA ETD 기간 필터 — 기본값: 오늘 +10일이 속한 달의 1일 ~ 말일
  const [etdFrom, setEtdFrom] = useState<string>(() => {
    const d = addDays(new Date(), 10)
    return format(new Date(d.getFullYear(), d.getMonth(), 1), 'yyyy-MM-dd')
  })
  const [etdTo, setEtdTo] = useState<string>(() => {
    const d = addDays(new Date(), 10)
    return format(new Date(d.getFullYear(), d.getMonth() + 1, 0), 'yyyy-MM-dd')
  })
  const [rfOff, setRfOff] = useState(true)
  const [showBlank, setShowBlank] = useState(true)
  const [mapOpen, setMapOpen] = useState(false)
  const [weekCfgOpen, setWeekCfgOpen] = useState(false)
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null)
  const [filterSearch, setFilterSearch] = useState('')
  const [copied, setCopied] = useState(false)
  const [snapDate, setSnapDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [snapMsg, setSnapMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null)
  const [focusCell, setFocusCell] = useState<{ r: number; c: number } | null>(null)
  const draggingRef = useRef(false)
  const tableWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const up = () => { draggingRef.current = false }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // ── 원본 행 ──────────────────────────────────────────────────────
  const allRows = useMemo<SsRow[]>(() => bookings.map(b => ({
    cells: {
      dest: b.final_destination || '',
      carrier: b.carrier || '',
      vessel: [b.vessel_name, b.voyage].filter(Boolean).join(' / '),
      petd: fmtKo(b.proforma_etd),
      doc: fmtKo(b.doc_cutoff_date),
      eta: fmtKo(b.eta),
      mqc: '', secured: '', actual: '',
      week: getWeekNum(b.proforma_etd) !== null ? `${getWeekNum(b.proforma_etd)}주차` : '',
    },
    srcDest: b.final_destination || '',
    etdIso: b.proforma_etd || '',
    handlerId: b.forwarder_handler_id || '',
    month: b.proforma_etd ? b.proforma_etd.slice(0, 7) : '',
    weekNum: getWeekNum(b.proforma_etd),
    src: b,
  })), [bookings])

  const baseRows = useMemo(() => allRows.filter(r => {
    if (handlerIds.length > 0 && !handlerIds.includes(r.handlerId)) return false
    if (etdFrom && (!r.etdIso || r.etdIso < etdFrom)) return false
    if (etdTo && (!r.etdIso || r.etdIso > etdTo)) return false
    return true
  }), [allRows, handlerIds, etdFrom, etdTo])

  const filteredRows = useMemo(() => baseRows.filter(r => {
    for (const [col, allowed] of Object.entries(colFilters)) {
      if (!allowed || allowed.length === 0) continue
      if (!allowed.includes(r.cells[col] || '')) return false
    }
    return true
  }), [baseRows, colFilters])

  // ── ETD 스냅샷 열 (기준일) ───────────────────────────────────────
  const snapKeys = useMemo(() => {
    const s = new Set<string>()
    for (const r of filteredRows) {
      const h = r.src?.etd_history
      if (h) Object.keys(h).forEach(k => s.add(k))
    }
    return [...s].sort().slice(-8)
  }, [filteredRows])

  const COLS = useMemo<ColDef[]>(() => [
    ...FIXED_HEAD,
    ...snapKeys.map((k, i) => ({ key: `snap_${k}`, label: snapLabel(k), w: 105, hi: i === snapKeys.length - 1 })),
    ...FIXED_TAIL,
  ], [snapKeys])

  const labelOf = useMemo(() => {
    const map = new Map<string, string>()
    groups.forEach(g => g.members.forEach(m => {
      const k = (m || '').trim().toUpperCase()
      if (k && !map.has(k)) map.set(k, g.label)
    }))
    return (dest: string) => map.get((dest || '').trim().toUpperCase()) || dest || '(미지정)'
  }, [groups])

  // 기간에 걸친 주차 (BLANK SAILING 기본 대상)
  const monthKey = etdFrom ? etdFrom.slice(0, 7) : ''
  const monthWeeks = useMemo(() => {
    const set = new Set<number>()
    if (etdFrom && etdTo) {
      let d = parseISO(etdFrom)
      const end = parseISO(etdTo)
      if (isValid(d) && isValid(end)) {
        let guard = 0
        while (d <= end && guard++ < 400) {
          const w = getWeekNum(format(d, 'yyyy-MM-dd'))
          if (w !== null) set.add(w)
          d = addDays(d, 1)
        }
      }
    } else {
      for (const r of filteredRows) if (r.weekNum !== null) set.add(r.weekNum)
    }
    return [...set].sort((a, b) => a - b)
  }, [etdFrom, etdTo, filteredRows])

  const targetWeeks = useMemo(() => {
    const saved = monthKey ? blankWeeks[monthKey] : undefined
    return Array.isArray(saved) ? [...saved].sort((a, b) => a - b) : monthWeeks
  }, [monthKey, blankWeeks, monthWeeks])

  // ── 그룹 병합 → 표시 행 ──────────────────────────────────────────
  const displayRows = useMemo<DisplayRow[]>(() => {
    const byLabel = new Map<string, SsRow[]>()
    for (const r of filteredRows) {
      const label = labelOf(r.srcDest)
      if (!byLabel.has(label)) byLabel.set(label, [])
      byLabel.get(label)!.push(r)
    }
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
      const seen = new Map<string, { row: SsRow; srcs: Booking[] }>()
      for (const r of byLabel.get(label)!) {
        const key = `${r.cells.carrier}|${r.cells.vessel}`
        const cur = seen.get(key)
        if (!cur) { seen.set(key, { row: r, srcs: r.src ? [r.src] : [] }); continue }
        if (r.src) cur.srcs.push(r.src)
        if (r.etdIso && (!cur.row.etdIso || r.etdIso < cur.row.etdIso)) cur.row = r
      }
      const rows: SsRow[] = [...seen.values()]
        .map(({ row, srcs }) => {
          const qtyAll = srcs.reduce((s, b) => s + qtyOf(b, false), 0)
          const qtyNet = rfOff ? srcs.reduce((s, b) => s + qtyOf(b, true), 0) : qtyAll
          const cells: Record<string, string> = {
            ...row.cells,
            // MQC는 도착지 단위 주간 쿼터라 합산하지 않고 최댓값
            mqc: dec1(Math.max(0, ...srcs.map(b => num(b.mqc)))),
            secured: dec1(srcs.reduce((s, b) => s + num(b.secured_space), 0)),
            // 실선적물량 = CI_수량(총합) 합계
            actual: dec1(srcs.reduce((s, b) => s + (calcCiQtyTotal(b) ?? 0), 0)),
          }
          for (const k of snapKeys) {
            const hit = srcs.map(b => b.etd_history?.[k]).find(Boolean)
            cells[`snap_${k}`] = fmtKo(hit || '')
          }
          return { row: { ...row, cells }, qtyAll, qtyNet }
        })
        .filter(({ qtyAll, qtyNet }) => !(rfOff && qtyAll > 0 && qtyNet === 0))
        .map(({ row }) => row)

      if (showBlank) {
        const present = new Set(rows.map(r => r.weekNum).filter(w => w !== null) as number[])
        for (const w of targetWeeks) {
          if (present.has(w)) continue
          const cells: Record<string, string> = {
            dest: '', carrier: '', vessel: 'BLANK SAILING', petd: '',
            doc: '', eta: '', mqc: '', secured: '', actual: '', week: `${w}주차`,
          }
          for (const k of snapKeys) cells[`snap_${k}`] = ''
          rows.push({
            cells, srcDest: '', etdIso: getWeekStartDate(w), handlerId: '', month: '',
            weekNum: w, src: null, blank: true,
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
  }, [filteredRows, labelOf, groups, destinationSortOrder, rfOff, showBlank, targetWeeks, snapKeys])

  const cellText = (rowIdx: number, colKey: string, forCopy = false, selTop = -1): string => {
    const row = displayRows[rowIdx]
    if (!row) return ''
    if (colKey === 'dest') {
      if (row.groupStart || (forCopy && rowIdx === selTop)) return row.groupLabel
      return ''
    }
    return row.cells[colKey] || ''
  }

  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const c of COLS) {
      const set = new Set<string>()
      for (const r of baseRows) set.add(c.key === 'dest' ? labelOf(r.srcDest) : (r.cells[c.key] || ''))
      m[c.key] = [...set].sort((a, b) => a.localeCompare(b, 'ko'))
    }
    return m
  }, [baseRows, labelOf, COLS])

  // ── 범위 선택 · 복사 ─────────────────────────────────────────────
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
    const plain: string[] = []
    const html: string[] = []
    for (let r = selRange.r1; r <= selRange.r2; r++) {
      const cells: string[] = []
      for (let c = selRange.c1; c <= selRange.c2; c++) cells.push(cellText(r, COLS[c].key, true, selRange.r1))
      plain.push(cells.join('\t'))
      html.push('<tr>' + cells.map(v => `<td>${esc(v)}</td>`).join('') + '</tr>')
    }
    if (plain.length === 0) return null
    return { plain: plain.join('\n'), html: `<table>${html.join('')}</table>` }
  }
  const buildRef = useRef(buildSelectionData)
  buildRef.current = buildSelectionData

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
      } else await navigator.clipboard.writeText(data.plain)
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (displayRows.length === 0) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setAnchor({ r: 0, c: 0 }); setFocusCell({ r: displayRows.length - 1, c: COLS.length - 1 })
      return
    }
    const dirs: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
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

  // ── ETD 스냅샷 ───────────────────────────────────────────────────
  const visibleIds = useMemo(
    () => [...new Set(filteredRows.map(r => r.src?.id).filter(Boolean) as string[])], [filteredRows])

  const takeSnapshot = () => {
    if (!snapDate) return
    const past = snapDate < format(new Date(), 'yyyy-MM-dd')
    if (!confirm(
      `"${snapLabel(snapDate)}" 열을 추가합니다. (조회된 ${visibleIds.length}건)\n`
      + (past
        ? '과거 일자입니다. 그 이후에 ETD가 수정된 부킹은 직전 ETD 값으로 채웁니다.\n(정확한 이력은 그 시점에 열을 추가해 두어야 남습니다)\n'
        : '현재 UPDATED ETD 값으로 채웁니다.\n')
      + '계속할까요?')) return
    setSnapMsg(null)
    startTransition(async () => {
      const { error, count } = await saveEtdSnapshot(snapDate, visibleIds)
      if (error) { setSnapMsg(error); return }
      setSnapMsg(`${count}건 저장됨`)
      router.refresh()
    })
  }

  const removeSnapshot = (key: string) => {
    if (!confirm(`"${snapLabel(key)}" 열을 삭제합니다. (조회된 ${visibleIds.length}건 기준)\n계속할까요?`)) return
    setSnapMsg(null)
    startTransition(async () => {
      const { error } = await deleteEtdSnapshot(key, visibleIds)
      if (error) { setSnapMsg(error); return }
      setSnapMsg('삭제됨')
      router.refresh()
    })
  }

  // ── 엑셀 ─────────────────────────────────────────────────────────
  const exportExcel = () => {
    import('xlsx-js-style').then((mod) => {
      const XLSX = (mod as unknown as { default: typeof import('xlsx-js-style') }).default ?? mod
      const header = COLS.map(c => c.label)
      const numKeys = new Set(['mqc', 'secured', 'actual'])
      const aoa: (string | number)[][] = [header, ...displayRows.map((_, r) => COLS.map(c => {
        const v = cellText(r, c.key)
        return numKeys.has(c.key) && v !== '' && !isNaN(Number(v)) ? Number(v) : v
      }))]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      const thin = { style: 'thin', color: { rgb: '1F3864' } } as const
      const medium = { style: 'medium', color: { rgb: '1F3864' } } as const

      COLS.forEach((c, i) => {
        const addr = XLSX.utils.encode_cell({ r: 0, c: i })
        if (!ws[addr]) ws[addr] = { t: 's', v: c.label }
        ws[addr].s = {
          font: { bold: true, sz: 10, name: '맑은 고딕', color: { rgb: c.hi ? 'C00000' : 'FFFFFF' } },
          fill: { patternType: 'solid', fgColor: { rgb: c.hi ? 'FFFF00' : '1F4E79' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: { top: medium, bottom: medium, left: thin, right: thin },
        }
      })
      displayRows.forEach((row, i) => {
        COLS.forEach((c, ci) => {
          const addr = XLSX.utils.encode_cell({ r: i + 1, c: ci })
          if (!ws[addr]) ws[addr] = { t: 's', v: '' }
          const isBlankVessel = row.blank && c.key === 'vessel'
          ws[addr].s = {
            font: isBlankVessel
              ? { sz: 10, name: '맑은 고딕', bold: true, color: { rgb: 'B45309' } }
              : { sz: 10, name: '맑은 고딕' },
            ...(row.blank
              ? { fill: { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } } }
              : c.hi ? { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFCC' } } } : {}),
            alignment: { horizontal: 'center', vertical: 'center', wrapText: ci === 0 },
            ...(numKeys.has(c.key) ? { numFmt: '0.0' } : {}),
            border: {
              top: row.groupStart ? medium : thin,
              bottom: row.groupEnd ? medium : thin,
              left: ci === 0 ? medium : thin,
              right: ci === COLS.length - 1 ? medium : thin,
            },
          }
        })
      })
      const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
      displayRows.forEach((row, i) => {
        if (row.groupStart && row.groupSpan > 1) merges.push({ s: { r: i + 1, c: 0 }, e: { r: i + row.groupSpan, c: 0 } })
      })
      ws['!merges'] = merges
      ws['!cols'] = COLS.map(c => ({ wch: Math.round(c.w / 8) }))
      ws['!rows'] = [{ hpt: 30 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '확보선복취합')
      XLSX.writeFile(wb, `확보선복취합_${format(new Date(), 'yyyyMMdd')}.xlsx`, { cellStyles: true })
    })
  }

  const activeHandlers = useMemo(
    () => profiles.filter(p => p.is_active !== false && allRows.some(r => r.handlerId === p.id)),
    [profiles, allRows])

  const filterCount = Object.values(colFilters).filter(v => v && v.length > 0).length

  return (
    <div className="space-y-3">
      {/* 필터 바 */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
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
          <span className="text-xs font-bold text-slate-500 w-14">출항기간</span>
          <input type="date" value={etdFrom} onChange={e => setEtdFrom(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
          <span className="text-xs text-slate-400">~</span>
          <input type="date" value={etdTo} onChange={e => setEtdTo(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
          <span className="text-[11px] text-slate-400">PROFORMA ETD 기준</span>
          <button onClick={() => setRfOff(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${rfOff ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            title="RF(리퍼)로만 구성된 행 제외">RF해제 {rfOff ? 'ON' : 'OFF'}</button>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 px-2 py-1.5 rounded-lg border border-slate-200 bg-white cursor-pointer select-none">
            <input type="checkbox" checked={showBlank} onChange={e => setShowBlank(e.target.checked)} />
            BLANK SAILING 표시
          </label>
          {showBlank && (
            <button onClick={() => { if (!monthKey) { alert('출항기간을 먼저 지정하세요.'); return } setWeekCfgOpen(true) }}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium ${monthKey && blankWeeks[monthKey] ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              주차 설정 ({targetWeeks.length}){monthKey && blankWeeks[monthKey] ? ' ✎' : ''}
            </button>
          )}
          <div className="flex-1" />
          {filterCount > 0 && (
            <button onClick={() => setColFilters({})}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">열 필터 {filterCount}개 해제</button>
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
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium shadow-sm">엑셀 다운로드</button>
        </div>

        {/* ETD 스냅샷 */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <span className="text-xs font-bold text-slate-500 w-14">ETD 기준</span>
          <input type="date" value={snapDate} onChange={e => setSnapDate(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
          <button onClick={takeSnapshot} disabled={isPending || visibleIds.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-40">
            {isPending ? '처리 중...' : `ETD 스냅 열 추가 (${visibleIds.length}건)`}
          </button>
          {snapKeys.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {snapKeys.map(k => (
                <span key={k} className="text-[11px] px-2 py-1 rounded-lg bg-slate-100 text-slate-600 flex items-center gap-1">
                  {snapLabel(k)}
                  <button onClick={() => removeSnapshot(k)} className="text-slate-400 hover:text-red-600" title="이 기준 열 삭제">×</button>
                </span>
              ))}
            </div>
          )}
          {snapMsg && <span className="text-[11px] text-slate-500">{snapMsg}</span>}
          <span className="text-[11px] text-slate-400">
            기준일별 ETD 열을 만듭니다. 날짜가 빠른 열이 왼쪽(Proforma ETD 오른쪽부터), × 로 열 삭제.
          </span>
        </div>
      </div>

      {/* 표 */}
      <div ref={tableWrapRef} tabIndex={0} onKeyDown={onKeyDown}
        className="overflow-auto bg-white rounded-lg outline-none" style={{ maxHeight: 'calc(100vh - 290px)' }}>
        <table className="text-[13px]" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>{COLS.map(c => <col key={c.key} style={{ width: c.w }} />)}</colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              {COLS.map(c => (
                <th key={c.key}
                  style={{
                    background: c.hi ? HI_BG : HEAD_BG, color: c.hi ? HI_FG : HEAD_FG,
                    border: `1px solid ${LINE}`, padding: '4px 6px',
                    fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', fontSize: 12,
                  }}>
                  <div className="flex items-center justify-center gap-1 relative">
                    <span>{c.label}</span>
                    <button onClick={() => { setOpenFilterCol(openFilterCol === c.key ? null : c.key); setFilterSearch('') }}
                      className="w-4 h-4 flex items-center justify-center bg-white border border-slate-400 rounded-[2px] text-[8px] text-slate-700 hover:bg-slate-100 leading-none"
                      title="필터">▼</button>
                    {openFilterCol === c.key && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setOpenFilterCol(null)} />
                        <div className="absolute top-full right-0 mt-1 z-40 bg-white border border-slate-300 rounded-lg shadow-xl p-2 w-56 text-left font-normal" style={{ color: '#0f172a' }}>
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
              <tr><td colSpan={COLS.length} className="text-center text-slate-400 py-8 text-sm" style={{ border: `1px solid ${LINE}` }}>
                조건에 맞는 데이터가 없습니다.
              </td></tr>
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
                        padding: '2px 6px',
                        textAlign: 'center',
                        verticalAlign: 'middle',
                        whiteSpace: isDest ? 'pre-line' : 'nowrap',
                        background: sel ? '#cfe2ff' : row.blank ? '#FEF3C7' : c.hi ? '#FFFFCC' : '#ffffff',
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
        {' · MQC는 그룹 내 최댓값, 확보선복·실선적물량은 합계'}
      </p>

      {weekCfgOpen && monthKey && (
        <BlankWeekModal
          month={monthKey}
          defaultWeeks={monthWeeks}
          selected={targetWeeks}
          isCustom={Array.isArray(blankWeeks[monthKey])}
          allWeeks={blankWeeks}
          onClose={() => setWeekCfgOpen(false)}
          onSaved={next => { setBlankWeeks(next); setWeekCfgOpen(false) }}
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
