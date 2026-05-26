'use client'

import { useState, useMemo } from 'react'
import { format, parseISO, isValid } from 'date-fns'
import type { Booking } from '@/types'

function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? format(p, 'MM/dd') : '' } catch { return '' }
}

function formatContainersCompact(b: Booking): string {
  if (b.booking_entries && b.booking_entries.length > 0) {
    return b.booking_entries.map(e => `${e.ctr_type} × ${e.ctr_qty}`).join(', ')
  }
  const parts: string[] = []
  if (b.qty_20_normal) parts.push(`20' × ${b.qty_20_normal}`)
  if (b.qty_20_dg) parts.push(`20'DG × ${b.qty_20_dg}`)
  if (b.qty_20_reefer) parts.push(`20'RF × ${b.qty_20_reefer}`)
  if (b.qty_40_normal) parts.push(`40' × ${b.qty_40_normal}`)
  if (b.qty_40_dg) parts.push(`40'DG × ${b.qty_40_dg}`)
  if (b.qty_40_reefer) parts.push(`40'RF × ${b.qty_40_reefer}`)
  return parts.join(', ') || '-'
}

interface FoundRow {
  booking: Booking
  pickupDate: string
  workDate: string
  docCutoff: string
}

interface Props {
  bookings: Booking[]
}

export default function ReeferCutoffTab({ bookings }: Props) {
  const [input, setInput] = useState('')
  const [rows, setRows] = useState<FoundRow[]>([])
  const [notFound, setNotFound] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  // 부킹번호로 검색
  const handleSearch = () => {
    const queries = input
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean)

    if (queries.length === 0) return

    const found: FoundRow[] = []
    const missing: string[] = []

    for (const q of queries) {
      // booking_entries 내부도 탐색
      const match = bookings.find(b => {
        if (b.booking_no && b.booking_no.toLowerCase().includes(q.toLowerCase())) return true
        if (b.booking_entries) {
          return b.booking_entries.some(e => e.no.toLowerCase().includes(q.toLowerCase()))
        }
        return false
      })
      if (match) {
        // 중복 방지
        if (!found.some(r => r.booking.id === match.id)) {
          found.push({
            booking: match,
            pickupDate: '',
            workDate: '',
            docCutoff: match.doc_cutoff_date || '',
          })
        }
      } else {
        missing.push(q)
      }
    }

    setRows(found)
    setNotFound(missing)
  }

  const updateRow = (idx: number, field: keyof Omit<FoundRow, 'booking'>, value: string) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const removeRow = (idx: number) => {
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  // 테이블 HTML 생성 (메일 복사용)
  const tableHtml = useMemo(() => {
    if (rows.length === 0) return ''
    const thStyle = 'padding:6px 10px;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;font-size:10pt;white-space:nowrap;text-align:center;'
    const tdStyle = 'padding:6px 10px;border:1px solid #cbd5e1;font-size:10pt;white-space:nowrap;'
    const tdCenter = 'padding:6px 10px;border:1px solid #cbd5e1;font-size:10pt;white-space:nowrap;text-align:center;'

    const headers = ['No.', '최종도착지', '양하항', '컨테이너', '선사', '모선명', 'VOYAGE', '부킹번호', 'UPDATED ETD', 'ETA', '컨테이너 픽업일', '작업일', '서류마감일']

    let html = `<table style="font-family:'맑은 고딕',Malgun Gothic,sans-serif;border-collapse:collapse;">`
    html += '<tr>' + headers.map(h => `<th style="${thStyle}">${h}</th>`).join('') + '</tr>'

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const b = r.booking
      const nos = (b.booking_entries && b.booking_entries.length > 0)
        ? b.booking_entries.map(e => e.no).join(', ')
        : b.booking_no || ''
      const cells = [
        { v: String(i + 1), s: tdCenter },
        { v: b.final_destination || '', s: tdStyle },
        { v: b.discharge_port || '', s: tdStyle },
        { v: formatContainersCompact(b), s: tdCenter },
        { v: b.carrier || '', s: tdCenter },
        { v: b.vessel_name || '', s: tdStyle },
        { v: b.voyage || '', s: tdCenter },
        { v: nos, s: tdStyle },
        { v: fmtDate(b.updated_etd), s: tdCenter },
        { v: fmtDate(b.eta), s: tdCenter },
        { v: r.pickupDate ? fmtDate(r.pickupDate) : '', s: tdCenter },
        { v: r.workDate ? fmtDate(r.workDate) : '', s: tdCenter },
        { v: r.docCutoff ? fmtDate(r.docCutoff) : '', s: tdCenter },
      ]
      html += '<tr>' + cells.map(c => `<td style="${c.s}">${c.v}</td>`).join('') + '</tr>'
    }
    html += '</table>'
    return html
  }, [rows])

  const handleCopy = async () => {
    if (!tableHtml) return
    try {
      // 텍스트 버전
      const plainRows = rows.map((r, i) => {
        const b = r.booking
        const nos = (b.booking_entries && b.booking_entries.length > 0)
          ? b.booking_entries.map(e => e.no).join(', ')
          : b.booking_no || ''
        return [
          i + 1,
          b.final_destination || '',
          b.discharge_port || '',
          formatContainersCompact(b),
          b.carrier || '',
          b.vessel_name || '',
          b.voyage || '',
          nos,
          fmtDate(b.updated_etd),
          fmtDate(b.eta),
          r.pickupDate ? fmtDate(r.pickupDate) : '',
          r.workDate ? fmtDate(r.workDate) : '',
          r.docCutoff ? fmtDate(r.docCutoff) : '',
        ].join('\t')
      })
      const header = 'No.\t최종도착지\t양하항\t컨테이너\t선사\t모선명\tVOYAGE\t부킹번호\tUPDATED ETD\tETA\t컨테이너 픽업일\t작업일\t서류마감일'
      const plain = [header, ...plainRows].join('\n')

      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([tableHtml], { type: 'text/html' }),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(plain)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="space-y-4 max-w-6xl">
      {/* 부킹번호 입력 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1 font-medium">부킹번호 입력</label>
          <p className="text-xs text-gray-400 mb-2">쉼표, 세미콜론, 또는 줄바꿈으로 여러 건 입력 가능</p>
        </div>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSearch() }}
            placeholder="예: SELG46775400, W360945512"
            rows={2}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <button onClick={handleSearch}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium self-end">
            조회
          </button>
        </div>
        {notFound.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
            <p className="text-xs text-yellow-700">
              다음 부킹번호를 찾을 수 없습니다: <span className="font-mono font-medium">{notFound.join(', ')}</span>
            </p>
          </div>
        )}
      </div>

      {/* 결과 테이블 */}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900">리퍼마감 메일 테이블</h3>
              <p className="text-xs text-gray-400 mt-0.5">{rows.length}건 · 복사 후 메일에 붙여넣기</p>
            </div>
            <button onClick={handleCopy}
              className={`text-xs px-4 py-2 rounded-lg font-medium border transition-colors ${
                copied
                  ? 'bg-green-500 text-white border-green-500'
                  : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
              }`}>
              {copied ? '✓ 복사됨' : '테이블 복사'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2.5 text-center font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">No.</th>
                  <th className="px-3 py-2.5 text-left font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">최종도착지</th>
                  <th className="px-3 py-2.5 text-left font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">양하항</th>
                  <th className="px-3 py-2.5 text-center font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">컨테이너</th>
                  <th className="px-3 py-2.5 text-center font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">선사</th>
                  <th className="px-3 py-2.5 text-left font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">모선명</th>
                  <th className="px-3 py-2.5 text-center font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">VOYAGE</th>
                  <th className="px-3 py-2.5 text-left font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">부킹번호</th>
                  <th className="px-3 py-2.5 text-center font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">UPDATED ETD</th>
                  <th className="px-3 py-2.5 text-center font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">ETA</th>
                  <th className="px-3 py-2.5 text-center font-bold text-cyan-700 border-b border-gray-200 whitespace-nowrap bg-cyan-50">컨테이너 픽업일</th>
                  <th className="px-3 py-2.5 text-center font-bold text-cyan-700 border-b border-gray-200 whitespace-nowrap bg-cyan-50">작업일</th>
                  <th className="px-3 py-2.5 text-center font-bold text-cyan-700 border-b border-gray-200 whitespace-nowrap bg-cyan-50">서류마감일</th>
                  <th className="px-3 py-2.5 text-center border-b border-gray-200 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const b = r.booking
                  const nos = (b.booking_entries && b.booking_entries.length > 0)
                    ? b.booking_entries.map(e => e.no).join(', ')
                    : b.booking_no || ''
                  return (
                    <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2 text-center text-gray-400 border-b border-gray-100">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-800 border-b border-gray-100">{b.final_destination || '-'}</td>
                      <td className="px-3 py-2 text-gray-700 border-b border-gray-100">{b.discharge_port || '-'}</td>
                      <td className="px-3 py-2 text-center text-gray-700 border-b border-gray-100 font-mono">{formatContainersCompact(b)}</td>
                      <td className="px-3 py-2 text-center border-b border-gray-100">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">{b.carrier || '-'}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-700 border-b border-gray-100">{b.vessel_name || '-'}</td>
                      <td className="px-3 py-2 text-center text-gray-600 border-b border-gray-100">{b.voyage || '-'}</td>
                      <td className="px-3 py-2 font-mono text-blue-700 border-b border-gray-100">{nos || '-'}</td>
                      <td className="px-3 py-2 text-center text-gray-700 border-b border-gray-100">{fmtDate(b.updated_etd) || '-'}</td>
                      <td className="px-3 py-2 text-center text-gray-700 border-b border-gray-100">{fmtDate(b.eta) || '-'}</td>
                      {/* 편집 가능 필드 */}
                      <td className="px-1 py-1 border-b border-gray-100 bg-cyan-50/30">
                        <input type="date" value={r.pickupDate}
                          onChange={e => updateRow(i, 'pickupDate', e.target.value)}
                          className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-cyan-400 bg-white" />
                      </td>
                      <td className="px-1 py-1 border-b border-gray-100 bg-cyan-50/30">
                        <input type="date" value={r.workDate}
                          onChange={e => updateRow(i, 'workDate', e.target.value)}
                          className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-cyan-400 bg-white" />
                      </td>
                      <td className="px-1 py-1 border-b border-gray-100 bg-cyan-50/30">
                        <input type="date" value={r.docCutoff}
                          onChange={e => updateRow(i, 'docCutoff', e.target.value)}
                          className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-cyan-400 bg-white" />
                      </td>
                      <td className="px-1 py-1 border-b border-gray-100 text-center">
                        <button onClick={() => removeRow(i)}
                          className="text-gray-300 hover:text-red-500 transition-colors text-sm">✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 미리보기 */}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-bold text-gray-900">메일 미리보기</h3>
          <div className="border border-gray-200 rounded-lg p-4 bg-white overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: tableHtml }} />
        </div>
      )}
    </div>
  )
}
