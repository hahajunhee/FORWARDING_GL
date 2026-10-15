'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format, addDays, parseISO, isValid } from 'date-fns'
import type { Booking, Profile, ColumnDefinition } from '@/types'
import type { TransitMap } from '@/lib/eta'
import { calcEta } from '@/lib/eta'
import { bulkSaveBookings } from '@/app/bookings/actions'

type View = 'cutoff' | 'etd'

const fmt = (d: string | null | undefined) => {
  if (!d) return '-'
  try { const p = parseISO(d); return isValid(p) ? format(p, 'yyyy-MM-dd') : '-' } catch { return '-' }
}

const bookingNos = (b: Booking) =>
  (b.booking_entries && b.booking_entries.length > 0)
    ? b.booking_entries.map(e => e.no).filter(Boolean).join(', ')
    : (b.booking_no || '-')

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

  // 편집 버퍼: { [bookingId]: { doc_cutoff_date?, updated_etd?, eta? } }
  const [edits, setEdits] = useState<Record<string, Partial<Booking>>>({})

  // ── 공통 필터 ────────────────────────────────────────────────────
  const [handlerId, setHandlerId] = useState<string>(currentUserId)
  const [carrier, setCarrier] = useState('')
  const [keyword, setKeyword] = useState('')   // 도착지·양하항·모선명·부킹번호 검색
  // 미마감 현황: 서류마감 기간 (비우면 전체)
  const [docFrom, setDocFrom] = useState('')
  const [docTo, setDocTo] = useState('')
  // ETD UPDATE: UPDATED ETD 기간 (기본 오늘 ~ +30일)
  const [etdFrom, setEtdFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [etdTo, setEtdTo] = useState(() => format(addDays(new Date(), 30), 'yyyy-MM-dd'))

  const carriers = useMemo(
    () => [...new Set(bookings.map(b => b.carrier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [bookings])

  // 서비스명 커스텀 열 (있으면 extra_data에서 읽음)
  const serviceCol = useMemo(
    () => customColumns.find(c => c.label.replace(/\s/g, '').includes('서비스')),
    [customColumns])
  const serviceOf = (b: Booking) =>
    serviceCol ? ((b.extra_data as Record<string, string> | null)?.[serviceCol.key] || '') : ''

  const matchKeyword = (b: Booking) => {
    if (!keyword.trim()) return true
    const q = keyword.trim().toUpperCase()
    return [b.final_destination, b.discharge_port, b.vessel_name, b.voyage, bookingNos(b), serviceOf(b)]
      .some(v => (v || '').toUpperCase().includes(q))
  }

  const rows = useMemo(() => {
    const base = bookings.filter(b => {
      if (handlerId && b.forwarder_handler_id !== handlerId) return false
      if (carrier && b.carrier !== carrier) return false
      if (!matchKeyword(b)) return false
      return true
    })
    if (view === 'cutoff') {
      return base
        .filter(b => !b.is_closed)                       // 마감 안 된 건만
        .filter(b => {
          const d = b.doc_cutoff_date || ''
          if (docFrom && (!d || d < docFrom)) return false
          if (docTo && (!d || d > docTo)) return false
          return true
        })
        .sort((a, b) => (a.doc_cutoff_date || '9999').localeCompare(b.doc_cutoff_date || '9999'))
    }
    return base
      .filter(b => {
        const d = b.updated_etd || ''
        if (etdFrom && (!d || d < etdFrom)) return false
        if (etdTo && (!d || d > etdTo)) return false
        return true
      })
      .sort((a, b) => (a.updated_etd || '9999').localeCompare(b.updated_etd || '9999'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, view, handlerId, carrier, keyword, docFrom, docTo, etdFrom, etdTo, serviceCol])

  const valueOf = (b: Booking, field: 'doc_cutoff_date' | 'updated_etd') =>
    (edits[b.id]?.[field] as string | null | undefined) ?? b[field] ?? ''

  const setCutoff = (b: Booking, v: string) =>
    setEdits(p => ({ ...p, [b.id]: { ...(p[b.id] || {}), doc_cutoff_date: v || null } }))

  const setEtd = (b: Booking, v: string) => {
    const next: Partial<Booking> = { updated_etd: v || null }
    // 선사·양하항 규칙이 있으면 ETA도 함께 갱신
    const eta = calcEta(v || null, b.carrier, b.discharge_port, etaTransitDays)
    if (eta) next.eta = eta
    setEdits(p => ({ ...p, [b.id]: { ...(p[b.id] || {}), ...next } }))
  }

  const changedIds = Object.keys(edits).filter(id => {
    const b = bookings.find(x => x.id === id)
    if (!b) return false
    const e = edits[id]
    return Object.entries(e).some(([k, v]) => (b[k as keyof Booking] ?? null) !== (v ?? null))
  })

  const save = () => {
    if (changedIds.length === 0) return
    setMsg(null)
    const list = changedIds.map(id => ({ id, data: edits[id] as Record<string, unknown> }))
    startTransition(async () => {
      const { errors } = await bulkSaveBookings(list, [])
      if (Object.keys(errors).length > 0) {
        setMsg('저장 실패: ' + Object.values(errors)[0])
        return
      }
      setEdits({})
      setMsg(`${list.length}건 저장 완료 — 부킹장에도 반영되었습니다.`)
      router.refresh()
    })
  }

  const etaPreview = (b: Booking) => {
    const e = edits[b.id]?.eta as string | undefined
    return e && e !== (b.eta || '') ? e : null
  }

  const th = 'px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50 border-b-2 border-slate-200'
  const td = 'px-3 py-1.5 text-xs text-slate-700 whitespace-nowrap border-b border-slate-100'

  return (
    <div className="space-y-3">
      {/* 뷰 전환 */}
      <div className="flex items-center gap-2">
        {([['cutoff', '미마감 현황'], ['etd', 'ETD UPDATE']] as [View, string][]).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)}
            className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors border ${
              view === v ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}>{label}</button>
        ))}
        <div className="flex-1" />
        {msg && (
          <span className={`text-xs ${msg.startsWith('저장 실패') ? 'text-red-600' : 'text-emerald-600'}`}>{msg}</span>
        )}
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
        {view === 'cutoff' ? (
          <div>
            <label className="text-[11px] text-slate-500 block mb-1 font-medium">서류마감 기간</label>
            <div className="flex items-center gap-1">
              <input type="date" value={docFrom} onChange={e => setDocFrom(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
              <span className="text-xs text-slate-400">~</span>
              <input type="date" value={docTo} onChange={e => setDocTo(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
              {(docFrom || docTo) && (
                <button onClick={() => { setDocFrom(''); setDocTo('') }}
                  className="text-[11px] px-2 py-1 rounded bg-slate-100 text-slate-500 hover:bg-slate-200">해제</button>
              )}
            </div>
          </div>
        ) : (
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
        )}
        <div className="flex-1 min-w-[180px]">
          <label className="text-[11px] text-slate-500 block mb-1 font-medium">검색</label>
          <input value={keyword} onChange={e => setKeyword(e.target.value)}
            placeholder="도착지 · 양하항 · 모선명 · 부킹번호"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
        </div>
        <div className="text-xs text-slate-500 pb-1.5">
          {rows.length}건
          {view === 'cutoff' && <span className="text-slate-400"> (마감 완료 제외)</span>}
        </div>
      </div>

      {/* 표 */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-auto" style={{ maxHeight: 'calc(100vh - 290px)' }}>
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={th}>선사</th>
              <th className={th}>최종도착지</th>
              <th className={th}>양하항</th>
              <th className={th}>모선명</th>
              <th className={th}>VOYAGE</th>
              {view === 'cutoff'
                ? <>
                    <th className={`${th} text-center`}>서류마감 (수정)</th>
                    <th className={th}>UPDATED ETD</th>
                  </>
                : <th className={`${th} text-center`}>UPDATED ETD (수정)</th>}
              <th className={th}>부킹번호</th>
              <th className={th}>포워더 담당</th>
              {view === 'etd' && <th className={th}>서비스명</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={view === 'cutoff' ? 9 : 9} className="py-10 text-center text-sm text-slate-400">
                조건에 맞는 부킹이 없습니다.
              </td></tr>
            )}
            {rows.map(b => {
              const dirty = !!edits[b.id]
              return (
                <tr key={b.id} className={dirty ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                  <td className={td}>{b.carrier || '-'}</td>
                  <td className={`${td} font-medium text-slate-800`}>{b.final_destination || '-'}</td>
                  <td className={td}>{b.discharge_port || '-'}</td>
                  <td className={td}>{b.vessel_name || '-'}</td>
                  <td className={td}>{b.voyage || '-'}</td>
                  {view === 'cutoff' ? (
                    <>
                      <td className={`${td} text-center`}>
                        <input type="date" value={valueOf(b, 'doc_cutoff_date') || ''}
                          onChange={e => setCutoff(b, e.target.value)}
                          className={`text-xs border rounded px-1.5 py-1 ${
                            dirty ? 'border-amber-400 bg-white font-semibold' : 'border-slate-200'
                          }`} />
                      </td>
                      <td className={td}>{fmt(b.updated_etd)}</td>
                    </>
                  ) : (
                    <td className={`${td} text-center`}>
                      <input type="date" value={valueOf(b, 'updated_etd') || ''}
                        onChange={e => setEtd(b, e.target.value)}
                        className={`text-xs border rounded px-1.5 py-1 ${
                          dirty ? 'border-amber-400 bg-white font-semibold' : 'border-slate-200'
                        }`} />
                      {etaPreview(b) && (
                        <div className="text-[10px] text-cyan-700 mt-0.5">ETA → {etaPreview(b)}</div>
                      )}
                    </td>
                  )}
                  <td className={`${td} font-mono text-blue-700`}>{bookingNos(b)}</td>
                  <td className={td}>{b.forwarder_handler?.name || '-'}</td>
                  {view === 'etd' && <td className={td}>{serviceOf(b) || '-'}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400">
        {view === 'cutoff'
          ? '마감 완료되지 않은 부킹만 표시합니다. 서류마감일을 바꾸고 저장하면 부킹장에 그대로 반영됩니다.'
          : 'UPDATED ETD를 바꾸고 저장하면 부킹장에 반영됩니다. 선사·양하항 운송일수 규칙이 있으면 ETA도 함께 갱신됩니다(부킹장 → ETA 자동계산 설정).'}
        {!serviceCol && view === 'etd' && ' · 서비스명은 설정에서 「서비스」가 들어간 열을 만들면 표시됩니다.'}
      </p>
    </div>
  )
}
