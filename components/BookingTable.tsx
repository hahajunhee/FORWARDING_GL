'use client'

import { useState, useMemo, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { differenceInCalendarDays, parseISO, isValid, format, addDays } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { Booking, Profile, CustomList, ColumnDefinition, BookingEntry, TableStyle } from '@/types'
import { DEFAULT_COLUMN_ORDER, DEFAULT_PINNED_COLUMNS, CARRIERS, MAJOR_PORTS, DEFAULT_DESTINATIONS, DEFAULT_TABLE_STYLE } from '@/types'
import { deleteBooking, saveColumnOrder, bulkSaveBookings, bulkDeleteBookings } from '@/app/bookings/actions'

// ── BLANK SAILING / 주차 헬퍼 ───────────────────────────────────
const WEEK1_START = new Date('2025-12-29') // 1주차 기준일(월요일)

interface BlankSailingRow {
  _blankSailing: true
  id: string
  final_destination: string
  discharge_port: string
  carrier: string
  weekNum: number
}

type DisplayRow = Booking | BlankSailingRow

function getWeekNum(d: string | null | undefined): number | null {
  if (!d) return null
  try {
    const p = parseISO(d)
    if (!isValid(p)) return null
    return Math.floor(differenceInCalendarDays(p, WEEK1_START) / 7) + 1
  } catch { return null }
}

// 리퍼 전용 행 판별: 컨테이너가 40RF/리퍼만 있으면 true
function isReeferOnly(b: Booking): boolean {
  if (b.booking_entries && b.booking_entries.length > 0) {
    return b.booking_entries.every(e => /rf|reefer|리퍼/i.test(e.ctr_type))
  }
  const hasNonReefer = (b.qty_20_normal || 0) + (b.qty_20_dg || 0) + (b.qty_20_reefer || 0)
    + (b.qty_40_normal || 0) + (b.qty_40_dg || 0)
  return hasNonReefer === 0 && (b.qty_40_reefer || 0) > 0
}

// RF 컨테이너 포함 여부 (리퍼별도 정렬용)
function hasReeferContainer(b: Booking): boolean {
  if (b.booking_entries && b.booking_entries.length > 0) {
    return b.booking_entries.some(e => /rf|reefer|리퍼/i.test(e.ctr_type))
  }
  return (b.qty_20_reefer || 0) > 0 || (b.qty_40_reefer || 0) > 0
}

function getWeekLabel(weekNum: number): string {
  const start = addDays(WEEK1_START, (weekNum - 1) * 7)
  const end = addDays(start, 6)
  return `${weekNum}주차 (${format(start, 'M/d')}~${format(end, 'M/d')})`
}

function getWeekStartDate(weekNum: number): string {
  return format(addDays(WEEK1_START, (weekNum - 1) * 7), 'yyyy-MM-dd')
}

function getWeekEndDate(weekNum: number): string {
  return format(addDays(WEEK1_START, weekNum * 7 - 1), 'yyyy-MM-dd')
}

// 병합 대상 열 (최종도착지만 병합)
const MERGE_HIERARCHY = ['final_destination'] as const

// ── 기본 열 정의 ───────────────────────────────────────────────────

const BASE_COL_DEFS: Record<string, { label: string; minW: number }> = {
  booking_no:           { label: '부킹번호',      minW: 200 },
  final_destination:    { label: '최종도착지',     minW: 120 },
  discharge_port:       { label: '양하항',         minW: 120 },
  carrier:              { label: '선사',            minW: 100 },
  vessel_name:          { label: '모선명',          minW: 140 },
  voyage:               { label: 'VOYAGE',           minW: 90  },
  secured_space:        { label: '확보선복',        minW: 90  },
  mqc:                  { label: 'MQC',             minW: 80  },
  customer_doc_handler: { label: '고객사 서류',     minW: 110 },
  forwarder_handler:    { label: '포워더 담당',     minW: 100 },
  handler_region:       { label: '담당지역',        minW: 90  },
  handler_customers:    { label: '담당고객사',      minW: 110 },
  doc_cutoff_date:      { label: '서류마감',        minW: 100 },
  proforma_etd:         { label: 'PROFORMA ETD',    minW: 110 },
  updated_etd:          { label: 'UPDATED ETD',     minW: 110 },
  eta:                  { label: 'ETA',             minW: 90  },
  containers:           { label: '컨테이너',        minW: 120 },
  final_qty:            { label: '최종수량',        minW: 80  },
  remarks:              { label: '비고',            minW: 160 },
  week_no:              { label: '주차',             minW: 150 },
}

// pinnedColumns 기준으로 sticky left 오프셋 계산 (colWidths 반영)
function getFixedLeft(
  col: string,
  pinnedCols: string[],
  colDefs: Record<string, { label: string; minW: number }>,
  colWidths: Record<string, number>,
): number | null {
  const idx = pinnedCols.indexOf(col)
  if (idx === -1) return null
  let left = 36 // checkbox 열 너비
  for (let i = 0; i < idx; i++) {
    const k = pinnedCols[i]
    left += colWidths[k] || colDefs[k]?.minW || 100
  }
  return left
}

function normalizeColOrder(stored: string[] | null | undefined, allKeys: string[]): string[] {
  if (!stored || stored.length === 0) return allKeys
  const valid = stored.filter((k: string) => allKeys.includes(k))
  const missing = allKeys.filter(k => !stored.includes(k))
  return [...valid, ...missing]
}

// ── 헬퍼 ──────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return '-'
  try { const p = parseISO(d); return isValid(p) ? format(p, 'MM/dd') : '-' } catch { return '-' }
}

function getDocClass(d: string | null | undefined): string {
  if (!d) return ''
  try {
    const diff = differenceInCalendarDays(parseISO(d), new Date())
    if (diff < 0) return 'bg-gray-100 text-gray-400'
    if (diff <= 3) return 'bg-red-100 text-red-700 font-semibold'
    if (diff <= 7) return 'bg-yellow-100 text-yellow-700'
    return ''
  } catch { return '' }
}

function getDayLabel(d: string | null | undefined): string {
  if (!d) return ''
  try {
    const diff = differenceInCalendarDays(parseISO(d), new Date())
    if (diff === 0) return 'D-day'
    if (diff > 0) return `D-${diff}`
    return `D+${Math.abs(diff)}`
  } catch { return '' }
}

function getEtdClass(d: string | null | undefined): string {
  if (!d) return ''
  try {
    const diff = differenceInCalendarDays(parseISO(d), new Date())
    if (diff < 0) return 'text-gray-400'
    if (diff <= 3) return 'text-orange-600 font-medium'
    return ''
  } catch { return '' }
}

// 부킹수량 자동계산 (20ft = 0.5, 40ft = 1) — 날짜 조건 없음
export function calcTotalQty(b: Partial<Booking>): number {
  if (b.booking_entries && b.booking_entries.length > 0) {
    return b.booking_entries.reduce((sum, e) => {
      const mult = e.ctr_type.startsWith('20') ? 0.5 : 1
      return sum + (e.ctr_qty || 0) * mult
    }, 0)
  }
  const qty20 = (b.qty_20_normal || 0) + (b.qty_20_dg || 0) + (b.qty_20_reefer || 0)
  const qty40 = (b.qty_40_normal || 0) + (b.qty_40_dg || 0) + (b.qty_40_reefer || 0)
  return qty20 * 0.5 + qty40
}

export function formatContainers(b: Partial<Booking>): string {
  if (b.booking_entries && b.booking_entries.length > 0) {
    return b.booking_entries.map(e => `${e.ctr_type}×${e.ctr_qty}`).join(' / ')
  }
  const parts: string[] = []
  if (b.qty_20_normal) parts.push(`20일반×${b.qty_20_normal}`)
  if (b.qty_20_dg) parts.push(`20DG×${b.qty_20_dg}`)
  if (b.qty_20_reefer) parts.push(`20리퍼×${b.qty_20_reefer}`)
  if (b.qty_40_normal) parts.push(`40일반×${b.qty_40_normal}`)
  if (b.qty_40_dg) parts.push(`40DG×${b.qty_40_dg}`)
  if (b.qty_40_reefer) parts.push(`40리퍼×${b.qty_40_reefer}`)
  return parts.join(' ') || '-'
}

function calcFinalQty(b: Booking): number | null {
  if (!b.doc_cutoff_date) return null
  try {
    const diff = differenceInCalendarDays(parseISO(b.doc_cutoff_date), new Date())
    if (diff >= 0) return null // 마감일이 오늘 이후면 표시 안 함
  } catch { return null }
  if (b.booking_entries && b.booking_entries.length > 0) {
    return b.booking_entries.reduce((sum, e) => {
      const mult = e.ctr_type.startsWith('20') ? 0.5 : 1
      return sum + (e.ctr_qty || 0) * mult
    }, 0)
  }
  const qty20 = (b.qty_20_normal || 0) + (b.qty_20_dg || 0) + (b.qty_20_reefer || 0)
  const qty40 = (b.qty_40_normal || 0) + (b.qty_40_dg || 0) + (b.qty_40_reefer || 0)
  return qty20 * 0.5 + qty40
}

function getMonthKey(d: string | null | undefined): string {
  if (!d) return 'none'
  try { const p = parseISO(d); return isValid(p) ? format(p, 'yyyy-MM') : 'none' } catch { return 'none' }
}

function getMonthLabel(key: string): string {
  if (key === 'none') return '날짜 미정'
  try { return format(parseISO(key + '-01'), 'yyyy년 M월', { locale: ko }) } catch { return key }
}

function getSortValue(b: Booking, col: string, customColumns: ColumnDefinition[]): string {
  switch (col) {
    case 'booking_no': return (b.booking_entries && b.booking_entries.length > 0) ? b.booking_entries[0].no : (b.booking_no || '')
    case 'final_destination': return b.final_destination || ''
    case 'discharge_port': return b.discharge_port || ''
    case 'carrier': return b.carrier || ''
    case 'vessel_name': return b.vessel_name || ''
    case 'voyage': return b.voyage || ''
    case 'secured_space': return b.secured_space || ''
    case 'mqc': return b.mqc || ''
    case 'customer_doc_handler': return b.customer_doc_handler || ''
    case 'forwarder_handler': return b.forwarder_handler?.name || ''
    case 'handler_region': return b.forwarder_handler?.region || ''
    case 'handler_customers': return b.forwarder_handler?.customers || ''
    case 'doc_cutoff_date': return b.doc_cutoff_date || ''
    case 'proforma_etd': return b.proforma_etd || ''
    case 'updated_etd': return b.updated_etd || ''
    case 'eta': return b.eta || ''
    case 'containers': return formatContainers(b)
    case 'remarks': return b.remarks || ''
    default: {
      const cd = customColumns.find(c => c.key === col)
      if (cd) return (b.extra_data as Record<string, string> | null)?.[col] || ''
      return ''
    }
  }
}

// ── 병합 스팬 계산 (계층적: 최종도착지 → 양하항 → 선사) ─────────

type SpanInfo = { span: number; skip: boolean }

type MergeableRow = { final_destination?: string | null; discharge_port?: string | null; carrier?: string | null }

function buildSpanMaps(rows: MergeableRow[], mergeEnabled: boolean): Record<string, SpanInfo[]> {
  const empty = () => rows.map((): SpanInfo => ({ span: 1, skip: false }))
  const maps: Record<string, SpanInfo[]> = {
    final_destination: empty(),
    discharge_port: empty(),
    carrier: empty(),
  }
  if (!mergeEnabled || rows.length === 0) return maps

  const fd = (b: MergeableRow) => b.final_destination || ''
  const dp = (b: MergeableRow) => b.discharge_port || ''
  const ca = (b: MergeableRow) => b.carrier || ''

  // 1. final_destination — 상위 제약 없음
  let i = 0
  while (i < rows.length) {
    const v = fd(rows[i]); if (!v) { i++; continue }
    let j = i + 1
    while (j < rows.length && fd(rows[j]) === v) j++
    if (j - i > 1) { maps.final_destination[i] = { span: j - i, skip: false }; for (let k = i + 1; k < j; k++) maps.final_destination[k] = { span: 1, skip: true } }
    i = j
  }

  // 2. discharge_port — 같은 final_destination 안에서만
  i = 0
  while (i < rows.length) {
    const fv = fd(rows[i]); const v = dp(rows[i]); if (!v) { i++; continue }
    let j = i + 1
    while (j < rows.length && dp(rows[j]) === v && fd(rows[j]) === fv) j++
    if (j - i > 1) { maps.discharge_port[i] = { span: j - i, skip: false }; for (let k = i + 1; k < j; k++) maps.discharge_port[k] = { span: 1, skip: true } }
    i = j
  }

  // 3. carrier — 같은 final_destination + discharge_port 안에서만
  i = 0
  while (i < rows.length) {
    const fv = fd(rows[i]); const dv = dp(rows[i]); const v = ca(rows[i]); if (!v) { i++; continue }
    let j = i + 1
    while (j < rows.length && ca(rows[j]) === v && dp(rows[j]) === dv && fd(rows[j]) === fv) j++
    if (j - i > 1) { maps.carrier[i] = { span: j - i, skip: false }; for (let k = i + 1; k < j; k++) maps.carrier[k] = { span: 1, skip: true } }
    i = j
  }

  return maps
}

function exportToExcel(rows: DisplayRow[], customColumns: ColumnDefinition[]) {
  import('xlsx').then((XLSX) => {
    const data = rows.map(r => {
      if ('_blankSailing' in r) {
        return {
          '부킹번호': '', '최종도착지': r.final_destination, '양하항': '', '담당선사': '',
          '모선명': 'BLANK SAILING', '주차': getWeekLabel(r.weekNum), '확보선복': '', 'MQC': '',
          '고객사서류담당': '', '포워더담당자': '', '서류마감일': '', 'Proforma ETD': '',
          'Updated ETD': '', 'ETA': '', '20일반': '', '20DG': '', '20리퍼': '',
          '40일반': '', '40DG': '', '40리퍼': '', '비고': '',
        }
      }
      const b = r as Booking
      const bookingNos = (b.booking_entries && b.booking_entries.length > 0)
        ? b.booking_entries.map(e => e.no).join(' / ')
        : b.booking_no
      const wn = getWeekNum(b.proforma_etd)
      const base: Record<string, unknown> = {
        '부킹번호': bookingNos, '최종도착지': b.final_destination, '양하항': b.discharge_port,
        '담당선사': b.carrier, '모선명': b.vessel_name, '주차': wn !== null ? getWeekLabel(wn) : '',
        '확보선복': b.secured_space, 'MQC': b.mqc,
        '고객사서류담당': b.customer_doc_handler, '포워더담당자': b.forwarder_handler?.name || '',
        '서류마감일': b.doc_cutoff_date || '', 'Proforma ETD': b.proforma_etd || '',
        'Updated ETD': b.updated_etd || '', 'ETA': b.eta || '',
        '20일반': b.qty_20_normal || 0, '20DG': b.qty_20_dg || 0, '20리퍼': b.qty_20_reefer || 0,
        '40일반': b.qty_40_normal || 0, '40DG': b.qty_40_dg || 0, '40리퍼': b.qty_40_reefer || 0,
        '비고': b.remarks,
      }
      for (const cd of customColumns) {
        base[cd.label] = (b.extra_data as Record<string, string> | null)?.[cd.key] || ''
      }
      return base
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '부킹목록')
    ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length, 8) }))
    XLSX.writeFile(wb, `부킹목록_${format(new Date(), 'yyyyMMdd')}.xlsx`)
  })
}

function exportInlandTransport(rows: Booking[]) {
  const headers = ['최종도착지', '선사', '부킹번호', '컨테이너', '부킹수량', '서류마감', '모선명', 'VOYAGE']
  const csvRows = rows.map(b => {
    const bookingNo = (b.booking_entries && b.booking_entries.length > 0)
      ? b.booking_entries.map(e => e.no).join(' / ')
      : (b.booking_no || '')
    const containers = formatContainers(b)
    const qty = calcTotalQty(b)
    const qtyStr = qty > 0 ? (qty % 1 === 0 ? String(qty) : qty.toFixed(1)) : ''
    return [
      b.final_destination || '',
      b.carrier || '',
      bookingNo,
      containers,
      qtyStr,
      b.doc_cutoff_date || '',
      b.vessel_name || '',
      b.voyage || '',
    ]
  })
  const esc = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v
  const content = [headers, ...csvRows].map(row => row.map(esc).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `내륙운송_${format(new Date(), 'yyyyMMdd')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── 컨테이너 편집 ─────────────────────────────────────────────────

type CtrKey = 'qty_20_normal' | 'qty_20_dg' | 'qty_20_reefer' | 'qty_40_normal' | 'qty_40_dg' | 'qty_40_reefer'
const CTR_FIELDS: { key: CtrKey; label: string }[] = [
  { key: 'qty_20_normal', label: '20일반' }, { key: 'qty_40_normal', label: '40일반' },
  { key: 'qty_20_dg',     label: '20DG'   }, { key: 'qty_40_dg',     label: '40DG'   },
  { key: 'qty_20_reefer', label: '20리퍼' }, { key: 'qty_40_reefer', label: '40리퍼' },
]

function ContainerEdit({ row, onChange }: { row: Partial<Booking>; onChange: (c: Partial<Booking>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
      {CTR_FIELDS.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-1">
          <span className="text-gray-400 text-xs w-10 shrink-0">{label}</span>
          <input type="number" min={0} max={99}
            value={(row[key] as number) ?? 0}
            onChange={e => onChange({ [key]: parseInt(e.target.value) || 0 })}
            className="w-10 border border-gray-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:border-blue-400"
          />
        </div>
      ))}
    </div>
  )
}

// ── 부킹 엔트리 편집 ──────────────────────────────────────────────

const CTR_TYPES = ['20', '20DG', '20RF', '40', '40DG', '40RF'] as const

function BookingEntriesEditor({ entries, onChange }: {
  entries: BookingEntry[]
  onChange: (entries: BookingEntry[]) => void
}) {
  const handleChange = (i: number, field: keyof BookingEntry, value: string | number) => {
    onChange(entries.map((e, idx) => idx === i ? { ...e, [field]: value } : e))
  }
  const handleAdd = () => onChange([...entries, { no: '', ctr_type: '20', ctr_qty: 1 }])
  const handleRemove = (i: number) => onChange(entries.filter((_, idx) => idx !== i))
  return (
    <div className="space-y-1">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            className="w-24 border border-gray-200 rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:border-blue-400"
            value={entry.no}
            onChange={e => handleChange(i, 'no', e.target.value)}
            placeholder="부킹번호"
          />
          <select
            className="border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:border-blue-400"
            value={entry.ctr_type}
            onChange={e => handleChange(i, 'ctr_type', e.target.value)}
          >
            {CTR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="number" min={1} max={99}
            className="w-10 border border-gray-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:border-blue-400"
            value={entry.ctr_qty || ''}
            onChange={e => handleChange(i, 'ctr_qty', parseInt(e.target.value) || 0)}
            onBlur={e => { if (!parseInt(e.target.value)) handleChange(i, 'ctr_qty', 1) }}
          />
          {entries.length > 1 && (
            <button onClick={() => handleRemove(i)}
              className="text-red-400 hover:text-red-600 text-xs leading-none px-0.5">✕</button>
          )}
        </div>
      ))}
      <button onClick={handleAdd}
        className="flex items-center gap-0.5 text-xs text-blue-500 hover:text-blue-700 mt-0.5">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        추가
      </button>
    </div>
  )
}

// 날짜 입력 자동 변환: MMDD, MM/DD, YYYYMMDD → YYYY-MM-DD
function normalizeDateInput(v: string): string | null {
  if (!v) return null
  const t = v.trim()
  // MM/DD or M/D → 올해 연도 적용
  const slashMatch = t.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (slashMatch) {
    const year = new Date().getFullYear()
    return `${year}-${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}`
  }
  const digits = t.replace(/[^0-9]/g, '')
  // MMDD (4자리 숫자) → 올해 YYYY-MM-DD
  if (digits.length === 4) {
    const year = new Date().getFullYear()
    return `${year}-${digits.slice(0, 2)}-${digits.slice(2, 4)}`
  }
  // YYYYMMDD (8자리 숫자) → YYYY-MM-DD
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  return t || null
}

// ── 자동완성 입력 ─────────────────────────────────────────────────

function AutocompleteInput({ value, options, onChange, placeholder, className, autoFocus }: {
  value: string; options: string[]; onChange: (v: string) => void
  placeholder?: string; className?: string; autoFocus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const filtered = value
    ? options.filter(o => o.toLowerCase().includes(value.toLowerCase()))
    : options
  return (
    <div className="relative">
      <input
        className={className}
        value={value}
        autoFocus={autoFocus}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 left-0 top-full mt-0.5 w-full min-w-[120px] bg-white border border-gray-200 rounded-lg shadow-lg max-h-44 overflow-y-auto text-xs">
          {filtered.map(opt => (
            <li key={opt}
              onMouseDown={e => { e.preventDefault(); onChange(opt); setOpen(false) }}
              className="px-2 py-1.5 cursor-pointer hover:bg-blue-50 hover:text-blue-700 whitespace-nowrap">
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── 편집 셀 ───────────────────────────────────────────────────────

function EditCell({ colKey, row, profiles, destinations, ports, carriers, customColumns, onChange, autoFocus }: {
  colKey: string; row: Partial<Booking>; profiles: Profile[]
  destinations: string[]; ports: string[]; carriers: string[]
  customColumns: ColumnDefinition[]
  onChange: (c: Partial<Booking>) => void
  autoFocus?: boolean
}) {
  const cls = "w-full h-full border-0 px-1.5 py-1 text-xs bg-transparent focus:outline-none"
  switch (colKey) {
    case 'booking_no': {
      const entries: BookingEntry[] = (row.booking_entries as BookingEntry[] | undefined) ||
        (row.booking_no ? [{ no: row.booking_no as string, ctr_type: '20', ctr_qty: 1 }] : [{ no: '', ctr_type: '20', ctr_qty: 1 }])
      return (
        <BookingEntriesEditor
          entries={entries}
          onChange={newEntries => onChange({
            booking_entries: newEntries,
            booking_no: newEntries[0]?.no || '',
          })}
        />
      )
    }
    case 'final_destination':
      return <AutocompleteInput className={cls} value={row.final_destination || ''} options={destinations} onChange={v => onChange({ final_destination: v })} placeholder="최종도착지" autoFocus={autoFocus} />
    case 'discharge_port':
      return <AutocompleteInput className={cls} value={row.discharge_port || ''} options={ports} onChange={v => onChange({ discharge_port: v })} placeholder="양하항" autoFocus={autoFocus} />
    case 'carrier':
      return <select className={cls} autoFocus={autoFocus} value={row.carrier || ''} onChange={e => onChange({ carrier: e.target.value })}>
        <option value="">-</option>{carriers.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    case 'vessel_name':
      return <input autoFocus={autoFocus} className={`${cls} uppercase`} value={row.vessel_name || ''} onChange={e => onChange({ vessel_name: e.target.value })} placeholder="모선명" />
    case 'voyage':
      return <input autoFocus={autoFocus} className={cls} value={row.voyage || ''} onChange={e => onChange({ voyage: e.target.value })} placeholder="항차" />
    case 'secured_space':
      return <input autoFocus={autoFocus} className={cls} value={row.secured_space || ''} onChange={e => onChange({ secured_space: e.target.value })} placeholder="확보선복" />
    case 'mqc':
      return <input autoFocus={autoFocus} className={cls} value={row.mqc || ''} onChange={e => onChange({ mqc: e.target.value })} placeholder="MQC" />
    case 'customer_doc_handler':
      return <input autoFocus={autoFocus} className={cls} value={row.customer_doc_handler || ''} onChange={e => onChange({ customer_doc_handler: e.target.value })} placeholder="서류담당" />
    case 'forwarder_handler':
      return <select autoFocus={autoFocus} className={cls} value={row.forwarder_handler_id || ''} onChange={e => onChange({ forwarder_handler_id: e.target.value || null })}>
        <option value="">미지정</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    case 'doc_cutoff_date':
      return <input autoFocus={autoFocus} type="text" placeholder="YYYY-MM-DD" className={cls} value={row.doc_cutoff_date || ''} onChange={e => onChange({ doc_cutoff_date: e.target.value || null })} onBlur={e => onChange({ doc_cutoff_date: normalizeDateInput(e.target.value) })} />
    case 'proforma_etd':
      return <input autoFocus={autoFocus} type="text" placeholder="YYYY-MM-DD" className={cls} value={row.proforma_etd || ''} onChange={e => onChange({ proforma_etd: e.target.value || null })} onBlur={e => onChange({ proforma_etd: normalizeDateInput(e.target.value) })} />
    case 'updated_etd':
      return <input autoFocus={autoFocus} type="text" placeholder="YYYY-MM-DD" className={cls} value={row.updated_etd || ''} onChange={e => onChange({ updated_etd: e.target.value || null })} onBlur={e => onChange({ updated_etd: normalizeDateInput(e.target.value) })} />
    case 'eta':
      return <input autoFocus={autoFocus} type="text" placeholder="YYYY-MM-DD" className={cls} value={row.eta || ''} onChange={e => onChange({ eta: e.target.value || null })} onBlur={e => onChange({ eta: normalizeDateInput(e.target.value) })} />
    case 'handler_region':
    case 'handler_customers':
      return <span className="text-xs text-gray-400 italic px-1.5">담당자 설정에서 변경</span>
    case 'containers':
      return <span className="text-xs text-gray-400 italic px-1.5">부킹번호 열에서 편집</span>
    case 'final_qty':
      return <span className="text-xs text-gray-400 italic px-1.5">자동 계산</span>
    case 'remarks':
      return <input autoFocus={autoFocus} className={cls} value={row.remarks || ''} onChange={e => onChange({ remarks: e.target.value })} placeholder="비고" />
    default: {
      // custom_mmgcysit: 부킹수량 자동계산 열 (편집 불가)
      if (colKey === 'custom_mmgcysit') {
        const qty = calcTotalQty(row as Partial<Booking>)
        return <span className="text-xs text-gray-500 italic px-1.5">{qty > 0 ? (qty % 1 === 0 ? qty : qty.toFixed(1)) : '-'} (자동)</span>
      }
      const cd = customColumns.find(c => c.key === colKey)
      if (cd) {
        const value = (row.extra_data as Record<string, string> | null)?.[colKey] || ''
        return <input className={cls} value={value}
          onChange={e => onChange({
            extra_data: { ...((row.extra_data as Record<string, string>) || {}), [colKey]: e.target.value }
          })}
          placeholder={cd.label} />
      }
      return null
    }
  }
}

// ── 뷰 셀 ─────────────────────────────────────────────────────────

function ViewCell({ colKey, booking, currentUserId, customColumns, carrierColorMap = {} }: {
  colKey: string; booking: Booking; currentUserId: string; customColumns: ColumnDefinition[]; carrierColorMap?: Record<string, string>
}) {
  switch (colKey) {
    case 'booking_no':
      if (booking.booking_entries && booking.booking_entries.length > 0) {
        return (
          <div className="space-y-0.5">
            {booking.booking_entries.map((e, i) => (
              <span key={i} className="block font-mono font-medium text-blue-700 text-xs">{e.no || <span className="text-gray-300">-</span>}</span>
            ))}
          </div>
        )
      }
      return <span className="font-mono font-medium text-blue-700">{booking.booking_no}</span>
    case 'final_destination':
      return <>{booking.final_destination || <span className="text-gray-300">-</span>}</>
    case 'discharge_port':
      return <>{booking.discharge_port || <span className="text-gray-300">-</span>}</>
    case 'carrier': {
      const cColor = carrierColorMap[booking.carrier || '']
      return booking.carrier
        ? <span className="inline-block px-2 py-0.5 rounded text-xs font-medium"
            style={{ backgroundColor: cColor || '#f3f4f6', color: cColor ? '#1f2937' : '#374151' }}>{booking.carrier}</span>
        : <span className="text-gray-300">-</span>
    }
    case 'vessel_name':
      return <span className="text-xs">{booking.vessel_name || '-'}</span>
    case 'voyage':
      return <span className="text-xs">{booking.voyage || '-'}</span>
    case 'secured_space':
      return <span className="text-xs">{booking.secured_space || '-'}</span>
    case 'mqc':
      return <span className="text-xs">{booking.mqc || '-'}</span>
    case 'customer_doc_handler':
      return <span className="text-xs">{booking.customer_doc_handler || '-'}</span>
    case 'forwarder_handler':
      return (
        <span className={`text-xs font-medium ${booking.forwarder_handler_id === currentUserId ? 'text-blue-600' : 'text-gray-600'}`}>
          {booking.forwarder_handler?.name || '-'}
        </span>
      )
    case 'handler_region':
      return <span className="text-xs text-gray-600">{booking.forwarder_handler?.region || '-'}</span>
    case 'handler_customers':
      return <span className="text-xs text-gray-600">{booking.forwarder_handler?.customers || '-'}</span>
    case 'doc_cutoff_date': {
      const dc = getDocClass(booking.doc_cutoff_date)
      const dl = getDayLabel(booking.doc_cutoff_date)
      return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${dc}`}>
          {fmtDate(booking.doc_cutoff_date)}
          {dl && <span className="opacity-75">({dl})</span>}
        </span>
      )
    }
    case 'week_no': {
      const wn = getWeekNum(booking.proforma_etd)
      return wn !== null
        ? <span className="text-xs text-indigo-700 font-medium">{getWeekLabel(wn)}</span>
        : <span className="text-gray-300 text-xs">-</span>
    }
    case 'proforma_etd':
      return <span className="text-gray-700 text-xs font-medium">{fmtDate(booking.proforma_etd)}</span>
    case 'updated_etd':
      return <span className={`text-xs ${getEtdClass(booking.updated_etd)}`}>{fmtDate(booking.updated_etd)}</span>
    case 'eta':
      return <span className="text-xs">{fmtDate(booking.eta)}</span>
    case 'containers':
      if (booking.booking_entries && booking.booking_entries.length > 0) {
        return (
          <div className="space-y-0.5">
            {booking.booking_entries.map((e, i) => (
              <span key={i} className="block text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                {e.ctr_type} × {e.ctr_qty}
              </span>
            ))}
          </div>
        )
      }
      return (
        <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded whitespace-pre-wrap break-words">
          {formatContainers(booking)}
        </span>
      )
    case 'final_qty': {
      const qty = calcFinalQty(booking)
      if (qty === null) return <span className="text-gray-300 text-xs">-</span>
      return <span className="text-xs font-semibold text-blue-700">{qty % 1 === 0 ? qty : qty.toFixed(1)}</span>
    }
    case 'remarks':
      return <span className="truncate block text-xs text-gray-500 max-w-[160px]" title={booking.remarks}>{booking.remarks || '-'}</span>
    default: {
      // custom_mmgcysit: 부킹수량 자동계산 열
      if (colKey === 'custom_mmgcysit') {
        const qty = calcTotalQty(booking)
        if (qty === 0) return <span className="text-gray-300 text-xs">-</span>
        return <span className="text-xs font-semibold text-blue-700">{qty % 1 === 0 ? qty : qty.toFixed(1)}</span>
      }
      const cd = customColumns.find(c => c.key === colKey)
      if (cd) {
        const val = (booking.extra_data as Record<string, string> | null)?.[colKey] || ''
        return <span className="text-xs">{val || <span className="text-gray-300">-</span>}</span>
      }
      return null
    }
  }
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────

type NewRow = {
  tempId: string; booking_no: string; final_destination: string; discharge_port: string
  carrier: string; vessel_name: string; secured_space: string; mqc: string
  customer_doc_handler: string; forwarder_handler_id: string | null
  doc_cutoff_date: string | null; proforma_etd: string | null; updated_etd: string | null; eta: string | null
  qty_20_normal: number; qty_20_dg: number; qty_20_reefer: number
  qty_40_normal: number; qty_40_dg: number; qty_40_reefer: number; remarks: string
  extra_data: Record<string, string>; booking_entries: BookingEntry[]
}

type SortItem = { col: string; dir: 'asc' | 'desc' }

interface Props {
  bookings: Booking[]
  profiles: Profile[]
  currentUserId: string
  currentProfile: Profile | null
  customLists: CustomList[]
  pinnedColumns?: string[]
  customColumns?: ColumnDefinition[]
  regionList?: string[]
  customerList?: string[]
  baseColDescriptions?: Record<string, string>
  baseColLabels?: Record<string, string>
  destinationSortOrder?: string[]
  tableStyle?: TableStyle
  onSettingsClick?: () => void
}

export default function BookingTable({
  bookings, profiles, currentUserId, currentProfile, customLists,
  pinnedColumns = DEFAULT_PINNED_COLUMNS,
  customColumns = [],
  regionList = [],
  customerList = [],
  baseColDescriptions = {},
  baseColLabels = {},
  destinationSortOrder = [],
  tableStyle = DEFAULT_TABLE_STYLE,
  onSettingsClick,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [editMode, setEditMode] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [rowEdits, setRowEdits] = useState<Record<string, Partial<Booking>>>({})
  const [newRows, setNewRows] = useState<NewRow[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkEditCol, setBulkEditCol] = useState('')
  const [bulkEditVal, setBulkEditVal] = useState('')
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null)

  const [dragSrc, setDragSrc] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const wasDraggingRef = useRef(false)
  const colDragSrcRef = useRef<string | null>(null)

  // 모든 열 키 (기본 + 커스텀)
  const allColKeys = useMemo(() => [
    ...DEFAULT_COLUMN_ORDER,
    ...customColumns.map(c => c.key),
  ], [customColumns])

  // 동적 COL_DEFS (기본 열 설명 + 라벨 오버라이드 병합)
  const allColDefs = useMemo(() => {
    const defs: Record<string, { label: string; minW: number; description?: string }> = {}
    for (const [k, v] of Object.entries(BASE_COL_DEFS)) {
      defs[k] = {
        ...v,
        label: baseColLabels[k] || v.label,
        description: baseColDescriptions[k] || undefined,
      }
    }
    for (const cd of customColumns) {
      defs[cd.key] = { label: cd.label, minW: 120, description: cd.description || undefined }
    }
    return defs
  }, [customColumns, baseColDescriptions, baseColLabels])

  const [colOrder, setColOrder] = useState<string[]>(() =>
    normalizeColOrder(currentProfile?.column_order, allColKeys)
  )

  const [sorts, _setSorts] = useState<SortItem[]>([])
  const [monthView, _setMonthView] = useState(false)
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [blankSailingMode, _setBlankSailingMode] = useState(false)
  const [blankWeekFrom, _setBlankWeekFrom] = useState(14)
  const [blankWeekTo, _setBlankWeekTo] = useState(18)
  const [reeferSeparate, _setReeferSeparate] = useState(false)
  const tableWrapperRef = useRef<HTMLDivElement>(null)

  // ── 필터 상태 (localStorage 영속) ────────────────────────────────
  const [viewMode, _setViewMode] = useState<'all' | 'mine'>('all')
  const [carrierFilter, _setCarrierFilter] = useState('')
  const [handlerFilter, _setHandlerFilter] = useState('')
  const [regionFilter, _setRegionFilter] = useState('')
  const [customersFilter, _setCustomersFilter] = useState('')
  const [etdFrom, _setEtdFrom] = useState('')
  const [etdTo, _setEtdTo] = useState('')
  const [docFilter, _setDocFilter] = useState(false)
  const [mergeEnabled, _setMergeEnabled] = useState(true)
  const [activeCell, setActiveCell] = useState<{ id: string; col: string } | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<{ field: string; value: string }[]>([])
  const [sortsSaved, setSortsSaved] = useState(false)

  // ── 엑셀식 셀 범위 선택 ──────────────────────────────────────────
  const [cellSelStart, setCellSelStart] = useState<{ rowIdx: number; colIdx: number } | null>(null)
  const [cellSelEnd, setCellSelEnd] = useState<{ rowIdx: number; colIdx: number } | null>(null)
  const cellSelStartRef = useRef(cellSelStart)
  const cellSelEndRef = useRef(cellSelEnd)
  cellSelStartRef.current = cellSelStart
  cellSelEndRef.current = cellSelEnd
  const isMouseSelecting = useRef(false)
  const [isDragSelecting, setIsDragSelecting] = useState(false)
  const [copyWithHeaders, _setCopyWithHeaders] = useState(false)
  const copyWithHeadersRef = useRef(false)
  const setCopyWithHeaders = (v: boolean) => { _setCopyWithHeaders(v); copyWithHeadersRef.current = v }
  const processedRef = useRef<Booking[]>([])
  const visualOrderRef = useRef<DisplayRow[]>([])
  const allColDefsRef = useRef(allColDefs)
  const editModeRef = useRef(editMode)
  editModeRef.current = editMode
  const bulkSavingRef = useRef(bulkSaving)
  bulkSavingRef.current = bulkSaving
  const setRowEditsRef = useRef(setRowEdits)
  setRowEditsRef.current = setRowEdits
  // canManageBookingRef는 canManageBooking 정의 후 아래에서 설정

  // 마운트 시 localStorage에서 복원 (raw setter 사용 → 저장 루프 없음)
  useEffect(() => {
    try {
      const vm = localStorage.getItem('bk_viewMode')
      if (vm === 'all' || vm === 'mine') _setViewMode(vm)
      const cf = localStorage.getItem('bk_carrierFilter')
      if (cf) _setCarrierFilter(cf)
      const hf = localStorage.getItem('bk_handlerFilter')
      if (hf) _setHandlerFilter(hf)
      const ef = localStorage.getItem('bk_etdFrom')
      if (ef) _setEtdFrom(ef)
      const et = localStorage.getItem('bk_etdTo')
      if (et) _setEtdTo(et)
      const rf = localStorage.getItem('bk_regionFilter')
      if (rf) _setRegionFilter(rf)
      const cusf = localStorage.getItem('bk_customersFilter')
      if (cusf) _setCustomersFilter(cusf)
      if (localStorage.getItem('bk_monthView') === 'true') _setMonthView(true)
      if (localStorage.getItem('bk_mergeEnabled') === 'false') _setMergeEnabled(false)
      if (localStorage.getItem('bk_blankSailing') === 'true') _setBlankSailingMode(true)
      const bwf = localStorage.getItem('bk_blankWeekFrom'); if (bwf) _setBlankWeekFrom(Number(bwf))
      const bwt = localStorage.getItem('bk_blankWeekTo'); if (bwt) _setBlankWeekTo(Number(bwt))
      if (localStorage.getItem('bk_reeferSeparate') === 'true') _setReeferSeparate(true)
      const storedSorts = localStorage.getItem('bk_sorts')
      if (storedSorts) _setSorts(JSON.parse(storedSorts))
      const storedWidths = localStorage.getItem('bk_col_widths')
      if (storedWidths) setColWidths(JSON.parse(storedWidths))
    } catch {}
  }, [])

  // 저장 헬퍼 + 래퍼 setter (사용자 조작 시에만 저장됨)
  const ls = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch {} }
  const setViewMode = (v: 'all' | 'mine') => { _setViewMode(v); ls('bk_viewMode', v) }
  const setCarrierFilter = (v: string) => { _setCarrierFilter(v); ls('bk_carrierFilter', v) }
  const setHandlerFilter = (v: string) => { _setHandlerFilter(v); ls('bk_handlerFilter', v) }
  const setEtdFrom = (v: string) => { _setEtdFrom(v); ls('bk_etdFrom', v) }
  const setEtdTo = (v: string) => { _setEtdTo(v); ls('bk_etdTo', v) }
  const setDocFilter = (updater: boolean | ((p: boolean) => boolean)) => {
    _setDocFilter(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      ls('bk_docFilter', String(next))
      return next
    })
  }
  const setMonthView = (updater: boolean | ((p: boolean) => boolean)) => {
    _setMonthView(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      ls('bk_monthView', String(next))
      return next
    })
  }
  const setRegionFilter = (v: string) => { _setRegionFilter(v); ls('bk_regionFilter', v) }
  const setCustomersFilter = (v: string) => { _setCustomersFilter(v); ls('bk_customersFilter', v) }
  const setMergeEnabled = (v: boolean) => { _setMergeEnabled(v); ls('bk_mergeEnabled', String(v)) }
  const setBlankSailingMode = (v: boolean) => {
    _setBlankSailingMode(v)
    ls('bk_blankSailing', String(v))
    if (v) {
      // BLANK 모드 ON → 정렬 강제: 최종도착지 asc → proforma_etd asc
      const blankSorts: SortItem[] = [
        { col: 'final_destination', dir: 'asc' },
        { col: 'proforma_etd', dir: 'asc' },
      ]
      setSorts(blankSorts)
      // RF분리 자동 활성화
      setReeferSeparate(true)
      // ETD 필터를 주차 범위에 맞게 설정
      setEtdFrom(getWeekStartDate(blankWeekFrom))
      setEtdTo(getWeekEndDate(blankWeekTo))
    }
  }
  const setBlankWeekFrom = (v: number) => {
    _setBlankWeekFrom(v); ls('bk_blankWeekFrom', String(v))
    if (blankSailingMode) setEtdFrom(getWeekStartDate(v))
  }
  const setBlankWeekTo = (v: number) => {
    _setBlankWeekTo(v); ls('bk_blankWeekTo', String(v))
    if (blankSailingMode) setEtdTo(getWeekEndDate(v))
  }
  const setReeferSeparate = (v: boolean) => { _setReeferSeparate(v); ls('bk_reeferSeparate', String(v)) }
  const setSorts = (updater: SortItem[] | ((p: SortItem[]) => SortItem[])) => {
    _setSorts(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      ls('bk_sorts', JSON.stringify(next))
      return next
    })
  }

  // 셀 텍스트 값 (복사용)
  const getCellTextValueRef = useRef<(booking: Booking, col: string) => string>(() => '')

  function getCellTextValue(booking: Booking, col: string): string {
    switch (col) {
      case 'booking_no':
        if (booking.booking_entries && booking.booking_entries.length > 0)
          return booking.booking_entries.map(e => e.no).join(' / ')
        return booking.booking_no || ''
      case 'final_destination': return booking.final_destination || ''
      case 'discharge_port': return booking.discharge_port || ''
      case 'carrier': return booking.carrier || ''
      case 'vessel_name': return booking.vessel_name || ''
      case 'voyage': return booking.voyage || ''
      case 'secured_space': return booking.secured_space || ''
      case 'mqc': return booking.mqc || ''
      case 'customer_doc_handler': return booking.customer_doc_handler || ''
      case 'forwarder_handler': return booking.forwarder_handler?.name || ''
      case 'handler_region': return booking.forwarder_handler?.region || ''
      case 'handler_customers': return booking.forwarder_handler?.customers || ''
      case 'doc_cutoff_date': return fmtDate(booking.doc_cutoff_date)
      case 'week_no': { const wn = getWeekNum(booking.proforma_etd); return wn !== null ? getWeekLabel(wn) : '-' }
      case 'proforma_etd': return fmtDate(booking.proforma_etd)
      case 'updated_etd': return fmtDate(booking.updated_etd)
      case 'eta': return fmtDate(booking.eta)
      case 'containers': return formatContainers(booking)
      case 'final_qty': { const q = calcFinalQty(booking); return q === null ? '' : (q % 1 === 0 ? String(q) : q.toFixed(1)) }
      case 'custom_mmgcysit': { const q = calcTotalQty(booking); return q > 0 ? (q % 1 === 0 ? String(q) : q.toFixed(1)) : '' }
      case 'remarks': return booking.remarks || ''
      default: {
        const cd = customColumns.find(c => c.key === col)
        if (cd) return (booking.extra_data as Record<string, string> | null)?.[col] || ''
        return ''
      }
    }
  }
  getCellTextValueRef.current = getCellTextValue

  function isCellInRange(rowIdx: number, colIdx: number): boolean {
    if (!cellSelStart || !cellSelEnd) return false
    const minR = Math.min(cellSelStart.rowIdx, cellSelEnd.rowIdx)
    const maxR = Math.max(cellSelStart.rowIdx, cellSelEnd.rowIdx)
    const minC = Math.min(cellSelStart.colIdx, cellSelEnd.colIdx)
    const maxC = Math.max(cellSelStart.colIdx, cellSelEnd.colIdx)
    return rowIdx >= minR && rowIdx <= maxR && colIdx >= minC && colIdx <= maxC
  }

  // 담당고객사 기반 편집 권한: 본인 담당이거나, 같은 고객사를 담당하는 경우 편집 가능
  const myCustomerSet = useMemo(() => {
    if (!currentProfile?.customers) return new Set<string>()
    return new Set(currentProfile.customers.split(',').map(s => s.trim()).filter(Boolean))
  }, [currentProfile?.customers])

  function canManageBooking(booking: Booking): boolean {
    if (booking.forwarder_handler_id === currentUserId) return true
    if (myCustomerSet.size === 0) return false
    const handlerCustomers = booking.forwarder_handler?.customers
    if (!handlerCustomers) return false
    const theirCustomers = handlerCustomers.split(',').map(s => s.trim()).filter(Boolean)
    return theirCustomers.some(c => myCustomerSet.has(c))
  }
  const canManageBookingRef = useRef(canManageBooking)
  canManageBookingRef.current = canManageBooking

  // 최종도착지별 행 배경색 맵
  const destinationColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const l of customLists) {
      if (l.list_type === 'destination' && l.color) map[l.name] = l.color
    }
    return map
  }, [customLists])

  const carrierColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const l of customLists) {
      if (l.list_type === 'carrier' && l.color) map[l.name] = l.color
    }
    return map
  }, [customLists])

  const destinations = useMemo(() => {
    const c = customLists.filter(l => l.list_type === 'destination').map(l => l.name)
    return c.length > 0 ? c : [...DEFAULT_DESTINATIONS]
  }, [customLists])

  const ports = useMemo(() => {
    const c = customLists.filter(l => l.list_type === 'port').map(l => l.name)
    return c.length > 0 ? c : [...MAJOR_PORTS]
  }, [customLists])

  const carriers = useMemo(() => {
    const c = customLists.filter(l => l.list_type === 'carrier').map(l => l.name)
    return c.length > 0 ? c : [...CARRIERS]
  }, [customLists])

  const carrierOptions = useMemo(() =>
    Array.from(new Set(bookings.map(b => b.carrier).filter(Boolean))).sort()
  , [bookings])

  // 고정열 먼저, 이동가능 열은 colOrder 순서
  const colsToRender = useMemo(() => {
    const validPinned = pinnedColumns.filter(k => allColDefs[k])
    const movable = colOrder.filter(k => allColDefs[k] && !pinnedColumns.includes(k))
    return [...validPinned, ...movable]
  }, [colOrder, pinnedColumns, allColDefs])

  // colsToRender ref (copy 핸들러에서 사용)
  const colsToRenderRef = useRef(colsToRender)
  colsToRenderRef.current = colsToRender

  // Ctrl+S: 편집 모드 저장/종료 (capture 단계에서 브라우저 기본 동작 차단)
  // handleToggleEditMode ref
  const handleToggleEditModeRef = useRef<() => void>(() => {})

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      e.stopPropagation()
      if (editModeRef.current && !bulkSavingRef.current) handleToggleEditModeRef.current()
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, []) // stable — refs만 사용


  // Ctrl+C: keydown 방식, refs 기반 (stale closure 없음)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return
      const start = cellSelStartRef.current
      const end = cellSelEndRef.current
      if (!start || !end) return
      // INPUT 안에 텍스트 선택 중이면 브라우저 기본 복사 허용
      const active = document.activeElement
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
        const inputEl = active as HTMLInputElement
        if (inputEl.selectionStart !== null && inputEl.selectionStart !== inputEl.selectionEnd) return
      }
      e.preventDefault()
      const cols = colsToRenderRef.current
      const minR = Math.min(start.rowIdx, end.rowIdx)
      const maxR = Math.max(start.rowIdx, end.rowIdx)
      const minC = Math.min(start.colIdx, end.colIdx)
      const maxC = Math.max(start.colIdx, end.colIdx)
      const rows: string[][] = []
      // 열제목 포함 복사
      if (copyWithHeadersRef.current) {
        const headerRow: string[] = []
        const defs = allColDefsRef.current
        for (let c = minC; c <= maxC; c++) {
          const col = cols[c]
          if (!col) continue
          headerRow.push(defs[col]?.label || col)
        }
        rows.push(headerRow)
      }
      for (let r = minR; r <= maxR; r++) {
        const bk = visualOrderRef.current[r]
        if (!bk) continue
        const row: string[] = []
        for (let c = minC; c <= maxC; c++) {
          const col = cols[c]
          if (!col) continue
          if ('_blankSailing' in bk) {
            const bs = bk as BlankSailingRow
            if (col === 'vessel_name') row.push('BLANK SAILING')
            else if (col === 'week_no') row.push(getWeekLabel(bs.weekNum))
            else if (col === 'final_destination') row.push(bs.final_destination)
            else if (col === 'discharge_port') row.push(bs.discharge_port)
            else if (col === 'carrier') row.push(bs.carrier)
            else row.push('')
          } else {
            row.push(getCellTextValueRef.current(bk as Booking, col))
          }
        }
        rows.push(row)
      }
      if (rows.length === 0) return
      const tsv = rows.map(r => r.join('\t')).join('\n')
      const htmlRows = rows.map((r, ri) => {
        const isHeader = copyWithHeadersRef.current && ri === 0
        const tag = isHeader ? 'th' : 'td'
        const style = isHeader ? 'padding:2px 6px;font-weight:bold;background:#f3f4f6;border:1px solid #d1d5db;' : 'padding:2px 6px;border:1px solid #e5e7eb;'
        return '<tr>' + r.map(v => `<${tag} style="${style}">${v.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</${tag}>`).join('') + '</tr>'
      }).join('')
      const html = `<table style="font-family:'맑은 고딕',Malgun Gothic,sans-serif;font-size:10pt;border-collapse:collapse;">${htmlRows}</table>`
      // ClipboardItem 지원 브라우저: text + html 동시 복사
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([tsv], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          })
        ]).catch(() => navigator.clipboard.writeText(tsv).catch(() => {}))
      } else {
        navigator.clipboard.writeText(tsv).catch(() => {})
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, []) // stable — refs만 사용

  // Ctrl+X: 잘라내기 (복사 + 선택 범위 값 삭제)
  // Delete: 선택 범위 값 삭제
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrlX = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x'
      const isDelete = e.key === 'Delete'
      if (!isCtrlX && !isDelete) return
      if (!editModeRef.current) return
      const start = cellSelStartRef.current
      const end = cellSelEndRef.current
      if (!start || !end) return
      const active = document.activeElement
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return
      e.preventDefault()

      const cols = colsToRenderRef.current
      const minR = Math.min(start.rowIdx, end.rowIdx)
      const maxR = Math.max(start.rowIdx, end.rowIdx)
      const minC = Math.min(start.colIdx, end.colIdx)
      const maxC = Math.max(start.colIdx, end.colIdx)

      // Ctrl+X인 경우 먼저 클립보드에 복사
      if (isCtrlX) {
        const rows: string[][] = []
        for (let r = minR; r <= maxR; r++) {
          const bk = visualOrderRef.current[r]
          if (!bk) continue
          const row: string[] = []
          for (let c = minC; c <= maxC; c++) {
            const col = cols[c]
            if (!col) continue
            if ('_blankSailing' in bk) row.push('')
            else row.push(getCellTextValueRef.current(bk as Booking, col))
          }
          rows.push(row)
        }
        const tsv = rows.map(r => r.join('\t')).join('\n')
        navigator.clipboard.writeText(tsv).catch(() => {})
      }

      // 선택 범위 값 삭제
      const batchEdits: Record<string, Partial<Booking>> = {}
      for (let r = minR; r <= maxR; r++) {
        const bk = visualOrderRef.current[r]
        if (!bk || '_blankSailing' in bk) continue
        const booking = bk as Booking
        if (!canManageBookingRef.current(booking)) continue
        const changes: Partial<Booking> = {}
        for (let c = minC; c <= maxC; c++) {
          const col = cols[c]
          if (!col || col === 'forwarder_handler' || col === 'week_no' || col === 'handler_region' || col === 'handler_customers' || col === 'final_qty') continue
          const change = textToCellChangeRef.current(col, '')
          if (change) {
            if (change.extra_data) {
              changes.extra_data = { ...((changes.extra_data as Record<string, string>) || {}), ...(change.extra_data as Record<string, string>) }
            } else {
              Object.assign(changes, change)
            }
          }
        }
        if (Object.keys(changes).length > 0) batchEdits[booking.id] = changes
      }
      if (Object.keys(batchEdits).length > 0) {
        setRowEditsRef.current(prev => {
          const next = { ...prev }
          for (const [id, changes] of Object.entries(batchEdits)) {
            next[id] = { ...(next[id] || {}), ...changes }
          }
          return next
        })
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [])

  const processed = useMemo(() => {
    let result = bookings.filter(b => {
      if (viewMode === 'mine' && b.forwarder_handler_id !== currentUserId) return false
      if (carrierFilter && b.carrier !== carrierFilter) return false
      if (handlerFilter === '__unassigned__' && b.forwarder_handler_id) return false
      if (handlerFilter && handlerFilter !== '__unassigned__' && b.forwarder_handler_id !== handlerFilter) return false
      if (regionFilter && b.forwarder_handler?.region !== regionFilter) return false
      if (customersFilter && !b.forwarder_handler?.customers?.includes(customersFilter)) return false
      const etd = b.proforma_etd
      if (etdFrom && etd && etd < etdFrom) return false
      if (etdTo && etd && etd > etdTo) return false
      if (docFilter) {
        if (!b.doc_cutoff_date) return false
        try {
          const diff = differenceInCalendarDays(parseISO(b.doc_cutoff_date), new Date())
          if (diff < 0 || diff > 3) return false
        } catch { return false }
      }
      return true
    })
    if (sorts.length > 0) {
      const destOrderMap = destinationSortOrder.length > 0
        ? Object.fromEntries(destinationSortOrder.map((d, i) => [d, i]))
        : null
      result = [...result].sort((a, b) => {
        for (const { col, dir } of sorts) {
          const va = getSortValue(a, col, customColumns)
          const vb = getSortValue(b, col, customColumns)
          let cmp: number
          if (col === 'final_destination' && destOrderMap) {
            const ia = destOrderMap[va] ?? 9999
            const ib = destOrderMap[vb] ?? 9999
            cmp = ia !== ib ? ia - ib : va.localeCompare(vb)
          } else {
            cmp = va.localeCompare(vb)
          }
          if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
        }
        return 0
      })
    }
    // 리퍼별도: 도착지 기준으로 그룹핑, RF 없는 행 상단 / RF 있는 행 하단
    if (reeferSeparate) {
      const destOrderMap = destinationSortOrder.length > 0
        ? Object.fromEntries(destinationSortOrder.map((d, i) => [d, i]))
        : null
      // 항상 도착지 기준 그룹핑 (기존 정렬 위에 도착지 + RF 우선순위 추가)
      result = [...result].sort((a, b) => {
        // 1) 도착지
        const da = a.final_destination || '', db = b.final_destination || ''
        if (da !== db) {
          if (destOrderMap) {
            const ia = destOrderMap[da] ?? 9999, ib = destOrderMap[db] ?? 9999
            if (ia !== ib) return ia - ib
          }
          return da.localeCompare(db)
        }
        // 2) RF 없음 = 0 (상단), RF 있음 = 1 (하단)
        const ra = hasReeferContainer(a) ? 1 : 0
        const rb = hasReeferContainer(b) ? 1 : 0
        if (ra !== rb) return ra - rb
        // 3) 기존 정렬 유지 (안정 정렬)
        return 0
      })
    }
    return result
  }, [bookings, viewMode, carrierFilter, handlerFilter, regionFilter, customersFilter, etdFrom, etdTo, docFilter, sorts, currentUserId, customColumns, reeferSeparate, destinationSortOrder])

  // processedRef를 항상 최신 processed로 동기화
  useEffect(() => { processedRef.current = processed }, [processed])
  useEffect(() => { allColDefsRef.current = allColDefs }, [allColDefs])


  const monthGroups = useMemo(() => {
    if (!monthView) return null
    const map: Record<string, Booking[]> = {}
    for (const b of processed) {
      const k = getMonthKey(b.proforma_etd)
      if (!map[k]) map[k] = []
      map[k].push(b)
    }
    const keys = Object.keys(map).sort((a, b) => {
      if (a === 'none') return 1; if (b === 'none') return -1
      return a < b ? -1 : 1
    })
    return keys.map(key => ({ key, rows: map[key] }))
  }, [processed, monthView])

  // ── BLANK SAILING 가상행 삽입 ────────────────────────────────────
  // RF분리 + BLANK: 도착지별로 [비RF 부킹 + BLANK] → [RF 부킹] 순서
  // BLANK는 비RF 부킹 기준으로만 판단 (RF는 매주 안 나오므로 BLANK 대상 아님)
  const displayRows: DisplayRow[] = useMemo(() => {
    if (!blankSailingMode) return processed
    const wFrom = blankWeekFrom
    const wTo = blankWeekTo
    if (wFrom > wTo) return processed

    // 도착지별 그룹핑
    const destBookings: Record<string, Booking[]> = {}
    const destOrder: string[] = []
    const destMeta: Record<string, { discharge_port: string; carrier: string }> = {}
    for (const b of processed) {
      const dest = b.final_destination || ''
      if (!destBookings[dest]) {
        destBookings[dest] = []; destOrder.push(dest)
        destMeta[dest] = { discharge_port: b.discharge_port || '', carrier: b.carrier || '' }
      }
      destBookings[dest].push(b)
    }

    const result: DisplayRow[] = []
    for (const dest of destOrder) {
      const all = destBookings[dest]
      const meta = destMeta[dest] || { discharge_port: '', carrier: '' }

      // RF 포함 행과 비RF 행을 분리
      const rfRows = all.filter(b => hasReeferContainer(b))
      const nonRfRows = all.filter(b => !hasReeferContainer(b))

      // 비RF 부킹: 주차별로 정렬하며 빈 주차에 BLANK SAILING 삽입
      const nonRfWeeks = new Set(nonRfRows.map(b => getWeekNum(b.proforma_etd)).filter((w): w is number => w !== null))
      for (let wn = wFrom; wn <= wTo; wn++) {
        const weekNonRf = nonRfRows.filter(b => getWeekNum(b.proforma_etd) === wn)
        if (weekNonRf.length > 0) {
          result.push(...weekNonRf)
        } else {
          // 비RF 부킹이 없는 주차 → BLANK SAILING
          result.push({
            _blankSailing: true, id: `blank-${dest}-${wn}`,
            final_destination: dest, discharge_port: meta.discharge_port, carrier: meta.carrier,
            weekNum: wn,
          })
        }
      }
      // 주차 범위 밖 비RF 부킹도 추가
      const outsideNonRf = nonRfRows.filter(b => {
        const wn = getWeekNum(b.proforma_etd)
        return wn === null || wn < wFrom || wn > wTo
      })
      if (outsideNonRf.length > 0) result.push(...outsideNonRf)

      // RF 부킹: BLANK 판단 없이 그대로 하단에 추가
      if (rfRows.length > 0) result.push(...rfRows)
    }
    return result
  }, [processed, blankSailingMode, blankWeekFrom, blankWeekTo])

  // visualOrderRef: 화면에 실제 렌더되는 행 순서를 추적 (monthView 재정렬 대응)
  useEffect(() => {
    if (monthView && monthGroups) {
      visualOrderRef.current = monthGroups.flatMap(g => g.rows)
    } else {
      visualOrderRef.current = displayRows
    }
  }, [displayRows, monthGroups, monthView])

  // ── 편집 모드 토글: OFF 시 일괄 저장 ──────────────────────────────

  const handleToggleEditMode = async () => {
    if (!editMode) {
      // 스크롤 위치 기억 → 편집 모드 ON 후 복원
      const scrollTop = tableWrapperRef.current?.scrollTop ?? 0
      const scrollLeft = tableWrapperRef.current?.scrollLeft ?? 0
      setEditMode(true)
      requestAnimationFrame(() => {
        if (tableWrapperRef.current) {
          tableWrapperRef.current.scrollTop = scrollTop
          tableWrapperRef.current.scrollLeft = scrollLeft
        }
      })
      return
    }
    const editEntries = Object.entries(rowEdits)
    const hasChanges = editEntries.length > 0 || newRows.length > 0
    if (!hasChanges) { setEditMode(false); return }

    // 양하항/최종도착지 유효성 검사
    const errors: { field: string; value: string }[] = []
    for (const [, edits] of editEntries) {
      if (edits.final_destination && !destinations.includes(edits.final_destination as string)) {
        errors.push({ field: '최종도착지', value: edits.final_destination as string })
      }
      if (edits.discharge_port && !ports.includes(edits.discharge_port as string)) {
        errors.push({ field: '양하항', value: edits.discharge_port as string })
      }
    }
    for (const row of newRows) {
      if (row.final_destination && !destinations.includes(row.final_destination)) {
        errors.push({ field: '최종도착지', value: row.final_destination })
      }
      if (row.discharge_port && !ports.includes(row.discharge_port)) {
        errors.push({ field: '양하항', value: row.discharge_port })
      }
    }
    if (errors.length > 0) {
      setValidationErrors(errors)
      return
    }

    setBulkSaving(true)
    try {
      const prepData = (data: Record<string, unknown>) => {
        const d = { ...data }
        if (Array.isArray(d.booking_entries) && (d.booking_entries as BookingEntry[]).length > 0) {
          d.booking_no = (d.booking_entries as BookingEntry[])[0].no
        }
        return d
      }
      const editsToSave = editEntries.map(([id, edits]) => ({ id, data: prepData(edits as Record<string, unknown>) }))
      const insertsToSave = newRows.map(({ tempId, ...data }) => ({ tempId, data: prepData(data as Record<string, unknown>) }))
      const { errors: errorMap } = await bulkSaveBookings(editsToSave, insertsToSave)
      if (Object.keys(errorMap).length === 0) {
        setRowEdits({}); setNewRows([]); setRowErrors({}); setEditMode(false); router.refresh()
      } else {
        setRowErrors(errorMap)
      }
    } finally {
      setBulkSaving(false)
    }
  }

  handleToggleEditModeRef.current = handleToggleEditMode

  const handleToggleMonthView = () => {
    if (!monthView) {
      const currentMonth = format(new Date(), 'yyyy-MM')
      const toCollapse = new Set(
        processed.map(b => getMonthKey(b.proforma_etd))
          .filter(k => k !== 'none' && k < currentMonth)
      )
      setCollapsedMonths(toCollapse)
    } else {
      setCollapsedMonths(new Set())
    }
    setMonthView(v => !v)
  }

  const handleSort = (col: string) => {
    if (wasDraggingRef.current) { wasDraggingRef.current = false; return }
    setSorts(prev => {
      const existing = prev.find(s => s.col === col)
      // 클릭: 해당 열을 다중 정렬 스택에 추가/토글/제거
      if (!existing) return [...prev, { col, dir: 'asc' }]
      if (existing.dir === 'asc') return prev.map(s => s.col === col ? { ...s, dir: 'desc' } : s)
      return prev.filter(s => s.col !== col)
    })
  }

  // ── 드래그 앤 드롭 (dataTransfer) ────────────────────────────────

  const handleDrop = (e: React.DragEvent, targetCol: string) => {
    e.preventDefault()
    const src = colDragSrcRef.current || e.dataTransfer.getData('text/plain')
    colDragSrcRef.current = null
    setDragSrc(null); setDragOver(null)
    if (!src || src === targetCol || pinnedColumns.includes(src) || pinnedColumns.includes(targetCol)) return
    const newOrder = [...colOrder]
    const si = newOrder.indexOf(src), ti = newOrder.indexOf(targetCol)
    if (si !== -1 && ti !== -1) {
      newOrder.splice(si, 1)
      newOrder.splice(ti, 0, src)
      setColOrder(newOrder)
      saveColumnOrder(newOrder).catch(() => {})
    }
    wasDraggingRef.current = true
  }

  // ── 편집 데이터 관리 ───────────────────────────────────────────────

  // TSV 붙여넣기: 텍스트 값 → Booking 필드 변환
  function textToCellChange(col: string, value: string): Partial<Booking> | null {
    const v = value.trim()
    const dateVal = normalizeDateInput(v)
    switch (col) {
      case 'final_destination': return { final_destination: v }
      case 'discharge_port': return { discharge_port: v }
      case 'carrier': return { carrier: v }
      case 'vessel_name': return { vessel_name: v.toUpperCase() }
      case 'voyage': return { voyage: v }
      case 'secured_space': return { secured_space: v }
      case 'mqc': return { mqc: v }
      case 'customer_doc_handler': return { customer_doc_handler: v }
      case 'forwarder_handler': return { forwarder_handler_id: v } as Partial<Booking>
      case 'doc_cutoff_date': return { doc_cutoff_date: dateVal }
      case 'proforma_etd': return { proforma_etd: dateVal }
      case 'updated_etd': return { updated_etd: dateVal }
      case 'eta': return { eta: dateVal }
      case 'remarks': return { remarks: v }
      default: {
        const cd = customColumns.find(c => c.key === col)
        if (cd && col !== 'custom_mmgcysit') {
          return { extra_data: { [col]: v } as Record<string, string> }
        }
        return null
      }
    }
  }
  const textToCellChangeRef = useRef(textToCellChange)
  textToCellChangeRef.current = textToCellChange

  const handleTablePaste = (e: React.ClipboardEvent) => {
    if (!editMode || !cellSelStart) return
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const pasteRows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd().split('\n').map(r => r.split('\t'))
    // 선택 범위의 왼쪽 상단을 기준점으로 사용
    const startRow = cellSelEnd ? Math.min(cellSelStart.rowIdx, cellSelEnd.rowIdx) : cellSelStart.rowIdx
    const startCol = cellSelEnd ? Math.min(cellSelStart.colIdx, cellSelEnd.colIdx) : cellSelStart.colIdx
    const batchEdits: Record<string, Partial<Booking>> = {}
    for (let ri = 0; ri < pasteRows.length; ri++) {
      const bookingRaw = visualOrderRef.current[startRow + ri]
      if (!bookingRaw || '_blankSailing' in bookingRaw) continue
      const booking = bookingRaw as Booking
      if (!canManageBooking(booking) && !pasteRows[ri].some((_, ci) => colsToRender[startCol + ci] === 'forwarder_handler')) continue
      const changes: Partial<Booking> = {}
      for (let ci = 0; ci < pasteRows[ri].length; ci++) {
        const col = colsToRender[startCol + ci]
        if (!col) continue
        const change = textToCellChange(col, pasteRows[ri][ci])
        if (!change) continue
        if (change.extra_data) {
          changes.extra_data = { ...((changes.extra_data as Record<string, string>) || {}), ...(change.extra_data as Record<string, string>) }
        } else {
          Object.assign(changes, change)
        }
      }
      if (Object.keys(changes).length > 0) batchEdits[booking.id] = changes
    }
    setRowEdits(prev => {
      const next = { ...prev }
      for (const [id, changes] of Object.entries(batchEdits)) {
        next[id] = { ...(next[id] || {}), ...changes }
      }
      return next
    })
  }

  const handleRowChange = (id: string, changes: Partial<Booking>) =>
    setRowEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...changes } }))

  const handleNewRowChange = (tempId: string, changes: Partial<Booking>) =>
    setNewRows(prev => prev.map(r => r.tempId === tempId ? { ...r, ...changes } as NewRow : r))

  const handleAddNewRow = () => {
    const tempId = `new-${Date.now()}`
    setNewRows(prev => [{
      tempId, booking_no: '', final_destination: '', discharge_port: '', carrier: '',
      vessel_name: '', secured_space: '', mqc: '', customer_doc_handler: '',
      forwarder_handler_id: currentUserId, doc_cutoff_date: null, proforma_etd: null,
      updated_etd: null, eta: null,
      qty_20_normal: 0, qty_20_dg: 0, qty_20_reefer: 0,
      qty_40_normal: 0, qty_40_dg: 0, qty_40_reefer: 0, remarks: '',
      extra_data: {}, booking_entries: [{ no: '', ctr_type: '20', ctr_qty: 1 }],
    }, ...prev])
  }

  const handleCopyRow = (booking: Booking) => {
    const scrollTop = tableWrapperRef.current?.scrollTop ?? 0
    const scrollLeft = tableWrapperRef.current?.scrollLeft ?? 0
    if (!editMode) setEditMode(true)
    const tempId = `new-${Date.now()}`
    setNewRows(prev => [{
      tempId,
      booking_no: '',
      final_destination: booking.final_destination || '',
      discharge_port: booking.discharge_port || '',
      carrier: booking.carrier || '',
      vessel_name: '',
      voyage: '',
      secured_space: booking.secured_space || '',
      mqc: booking.mqc || '',
      customer_doc_handler: booking.customer_doc_handler || '',
      forwarder_handler_id: booking.forwarder_handler_id,
      doc_cutoff_date: null,
      proforma_etd: null,
      updated_etd: null,
      eta: null,
      qty_20_normal: booking.qty_20_normal || 0,
      qty_20_dg: booking.qty_20_dg || 0,
      qty_20_reefer: booking.qty_20_reefer || 0,
      qty_40_normal: booking.qty_40_normal || 0,
      qty_40_dg: booking.qty_40_dg || 0,
      qty_40_reefer: booking.qty_40_reefer || 0,
      remarks: booking.remarks || '',
      extra_data: { ...(booking.extra_data || {}) },
      booking_entries: booking.booking_entries
        ? booking.booking_entries.map(e => ({ ...e, no: '' }))
        : [{ no: '', ctr_type: '20', ctr_qty: 1 }],
    }, ...prev])
    // 스크롤 위치 복원
    requestAnimationFrame(() => {
      if (tableWrapperRef.current) {
        tableWrapperRef.current.scrollTop = scrollTop
        tableWrapperRef.current.scrollLeft = scrollLeft
      }
    })
  }

  const handleDelete = (id: string) => {
    startTransition(async () => {
      await deleteBooking(id); setDeleteConfirmId(null); router.refresh()
    })
  }

  // 지역 옵션: 관리자 설정 목록 우선, 없으면 프로필에서 추출
  const regionOptions = useMemo(() =>
    regionList.length > 0
      ? regionList
      : Array.from(new Set(profiles.map(p => p.region).filter(Boolean))).sort() as string[]
  , [regionList, profiles])

  // 고객사 옵션: 관리자 설정 목록
  const customerOptions = customerList

  const hasFilter = !!(carrierFilter || handlerFilter || regionFilter || customersFilter || etdFrom || etdTo || docFilter)
  const numCols = colsToRender.length + 2 // +1 체크박스 +1 관리

  const handleBulkDelete = async () => {
    if (selectedRows.size === 0) return
    // 내 담당(또는 같은 고객사) 건만 삭제 가능
    const ownedIds = Array.from(selectedRows).filter(id => {
      const b = bookings.find(bk => bk.id === id)
      return b ? canManageBooking(b) : false
    })
    if (ownedIds.length === 0) {
      alert('내 담당 건만 삭제할 수 있습니다. 타인 담당 건은 포워더 담당자를 변경한 후 삭제해주세요.')
      return
    }
    const skipped = selectedRows.size - ownedIds.length
    if (skipped > 0 && !confirm(`${ownedIds.length}건만 삭제됩니다 (타인 담당 ${skipped}건은 제외). 계속하시겠습니까?`)) return
    setBulkDeleting(true)
    try {
      const { error } = await bulkDeleteBookings(ownedIds)
      if (!error) { setSelectedRows(new Set()); router.refresh() }
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleBulkEdit = () => {
    if (selectedRows.size === 0 || !bulkEditCol) return
    const editableIds = Array.from(selectedRows).filter(id => {
      const b = bookings.find(bk => bk.id === id)
      return b ? canManageBooking(b) : false
    })
    if (editableIds.length === 0) { alert('편집 가능한 행이 없습니다.'); return }
    const batchEdits: Record<string, Partial<Booking>> = {}
    for (const id of editableIds) {
      const change = textToCellChange(bulkEditCol, bulkEditVal)
      if (change) batchEdits[id] = change
    }
    setRowEdits(prev => {
      const next = { ...prev }
      for (const [id, changes] of Object.entries(batchEdits)) {
        next[id] = { ...(next[id] || {}), ...changes }
      }
      return next
    })
    setBulkEditOpen(false)
    setBulkEditVal('')
    if (!editMode) setEditMode(true)
  }

  const handleResizeStart = (col: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const th = (e.currentTarget as HTMLElement).closest('th') as HTMLElement | null
    const startW = th ? th.offsetWidth : (colWidths[col] || allColDefs[col]?.minW || 100)
    resizingRef.current = { col, startX: e.clientX, startW }
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = ev.clientX - resizingRef.current.startX
      const newW = Math.max(50, resizingRef.current.startW + delta)
      setColWidths(prev => {
        const next = { ...prev, [col]: newW }
        try { localStorage.setItem('bk_col_widths', JSON.stringify(next)) } catch {}
        return next
      })
    }
    const onUp = () => {
      resizingRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const toggleRowSelect = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allProcessedIds = processed.map(b => b.id)
  const allSelected = allProcessedIds.length > 0 && allProcessedIds.every(id => selectedRows.has(id))

  const d3Count = useMemo(() => bookings.filter(b => {
    if (!b.doc_cutoff_date) return false
    try {
      const diff = differenceInCalendarDays(parseISO(b.doc_cutoff_date), new Date())
      return diff >= 0 && diff <= 3
    } catch { return false }
  }).length, [bookings])

  // ── 행 렌더링 ─────────────────────────────────────────────────────

  function getRowDest(r: DisplayRow | null | undefined): string {
    if (!r) return ''
    return ('_blankSailing' in r ? r.final_destination : r.final_destination) || ''
  }

  function renderDataRow(
    booking: Booking,
    rowSpans: Record<string, { span: number; skip: boolean }>,
    rowIdx: number,
    prevRow?: DisplayRow | null,
    nextRow?: DisplayRow | null,
  ) {
    const edits = rowEdits[booking.id] || {}
    const merged: Partial<Booking> = { ...booking, ...edits }
    const hasEdits = Object.keys(edits).length > 0
    const err = rowErrors[booking.id]
    const handlerColor = destinationColorMap[booking.final_destination || ''] || ''
    const isOwnBooking = canManageBooking(booking)

    const myDest = booking.final_destination || ''
    const isGroupStart = !prevRow || getRowDest(prevRow) !== myDest
    const isGroupEnd = !nextRow || getRowDest(nextRow) !== myDest
    const groupBorder = `${tableStyle.groupBorderWidth}px solid ${tableStyle.groupBorderColor}`
    const colBorder = `${tableStyle.cellBorderWidth}px solid ${tableStyle.cellBorderColor}`
    const isSelected = selectedRows.has(booking.id)
    const manageCell = (
      <td className="table-td"
        style={{
          minWidth: 90,
          borderTop: isGroupStart ? groupBorder : colBorder,
          borderBottom: isGroupEnd ? groupBorder : 'none',
          borderLeft: colBorder,
          borderRight: colBorder,
        }}>
        {err && <p className="text-xs text-red-500 mb-1">{err}</p>}
        {!isOwnBooking && editMode && !hasEdits
          ? <span className="text-xs text-gray-400 italic">타인 담당</span>
          : (
            <div className="flex items-center gap-1 flex-wrap">
              {editMode && hasEdits && (
                <button onClick={() => {
                  setRowEdits(p => { const c = { ...p }; delete c[booking.id]; return c })
                  setRowErrors(p => { const c = { ...p }; delete c[booking.id]; return c })
                }} className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors">되돌리기</button>
              )}
              <button onClick={() => handleCopyRow(booking)}
                className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                title="이 행을 복사하여 새 행으로 추가">복사</button>
              {isOwnBooking && (
                deleteConfirmId === booking.id ? (
                  <>
                    <button onClick={() => handleDelete(booking.id)} disabled={isPending}
                      className="text-xs px-2 py-1 bg-red-600 text-white rounded">확인</button>
                    <button onClick={() => setDeleteConfirmId(null)}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded">취소</button>
                  </>
                ) : (
                  <button onClick={() => setDeleteConfirmId(booking.id)}
                    className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors">삭제</button>
                )
              )}
            </div>
          )
        }
      </td>
    )

    return (
      <tr key={booking.id}
        className="transition-colors"
        style={{
          backgroundColor: isSelected ? '#eff6ff' : (handlerColor || undefined),
          ...(editMode && hasEdits ? { boxShadow: 'inset 3px 0 0 #3b82f6' } : {}),
        }}>
        <td className="table-td w-9 sticky left-0 z-10"
          style={{
            backgroundColor: isSelected ? '#eff6ff' : (handlerColor || 'white'),
            borderRight: colBorder,
            borderTop: isGroupStart ? groupBorder : colBorder,
            borderBottom: isGroupEnd ? groupBorder : 'none',
          }}>
          <input type="checkbox" checked={isSelected} onChange={() => toggleRowSelect(booking.id)} className="rounded border-gray-400" />
        </td>
        {colsToRender.map(col => {
          const def = allColDefs[col]
          if (!def) return null

          const isMergeCol = MERGE_HIERARCHY.includes(col as typeof MERGE_HIERARCHY[number])
          const spanInfo = isMergeCol ? (rowSpans[col] ?? { span: 1, skip: false }) : { span: 1, skip: false }
          if (spanInfo.skip) return null

          const rowSpan = spanInfo.span > 1 ? spanInfo.span : undefined
          const isMergedSpan = spanInfo.span > 1
          const isPinned = pinnedColumns.includes(col)
          const fixedLeft = getFixedLeft(col, pinnedColumns, allColDefs, colWidths)
          const isDocCol = col === 'doc_cutoff_date'

          const tdIsGroupStart = isMergedSpan ? true : isGroupStart
          const tdIsGroupEnd = isMergedSpan ? true : isGroupEnd
          const canEditCell = editMode && (isOwnBooking || col === 'forwarder_handler')
          const isActive = canEditCell && activeCell?.id === booking.id && activeCell?.col === col
          const colIdx = colsToRender.indexOf(col)
          const isCellSel = isCellInRange(rowIdx, colIdx)

          return (
            <td key={col}
              rowSpan={rowSpan}
              onMouseDown={e => {
                if (e.button !== 0) return
                isMouseSelecting.current = true
                setIsDragSelecting(true)
                if (e.shiftKey && cellSelStart) {
                  setCellSelEnd({ rowIdx, colIdx })
                } else {
                  setCellSelStart({ rowIdx, colIdx })
                  setCellSelEnd({ rowIdx, colIdx })
                }
              }}
              onMouseEnter={() => {
                if (!isMouseSelecting.current) return
                setCellSelEnd({ rowIdx, colIdx })
              }}
              onClick={canEditCell
                ? () => setActiveCell({ id: booking.id, col })
                : undefined
              }
              {...(isCellSel ? (isPinned ? { 'data-cell-sel-pinned': 'true' } : { 'data-cell-sel': 'true' }) : {})}
              className={`table-td text-xs
                ${isPinned ? 'sticky z-10' : ''}
                ${dragOver === col && dragSrc !== col ? 'bg-blue-50' : ''}
                ${canEditCell ? 'p-0.5 cursor-pointer' : ''}
                ${editMode && !isOwnBooking && col !== 'forwarder_handler' ? 'opacity-60' : ''}
              `}
              style={{
                minWidth: colWidths[col] || def.minW,
                ...(fixedLeft !== null ? { left: fixedLeft } : {}),
                ...(isPinned ? { backgroundColor: handlerColor || 'white' } : {}),
                borderTop: isActive ? '2px solid #ef4444' : tdIsGroupStart ? groupBorder : ((isMergeCol && mergeEnabled && !editMode) ? '1px solid transparent' : colBorder),
                borderBottom: isActive ? '2px solid #ef4444' : tdIsGroupEnd ? groupBorder : ((isMergeCol && mergeEnabled && !editMode) ? '1px solid transparent' : 'none'),
                borderLeft: isActive ? '2px solid #ef4444' : isCellSel ? '1px solid #93c5fd' : colBorder,
                borderRight: isActive ? '2px solid #ef4444' : isCellSel ? '1px solid #93c5fd' : colBorder,
                ...(isMergedSpan ? { verticalAlign: 'middle' } : {}),
                userSelect: 'none',
              }}>
              {canEditCell
                ? <EditCell colKey={col} row={merged} profiles={profiles} destinations={destinations} ports={ports} carriers={carriers} customColumns={customColumns} onChange={c => handleRowChange(booking.id, c)} autoFocus={isActive} />
                : <ViewCell colKey={col} booking={booking} currentUserId={currentUserId} customColumns={customColumns} carrierColorMap={carrierColorMap} />
              }
            </td>
          )
        })}
        {manageCell}
      </tr>
    )
  }

  function renderNewRow(row: NewRow) {
    const err = rowErrors[row.tempId]
    const newRowBorder = { border: '1px solid #d1d5db' }
    return (
      <tr key={row.tempId} className="bg-violet-50/60">
        <td className="table-td w-9 sticky left-0 z-10" style={{ backgroundColor: '#f5f3ff' }} />
        {colsToRender.map(col => {
          const def = allColDefs[col]
          if (!def) return null
          const isPinned = pinnedColumns.includes(col)
          const fixedLeft = getFixedLeft(col, pinnedColumns, allColDefs, colWidths)
          return (
            <td key={col} className={`table-td text-xs ${isPinned ? 'sticky z-10' : ''}`}
              style={{ minWidth: def.minW, ...(fixedLeft !== null ? { left: fixedLeft } : {}), ...(isPinned ? { backgroundColor: '#f5f3ff' } : {}), ...newRowBorder }}>
              <EditCell colKey={col} row={row as unknown as Partial<Booking>} profiles={profiles}
                destinations={destinations} ports={ports} carriers={carriers} customColumns={customColumns}
                onChange={c => handleNewRowChange(row.tempId, c as Partial<Booking>)} />
            </td>
          )
        })}
        <td className="table-td" style={{ minWidth: 90, backgroundColor: '#f5f3ff', ...newRowBorder }}>
          {err && <p className="text-xs text-red-500 mb-1">{err}</p>}
          <button onClick={() => { setNewRows(prev => prev.filter(r => r.tempId !== row.tempId)); setRowErrors(p => { const c = { ...p }; delete c[row.tempId]; return c }) }}
            className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors">제거</button>
        </td>
      </tr>
    )
  }

  function renderBlankSailingRow(row: BlankSailingRow, rowIdx: number, rowSpans: Record<string, SpanInfo>, prevRow?: DisplayRow | null, nextRow?: DisplayRow | null) {
    const colBorder = `${tableStyle.cellBorderWidth}px solid ${tableStyle.cellBorderColor}`
    const groupBorder = `${tableStyle.groupBorderWidth}px solid ${tableStyle.groupBorderColor}`
    const handlerColor = destinationColorMap[row.final_destination || ''] || ''

    // 그룹 경계 판단 (DisplayRow 기반)
    const getFd = (r: DisplayRow | null | undefined) => r ? ('_blankSailing' in r ? r.final_destination : r.final_destination) || '' : ''
    const isGroupStart = !prevRow || getFd(prevRow) !== (row.final_destination || '')
    const isGroupEnd = !nextRow || getFd(nextRow) !== (row.final_destination || '')

    return (
      <tr key={row.id}>
        <td className="table-td w-9 sticky left-0 z-10" style={{
          backgroundColor: '#fffbeb',
          borderRight: colBorder,
          borderTop: isGroupStart ? groupBorder : colBorder,
          borderBottom: isGroupEnd ? groupBorder : 'none',
        }} />
        {colsToRender.map((col, colIdx) => {
          const def = allColDefs[col]
          if (!def) return null

          const isMergeCol = MERGE_HIERARCHY.includes(col as typeof MERGE_HIERARCHY[number])
          const spanInfo = isMergeCol ? (rowSpans[col] ?? { span: 1, skip: false }) : { span: 1, skip: false }
          if (spanInfo.skip) return null
          const rowSpan = spanInfo.span > 1 ? spanInfo.span : undefined
          const isMergedSpan = spanInfo.span > 1

          const isPinned = pinnedColumns.includes(col)
          const fixedLeft = getFixedLeft(col, pinnedColumns, allColDefs, colWidths)
          const isCellSel = isCellInRange(rowIdx, colIdx)
          const noTint = isMergeCol // 최종도착지/양하항/선사 = 음영 없음
          const tdIsGroupStart = isMergedSpan ? true : isGroupStart
          const tdIsGroupEnd = isMergedSpan ? true : isGroupEnd

          let content: React.ReactNode = null
          if (col === 'vessel_name') content = <span className="text-amber-800 font-bold text-xs tracking-wider">⚓ BLANK SAILING</span>
          else if (col === 'week_no') content = <span className="text-xs text-amber-700 font-medium">{getWeekLabel(row.weekNum)}</span>
          else if (col === 'final_destination') content = <span className="text-xs">{row.final_destination || '-'}</span>
          else if (col === 'discharge_port') content = <span className="text-xs">{row.discharge_port || '-'}</span>
          else if (col === 'carrier') {
            const cColor = carrierColorMap[row.carrier || '']
            content = row.carrier ? <span className="inline-block px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: cColor || '#f3f4f6', color: '#1f2937' }}>{row.carrier}</span> : null
          }

          // bgColor: isCellSel은 CSS data-attr 방식으로 처리
          const bgColorFinal = isMergedSpan ? (handlerColor || 'white')
            : noTint ? 'white'
            : isPinned ? '#fffbeb' : undefined

          return (
            <td key={col}
              rowSpan={rowSpan}
              {...(isCellSel ? (isPinned ? { 'data-cell-sel-pinned': 'true' } : { 'data-cell-sel': 'true' }) : {})}
              onMouseDown={e => {
                if (e.button !== 0) return
                isMouseSelecting.current = true
                setIsDragSelecting(true)
                if (e.shiftKey && cellSelStart) {
                  setCellSelEnd({ rowIdx, colIdx })
                } else {
                  setCellSelStart({ rowIdx, colIdx })
                  setCellSelEnd({ rowIdx, colIdx })
                }
              }}
              onMouseEnter={() => { if (!isMouseSelecting.current) return; setCellSelEnd({ rowIdx, colIdx }) }}
              className={`table-td text-xs ${isPinned ? 'sticky z-10' : ''}`}
              style={{
                minWidth: colWidths[col] || def.minW,
                ...(fixedLeft !== null ? { left: fixedLeft } : {}),
                backgroundColor: bgColorFinal,
                borderTop: tdIsGroupStart ? groupBorder : ((isMergeCol && mergeEnabled && !editMode) ? '1px solid transparent' : colBorder),
                borderBottom: tdIsGroupEnd ? groupBorder : ((isMergeCol && mergeEnabled && !editMode) ? '1px solid transparent' : 'none'),
                borderLeft: isCellSel ? '1px solid #93c5fd' : colBorder,
                borderRight: isCellSel ? '1px solid #93c5fd' : colBorder,
                userSelect: 'none',
                ...(isMergedSpan ? { verticalAlign: 'middle' } : {}),
              }}>
              {content}
            </td>
          )
        })}
        <td className="table-td" style={{
          minWidth: 90,
          borderTop: isGroupStart ? groupBorder : colBorder,
          borderBottom: isGroupEnd ? groupBorder : 'none',
          borderLeft: colBorder, borderRight: colBorder,
        }} />
      </tr>
    )
  }

  function renderBody() {
    const effectiveMerge = mergeEnabled && !editMode

    function renderRows(rows: DisplayRow[], baseRowIdx: number = 0) {
      // BLANK SAILING 포함 전체 행으로 span 계산 (병합 시 도착지/양하항/선사 그룹 유지)
      const spanMaps = buildSpanMaps(rows as MergeableRow[], effectiveMerge)
      return rows.map((r, i) => {
        const rowSpans: Record<string, SpanInfo> = {}
        for (const col of MERGE_HIERARCHY) rowSpans[col] = spanMaps[col][i]
        if ('_blankSailing' in r) return renderBlankSailingRow(r as BlankSailingRow, baseRowIdx + i, rowSpans, i > 0 ? rows[i - 1] : null, i < rows.length - 1 ? rows[i + 1] : null)
        const b = r as Booking
        return renderDataRow(b, rowSpans, baseRowIdx + i, i > 0 ? rows[i - 1] : null, i < rows.length - 1 ? rows[i + 1] : null)
      })
    }

    if (monthView && monthGroups) {
      let offset = 0
      return (
        <>
          {monthGroups.map(({ key, rows }) => {
            const collapsed = collapsedMonths.has(key)
            const base = offset
            offset += rows.length
            return (
              <>
                <tr key={`hd-${key}`} className="bg-gray-100 cursor-pointer select-none"
                  onClick={() => setCollapsedMonths(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })}>
                  <td colSpan={numCols} className="px-4 py-2 text-xs font-semibold text-gray-600">
                    <span className="mr-1.5">{collapsed ? '▶' : '▼'}</span>
                    {getMonthLabel(key)}
                    <span className="ml-2 font-normal text-gray-400">({rows.length}건)</span>
                  </td>
                </tr>
                {!collapsed && renderRows(rows, base)}
              </>
            )
          })}
        </>
      )
    }
    return <>{renderRows(displayRows)}</>
  }

  const editBtnLabel = bulkSaving ? '저장 중...' : editMode ? '편집 OFF (저장)' : '편집'

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      {/* 유효성 검사 모달 */}
      {validationErrors.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setValidationErrors([])}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 mb-2">저장 불가 — 허용되지 않는 값</h3>
            <p className="text-sm text-gray-500 mb-3">설정에 등록된 목록에 없는 값이 입력되어 있습니다. 수정 후 다시 저장해주세요.</p>
            <ul className="space-y-1.5 mb-4">
              {validationErrors.map((e, i) => (
                <li key={i} className="flex items-center gap-2 text-sm bg-red-50 rounded-lg px-3 py-1.5">
                  <span className="text-red-500 font-medium">{e.field}:</span>
                  <span className="font-mono text-red-700">"{e.value}"</span>
                </li>
              ))}
            </ul>
            <button onClick={() => setValidationErrors([])}
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors">
              확인
            </button>
          </div>
        </div>
      )}
      {/* 필터 바 */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button onClick={() => setViewMode('all')}
              className={`px-3 py-1.5 font-medium transition-colors ${viewMode === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              전체 ({bookings.length})
            </button>
            <button onClick={() => setViewMode('mine')}
              className={`px-3 py-1.5 font-medium transition-colors ${viewMode === 'mine' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              내 담당 ({bookings.filter(b => b.forwarder_handler_id === currentUserId).length})
            </button>
          </div>
          <div className="w-px h-6 bg-gray-200" />
          <select value={carrierFilter} onChange={e => setCarrierFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">선사 전체</option>
            {carrierOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={handlerFilter} onChange={e => setHandlerFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">담당자 전체</option>
            <option value="__unassigned__">미지정</option>
            {profiles.filter(p => p.is_active !== false && !p.name.startsWith('[탈퇴]')).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {regionOptions.length > 0 && (
            <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">지역 전체</option>
              {regionOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          {customerOptions.length > 0 ? (
            <select value={customersFilter} onChange={e => setCustomersFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">고객사 전체</option>
              {customerOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input value={customersFilter} onChange={e => setCustomersFilter(e.target.value)}
              placeholder="고객사 검색"
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-28" />
          )}
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <span>ETD</span>
            <input type="date" value={etdFrom} onChange={e => setEtdFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span>~</span>
            <input type="date" value={etdTo} onChange={e => setEtdTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {d3Count > 0 && (
            <button onClick={() => setDocFilter(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors ${
                docFilter ? 'bg-red-600 text-white border-red-600' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
              }`}>
              서류마감 D-3
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${docFilter ? 'bg-red-700 text-white' : 'bg-red-200 text-red-800'}`}>{d3Count}</span>
            </button>
          )}
          {hasFilter && (
            <button onClick={() => { setCarrierFilter(''); setHandlerFilter(''); setEtdFrom(''); setEtdTo(''); setDocFilter(false); setRegionFilter(''); setCustomersFilter('') }}
              className="text-xs text-gray-400 hover:text-gray-600">✕ 초기화</button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {selectedRows.size > 0 && (
              <>
                <button onClick={() => setBulkEditOpen(!bulkEditOpen)}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
                  일괄편집 ({selectedRows.size})
                </button>
                <button onClick={handleBulkDelete} disabled={bulkDeleting}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
                  {bulkDeleting ? '삭제 중...' : `선택 삭제 (${selectedRows.size})`}
                </button>
              </>
            )}
            <span className="text-xs text-gray-400">{processed.length}건</span>
            <button onClick={handleToggleEditMode} disabled={bulkSaving}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium transition-colors disabled:opacity-60 ${
                editMode ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {editBtnLabel}
            </button>
            <button onClick={() => setMergeEnabled(!mergeEnabled)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${mergeEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              title="포워더 담당·고객사 서류·도착지·양하항·선사 열 병합 ON/OFF">
              병합
            </button>
            <button onClick={handleToggleMonthView}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${monthView ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              월별
            </button>
            <button onClick={() => setReeferSeparate(!reeferSeparate)}
              title="도착지 내 RF 컨테이너 유무로 상단(비RF)/하단(RF) 분리"
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${reeferSeparate ? 'bg-cyan-100 text-cyan-800 border border-cyan-400' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              RF분리
            </button>
            <div className="flex items-center gap-1">
              <button onClick={() => setBlankSailingMode(!blankSailingMode)}
                title="목적지별 주차에 부킹 없는 경우 BLANK SAILING 행 표시 (정렬: 도착지→ETD)"
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${blankSailingMode ? 'bg-amber-200 text-amber-900 border border-amber-400' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                ⚓ BLANK
              </button>
              {blankSailingMode && (
                <div className="flex items-center gap-0.5 text-xs">
                  <input type="number" min={1} max={53} value={blankWeekFrom}
                    onChange={e => setBlankWeekFrom(Math.max(1, Number(e.target.value)))}
                    className="w-12 text-center border border-amber-300 rounded px-1 py-1 text-xs bg-amber-50 focus:ring-1 focus:ring-amber-400 focus:outline-none" />
                  <span className="text-gray-400">~</span>
                  <input type="number" min={1} max={53} value={blankWeekTo}
                    onChange={e => setBlankWeekTo(Math.max(1, Number(e.target.value)))}
                    className="w-12 text-center border border-amber-300 rounded px-1 py-1 text-xs bg-amber-50 focus:ring-1 focus:ring-amber-400 focus:outline-none" />
                  <span className="text-gray-500">주차</span>
                </div>
              )}
            </div>
            <button onClick={() => exportInlandTransport(processed)} disabled={processed.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              내륙운송
            </button>
            <button onClick={() => exportToExcel(displayRows, customColumns)} disabled={displayRows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              엑셀
            </button>
          </div>
        </div>
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 px-1 flex-shrink-0">
        <button onClick={() => setDocFilter(v => !v)}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${docFilter ? 'bg-red-100 text-red-700 font-semibold' : 'text-gray-500 hover:bg-red-50'}`}>
          <span className="w-3 h-3 bg-red-100 border border-red-300 rounded inline-block" /> 서류마감 D-3 이내 (클릭 필터)
        </button>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-yellow-100 rounded" /> D-4 ~ D-7</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-gray-100 rounded" /> 마감 지남</span>
        {sorts.length > 0 && !editMode && <span className="flex items-center gap-1 text-blue-500 font-medium ml-2">정렬: {sorts.map((s, i) => <span key={s.col}>{i > 0 && ' › '}{BASE_COL_DEFS[s.col]?.label || s.col} {s.dir === 'asc' ? '↑' : '↓'}</span>)} <button onClick={() => setSorts([])} className="text-gray-400 hover:text-gray-600 ml-1">✕</button></span>}
        <div className="flex items-center gap-1.5 ml-auto">
          <button onClick={() => {
            try {
              localStorage.setItem('bk_default_sorts', JSON.stringify(sorts))
              setSortsSaved(true)
              setTimeout(() => setSortsSaved(false), 2000)
            } catch {}
          }} className={`text-xs px-2 py-0.5 border rounded transition-colors ${sortsSaved ? 'bg-green-100 text-green-700 border-green-300' : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'}`}>
            {sortsSaved ? '✓ 저장됨' : '정렬 기본 저장'}
          </button>
          <button onClick={() => { try { const s = localStorage.getItem('bk_default_sorts'); if (s) setSorts(JSON.parse(s)) } catch {} }}
            className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 border border-gray-200 rounded hover:bg-gray-200 transition-colors">
            기본 불러오기
          </button>
          <button onClick={() => { setColWidths({}); try { localStorage.removeItem('bk_col_widths') } catch {} }}
            className="text-xs px-2 py-0.5 bg-gray-100 text-gray-400 border border-gray-200 rounded hover:bg-gray-200 transition-colors">
            열 너비 초기화
          </button>
          <label className={`flex items-center gap-1 text-xs px-2 py-0.5 border rounded cursor-pointer transition-colors ${copyWithHeaders ? 'bg-indigo-100 text-indigo-700 border-indigo-300' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}
            title="드래그 복사 시 열 제목 포함">
            <input type="checkbox" checked={copyWithHeaders} onChange={e => setCopyWithHeaders(e.target.checked)}
              className="rounded w-3 h-3" />
            열제목 복사
          </label>
        </div>
        {editMode && <span className="text-blue-500 font-medium ml-2">✎ 편집 모드 — 편집 OFF 시 일괄 저장</span>}
      </div>

      {/* 새 행 입력 섹션 (보라색 별도 공간) — 새 행이 있을 때만 표시 */}
      {editMode && newRows.length > 0 && (
        <div className="bg-violet-50 rounded-xl border-2 border-violet-200 overflow-hidden flex-shrink-0">
          <div className="px-4 py-2 bg-violet-100 border-b border-violet-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-violet-800">새 행 입력</span>
              <span className="text-xs bg-violet-200 text-violet-700 px-2 py-0.5 rounded-full font-medium">{newRows.length}건</span>
            </div>
            <button onClick={handleAddNewRow}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700 transition-colors font-medium">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              행 추가
            </button>
          </div>
          {newRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-violet-100/70">
                    <th className="table-th w-9 text-violet-700 sticky left-0 z-20" style={{ backgroundColor: '#ede9fe' }} />
                    {colsToRender.map(col => {
                      const def = allColDefs[col]
                      if (!def) return null
                      const isPinned = pinnedColumns.includes(col)
                      const fixedLeft = getFixedLeft(col, pinnedColumns, allColDefs, colWidths)
                      return (
                        <th key={col}
                          className={`table-th text-xs text-violet-700 ${isPinned ? 'sticky z-20' : ''}`}
                          style={{ minWidth: def.minW, ...(fixedLeft !== null ? { left: fixedLeft } : {}), ...(isPinned ? { backgroundColor: '#ede9fe' } : {}) }}>
                          {def.label}
                        </th>
                      )
                    })}
                    <th className="table-th text-xs text-violet-700 min-w-[90px]" style={{ backgroundColor: '#ede9fe' }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {newRows.map(r => renderNewRow(r))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-5 text-center text-violet-400 text-sm">
              행 추가 버튼을 눌러 새 부킹을 입력하세요.
            </div>
          )}
        </div>
      )}

      {/* 일괄편집 패널 */}
      {bulkEditOpen && selectedRows.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-blue-800">{selectedRows.size}건 일괄편집</span>
          <select value={bulkEditCol} onChange={e => setBulkEditCol(e.target.value)}
            className="border border-blue-200 rounded-lg px-2 py-1 text-xs bg-white focus:ring-1 focus:ring-blue-400 focus:outline-none">
            <option value="">변경할 열 선택</option>
            {colsToRender.filter(c => c !== 'week_no' && c !== 'handler_region' && c !== 'handler_customers' && c !== 'final_qty').map(c => (
              <option key={c} value={c}>{allColDefs[c]?.label || c}</option>
            ))}
          </select>
          {bulkEditCol && (
            bulkEditCol === 'forwarder_handler' ? (
              <select value={bulkEditVal} onChange={e => setBulkEditVal(e.target.value)}
                className="border border-blue-200 rounded-lg px-2 py-1 text-xs bg-white focus:ring-1 focus:ring-blue-400 focus:outline-none">
                <option value="">담당자 선택</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : bulkEditCol === 'carrier' ? (
              <select value={bulkEditVal} onChange={e => setBulkEditVal(e.target.value)}
                className="border border-blue-200 rounded-lg px-2 py-1 text-xs bg-white focus:ring-1 focus:ring-blue-400 focus:outline-none">
                <option value="">선사 선택</option>
                {carriers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : bulkEditCol === 'final_destination' ? (
              <select value={bulkEditVal} onChange={e => setBulkEditVal(e.target.value)}
                className="border border-blue-200 rounded-lg px-2 py-1 text-xs bg-white focus:ring-1 focus:ring-blue-400 focus:outline-none">
                <option value="">도착지 선택</option>
                {destinations.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            ) : bulkEditCol === 'discharge_port' ? (
              <select value={bulkEditVal} onChange={e => setBulkEditVal(e.target.value)}
                className="border border-blue-200 rounded-lg px-2 py-1 text-xs bg-white focus:ring-1 focus:ring-blue-400 focus:outline-none">
                <option value="">양하항 선택</option>
                {ports.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : ['doc_cutoff_date', 'proforma_etd', 'updated_etd', 'eta'].includes(bulkEditCol) ? (
              <input type="date" value={bulkEditVal} onChange={e => setBulkEditVal(e.target.value)}
                className="border border-blue-200 rounded-lg px-2 py-1 text-xs bg-white focus:ring-1 focus:ring-blue-400 focus:outline-none" />
            ) : (
              <input type="text" value={bulkEditVal} onChange={e => setBulkEditVal(e.target.value)}
                placeholder="변경할 값 입력" onKeyDown={e => e.key === 'Enter' && handleBulkEdit()}
                className="border border-blue-200 rounded-lg px-2 py-1 text-xs bg-white focus:ring-1 focus:ring-blue-400 focus:outline-none min-w-[120px]" />
            )
          )}
          <button onClick={handleBulkEdit} disabled={!bulkEditCol}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors font-medium">
            적용
          </button>
          <button onClick={() => setBulkEditOpen(false)}
            className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700">
            닫기
          </button>
        </div>
      )}

      {/* 테이블 */}
      <div ref={tableWrapperRef}
        className={`flex-1 overflow-auto min-h-0 bg-white rounded-xl border border-gray-300 shadow-sm${isDragSelecting ? ' is-drag-selecting' : ''}`}
        onMouseUp={() => { isMouseSelecting.current = false; setIsDragSelecting(false) }}
        onMouseLeave={() => { isMouseSelecting.current = false; setIsDragSelecting(false) }}
        onDoubleClick={() => { if (!editMode) handleToggleEditMode() }}
        onPaste={handleTablePaste}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-20">
              <tr style={{ background: 'linear-gradient(to bottom, #f8fafc, #eef2f7)' }}>
                <th className="table-th w-9 sticky left-0 z-30" style={{ background: 'linear-gradient(to bottom, #f8fafc, #eef2f7)' }}>
                  <input type="checkbox" checked={allSelected} onChange={() => {
                    if (allSelected) setSelectedRows(new Set())
                    else setSelectedRows(new Set(allProcessedIds))
                  }} className="rounded" />
                </th>
                {colsToRender.map(col => {
                  const def = allColDefs[col]
                  if (!def) return null
                  const isPinned = pinnedColumns.includes(col)
                  const fixedLeft = getFixedLeft(col, pinnedColumns, allColDefs, colWidths)
                  return (
                    <th key={col}
                      title={def.description || undefined}
                      className={`table-th select-none transition-colors relative
                        ${isPinned ? 'sticky z-30' : 'cursor-grab active:cursor-grabbing'}
                        ${dragSrc === col ? 'opacity-40' : ''}
                        ${dragOver === col && dragSrc !== col ? 'bg-blue-100 text-blue-700' : ''}
                        ${def.description ? 'cursor-help' : ''}
                      `}
                      style={{ minWidth: colWidths[col] || def.minW, width: colWidths[col] || undefined, ...(fixedLeft !== null ? { left: fixedLeft } : {}), background: dragOver === col && dragSrc !== col ? undefined : 'linear-gradient(to bottom, #f8fafc, #eef2f7)' }}
                      draggable={!isPinned}
                      onDragStart={e => {
                        if (isPinned) return
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', col)
                        colDragSrcRef.current = col
                        setDragSrc(col)
                      }}
                      onDragOver={e => { e.preventDefault(); setDragOver(col) }}
                      onDrop={e => handleDrop(e, col)}
                      onDragEnd={() => { setDragSrc(null); setDragOver(null) }}
                      onClick={() => handleSort(col)}
                    >
                      {def.label}
                      {(() => {
                        const si = sorts.findIndex(s => s.col === col)
                        if (si === -1) return null
                        const s = sorts[si]
                        return (
                          <span className="ml-0.5 text-blue-500 font-bold text-xs">
                            {sorts.length > 1 ? `${si + 1}` : ''}{s.dir === 'asc' ? '↑' : '↓'}
                          </span>
                        )
                      })()}
                      {isPinned && <span className="ml-0.5 text-gray-300 text-xs">📌</span>}
                      <span
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-300/50 z-10"
                        onMouseDown={e => handleResizeStart(col, e)}
                        onClick={e => e.stopPropagation()}
                      />
                    </th>
                  )
                })}
                <th className="table-th min-w-[90px]" style={{ background: 'linear-gradient(to bottom, #f8fafc, #eef2f7)' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {processed.length === 0 ? (
                <tr>
                  <td colSpan={numCols} className="text-center py-16 text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-sm">
                        {hasFilter || viewMode === 'mine' ? '필터 조건에 맞는 부킹이 없습니다' : '등록된 부킹이 없습니다'}
                      </p>
                      {!hasFilter && viewMode === 'all' && (
                        <button onClick={() => { setEditMode(true); handleAddNewRow() }}
                          className="text-blue-600 text-sm hover:underline">첫 번째 부킹 등록하기 →</button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : renderBody()}
            </tbody>
          </table>
      </div>
    </div>
  )
}
