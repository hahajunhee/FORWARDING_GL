'use client'

import { useState, useMemo, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { differenceInCalendarDays, parseISO, isValid, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { Booking, Profile, CustomList, ColumnDefinition, BookingEntry } from '@/types'
import { DEFAULT_COLUMN_ORDER, DEFAULT_PINNED_COLUMNS, CARRIERS, MAJOR_PORTS, DEFAULT_DESTINATIONS } from '@/types'
import { deleteBooking, saveColumnOrder, bulkSaveBookings, bulkDeleteBookings } from '@/app/bookings/actions'

// 병합 대상 열 (계층 순서: 최종도착지 → 양하항 → 선사)
const MERGE_HIERARCHY = ['final_destination', 'discharge_port', 'carrier'] as const

// ── 기본 열 정의 ───────────────────────────────────────────────────

const BASE_COL_DEFS: Record<string, { label: string; minW: number }> = {
  booking_no:           { label: '부킹번호',      minW: 200 },
  final_destination:    { label: '최종도착지',     minW: 120 },
  discharge_port:       { label: '양하항',         minW: 120 },
  carrier:              { label: '선사',            minW: 100 },
  vessel_name:          { label: '모선명',          minW: 140 },
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
  remarks:              { label: '비고',            minW: 160 },
}

// pinnedColumns 기준으로 sticky left 오프셋 계산 (colWidths 반영)
const MANAGE_COL_W = 90 // 관리 열 너비 (edit mode 시 왼쪽 고정)

function getFixedLeft(
  col: string,
  pinnedCols: string[],
  colDefs: Record<string, { label: string; minW: number }>,
  colWidths: Record<string, number>,
  manageColOffset: number = 0,
): number | null {
  const idx = pinnedCols.indexOf(col)
  if (idx === -1) return null
  let left = 36 + manageColOffset // checkbox + 관리 열(editMode 시)
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

function buildSpanMaps(rows: Booking[], mergeEnabled: boolean): Record<string, SpanInfo[]> {
  const empty = () => rows.map((): SpanInfo => ({ span: 1, skip: false }))
  const maps: Record<string, SpanInfo[]> = {
    final_destination: empty(),
    discharge_port: empty(),
    carrier: empty(),
  }
  if (!mergeEnabled || rows.length === 0) return maps

  const fd = (b: Booking) => b.final_destination || ''
  const dp = (b: Booking) => b.discharge_port || ''
  const ca = (b: Booking) => b.carrier || ''

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

function exportToExcel(rows: Booking[], customColumns: ColumnDefinition[]) {
  import('xlsx').then((XLSX) => {
    const data = rows.map(b => {
      const bookingNos = (b.booking_entries && b.booking_entries.length > 0)
        ? b.booking_entries.map(e => e.no).join(' / ')
        : b.booking_no
      const base: Record<string, unknown> = {
        '부킹번호': bookingNos, '최종도착지': b.final_destination, '양하항': b.discharge_port,
        '담당선사': b.carrier, '모선명': b.vessel_name, '확보선복': b.secured_space, 'MQC': b.mqc,
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

// YYYYMMDD → YYYY-MM-DD 자동 변환
function normalizeDateInput(v: string): string | null {
  if (!v) return null
  const digits = v.replace(/[^0-9]/g, '')
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  return v || null
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
    case 'remarks':
      return <input autoFocus={autoFocus} className={cls} value={row.remarks || ''} onChange={e => onChange({ remarks: e.target.value })} placeholder="비고" />
    default: {
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

function ViewCell({ colKey, booking, currentUserId, customColumns }: {
  colKey: string; booking: Booking; currentUserId: string; customColumns: ColumnDefinition[]
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
    case 'carrier':
      return booking.carrier
        ? <span className="inline-block bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-medium">{booking.carrier}</span>
        : <span className="text-gray-300">-</span>
    case 'vessel_name':
      return <span className="text-xs">{booking.vessel_name || '-'}</span>
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
    case 'proforma_etd':
      return <span className="text-gray-500 text-xs">{fmtDate(booking.proforma_etd)}</span>
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
    case 'remarks':
      return <span className="truncate block text-xs text-gray-500 max-w-[160px]" title={booking.remarks}>{booking.remarks || '-'}</span>
    default: {
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
  const setSorts = (updater: SortItem[] | ((p: SortItem[]) => SortItem[])) => {
    _setSorts(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      ls('bk_sorts', JSON.stringify(next))
      return next
    })
  }

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

  const processed = useMemo(() => {
    let result = bookings.filter(b => {
      if (viewMode === 'mine' && b.forwarder_handler_id !== currentUserId) return false
      if (carrierFilter && b.carrier !== carrierFilter) return false
      if (handlerFilter && b.forwarder_handler_id !== handlerFilter) return false
      if (regionFilter && b.forwarder_handler?.region !== regionFilter) return false
      if (customersFilter && !b.forwarder_handler?.customers?.includes(customersFilter)) return false
      const etd = b.updated_etd || b.proforma_etd
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
            cmp = ia - ib
          } else {
            cmp = va < vb ? -1 : va > vb ? 1 : 0
          }
          if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
        }
        return 0
      })
    }
    return result
  }, [bookings, viewMode, carrierFilter, handlerFilter, regionFilter, customersFilter, etdFrom, etdTo, docFilter, sorts, currentUserId, customColumns])

  const monthGroups = useMemo(() => {
    if (!monthView) return null
    const map: Record<string, Booking[]> = {}
    for (const b of processed) {
      const k = getMonthKey(b.updated_etd || b.proforma_etd)
      if (!map[k]) map[k] = []
      map[k].push(b)
    }
    const keys = Object.keys(map).sort((a, b) => {
      if (a === 'none') return 1; if (b === 'none') return -1
      return a < b ? -1 : 1
    })
    return keys.map(key => ({ key, rows: map[key] }))
  }, [processed, monthView])

  // ── 편집 모드 토글: OFF 시 일괄 저장 ──────────────────────────────

  const handleToggleEditMode = async () => {
    if (!editMode) { setEditMode(true); return }
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

  const handleToggleMonthView = () => {
    if (!monthView) {
      const currentMonth = format(new Date(), 'yyyy-MM')
      const toCollapse = new Set(
        processed.map(b => getMonthKey(b.updated_etd || b.proforma_etd))
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
    if (!editMode) setEditMode(true)
    const tempId = `new-${Date.now()}`
    setNewRows(prev => [{
      tempId,
      booking_no: booking.booking_no ? `${booking.booking_no}_복사` : '',
      final_destination: booking.final_destination || '',
      discharge_port: booking.discharge_port || '',
      carrier: booking.carrier || '',
      vessel_name: booking.vessel_name || '',
      secured_space: booking.secured_space || '',
      mqc: booking.mqc || '',
      customer_doc_handler: booking.customer_doc_handler || '',
      forwarder_handler_id: booking.forwarder_handler_id,
      doc_cutoff_date: booking.doc_cutoff_date,
      proforma_etd: booking.proforma_etd,
      updated_etd: booking.updated_etd,
      eta: booking.eta,
      qty_20_normal: booking.qty_20_normal || 0,
      qty_20_dg: booking.qty_20_dg || 0,
      qty_20_reefer: booking.qty_20_reefer || 0,
      qty_40_normal: booking.qty_40_normal || 0,
      qty_40_dg: booking.qty_40_dg || 0,
      qty_40_reefer: booking.qty_40_reefer || 0,
      remarks: booking.remarks || '',
      extra_data: { ...(booking.extra_data || {}) },
      booking_entries: booking.booking_entries ? booking.booking_entries.map(e => ({ ...e })) : [],
    }, ...prev])
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
    // 내 담당 건만 삭제 가능
    const ownedIds = Array.from(selectedRows).filter(id => {
      const b = bookings.find(bk => bk.id === id)
      return b?.forwarder_handler_id === currentUserId
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

  function isSameGroup(a: Booking, b: Booking): boolean {
    return (a.final_destination || '') === (b.final_destination || '')
  }

  function renderDataRow(
    booking: Booking,
    rowSpans: Record<string, { span: number; skip: boolean }>,
    prevBooking?: Booking | null,
    nextBooking?: Booking | null,
  ) {
    const edits = rowEdits[booking.id] || {}
    const merged: Partial<Booking> = { ...booking, ...edits }
    const hasEdits = Object.keys(edits).length > 0
    const err = rowErrors[booking.id]
    const handlerColor = booking.forwarder_handler?.color || ''
    const isOwnBooking = booking.forwarder_handler_id === currentUserId

    const isGroupStart = !prevBooking || !isSameGroup(booking, prevBooking)
    const isGroupEnd = !nextBooking || !isSameGroup(booking, nextBooking)
    const groupBorder = '1.5px solid #9ca3af'
    const colBorder = '1px solid #e5e7eb'
    const isSelected = selectedRows.has(booking.id)
    const manageOffset = editMode ? MANAGE_COL_W : 0

    const manageCell = (
      <td className={`table-td ${editMode ? 'sticky z-10' : ''}`}
        style={{
          ...(editMode ? { left: 36, width: MANAGE_COL_W, minWidth: MANAGE_COL_W, backgroundColor: isSelected ? '#eff6ff' : (handlerColor || 'white') } : {}),
          borderTop: isGroupStart ? groupBorder : '1px solid transparent',
          borderBottom: isGroupEnd ? groupBorder : '1px solid transparent',
          borderLeft: colBorder,
          borderRight: colBorder,
        }}>
        {err && <p className="text-xs text-red-500 mb-1">{err}</p>}
        {!isOwnBooking && editMode
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
          ...(editMode && hasEdits && isOwnBooking ? { boxShadow: 'inset 3px 0 0 #3b82f6' } : {}),
        }}>
        <td className="table-td w-9 sticky left-0 z-10 bg-white"
          style={{ backgroundColor: isSelected ? '#eff6ff' : (handlerColor || 'white') }}>
          <input type="checkbox" checked={isSelected} onChange={() => toggleRowSelect(booking.id)} className="rounded" />
        </td>
        {editMode && manageCell}
        {colsToRender.map(col => {
          const def = allColDefs[col]
          if (!def) return null

          const isMergeCol = MERGE_HIERARCHY.includes(col as typeof MERGE_HIERARCHY[number])
          const spanInfo = isMergeCol ? (rowSpans[col] ?? { span: 1, skip: false }) : { span: 1, skip: false }
          if (spanInfo.skip) return null

          const rowSpan = spanInfo.span > 1 ? spanInfo.span : undefined
          const isMergedSpan = spanInfo.span > 1
          const isPinned = pinnedColumns.includes(col)
          const fixedLeft = getFixedLeft(col, pinnedColumns, allColDefs, colWidths, manageOffset)
          const isDocCol = col === 'doc_cutoff_date'

          const tdIsGroupStart = isMergedSpan ? true : isGroupStart
          const tdIsGroupEnd = isMergedSpan ? true : isGroupEnd
          const isActive = editMode && isOwnBooking && activeCell?.id === booking.id && activeCell?.col === col

          return (
            <td key={col}
              rowSpan={rowSpan}
              onClick={editMode && isOwnBooking
                ? () => setActiveCell({ id: booking.id, col })
                : (!editMode && isDocCol && booking.doc_cutoff_date ? () => setDocFilter(v => !v) : undefined)
              }
              className={`table-td text-xs
                ${isPinned ? 'sticky z-10 bg-white' : ''}
                ${dragOver === col && dragSrc !== col ? 'bg-blue-50' : ''}
                ${!editMode && isDocCol && booking.doc_cutoff_date ? 'cursor-pointer hover:bg-red-50' : ''}
                ${editMode && isOwnBooking ? 'p-0.5 cursor-pointer' : ''}
                ${editMode && !isOwnBooking ? 'opacity-60' : ''}
              `}
              style={{
                minWidth: colWidths[col] || def.minW,
                ...(fixedLeft !== null ? { left: fixedLeft } : {}),
                ...(isPinned ? { backgroundColor: handlerColor || 'white' } : {}),
                borderTop: isActive ? '2px solid #ef4444' : tdIsGroupStart ? groupBorder : '1px solid transparent',
                borderBottom: isActive ? '2px solid #ef4444' : tdIsGroupEnd ? groupBorder : '1px solid transparent',
                borderLeft: isActive ? '2px solid #ef4444' : colBorder,
                borderRight: isActive ? '2px solid #ef4444' : colBorder,
                ...(isMergedSpan ? { verticalAlign: 'middle' } : {}),
              }}>
              {editMode && isOwnBooking
                ? <EditCell colKey={col} row={merged} profiles={profiles} destinations={destinations} ports={ports} carriers={carriers} customColumns={customColumns} onChange={c => handleRowChange(booking.id, c)} autoFocus={isActive} />
                : <ViewCell colKey={col} booking={booking} currentUserId={currentUserId} customColumns={customColumns} />
              }
            </td>
          )
        })}
        {!editMode && manageCell}
      </tr>
    )
  }

  function renderNewRow(row: NewRow) {
    const err = rowErrors[row.tempId]
    const newRowBorder = { border: '1px solid #e5e7eb' }
    return (
      <tr key={row.tempId} className="bg-violet-50/60">
        <td className="table-td w-9 sticky left-0 z-10" style={{ backgroundColor: '#f5f3ff' }} />
        <td className="table-td sticky z-10" style={{ left: 36, width: MANAGE_COL_W, minWidth: MANAGE_COL_W, backgroundColor: '#f5f3ff', ...newRowBorder }}>
          {err && <p className="text-xs text-red-500 mb-1">{err}</p>}
          <button onClick={() => { setNewRows(prev => prev.filter(r => r.tempId !== row.tempId)); setRowErrors(p => { const c = { ...p }; delete c[row.tempId]; return c }) }}
            className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors">제거</button>
        </td>
        {colsToRender.map(col => {
          const def = allColDefs[col]
          if (!def) return null
          const isPinned = pinnedColumns.includes(col)
          const fixedLeft = getFixedLeft(col, pinnedColumns, allColDefs, colWidths, MANAGE_COL_W)
          return (
            <td key={col} className={`table-td text-xs ${isPinned ? 'sticky z-10' : ''}`}
              style={{ minWidth: def.minW, ...(fixedLeft !== null ? { left: fixedLeft } : {}), ...(isPinned ? { backgroundColor: '#f5f3ff' } : {}), ...newRowBorder }}>
              <EditCell colKey={col} row={row as unknown as Partial<Booking>} profiles={profiles}
                destinations={destinations} ports={ports} carriers={carriers} customColumns={customColumns}
                onChange={c => handleNewRowChange(row.tempId, c as Partial<Booking>)} />
            </td>
          )
        })}
      </tr>
    )
  }

  function renderBody() {
    const effectiveMerge = mergeEnabled && !editMode

    function renderRows(rows: Booking[]) {
      const spanMaps = buildSpanMaps(rows, effectiveMerge)
      return rows.map((b, i) => {
        const rowSpans: Record<string, SpanInfo> = {}
        for (const col of MERGE_HIERARCHY) rowSpans[col] = spanMaps[col][i]
        return renderDataRow(b, rowSpans, i > 0 ? rows[i - 1] : null, i < rows.length - 1 ? rows[i + 1] : null)
      })
    }

    if (monthView && monthGroups) {
      return (
        <>
          {monthGroups.map(({ key, rows }) => {
            const collapsed = collapsedMonths.has(key)
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
                {!collapsed && renderRows(rows)}
              </>
            )
          })}
        </>
      )
    }
    return <>{renderRows(processed)}</>
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
            {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
                {bulkDeleting ? '삭제 중...' : `선택 삭제 (${selectedRows.size})`}
              </button>
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
            <button onClick={() => exportToExcel(processed, customColumns)} disabled={processed.length === 0}
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
        </div>
        {editMode && <span className="text-blue-500 font-medium ml-2">✎ 편집 모드 — 편집 OFF 시 일괄 저장</span>}
      </div>

      {/* 새 행 입력 섹션 (보라색 별도 공간) */}
      {editMode && (
        <div className="bg-violet-50 rounded-xl border-2 border-violet-200 overflow-hidden flex-shrink-0">
          <div className="px-4 py-2.5 bg-violet-100 border-b border-violet-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-violet-800">새 행 입력</span>
              {newRows.length > 0 && (
                <span className="text-xs bg-violet-200 text-violet-700 px-2 py-0.5 rounded-full font-medium">{newRows.length}건</span>
              )}
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
                    <th className="table-th text-xs text-violet-700 sticky z-20"
                      style={{ left: 36, width: MANAGE_COL_W, minWidth: MANAGE_COL_W, backgroundColor: '#ede9fe' }}>관리</th>
                    {colsToRender.map(col => {
                      const def = allColDefs[col]
                      if (!def) return null
                      const isPinned = pinnedColumns.includes(col)
                      const fixedLeft = getFixedLeft(col, pinnedColumns, allColDefs, colWidths, MANAGE_COL_W)
                      return (
                        <th key={col}
                          className={`table-th text-xs text-violet-700 ${isPinned ? 'sticky z-20' : ''}`}
                          style={{ minWidth: def.minW, ...(fixedLeft !== null ? { left: fixedLeft } : {}), ...(isPinned ? { backgroundColor: '#ede9fe' } : {}) }}>
                          {def.label}
                        </th>
                      )
                    })}
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

      {/* 테이블 */}
      <div className="flex-1 overflow-auto min-h-0 bg-white rounded-xl border border-gray-200">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-50">
                <th className="table-th w-9 bg-gray-50 sticky left-0 z-30">
                  <input type="checkbox" checked={allSelected} onChange={() => {
                    if (allSelected) setSelectedRows(new Set())
                    else setSelectedRows(new Set(allProcessedIds))
                  }} className="rounded" />
                </th>
                {editMode && (
                  <th className="table-th bg-gray-50 sticky z-30 text-xs min-w-0"
                    style={{ left: 36, width: MANAGE_COL_W, minWidth: MANAGE_COL_W }}>관리</th>
                )}
                {colsToRender.map(col => {
                  const def = allColDefs[col]
                  if (!def) return null
                  const isPinned = pinnedColumns.includes(col)
                  const fixedLeft = getFixedLeft(col, pinnedColumns, allColDefs, colWidths, editMode ? MANAGE_COL_W : 0)
                  return (
                    <th key={col}
                      title={def.description || undefined}
                      className={`table-th select-none transition-colors relative
                        ${isPinned ? 'sticky z-30 bg-gray-50' : 'bg-gray-50 cursor-grab active:cursor-grabbing'}
                        ${dragSrc === col ? 'opacity-40' : ''}
                        ${dragOver === col && dragSrc !== col ? 'bg-blue-100 text-blue-700' : ''}
                        ${def.description ? 'cursor-help' : ''}
                      `}
                      style={{ minWidth: colWidths[col] || def.minW, width: colWidths[col] || undefined, ...(fixedLeft !== null ? { left: fixedLeft } : {}) }}
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
                {!editMode && <th className="table-th min-w-[90px] bg-gray-50">관리</th>}
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
