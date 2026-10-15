'use client'

import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format, addDays, parseISO, isValid } from 'date-fns'
import type { Booking, Profile, ColumnDefinition } from '@/types'
import type { TransitMap } from '@/lib/eta'
import { calcEta } from '@/lib/eta'
import { normalizeDateInput } from './BookingTable'
import { bulkSaveBookings } from '@/app/bookings/actions'

type View = 'cutoff' | 'etd'
type EditField = 'doc_cutoff_date' | 'updated_etd'
type Col = { key: string; label: string; w: number; edit?: EditField }

const COLS_CUTOFF: Col[] = [
  { key: 'carrier',   label: '선사',        w: 90  },
  { key: 'dest',      label: '최종도착지',  w: 180 },
  { key: 'port',      label: '양하항',      w: 120 },
  { key: 'vessel',    label: '모선명',      w: 160 },
  { key: 'voyage',    label: 'VOYAGE',      w: 90  },
  { key: 'doc',       label: '서류마감',    w: 130, edit: 'doc_cutoff_date' },
  { key: 'etd',       label: 'UPDATED ETD', w: 110 },
  { key: 'booking_no', label: '부킹번호',   w: 180 },
  { key: 'handler',   label: '포워더 담당', w: 100 },
]

const COLS_ETD: Col[] = [
  { key: 'carrier',   label: '선사',        w: 90  },
  { key: 'dest',      label: '최종도착지',  w: 180 },
  { key: 'port',      label: '양하항',      w: 120 },
  { key: 'vessel',    label: '모선명',      w: 160 },
  { key: 'voyage',    label: 'VOYAGE',      w: 90  },
  { key: 'etd',       label: 'UPDATED ETD', w: 130, edit: 'updated_etd' },
  { key: 'booking_no', label: '부킹번호',   w: 180 },
  { key: 'handler',   label: '포워더 담당', w: 100 },
  { key: 'service',   label: '서비스명',    w: 120 },
]

const fmt = (d: string | null | undefined) => {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? format(p, 'yyyy-MM-dd') : '' } catch { return '' }
}

const bookingNos = (b: Booking) =>
  (b.booking_entries && b.booking_entries.length > 0)
    ? b.booking_entries.map(e => e.no).filter(Boolean).join(', ')
    : (b.booking_no || '')

interface Props {
  bookings: Booking[]
  profiles: Profile[]
  currentUserId: string
  customColumns?: ColumnDefinition[]
  etaTransitDays?: TransitMap
}

export default function CutoffEtdTab({
  bookings, profiles, currentUserId, customColumns = [], etaTransitDays = {},
}: Props) {
  const router = useRouter()
  const [view, setView] = useState<View>('cutoff')
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, Partial<Booking>>>({})

  // ── 검색 조건 ────────────────────────────────────────────────────
  const [handlerId, setHandlerId] = useState<string>(currentUserId)
  const [carrier, setCarrier] = useState('')
  const [keyword, setKeyword] = useState('')
  // 두 뷰 모두 UPDATED ETD 기간으로 조회 (기본 오늘 ~ +30일)
  const [etdFrom, setEtdFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [etdTo, setEtdTo] = useState(() => format(addDays(new Date(), 30), 'yyyy-MM-dd'))

  // ── 정렬 (1·2·3차) ───────────────────────────────────────────────
  const [sorts, setSorts] = useState<{ col: string; dir: 'asc' | 'desc' }[]>([])
  const toggleSort = (col: string) => {
    setSorts(prev => {
      const i = prev.findIndex(s => s.col === col)
      if (i === -1) return [...prev, { col, dir: 'asc' }]
      if (prev[i].dir === 'asc') return prev.map((s, si) => si === i ? { ...s, dir: 'desc' } : s)
      return prev.filter((_, si) => si !== i)
    })
  }

  const cols = view === 'cutoff' ? COLS_CUTOFF : COLS_ETD
  const editField: EditField = view === 'cutoff' ? 'doc_cutoff_date' : 'updated_etd'
  const editColIdx = cols.findIndex(c => c.edit)

  const serviceCol = useMemo(
    () => customColumns.find(c => c.label.replace(/\s/g, '').includes('서비스')),
    [customColumns])
  const serviceOf = (b: Booking) =>
    serviceCol ? ((b.extra_data as Record<string, string> | null)?.[serviceCol.key] || '') : ''

  const valueOf = (b: Booking, field: EditField): string => {
    const e = edits[b.id]?.[field] as string | null | undefined
    return (e !== undefined ? (e || '') : (b[field] || '')) as string
  }

  const cellText = (b: Booking, key: string): string => {
    switch (key) {
      case 'carrier': return b.carrier || ''
      case 'dest': return b.final_destination || ''
      case 'port': return b.discharge_port || ''
      case 'vessel': return b.vessel_name || ''
      case 'voyage': return b.voyage || ''
      case 'doc': return fmt(valueOf(b, 'doc_cutoff_date'))
      case 'etd': return view === 'etd' ? fmt(valueOf(b, 'updated_etd')) : fmt(b.updated_etd)
      case 'booking_no': return bookingNos(b)
      case 'handler': return b.forwarder_handler?.name || ''
      case 'service': return serviceOf(b)
      default: return ''
    }
  }

  // ── 조회 ─────────────────────────────────────────────────────────
  const carriers = useMemo(
    () => [...new Set(bookings.map(b => b.carrier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [bookings])

  // 검색 입력 자동완성 후보
  const keywordOptions = useMemo(() => {
    const s = new Set<string>()
    for (const b of bookings) {
      ;[b.final_destination, b.discharge_port, b.vessel_name, b.voyage, serviceOf(b)]
        .forEach(v => { if (v) s.add(v) })
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'ko'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, serviceCol])

  const rows = useMemo(() => {
    const q = keyword.trim().toUpperCase()
    let list = bookings.filter(b => {
      if (handlerId && b.forwarder_handler_id !== handlerId) return false
      if (carrier && b.carrier !== carrier) return false
      if (view === 'cutoff' && b.is_closed) return false          // 미마감만
      const d = b.updated_etd || ''
      if (etdFrom && (!d || d < etdFrom)) return false
      if (etdTo && (!d || d > etdTo)) return false
      if (q) {
        const hit = [b.final_destination, b.discharge_port, b.vessel_name, b.voyage, bookingNos(b), serviceOf(b)]
          .some(v => (v || '').toUpperCase().includes(q))
        if (!hit) return false
      }
      return true
    })
    if (sorts.length > 0) {
      list = [...list].sort((a, b) => {
        for (const { col, dir } of sorts) {
          const va = cellText(a, col), vb = cellText(b, col)
          if (va !== vb) {
            // 빈 값은 항상 뒤로
            if (!va) return 1
            if (!vb) return -1
            const cmp = va.localeCompare(vb, 'ko', { numeric: true })
            return dir === 'asc' ? cmp : -cmp
          }
        }
        return 0
      })
    } else {
      const key: EditField = view === 'cutoff' ? 'doc_cutoff_date' : 'updated_etd'
      list = [...list].sort((a, b) => (a[key] || '9999').localeCompare(b[key] || '9999'))
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, view, handlerId, carrier, keyword, etdFrom, etdTo, sorts, edits, serviceCol])

  // ── 편집 ─────────────────────────────────────────────────────────
  const applyValue = (b: Booking, raw: string) => {
    const v = raw ? (normalizeDateInput(raw) || null) : null
    const next: Partial<Booking> = { [editField]: v } as Partial<Booking>
    if (editField === 'updated_etd') {
      const eta = calcEta(v, b.carrier, b.discharge_port, etaTransitDays)
      if (eta) next.eta = eta
    }
    setEdits(p => ({ ...p, [b.id]: { ...(p[b.id] || {}), ...next } }))
  }

  const changedIds = useMemo(() => Object.keys(edits).filter(id => {
    const b = bookings.find(x => x.id === id)
    if (!b) return false
    return Object.entries(edits[id]).some(([k, v]) => (b[k as keyof Booking] ?? null) !== (v ?? null))
  }), [edits, bookings])

  const save = () => {
    if (changedIds.length === 0) return
    setMsg(null)
    const list = changedIds.map(id => ({ id, data: edits[id] as Record<string, unknown> }))
    startTransition(async () => {
      const { errors } = await bulkSaveBookings(list, [])
      if (Object.keys(errors).length > 0) { setMsg('저장 실패: ' + Object.values(errors)[0]); return }
      setEdits({})
      setMsg(`${list.length}건 저장 완료 — 부킹장에도 반영되었습니다.`)
      router.refresh()
    })
  }

  // ── 범위 선택 · 복사 · 붙여넣기 ──────────────────────────────────
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null)
  const [focusCell, setFocusCell] = useState<{ r: number; c: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const draggingRef = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [bulkDate, setBulkDate] = useState('')

  useEffect(() => {
    const up = () => { draggingRef.current = false }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const selRange = useMemo(() => {
    if (!anchor || !focusCell) return null
    return {
      r1: Math.min(anchor.r, focusCell.r), r2: Math.max(anchor.r, focusCell.r),
      c1: Math.min(anchor.c, focusCell.c), c2: Math.max(anchor.c, focusCell.c),
    }
  }, [anchor, focusCell])

  const buildCopy = () => {
    if (!selRange) return null
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const plain: string[] = [], html: string[] = []
    for (let r = selRange.r1; r <= selRange.r2; r++) {
      const b = rows[r]
      if (!b) continue
      const cells: string[] = []
      for (let c = selRange.c1; c <= selRange.c2; c++) cells.push(cellText(b, cols[c].key))
      plain.push(cells.join('\t'))
      html.push('<tr>' + cells.map(v => `<td>${esc(v)}</td>`).join('') + '</tr>')
    }
    if (plain.length === 0) return null
    return { plain: plain.join('\n'), html: `<table>${html.join('')}</table>` }
  }
  const copyRef = useRef(buildCopy)
  copyRef.current = buildCopy

  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const ae = document.activeElement
      if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return
      const data = copyRef.current()
      if (!data) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', data.plain)
      e.clipboardData?.setData('text/html', data.html)
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [])

  // 붙여넣기 — 선택 범위의 첫 행부터 아래로 채움 (한 칸만 복사했으면 전체에 동일 적용)
  const handlePaste = (e: React.ClipboardEvent) => {
    const ae = document.activeElement
    if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return
    if (!selRange) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const vals = text.replace(/\r/g, '').split('\n').map(l => l.split('\t')[0].trim()).filter(l => l !== '')
    if (vals.length === 0) return
    const count = selRange.r2 - selRange.r1 + 1
    for (let i = 0; i < Math.max(count, vals.length); i++) {
      const b = rows[selRange.r1 + i]
      if (!b) break
      const v = vals.length === 1 ? vals[0] : vals[i]
      if (v === undefined) break
      applyValue(b, v)
    }
    setMsg(null)
  }

  // 선택 범위에 날짜 일괄 적용
  const applyBulk = () => {
    if (!selRange) { alert('표에서 적용할 행을 드래그해 선택하세요.'); return }
    if (!bulkDate) { alert('적용할 날짜를 선택하세요.'); return }
    for (let r = selRange.r1; r <= selRange.r2; r++) {
      const b = rows[r]
      if (b) applyValue(b, bulkDate)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setAnchor({ r: 0, c: 0 }); setFocusCell({ r: rows.length - 1, c: cols.length - 1 })
      return
    }
    if (e.key === 'Delete' && selRange) {
      e.preventDefault()
      for (let r = selRange.r1; r <= selRange.r2; r++) {
        const b = rows[r]
        if (b) applyValue(b, '')
      }
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
      r: Math.max(0, Math.min(rows.length - 1, cur.r + d[0])),
      c: Math.max(0, Math.min(cols.length - 1, cur.c + d[1])),
    }
    setFocusCell(next)
    if (!e.shiftKey) setAnchor(next)
  }

  // ── 엑셀 다운로드 ────────────────────────────────────────────────
  const exportExcel = () => {
    import('xlsx-js-style').then((mod) => {
      const XLSX = (mod as unknown as { default: typeof import('xlsx-js-style') }).default ?? mod
      const header = cols.map(c => c.label)
      const aoa = [header, ...rows.map(b => cols.map(c => cellText(b, c.key)))]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      const thin = { style: 'thin', color: { rgb: 'D1D5DB' } } as const
      cols.forEach((c, i) => {
        const addr = XLSX.utils.encode_cell({ r: 0, c: i })
        if (!ws[addr]) ws[addr] = { t: 's', v: c.label }
        ws[addr].s = {
          font: { bold: true, sz: 10, name: '맑은 고딕', color: { rgb: 'FFFFFF' } },
          fill: { patternType: 'solid', fgColor: { rgb: '1E40AF' } },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: { top: thin, bottom: thin, left: thin, right: thin },
        }
      })
      rows.forEach((_, ri) => {
        cols.forEach((c, ci) => {
          const addr = XLSX.utils.encode_cell({ r: ri + 1, c: ci })
          if (!ws[addr]) ws[addr] = { t: 's', v: '' }
          ws[addr].s = {
            font: { sz: 10, name: '맑은 고딕' },
            alignment: { vertical: 'center', horizontal: c.edit ? 'center' : 'left' },
            border: { top: thin, bottom: thin, left: thin, right: thin },
          }
        })
      })
      ws['!cols'] = cols.map(c => ({ wch: Math.round(c.w / 8) }))
      ws['!freeze'] = { xSplit: 0, ySplit: 1 }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, view === 'cutoff' ? '미마감현황' : 'ETD UPDATE')
      XLSX.writeFile(wb, `${view === 'cutoff' ? '미마감현황' : 'ETD_UPDATE'}_${format(new Date(), 'yyyyMMdd')}.xlsx`, { cellStyles: true })
    })
  }

  const th = 'px-2 py-2 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50 border-b-2 border-slate-200 cursor-pointer select-none hover:bg-slate-100'
  const tdCls = 'px-2 py-1 text-xs text-slate-700 whitespace-nowrap border-b border-slate-100'

  return (
    <div className="space-y-3">
      {/* 뷰 전환 + 저장 */}
      <div className="flex flex-wrap items-center gap-2">
        {([['cutoff', '미마감 현황'], ['etd', 'ETD UPDATE']] as [View, string][]).map(([v, label]) => (
          <button key={v} onClick={() => { setView(v); setAnchor(null); setFocusCell(null); setSorts([]) }}
            className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors border ${
              view === v ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}>{label}</button>
        ))}
        <div className="flex-1" />
        {msg && <span className={`text-xs ${msg.startsWith('저장 실패') ? 'text-red-600' : 'text-emerald-600'}`}>{msg}</span>}
        {changedIds.length > 0 && (
          <>
            <button onClick={() => setEdits({})}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">되돌리기</button>
            <button onClick={save} disabled={isPending}
              className="text-sm px-4 py-2 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 disabled:opacity-40">
              {isPending ? '저장 중...' : `변경 ${changedIds.length}건 저장`}
            </button>
          </>
        )}
      </div>

      {/* 검색 조건 */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-end gap-3 shadow-sm">
        <div>
          <label className="text-[11px] text-slate-500 block mb-1 font-medium">포워더 담당</label>
          <select value={handlerId} onChange={e => setHandlerId(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">전체</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{p.name}{p.id === currentUserId ? ' (나)' : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1 font-medium">선사</label>
          <select value={carrier} onChange={e => setCarrier(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">전체</option>
            {carriers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1 font-medium">UPDATED ETD 기간</label>
          <div className="flex items-center gap-1">
            <input type="date" value={etdFrom} onChange={e => setEtdFrom(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
            <span className="text-xs text-slate-400">~</span>
            <input type="date" value={etdTo} onChange={e => setEtdTo(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
          </div>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="text-[11px] text-slate-500 block mb-1 font-medium">검색</label>
          <input list="cutoff-kw" value={keyword} onChange={e => setKeyword(e.target.value)}
            placeholder="도착지 · 양하항 · 모선명 · 부킹번호"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
          <datalist id="cutoff-kw">{keywordOptions.map(o => <option key={o} value={o} />)}</datalist>
        </div>
        <div className="text-xs text-slate-500 pb-1.5">
          {rows.length}건{view === 'cutoff' && <span className="text-slate-400"> (마감 제외)</span>}
        </div>
      </div>

      {/* 일괄 입력 · 복사 · 엑셀 */}
      <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 shadow-sm">
        <span className="text-xs font-bold text-slate-500">
          {view === 'cutoff' ? '서류마감 일괄' : 'UPDATED ETD 일괄'}
        </span>
        <input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
        <button onClick={applyBulk}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          선택 범위에 적용{selRange ? ` (${selRange.r2 - selRange.r1 + 1}행)` : ''}
        </button>
        <span className="text-[11px] text-slate-400">
          드래그로 범위 선택 → Ctrl+C 복사 / Ctrl+V 붙여넣기(엑셀 날짜 세로 복사 지원) · Delete로 비우기
        </span>
        <div className="flex-1" />
        {copied && <span className="text-[11px] text-emerald-600">복사됨!</span>}
        <button onClick={exportExcel}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium">
          엑셀 다운로드
        </button>
      </div>

      {/* 표 */}
      <div ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown} onPaste={handlePaste}
        className="bg-white border border-slate-200 rounded-xl overflow-auto outline-none"
        style={{ maxHeight: 'calc(100vh - 330px)' }}>
        <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>{cols.map(c => <col key={c.key} style={{ width: c.w }} />)}</colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              {cols.map(c => {
                const si = sorts.findIndex(s => s.col === c.key)
                return (
                  <th key={c.key} className={th} onClick={() => toggleSort(c.key)}
                    title="클릭: 오름차순 → 내림차순 → 해제 (여러 열을 누르면 1·2·3차 정렬)">
                    {c.label}
                    {si !== -1 && (
                      <span className="ml-0.5 text-blue-600 font-bold">
                        {sorts.length > 1 ? `${si + 1}` : ''}{sorts[si].dir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols.length} className="py-10 text-center text-sm text-slate-400">
                조건에 맞는 부킹이 없습니다.
              </td></tr>
            )}
            {rows.map((b, r) => {
              const dirty = !!edits[b.id]
              return (
                <tr key={b.id} className={dirty ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                  {cols.map((c, ci) => {
                    const sel = selRange && r >= selRange.r1 && r <= selRange.r2 && ci >= selRange.c1 && ci <= selRange.c2
                    return (
                      <td key={c.key}
                        className={tdCls}
                        onMouseDown={e => {
                          if (e.button !== 0) return
                          draggingRef.current = true
                          wrapRef.current?.focus()
                          if (e.shiftKey && anchor) setFocusCell({ r, c: ci })
                          else { setAnchor({ r, c: ci }); setFocusCell({ r, c: ci }) }
                        }}
                        onMouseEnter={() => { if (draggingRef.current) setFocusCell({ r, c: ci }) }}
                        style={{
                          background: sel ? '#cfe2ff' : undefined,
                          cursor: 'cell', userSelect: 'none',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                        {c.edit ? (
                          <input type="date" value={valueOf(b, c.edit) || ''}
                            onMouseDown={e => e.stopPropagation()}
                            onChange={e => applyValue(b, e.target.value)}
                            className={`text-xs border rounded px-1 py-0.5 w-full ${
                              dirty ? 'border-amber-400 bg-white font-semibold' : 'border-slate-200 bg-white'
                            }`} />
                        ) : (
                          <span className={c.key === 'booking_no' ? 'font-mono text-blue-700' : c.key === 'dest' ? 'font-medium text-slate-800' : ''}>
                            {cellText(b, c.key) || '-'}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400">
        {view === 'cutoff'
          ? '마감 완료되지 않은 부킹만, UPDATED ETD 기간으로 조회합니다. 서류마감일을 바꾸고 저장하면 부킹장에 반영됩니다.'
          : 'UPDATED ETD를 바꾸고 저장하면 부킹장에 반영됩니다. 선사·양하항 운송일수 규칙이 있으면 ETA도 함께 갱신됩니다.'}
        {selRange && ` · 선택 ${selRange.r2 - selRange.r1 + 1}행 × ${selRange.c2 - selRange.c1 + 1}열`}
        {editColIdx >= 0 && ` · 붙여넣기는 ${cols[editColIdx].label} 열에 적용됩니다.`}
      </p>
    </div>
  )
}
