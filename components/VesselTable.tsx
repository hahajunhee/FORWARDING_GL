'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, isValid } from 'date-fns'
import type { Booking, Profile, CustomList } from '@/types'
import { CARRIERS, DEFAULT_DESTINATIONS, MAJOR_PORTS } from '@/types'
import { bulkSaveBookings } from '@/app/bookings/actions'
import { formatContainers, normalizeDateInput } from './BookingTable'

// ── 헬퍼 ──────────────────────────────────────────────────────────

function fmtD(d: string | null | undefined): string {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? format(p, 'yy/MM/dd') : '' } catch { return '' }
}

// 그룹 키: 선사 | 모선명 | VOYAGE (모선명 없으면 개별 행으로 취급)
function vKey(b: Booking): string {
  if (!b.vessel_name) return `__solo_${b.id}`
  return `${b.carrier || ''}|${b.vessel_name}|${b.voyage || ''}`
}

function bookingNos(b: Booking): string {
  return (b.booking_entries && b.booking_entries.length > 0)
    ? b.booking_entries.map(e => e.no).filter(Boolean).join(' / ')
    : (b.booking_no || '')
}

// 편집 가능한 단순 필드 열 정의 (get: 표시·동일성 비교용 문자열)
type ColDef = {
  key: string
  label: string
  minW: number
  type: 'text' | 'date' | 'carrier' | 'handler' | 'dest' | 'port' | 'number' | 'ro'
  field?: keyof Booking          // 저장 시 사용할 필드
  get: (b: Booking) => string
}

const COLS: ColDef[] = [
  { key: 'carrier',              label: '선사',         minW: 90,  type: 'carrier', field: 'carrier',              get: b => b.carrier || '' },
  { key: 'vessel_name',          label: '모선명',       minW: 130, type: 'text',    field: 'vessel_name',          get: b => b.vessel_name || '' },
  { key: 'voyage',               label: 'VOYAGE',       minW: 80,  type: 'text',    field: 'voyage',               get: b => b.voyage || '' },
  { key: 'seq_no',               label: '고유번호',     minW: 60,  type: 'ro',                                     get: b => String(b.seq_no ?? '') },
  { key: 'booking_no',           label: '부킹번호',     minW: 150, type: 'ro',                                     get: b => bookingNos(b) },
  { key: 'final_destination',    label: '최종도착지',   minW: 110, type: 'dest',    field: 'final_destination',    get: b => b.final_destination || '' },
  { key: 'discharge_port',       label: '양하항',       minW: 110, type: 'port',    field: 'discharge_port',       get: b => b.discharge_port || '' },
  { key: 'secured_space',        label: '확보선복',     minW: 70,  type: 'text',    field: 'secured_space',        get: b => b.secured_space || '' },
  { key: 'mqc',                  label: 'MQC',          minW: 60,  type: 'text',    field: 'mqc',                  get: b => b.mqc || '' },
  { key: 'customer_doc_handler', label: '고객사 서류',  minW: 90,  type: 'text',    field: 'customer_doc_handler', get: b => b.customer_doc_handler || '' },
  { key: 'forwarder_handler',    label: '포워더 담당',  minW: 90,  type: 'handler', field: 'forwarder_handler_id', get: b => b.forwarder_handler?.name || '' },
  { key: 'doc_cutoff_date',      label: '서류마감',     minW: 90,  type: 'date',    field: 'doc_cutoff_date',      get: b => b.doc_cutoff_date || '' },
  { key: 'proforma_etd',         label: 'PROFORMA ETD', minW: 95,  type: 'date',    field: 'proforma_etd',         get: b => b.proforma_etd || '' },
  { key: 'updated_etd',          label: 'UPDATED ETD',  minW: 95,  type: 'date',    field: 'updated_etd',          get: b => b.updated_etd || '' },
  { key: 'eta',                  label: 'ETA',          minW: 90,  type: 'date',    field: 'eta',                  get: b => b.eta || '' },
  { key: 'containers',           label: '컨테이너',     minW: 110, type: 'ro',                                     get: b => formatContainers(b) },
  { key: 'remarks',              label: '비고',         minW: 140, type: 'text',    field: 'remarks',              get: b => b.remarks || '' },
]

type VGroup = {
  key: string
  rows: Booking[]
  uniform: Record<string, boolean> // colKey → 그룹 내 값 동일 여부
}

interface Props {
  bookings: Booking[]
  profiles: Profile[]
  customLists: CustomList[]
  currentUserId: string
}

export default function VesselTable({ bookings, profiles, customLists }: Props) {
  const router = useRouter()
  const [editMode, setEditMode] = useState(false)
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<{ mode: 'new' | 'copy' | 'keep'; source?: VGroup } | null>(null)

  // 자동완성 옵션
  const destinations = useMemo(() => {
    const custom = customLists.filter(c => c.list_type === 'destination').map(c => c.name)
    const existing = bookings.map(b => b.final_destination).filter(Boolean) as string[]
    return Array.from(new Set([...custom, ...DEFAULT_DESTINATIONS, ...existing])).sort()
  }, [customLists, bookings])
  const ports = useMemo(() => {
    const custom = customLists.filter(c => c.list_type === 'port').map(c => c.name)
    const existing = bookings.map(b => b.discharge_port).filter(Boolean) as string[]
    return Array.from(new Set([...custom, ...MAJOR_PORTS, ...existing])).sort()
  }, [customLists, bookings])
  const carriers = useMemo(() => {
    const custom = customLists.filter(c => c.list_type === 'carrier').map(c => c.name)
    return Array.from(new Set([...CARRIERS, ...custom]))
  }, [customLists])

  // 편집 오버레이 적용값
  const val = (b: Booking, col: ColDef): string => {
    const e = edits[b.id]
    if (e && col.field && col.field in e) {
      if (col.type === 'handler') {
        const pid = e[col.field] as string | null
        return profiles.find(p => p.id === pid)?.name || ''
      }
      return String(e[col.field] ?? '')
    }
    return col.get(b)
  }

  // 그룹핑 (uniform 여부는 서버 데이터 기준 → 편집 중 구조 안 바뀜)
  const groups = useMemo(() => {
    const map = new Map<string, Booking[]>()
    for (const b of bookings) {
      const k = vKey(b)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(b)
    }
    const list: VGroup[] = []
    for (const [key, rows] of map) {
      rows.sort((a, b2) => (a.seq_no || 0) - (b2.seq_no || 0))
      const uniform: Record<string, boolean> = {}
      for (const c of COLS) {
        uniform[c.key] = rows.every(r => c.get(r) === c.get(rows[0]))
      }
      list.push({ key, rows, uniform })
    }
    // 최신 PROFORMA ETD 그룹이 위로
    list.sort((a, b2) => {
      const ea = a.rows[0].proforma_etd || '', eb = b2.rows[0].proforma_etd || ''
      if (ea !== eb) return ea < eb ? 1 : -1
      return (a.rows[0].vessel_name || '').localeCompare(b2.rows[0].vessel_name || '')
    })
    return list
  }, [bookings])

  // 검색 필터
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(g => g.rows.some(b =>
      (b.vessel_name || '').toLowerCase().includes(q) ||
      (b.carrier || '').toLowerCase().includes(q) ||
      (b.voyage || '').toLowerCase().includes(q) ||
      (b.final_destination || '').toLowerCase().includes(q) ||
      bookingNos(b).toLowerCase().includes(q)
    ))
  }, [groups, search])

  // 셀 편집 → 그룹(병합 셀) 또는 단일 행에 반영
  const setCell = (ids: string[], field: keyof Booking, value: unknown) => {
    setEdits(prev => {
      const next = { ...prev }
      for (const id of ids) next[id] = { ...(next[id] || {}), [field]: value }
      return next
    })
  }

  const dirtyCount = Object.keys(edits).length

  const handleSave = async () => {
    setSaving(true); setSaveError(null)
    const payload = Object.entries(edits).map(([id, data]) => ({ id, data }))
    const { errors } = await bulkSaveBookings(payload, [])
    setSaving(false)
    if (Object.keys(errors).length > 0) { setSaveError(Object.values(errors)[0]); return }
    setEdits({})
    router.refresh()
  }

  // ── 셀 렌더 ────────────────────────────────────────────────────
  const inputCls = 'w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400'
  const renderCell = (col: ColDef, ids: string[], b: Booking) => {
    const v = val(b, col)
    if (!editMode || col.type === 'ro' || !col.field) {
      if (col.type === 'date') return <span className="text-xs">{fmtD(v) || <span className="text-gray-300">-</span>}</span>
      if (col.key === 'booking_no') return <span className="text-xs font-mono text-blue-700">{v || <span className="text-gray-300">-</span>}</span>
      if (col.key === 'seq_no') return <span className="text-xs font-mono font-semibold text-gray-500">{v || '-'}</span>
      if (col.key === 'containers') return <span className="text-xs font-mono text-blue-700">{v || <span className="text-gray-300">-</span>}</span>
      return <span className="text-xs">{v || <span className="text-gray-300">-</span>}</span>
    }
    const field = col.field
    switch (col.type) {
      case 'carrier':
        return <select className={inputCls} value={v} onChange={e => setCell(ids, field, e.target.value)}>
          <option value="">-</option>{carriers.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      case 'handler': {
        const e0 = edits[b.id]
        const pid = (e0 && field in e0) ? (e0[field] as string | null) : b.forwarder_handler_id
        return <select className={inputCls} value={pid || ''} onChange={e => setCell(ids, field, e.target.value || null)}>
          <option value="">미지정</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      }
      case 'dest':
        return <input className={inputCls} list="vt-dests" value={v} onChange={e => setCell(ids, field, e.target.value.toUpperCase())} />
      case 'port':
        return <input className={inputCls} list="vt-ports" value={v} onChange={e => setCell(ids, field, e.target.value.toUpperCase())} />
      case 'date':
        return <input className={inputCls} placeholder="YYYY-MM-DD" value={v}
          onChange={e => setCell(ids, field, e.target.value || null)}
          onBlur={e => setCell(ids, field, normalizeDateInput(e.target.value))} />
      default:
        return <input className={inputCls} value={v} onChange={e => setCell(ids, field, e.target.value)} />
    }
  }

  const th = 'table-th text-center'
  const groupBorder = '2px solid #94a3b8'

  return (
    <div className="space-y-3">
      <datalist id="vt-dests">{destinations.map(d => <option key={d} value={d} />)}</datalist>
      <datalist id="vt-ports">{ports.map(p => <option key={p} value={p} />)}</datalist>

      {/* 툴바 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="모선명·선사·VOYAGE·도착지·부킹번호 검색"
          className="w-64 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button onClick={() => setModal({ mode: 'new' })}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors font-medium">+ 새 모선</button>
        <button onClick={() => { setEditMode(v => !v); if (editMode) setEdits({}) }}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${editMode ? 'bg-amber-200 text-amber-900 border border-amber-400' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
          {editMode ? '편집 종료' : '편집'}
        </button>
        {editMode && dirtyCount > 0 && (
          <>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? '저장 중...' : `저장 (${dirtyCount}건)`}
            </button>
            <button onClick={() => setEdits({})}
              className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors">되돌리기</button>
          </>
        )}
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length}개 모선 그룹 · {bookings.length}건 부킹</span>
      </div>
      <p className="text-[11px] text-gray-400">
        선사·모선명·VOYAGE가 같은 부킹을 한 그룹으로 병합 표시합니다. 병합된 셀을 편집하면 그룹 전체가, 분리된 셀은 해당 행만 수정됩니다. 저장 시 부킹장에도 동일하게 반영됩니다.
      </p>

      {/* 표 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex-1 min-h-0">
        <div className="overflow-auto max-h-[calc(100vh-230px)]">
          <table className="text-xs border-collapse w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                {COLS.map(c => <th key={c.key} className={th} style={{ minWidth: c.minW }}>{c.label}</th>)}
                <th className={th} style={{ minWidth: 110 }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => g.rows.map((b, ri) => (
                <tr key={b.id}>
                  {COLS.map(c => {
                    const isUniform = g.uniform[c.key]
                    if (isUniform && ri > 0) return null // 병합 — 첫 행에서만 렌더
                    const ids = isUniform ? g.rows.map(r => r.id) : [b.id]
                    const dirty = ids.some(id => edits[id] && c.field && c.field in edits[id])
                    return (
                      <td key={c.key}
                        rowSpan={isUniform && g.rows.length > 1 ? g.rows.length : undefined}
                        className={`table-td text-center align-middle ${dirty ? 'bg-amber-50' : ''} ${isUniform && g.rows.length > 1 ? 'bg-slate-50/50' : ''}`}
                        style={{ borderTop: ri === 0 ? groupBorder : undefined, borderLeft: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0' }}>
                        {renderCell(c, ids, b)}
                      </td>
                    )
                  })}
                  {ri === 0 && (
                    <td rowSpan={g.rows.length > 1 ? g.rows.length : undefined}
                      className="table-td text-center align-middle"
                      style={{ borderTop: groupBorder, borderLeft: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0' }}>
                      <div className="flex items-center justify-center gap-1 flex-nowrap">
                        <button onClick={() => setModal({ mode: 'copy', source: g })}
                          className="text-[11px] leading-none px-1.5 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors whitespace-nowrap"
                          title="모선명·VOYAGE·부킹번호·날짜·비고는 비우고 도착지 여러 개로 복사">복사</button>
                        <button onClick={() => setModal({ mode: 'keep', source: g })}
                          className="text-[11px] leading-none px-1.5 py-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition-colors whitespace-nowrap"
                          title="모든 값을 유지하고 도착지 여러 개로 복제">기존유지</button>
                      </div>
                      {g.rows.length > 1 && <div className="text-[10px] text-gray-400 mt-0.5">{g.rows.length}개 도착지</div>}
                    </td>
                  )}
                </tr>
              )))}
              {filtered.length === 0 && (
                <tr><td colSpan={COLS.length + 1} className="text-center py-16 text-gray-400 text-sm">표시할 부킹이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 추가/복사 모달 */}
      {modal && (
        <AddVesselModal
          mode={modal.mode}
          source={modal.source}
          carriers={carriers}
          destinations={destinations}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); router.refresh() }}
        />
      )}
    </div>
  )
}

// ── 모선 추가/복사 모달 — 최종도착지 여러 개 한 번에 입력 ─────────────
function AddVesselModal({ mode, source, carriers, destinations, onClose, onSaved }: {
  mode: 'new' | 'copy' | 'keep'
  source?: VGroup
  carriers: string[]
  destinations: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const repr = source?.rows[0]
  const [carrier, setCarrier] = useState(repr?.carrier || '')
  const [vessel, setVessel] = useState(mode === 'keep' ? (repr?.vessel_name || '') : '')
  const [voyage, setVoyage] = useState(mode === 'keep' ? (repr?.voyage || '') : '')
  const [dests, setDests] = useState<string[]>(
    source ? source.rows.map(r => r.final_destination || '').filter(Boolean) : ['']
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = mode === 'new' ? '새 모선 추가' : mode === 'copy' ? '모선 복사 (날짜·부킹번호 초기화)' : '모선 복제 (기존값 유지)'

  const handleSave = async () => {
    const list = dests.map(d => d.trim().toUpperCase()).filter(Boolean)
    if (!vessel.trim()) { setError('모선명을 입력해주세요.'); return }
    if (list.length === 0) { setError('최종도착지를 1개 이상 입력해주세요.'); return }
    setSaving(true); setError(null)
    const keep = mode === 'keep'
    const inserts = list.map((dest, i) => ({
      tempId: `vt-${i}`,
      data: {
        booking_no: keep ? (repr?.booking_no || '') : '',
        booking_entries: keep ? (repr?.booking_entries || null) : null,
        final_destination: dest,
        discharge_port: repr?.discharge_port || '',
        carrier,
        vessel_name: vessel.trim().toUpperCase(),
        voyage: voyage.trim(),
        secured_space: repr?.secured_space || '',
        mqc: repr?.mqc || '',
        customer_doc_handler: repr?.customer_doc_handler || '',
        forwarder_handler_id: repr?.forwarder_handler_id || null,
        doc_cutoff_date: keep ? (repr?.doc_cutoff_date || null) : null,
        proforma_etd: keep ? (repr?.proforma_etd || null) : null,
        updated_etd: keep ? (repr?.updated_etd || null) : null,
        eta: keep ? (repr?.eta || null) : null,
        qty_20_normal: repr?.qty_20_normal || 0,
        qty_20_dg: repr?.qty_20_dg || 0,
        qty_20_reefer: repr?.qty_20_reefer || 0,
        qty_40_normal: repr?.qty_40_normal || 0,
        qty_40_dg: repr?.qty_40_dg || 0,
        qty_40_reefer: repr?.qty_40_reefer || 0,
        remarks: keep ? (repr?.remarks || '') : '',
        extra_data: repr?.extra_data || null,
      } as Record<string, unknown>,
    }))
    const { errors } = await bulkSaveBookings([], inserts)
    setSaving(false)
    if (Object.keys(errors).length > 0) { setError(Object.values(errors)[0]); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-400 mt-0.5">최종도착지는 여러 개 입력 가능 — 도착지마다 부킹 행이 하나씩 생성됩니다.</p>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-gray-500 block mb-1 font-medium">선사</label>
              <select value={carrier} onChange={e => setCarrier(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">-</option>{carriers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1 font-medium">모선명 *</label>
              <input value={vessel} onChange={e => setVessel(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1 font-medium">VOYAGE</label>
              <input value={voyage} onChange={e => setVoyage(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 block mb-1 font-medium">최종도착지 (도착지별 1행 생성) *</label>
            <datalist id="vt-modal-dests">{destinations.map(d => <option key={d} value={d} />)}</datalist>
            <div className="space-y-1.5">
              {dests.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input value={d} list="vt-modal-dests"
                    onChange={e => setDests(prev => prev.map((x, xi) => xi === i ? e.target.value : x))}
                    placeholder={`도착지 ${i + 1}`}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <button onClick={() => setDests(prev => prev.length > 1 ? prev.filter((_, xi) => xi !== i) : prev)}
                    disabled={dests.length <= 1}
                    className="text-gray-300 hover:text-red-500 disabled:opacity-30 transition-colors text-sm w-5">✕</button>
                </div>
              ))}
            </div>
            <button onClick={() => setDests(prev => [...prev, ''])}
              className="mt-1.5 w-full text-xs py-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg border border-dashed border-indigo-300 transition-colors">
              + 도착지 추가
            </button>
          </div>
          {mode !== 'new' && (
            <p className="text-[11px] text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
              {mode === 'keep'
                ? '부킹번호·날짜·비고 등 모든 값이 원본 그룹에서 복제됩니다.'
                : '양하항·확보선복·MQC·담당자·수량은 복사되고, 부킹번호·날짜·비고는 비워집니다.'}
            </p>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">취소</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-xs text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
            {saving ? '생성 중...' : `${dests.filter(d => d.trim()).length}개 행 생성`}
          </button>
        </div>
      </div>
    </div>
  )
}
