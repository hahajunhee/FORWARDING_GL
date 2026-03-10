'use client'

import { useState, useMemo, useTransition, useEffect } from 'react'
import { format, parseISO, isValid } from 'date-fns'
import type { Booking, ColumnDefinition } from '@/types'
import { COLUMN_LABELS, DEFAULT_COLUMN_ORDER } from '@/types'
import { formatContainers } from './BookingTable'
import { saveGlobalScheduleCols } from '@/app/settings/actions'

// 기본 열 (containers 포함)
const BASE_AVAILABLE_COLS = DEFAULT_COLUMN_ORDER.filter(k => k !== 'containers').concat(['containers'])

const DEFAULT_SCHED_COLS = [
  'final_destination', 'discharge_port', 'carrier', 'vessel_name',
  'booking_no', 'updated_etd', 'eta', 'containers',
]

function fmtDate(d: string | null | undefined): string {
  if (!d) return '-'
  try { const p = parseISO(d); return isValid(p) ? format(p, 'yy/MM/dd') : '-' } catch { return '-' }
}

function getCellValue(booking: Booking, col: string, customCols: ColumnDefinition[] = []): string {
  switch (col) {
    case 'booking_no': return (booking.booking_entries && booking.booking_entries.length > 0)
      ? booking.booking_entries.map(e => e.no).join(' / ')
      : (booking.booking_no || '')
    case 'final_destination': return booking.final_destination || ''
    case 'discharge_port': return booking.discharge_port || ''
    case 'carrier': return booking.carrier || ''
    case 'vessel_name': return booking.vessel_name || ''
    case 'secured_space': return booking.secured_space || ''
    case 'mqc': return booking.mqc || ''
    case 'customer_doc_handler': return booking.customer_doc_handler || ''
    case 'forwarder_handler': return booking.forwarder_handler?.name || ''
    case 'doc_cutoff_date': return fmtDate(booking.doc_cutoff_date)
    case 'proforma_etd': return fmtDate(booking.proforma_etd)
    case 'updated_etd': return fmtDate(booking.updated_etd)
    case 'eta': return fmtDate(booking.eta)
    case 'containers': return formatContainers(booking)
    case 'remarks': return booking.remarks || ''
    default: {
      const cd = customCols.find(c => c.key === col)
      if (cd) return (booking.extra_data as Record<string, string> | null)?.[col] || ''
      return ''
    }
  }
}

// rowSpan 계산: 계층적 병합 (최종도착지 → 양하항 → 선사)
function buildHierarchicalSpans(rows: Booking[]): Record<string, number[]> {
  const n = rows.length
  const result: Record<string, number[]> = {
    final_destination: Array(n).fill(1),
    discharge_port: Array(n).fill(1),
    carrier: Array(n).fill(1),
  }
  const fd = (b: Booking) => b.final_destination || ''
  const dp = (b: Booking) => b.discharge_port || ''
  const ca = (b: Booking) => b.carrier || ''

  let i = 0
  while (i < n) {
    const v = fd(rows[i]); if (!v) { i++; continue }
    let j = i + 1; while (j < n && fd(rows[j]) === v) j++
    if (j - i > 1) { result.final_destination[i] = j - i; for (let k = i + 1; k < j; k++) result.final_destination[k] = 0 }
    i = j
  }
  i = 0
  while (i < n) {
    const fv = fd(rows[i]); const v = dp(rows[i]); if (!v) { i++; continue }
    let j = i + 1; while (j < n && dp(rows[j]) === v && fd(rows[j]) === fv) j++
    if (j - i > 1) { result.discharge_port[i] = j - i; for (let k = i + 1; k < j; k++) result.discharge_port[k] = 0 }
    i = j
  }
  i = 0
  while (i < n) {
    const fv = fd(rows[i]); const dv = dp(rows[i]); const v = ca(rows[i]); if (!v) { i++; continue }
    let j = i + 1; while (j < n && ca(rows[j]) === v && dp(rows[j]) === dv && fd(rows[j]) === fv) j++
    if (j - i > 1) { result.carrier[i] = j - i; for (let k = i + 1; k < j; k++) result.carrier[k] = 0 }
    i = j
  }
  return result
}

type SortLevel = { col: string; dir: 'asc' | 'desc' } | null

interface Props {
  bookings: Booking[]
  customColumns: ColumnDefinition[]
  initialScheduleCols: string[] | null
}

export default function ScheduleTab({ bookings, customColumns, initialScheduleCols }: Props) {
  // ETD 기본값: 이번 달 1일 ~ 말일
  const now = new Date()
  const defaultFrom = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd')
  const defaultTo = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), 'yyyy-MM-dd')

  const [etdFrom, setEtdFrom] = useState(defaultFrom)
  const [etdTo, setEtdTo] = useState(defaultTo)
  const [selectedCols, setSelectedCols] = useState<string[]>(
    initialScheduleCols && initialScheduleCols.length > 0 ? initialScheduleCols : DEFAULT_SCHED_COLS
  )
  const [sort1, _setSort1] = useState<SortLevel>(null)
  const [sort2, _setSort2] = useState<SortLevel>(null)
  const [sort3, _setSort3] = useState<SortLevel>(null)
  const [mergeEnabled, _setMergeEnabled] = useState(true)

  useEffect(() => {
    try {
      const s1 = localStorage.getItem('sched_sort1')
      if (s1) _setSort1(JSON.parse(s1))
      const s2 = localStorage.getItem('sched_sort2')
      if (s2) _setSort2(JSON.parse(s2))
      const s3 = localStorage.getItem('sched_sort3')
      if (s3) _setSort3(JSON.parse(s3))
      const me = localStorage.getItem('sched_mergeEnabled')
      if (me !== null) _setMergeEnabled(me === 'true')
    } catch {}
  }, [])

  const ls = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch {} }
  const setSort1 = (v: SortLevel) => { _setSort1(v); ls('sched_sort1', JSON.stringify(v)) }
  const setSort2 = (v: SortLevel) => { _setSort2(v); ls('sched_sort2', JSON.stringify(v)) }
  const setSort3 = (v: SortLevel) => { _setSort3(v); ls('sched_sort3', JSON.stringify(v)) }
  const setMergeEnabled = (v: boolean) => { _setMergeEnabled(v); ls('sched_mergeEnabled', String(v)) }

  // 전체 저장 UI
  const [savePassword, setSavePassword] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // 사용 가능한 모든 열
  const availableCols = useMemo(() => [
    ...BASE_AVAILABLE_COLS,
    ...customColumns.map(c => c.key),
  ], [customColumns])

  // 전체 열 라벨 맵
  const allLabels = useMemo(() => {
    const m: Record<string, string> = { ...COLUMN_LABELS }
    for (const cd of customColumns) m[cd.key] = cd.label
    return m
  }, [customColumns])

  const toggleCol = (col: string) => {
    setSelectedCols(prev => prev.includes(col)
      ? prev.filter(c => c !== col)
      : [...prev, col]
    )
  }

  const moveUp = (idx: number) => {
    if (idx === 0) return
    const next = [...selectedCols]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setSelectedCols(next)
  }

  const moveDown = (idx: number) => {
    if (idx === selectedCols.length - 1) return
    const next = [...selectedCols]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setSelectedCols(next)
  }

  const handleGlobalSave = () => {
    setSaveError(null)
    startTransition(async () => {
      setSaveState('saving')
      const result = await saveGlobalScheduleCols(selectedCols, savePassword)
      if (result.error) {
        setSaveError(result.error)
        setSaveState('error')
      } else {
        setSaveState('saved')
        setSavePassword('')
        setTimeout(() => setSaveState('idle'), 3000)
      }
    })
  }

  // ETD 기준 필터 + 다중 정렬
  const filtered = useMemo(() => {
    const etdFiltered = bookings.filter(b => {
      const etd = b.updated_etd || b.proforma_etd
      if (!etd) return false
      if (etdFrom && etd < etdFrom) return false
      if (etdTo && etd > etdTo) return false
      return true
    })

    const levels = [sort1, sort2, sort3].filter(Boolean) as { col: string; dir: 'asc' | 'desc' }[]
    if (levels.length === 0) {
      return [...etdFiltered].sort((a, b) => {
        const ea = a.updated_etd || a.proforma_etd || ''
        const eb = b.updated_etd || b.proforma_etd || ''
        return ea < eb ? -1 : 1
      })
    }
    return [...etdFiltered].sort((a, b) => {
      for (const level of levels) {
        const va = getCellValue(a, level.col, customColumns)
        const vb = getCellValue(b, level.col, customColumns)
        const cmp = va < vb ? -1 : va > vb ? 1 : 0
        if (cmp !== 0) return level.dir === 'asc' ? cmp : -cmp
      }
      return 0
    })
  }, [bookings, etdFrom, etdTo, sort1, sort2, sort3, customColumns])

  const hasSorts = !!(sort1 || sort2 || sort3)

  // rowSpan 계산 (병합 활성 시 — 최종도착지/양하항/선사만 계층 병합)
  const rowSpanMap = useMemo(() => {
    if (!mergeEnabled || !hasSorts || filtered.length === 0) return null
    return buildHierarchicalSpans(filtered)
  }, [filtered, mergeEnabled, hasSorts])

  const exportToExcel = () => {
    import('xlsx').then((XLSX) => {
      const header = selectedCols.map(c => allLabels[c] || c)
      const rows = filtered.map(b => selectedCols.map(c => getCellValue(b, c, customColumns)))
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
      ws['!cols'] = header.map((h, i) => ({
        wch: Math.max(h.length + 2, ...rows.map(r => String(r[i] || '').length))
      }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '스케줄')
      XLSX.writeFile(wb, `스케줄_${etdFrom}_${etdTo}.xlsx`)
    })
  }

  const sortOptions = [
    { value: '', label: '정렬 없음' },
    ...selectedCols.map(col => ({ value: col, label: allLabels[col] || col })),
  ]

  function SortSelect({ value, onChange, label }: {
    value: SortLevel; onChange: (v: SortLevel) => void; label: string
  }) {
    const col = value?.col || ''
    const dir = value?.dir || 'asc'
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 w-8 flex-shrink-0">{label}</span>
        <select value={col} onChange={e => {
          const newCol = e.target.value
          onChange(newCol ? { col: newCol, dir } : null)
        }} className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
          {sortOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {col && (
          <button onClick={() => onChange({ col, dir: dir === 'asc' ? 'desc' : 'asc' })}
            className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors min-w-[44px]">
            {dir === 'asc' ? '↑ 오름' : '↓ 내림'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 필터 + 열 설정 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ETD 필터 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900">ETD 기간 필터</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={etdFrom} onChange={e => setEtdFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-gray-400 text-sm">~</span>
            <input type="date" value={etdTo} onChange={e => setEtdTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[7, 14, 30, 60].map(days => (
              <button key={days} onClick={() => {
                setEtdFrom(format(new Date(), 'yyyy-MM-dd'))
                setEtdTo(format(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days), 'yyyy-MM-dd'))
              }} className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors">
                +{days}일
              </button>
            ))}
            <button onClick={() => { setEtdFrom(defaultFrom); setEtdTo(defaultTo) }}
              className="text-xs px-2.5 py-1 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors">
              이번달
            </button>
          </div>
          <p className="text-sm text-gray-500">
            조회결과: <span className="font-semibold text-blue-700">{filtered.length}건</span>
          </p>
        </div>

        {/* 열 구성 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900">열 구성</h3>
          <div className="text-xs text-gray-400">체크: 포함 여부 · ↑↓: 순서 변경</div>

          <div className="flex gap-3">
            {/* 비선택 열 */}
            <div className="flex-1 space-y-1 max-h-52 overflow-y-auto">
              <p className="text-xs text-gray-400 font-medium sticky top-0 bg-white py-0.5">제외</p>
              {availableCols.filter(c => !selectedCols.includes(c)).map(col => (
                <label key={col} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={false} onChange={() => toggleCol(col)} className="rounded" />
                  <span className="text-xs text-gray-500">{allLabels[col] || col}</span>
                </label>
              ))}
            </div>
            <div className="w-px bg-gray-200 flex-shrink-0" />
            {/* 선택된 열 */}
            <div className="flex-1 space-y-1 max-h-52 overflow-y-auto">
              <p className="text-xs text-gray-400 font-medium sticky top-0 bg-white py-0.5">포함 (순서대로)</p>
              {selectedCols.map((col, idx) => (
                <div key={col} className="flex items-center gap-1 py-1 px-2 rounded bg-blue-50/50">
                  <input type="checkbox" checked onChange={() => toggleCol(col)} className="rounded" />
                  <span className="text-xs text-blue-700 flex-1 font-medium">{allLabels[col] || col}</span>
                  <button onClick={() => moveUp(idx)} disabled={idx === 0}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-20 text-sm w-4">↑</button>
                  <button onClick={() => moveDown(idx)} disabled={idx === selectedCols.length - 1}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-20 text-sm w-4">↓</button>
                </div>
              ))}
            </div>
          </div>

          {/* 전체 저장 (비밀번호) */}
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-xs text-gray-500">전체 유저 열 구성 저장 (비밀번호 필요)</p>
            <div className="flex gap-2">
              <input type="password" value={savePassword} onChange={e => setSavePassword(e.target.value)}
                placeholder="비밀번호"
                className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={handleGlobalSave} disabled={isPending || !savePassword}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saveState === 'saving' ? '저장 중...' : '전체 적용'}
              </button>
              {saveState === 'saved' && <span className="text-xs text-green-600 self-center font-medium">✓ 저장됨</span>}
            </div>
            {saveError && <p className="text-xs text-red-600">{saveError}</p>}
          </div>
        </div>
      </div>

      {/* 정렬 설정 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-gray-900">정렬 설정</h3>
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={mergeEnabled} onChange={e => setMergeEnabled(e.target.checked)} className="rounded" />
            정렬 시 동일값 셀 병합
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SortSelect value={sort1} onChange={setSort1} label="1차" />
          <SortSelect value={sort2} onChange={setSort2} label="2차" />
          <SortSelect value={sort3} onChange={setSort3} label="3차" />
        </div>
        {hasSorts && mergeEnabled && (
          <p className="text-xs text-gray-400">정렬 활성: 연속 동일값 셀이 병합됩니다.</p>
        )}
      </div>

      {/* 액션 버튼 */}
      <div className="flex items-center gap-3">
        <button onClick={exportToExcel} disabled={filtered.length === 0 || selectedCols.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Excel 다운로드
        </button>
        <span className="text-xs text-gray-400">고객사 송부용 · {filtered.length}건 · {selectedCols.length}개 열</span>
      </div>

      {/* 미리보기 테이블 */}
      {filtered.length > 0 && selectedCols.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600">미리보기</span>
            <span className="text-xs text-gray-400">{filtered.length}건</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b-2 border-gray-300">
                  {selectedCols.map(col => (
                    <th key={col} className="text-center px-3 py-2 font-semibold text-gray-600 whitespace-nowrap border-r border-gray-200 last:border-0">
                      {allLabels[col] || col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((booking, rowIdx) => {
                  const hasVisibleCells = !rowSpanMap || selectedCols.some(col => (rowSpanMap[col]?.[rowIdx] ?? 1) !== 0)
                  if (!hasVisibleCells) return null

                  return (
                    <tr key={booking.id} className={`border-b border-gray-200 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      {selectedCols.map(col => {
                        const span = rowSpanMap ? (rowSpanMap[col]?.[rowIdx] ?? 1) : 1
                        if (span === 0) return null
                        const value = getCellValue(booking, col, customColumns)
                        return (
                          <td key={col}
                            rowSpan={span > 1 ? span : undefined}
                            className={`px-3 py-2 text-gray-700 border-r border-gray-200 last:border-0 whitespace-nowrap text-center align-middle ${span > 1 ? 'bg-blue-50/60 font-semibold' : ''}`}
                            style={span > 1 ? { borderBottom: '2px solid #93c5fd', borderTop: '2px solid #93c5fd' } : undefined}>
                            {value || <span className="text-gray-300">-</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400">
          <p className="text-sm">
            {filtered.length === 0 ? '해당 기간에 부킹이 없습니다.' : '열을 하나 이상 선택해주세요.'}
          </p>
        </div>
      )}
    </div>
  )
}
