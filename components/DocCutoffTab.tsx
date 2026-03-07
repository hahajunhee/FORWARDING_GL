'use client'

import { useState, useMemo, useEffect, useTransition } from 'react'
import { format, parseISO, isValid } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { Booking, Profile, ColumnDefinition } from '@/types'
import { COLUMN_LABELS } from '@/types'
import { saveDocTemplate } from '@/app/settings/actions'
import { formatContainers } from '@/components/BookingTable'

const DEFAULT_TEMPLATE = `{담당자}님,

안녕하세요.
금일 ({날짜}) 서류마감인 부킹 안내드립니다.

{부킹목록}

서류 마감 부탁드립니다.

감사합니다.`

function fmtDate(d: string | null | undefined): string {
  if (!d) return '-'
  try { const p = parseISO(d); return isValid(p) ? format(p, 'MM/dd') : '-' } catch { return '-' }
}

// 단일 부킹 요약 문자열
function bookingLine(b: Booking): string {
  const etd = fmtDate(b.updated_etd || b.proforma_etd)
  return `부킹번호: ${b.booking_no} / 선사: ${b.carrier || '-'} / 모선명: ${b.vessel_name || '-'} / ETD: ${etd}`
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getFieldValue(booking: Booking, key: string, customColumns: ColumnDefinition[]): string {
  switch (key) {
    case 'booking_no': return booking.booking_no || ''
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
      const cd = customColumns.find(c => c.key === key)
      if (cd) return (booking.extra_data as Record<string, string> | null)?.[key] || ''
      return ''
    }
  }
}

const BUILTIN_FIELD_KEYS = [
  'booking_no', 'final_destination', 'discharge_port', 'carrier', 'vessel_name',
  'secured_space', 'mqc', 'customer_doc_handler', 'forwarder_handler',
  'doc_cutoff_date', 'proforma_etd', 'updated_etd', 'eta', 'containers', 'remarks',
]

interface Props {
  bookings: Booking[]
  initialTemplate: string | null
  customColumns: ColumnDefinition[]
  profiles: Profile[]
  currentUserId: string
}

export default function DocCutoffTab({ bookings, initialTemplate, customColumns, profiles, currentUserId }: Props) {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [handlerFilter, setHandlerFilter] = useState<string>(currentUserId)
  const [template, setTemplate] = useState(initialTemplate || DEFAULT_TEMPLATE)
  const [editingTemplate, setEditingTemplate] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (initialTemplate) setTemplate(initialTemplate)
  }, [initialTemplate])

  const handleSaveTemplate = (t: string) => {
    setSaveState('saving')
    startTransition(async () => {
      const result = await saveDocTemplate(t)
      if (result.error) {
        setSaveState('error')
      } else {
        setTemplate(t)
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2500)
      }
    })
  }

  // 선택 날짜 기준 필터
  const filtered = useMemo(() => {
    let result = bookings.filter(b => b.doc_cutoff_date === selectedDate)
    if (handlerFilter) {
      result = result.filter(b => b.forwarder_handler_id === handlerFilter)
    }
    return result
  }, [bookings, selectedDate, handlerFilter])

  // 고객사서류담당자별 그룹
  const groups = useMemo(() => {
    const map: Record<string, Booking[]> = {}
    for (const b of filtered) {
      const key = b.customer_doc_handler || '(담당자 미지정)'
      if (!map[key]) map[key] = []
      map[key].push(b)
    }
    return Object.entries(map)
  }, [filtered])

  // 사용 가능한 열별 변수
  const fieldVariables = useMemo(() => {
    const builtins = BUILTIN_FIELD_KEYS.map(key => ({
      key, label: COLUMN_LABELS[key] || key, variable: `{${COLUMN_LABELS[key] || key}}`,
    }))
    const customs = customColumns.map(cd => ({
      key: cd.key, label: cd.label, variable: `{${cd.label}}`,
    }))
    return [...builtins, ...customs]
  }, [customColumns])

  const generateEmail = (handler: string, rows: Booking[]): string => {
    let dateStr = selectedDate
    try { dateStr = format(parseISO(selectedDate), 'yyyy년 M월 d일 (E)', { locale: ko }) } catch {}

    // {부킹목록} - 전체 합친 목록 (기존 호환)
    const combinedList = rows.map((b, i) => {
      const prefix = rows.length > 1 ? `${i + 1}. ` : ''
      return `${prefix}${bookingLine(b)}`
    }).join('\n')

    let result = template
      .replace(/{담당자}/g, handler)
      .replace(/{날짜}/g, dateStr)
      .replace(/{부킹목록}/g, combinedList)
      .replace(/{부킹수}/g, String(rows.length))

    // {부킹목록_N} - N번째 부킹 개별 라인
    for (let i = 0; i < rows.length; i++) {
      result = result.replace(new RegExp(`\\{부킹목록_${i + 1}\\}`, 'g'), bookingLine(rows[i]))
    }
    result = result.replace(/\{부킹목록_\d+\}/g, '')

    // 열별 변수: {label_N} → N번째 행의 값, {label} → 첫 번째 행의 값
    for (const fv of fieldVariables) {
      const escapedLabel = escapeRegex(fv.label)
      // {label_N} 치환
      for (let i = 0; i < rows.length; i++) {
        const valN = getFieldValue(rows[i], fv.key, customColumns)
        result = result.replace(new RegExp(`\\{${escapedLabel}_${i + 1}\\}`, 'g'), valN)
      }
      // 사용되지 않은 {label_N} 제거
      result = result.replace(new RegExp(`\\{${escapedLabel}_\\d+\\}`, 'g'), '')
      // {label} → 첫 번째 행 값
      const val = rows.length > 0 ? getFieldValue(rows[0], fv.key, customColumns) : ''
      result = result.replace(new RegExp(`\\{${escapedLabel}\\}`, 'g'), val)
    }

    return result
  }

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch {}
  }

  // D-7 이내 날짜 빠른 선택
  const upcomingDates = useMemo(() => {
    const dates = new Set<string>()
    const today = new Date()
    for (const b of bookings) {
      if (!b.doc_cutoff_date) continue
      try {
        const d = parseISO(b.doc_cutoff_date)
        const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000)
        if (diff >= -1 && diff <= 7) dates.add(b.doc_cutoff_date)
      } catch {}
    }
    return Array.from(dates).sort()
  }, [bookings])

  // 해당 날짜의 전체 건수 (담당자 필터 무관)
  const totalForDate = useMemo(() =>
    bookings.filter(b => b.doc_cutoff_date === selectedDate).length,
    [bookings, selectedDate]
  )

  return (
    <div className="space-y-4 max-w-5xl">
      {/* 날짜 + 담당자 필터 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1 font-medium">서류마감 날짜</label>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1 font-medium">포워더 담당자</label>
            <select value={handlerFilter} onChange={e => setHandlerFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">전체</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.id === currentUserId ? ' (나)' : ''}
                </option>
              ))}
            </select>
          </div>

          {upcomingDates.length > 0 && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">마감 임박</label>
              <div className="flex flex-wrap gap-1.5">
                {upcomingDates.map(d => {
                  const count = bookings.filter(b => b.doc_cutoff_date === d).length
                  const isToday = d === format(new Date(), 'yyyy-MM-dd')
                  const isSelected = d === selectedDate
                  return (
                    <button key={d} onClick={() => setSelectedDate(d)}
                      className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors border ${
                        isSelected ? 'bg-blue-600 text-white border-blue-600' :
                        isToday ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' :
                        'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}>
                      {format(parseISO(d), 'M/d')} {isToday && '(오늘)'}
                      <span className="ml-1 opacity-70">{count}건</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="ml-auto text-sm">
            {filtered.length > 0
              ? <span className="text-red-600 font-semibold">{filtered.length}건 {handlerFilter ? '(필터)' : ''} / 전체 {totalForDate}건</span>
              : <span className="text-gray-400">해당 조건 서류마감 없음 {totalForDate > 0 ? `(전체 ${totalForDate}건)` : ''}</span>
            }
          </div>
        </div>
      </div>

      {/* 메일 초안 카드 - 담당자별 */}
      {groups.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {groups.map(([handler, rows]) => {
            const email = generateEmail(handler, rows)
            const key = `email-${handler}-${selectedDate}`
            return (
              <div key={key} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-sm text-gray-900">{handler}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{rows.length}건 · 서류마감 {format(parseISO(selectedDate), 'M/d')}</p>
                  </div>
                  <button onClick={() => copyToClipboard(email, key)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                      copied === key ? 'bg-green-500 text-white border-green-500' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {copied === key ? '✓ 복사됨' : '복사'}
                  </button>
                </div>

                {/* 포함 부킹 목록 */}
                <div className="bg-gray-50 rounded-lg p-2.5 space-y-1">
                  {rows.map((b, i) => (
                    <div key={b.id} className="flex items-center gap-2 text-xs">
                      <span className="text-gray-400 w-4 flex-shrink-0">{i + 1}.</span>
                      <span className="font-mono font-medium text-blue-700">{b.booking_no}</span>
                      <span className="text-gray-500">{b.carrier}</span>
                      <span className="text-gray-400 truncate">{b.vessel_name}</span>
                      <span className="ml-auto text-gray-500 whitespace-nowrap">ETD {fmtDate(b.updated_etd || b.proforma_etd)}</span>
                    </div>
                  ))}
                </div>

                {/* 메일 미리보기 */}
                <textarea readOnly value={email}
                  className="w-full border border-gray-200 rounded-lg p-3 text-xs font-mono resize-none bg-white h-52 focus:outline-none text-gray-700 leading-relaxed"
                />
              </div>
            )
          })}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
          <svg className="w-10 h-10 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-sm">선택한 조건에 서류마감인 부킹이 없습니다.</p>
        </div>
      )}

      {/* 메일 템플릿 편집 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-gray-900">메일 템플릿 편집</h3>
          <div className="flex items-center gap-2">
            {saveState === 'saved' && <span className="text-xs text-green-600 font-medium">✓ 저장됨</span>}
            {saveState === 'error' && <span className="text-xs text-red-600">저장 실패</span>}
            <button onClick={() => setEditingTemplate(v => !v)}
              className="text-xs px-3 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
              {editingTemplate ? '접기' : '편집'}
            </button>
          </div>
        </div>

        {/* 변수 안내 */}
        <div className="space-y-2">
          <div>
            <p className="text-xs text-gray-500 font-medium mb-1">예약 변수:</p>
            <div className="flex flex-wrap gap-1.5">
              {['{담당자}', '{날짜}', '{부킹목록}', '{부킹수}'].map(v => (
                <code key={v} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs border border-blue-200">{v}</code>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium mb-1">N번째 부킹 변수 — <span className="text-orange-600">열이름_N</span> 형식으로 N번째 행 값 사용:</p>
            <div className="flex flex-wrap gap-1.5">
              {['{부킹목록_1}', '{부킹목록_2}', '{부킹번호_1}', '{선사_1}', '{모선명_1}', '{양하항_2}'].map(v => (
                <code key={v} className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded text-xs border border-orange-200">{v}</code>
              ))}
              <span className="text-xs text-gray-400 self-center">등 모든 열 지원</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium mb-1">열별 변수 (접미사 없으면 첫 번째 행):</p>
            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
              {fieldVariables.map(fv => (
                <code key={fv.key} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">{fv.variable}</code>
              ))}
            </div>
          </div>
        </div>

        {editingTemplate && (
          <>
            <textarea value={template} onChange={e => setTemplate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg p-3 text-xs font-mono resize-y bg-white h-52 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700 leading-relaxed"
            />
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={() => handleSaveTemplate(template)} disabled={isPending}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saveState === 'saving' ? '저장 중...' : '템플릿 저장 (내 계정)'}
              </button>
              <button onClick={() => { const t = DEFAULT_TEMPLATE; setTemplate(t); handleSaveTemplate(t) }} disabled={isPending}
                className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                기본값으로
              </button>
              <span className="text-xs text-gray-400">저장된 템플릿은 내 계정에만 적용, 다른 기기에서도 유지됩니다.</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
