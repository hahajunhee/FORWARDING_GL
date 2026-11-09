'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addDays, format } from 'date-fns'
import type { Booking, Profile } from '@/types'
import type { TransitMap } from '@/lib/eta'
import { calcEta } from '@/lib/eta'
import type { TerminalCandidate } from '@/lib/terminal-schedule'
import { normVessel } from '@/lib/terminal-schedule'
import { bulkSaveBookings } from '@/app/bookings/actions'
import {
  searchEtdCandidates, saveEtdTerminalPrefs, logEtdSync, fetchEtdSyncLog,
  type EtdLogRow,
} from '@/app/bookings/etdSyncActions'

// 터미널 스케줄 수집기가 제공하는 터미널 코드
const TERMINALS: [string, string][] = [
  ['BCT', 'BCT'], ['BNCT', 'BNCT'], ['HJNC', '한진신항'], ['HPNT', 'HPNT'], ['PNIT', 'PNIT'], ['PNC', 'PNC'],
  ['DGT', '동원'], ['HBCT', '허치슨'], ['KITL', '한국국제'], ['BPT', 'BPT(신선대·감만)'], ['ITG', '인터지스'],
  ['SNCT', '선광(인천)'], ['HJIT', '한진인천'], ['E1CT', 'E1(인천)'], ['GWCT', '광양서부'], ['PCTC', '평택'], ['GCT', '군산'],
]
const TERM_NAME = Object.fromEntries(TERMINALS)

const carrierKey = (c: string | null | undefined) => (c || '').trim().toUpperCase()
const candKey = (c: TerminalCandidate) => `${c.source}|${c.etd || ''}|${c.terminal_voyage || ''}`
const dateOf = (s: string | null | undefined) => (s || '').slice(0, 10)

function dayDiff(a: string, b: string): number {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number)
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000)
}

const bookingNos = (b: Booking) =>
  (b.booking_entries && b.booking_entries.length > 0)
    ? b.booking_entries.map(e => e.no).filter(Boolean).join(', ')
    : (b.booking_no || '')

interface Props {
  bookings: Booking[]
  profiles: Profile[]
  currentUserId: string
  currentProfile: Profile | null
  etaTransitDays?: TransitMap
}

export default function EtdSyncTab({ bookings, profiles, currentUserId, currentProfile, etaTransitDays = {} }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ── 조회 조건 ──────────────────────────────────────────────
  const [handlerId, setHandlerId] = useState(currentUserId)
  const [carrierFilter, setCarrierFilter] = useState('')
  const [etdFrom, setEtdFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [etdTo, setEtdTo] = useState(() => format(addDays(new Date(), 30), 'yyyy-MM-dd'))
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [showAllDates, setShowAllDates] = useState(false)   // 후보를 현재 ETD ±기간으로 좁히지 않고 전부 보기

  // ── 선사 → 기본 터미널 (유저별 저장) ──────────────────────
  const [prefs, setPrefs] = useState<Record<string, string[]>>(currentProfile?.etd_terminal_prefs || {})
  const [prefOpen, setPrefOpen] = useState(false)
  const [prefDirty, setPrefDirty] = useState(false)

  // ── 후보·선택 상태 ────────────────────────────────────────
  const [cands, setCands] = useState<Record<string, TerminalCandidate[]> | null>(null)
  const [loading, setLoading] = useState(false)
  const [choice, setChoice] = useState<Record<string, string>>({})   // bookingId → 후보키
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [logOpen, setLogOpen] = useState(false)
  const [logRows, setLogRows] = useState<EtdLogRow[] | null>(null)

  const allCarriers = useMemo(
    () => [...new Set(bookings.map(b => carrierKey(b.carrier)).filter(Boolean))].sort(),
    [bookings])

  const rows = useMemo(() => {
    const q = keyword.trim().toUpperCase()
    return bookings
      .filter(b => {
        if (!b.vessel_name?.trim()) return false
        if (handlerId && b.forwarder_handler_id !== handlerId) return false
        if (carrierFilter && carrierKey(b.carrier) !== carrierFilter) return false
        if (onlyOpen && b.is_closed) return false
        const d = b.updated_etd || ''
        if (etdFrom && (!d || d < etdFrom)) return false
        if (etdTo && (!d || d > etdTo)) return false
        if (q && ![b.vessel_name, b.final_destination, b.discharge_port, bookingNos(b), b.carrier]
          .some(v => (v || '').toUpperCase().includes(q))) return false
        return true
      })
      .sort((a, b) => (a.updated_etd || '9999').localeCompare(b.updated_etd || '9999')
        || (a.vessel_name || '').localeCompare(b.vessel_name || ''))
  }, [bookings, handlerId, carrierFilter, onlyOpen, etdFrom, etdTo, keyword])

  // 부킹 한 줄에 대한 후보 목록 (기본 터미널 우선 → 현재 ETD와 가까운 순)
  const candidatesFor = (b: Booking): TerminalCandidate[] => {
    const all = cands?.[normVessel(b.vessel_name)] || []
    const cur = b.updated_etd
    const near = (!showAllDates && cur)
      ? all.filter(c => c.etd && Math.abs(dayDiff(cur, dateOf(c.etd))) <= 21)
      : all
    const pref = prefs[carrierKey(b.carrier)] || []
    const dist = (c: TerminalCandidate) => (cur && c.etd) ? Math.abs(dayDiff(cur, dateOf(c.etd))) : 999
    return [...near].sort((x, y) => {
      const px = pref.includes(x.source) ? 0 : 1, py = pref.includes(y.source) ? 0 : 1
      return px - py || dist(x) - dist(y)
    })
  }

  // 기본 터미널로 좁힌 후보(= 사람이 고를 때 우선 보게 되는 후보)
  const poolFor = (b: Booking, list: TerminalCandidate[]) => {
    const pref = prefs[carrierKey(b.carrier)] || []
    const inPref = list.filter(c => pref.includes(c.source))
    return inPref.length > 0 ? inPref : list
  }

  const view = rows.map(b => {
    const list = candidatesFor(b)
    const pool = poolFor(b, list)
    const selKey = choice[b.id] ?? (pool[0] ? candKey(pool[0]) : '')
    const sel = list.find(c => candKey(c) === selKey) || null
    const newEtd = sel?.etd ? dateOf(sel.etd) : null
    const diff = (b.updated_etd && newEtd) ? dayDiff(b.updated_etd, newEtd) : null
    return { b, list, pool, sel, newEtd, diff, ambiguous: pool.length > 1 && choice[b.id] === undefined }
  })

  const changeable = view.filter(v => v.sel && v.newEtd && v.newEtd !== v.b.updated_etd)
  const sure = changeable.filter(v => !v.ambiguous)

  // ── 동작 ──────────────────────────────────────────────────
  const runSearch = () => {
    setMsg(null); setChoice({}); setChecked(new Set()); setLoading(true)
    startTransition(async () => {
      const { byVessel, error } = await searchEtdCandidates(rows.map(r => r.vessel_name))
      setLoading(false)
      if (error && Object.values(byVessel).every(l => l.length === 0)) {
        setMsg({ ok: false, text: error }); setCands(null); return
      }
      setCands(byVessel)
      if (error) setMsg({ ok: false, text: `일부 조회 실패: ${error}` })
    })
  }

  const toggleCheck = (id: string) =>
    setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const apply = () => {
    const targets = view.filter(v => checked.has(v.b.id) && v.sel && v.newEtd && v.newEtd !== v.b.updated_etd)
    if (targets.length === 0) return
    if (!window.confirm(`${targets.length}건의 UPDATED ETD를 터미널 스케줄 값으로 변경합니다. 진행할까요?`)) return
    setMsg(null)
    const edits = targets.map(v => {
      const data: Record<string, unknown> = { updated_etd: v.newEtd }
      const eta = calcEta(v.newEtd, v.b.carrier, v.b.discharge_port, etaTransitDays)
      if (eta) data.eta = eta
      return { id: v.b.id, data }
    })
    startTransition(async () => {
      const { errors } = await bulkSaveBookings(edits, [])
      const failed = Object.keys(errors)
      const okTargets = targets.filter(v => !failed.includes(v.b.id))
      if (okTargets.length > 0) {
        await logEtdSync(okTargets.map(v => ({
          booking_id: v.b.id, vessel_name: v.b.vessel_name, old_etd: v.b.updated_etd, new_etd: v.newEtd as string,
          terminal: v.sel!.source, terminal_voyage: v.sel!.terminal_voyage, collected_at: v.sel!.collected_at,
        })))
      }
      if (failed.length > 0) setMsg({ ok: false, text: `${failed.length}건 저장 실패: ${Object.values(errors)[0]}` })
      else setMsg({ ok: true, text: `${okTargets.length}건 반영 완료 — 부킹장에도 반영되었습니다.` })
      setChecked(new Set())
      setLogRows(null)
      router.refresh()
    })
  }

  const savePrefs = (next: Record<string, string[]>) => {
    startTransition(async () => {
      const { error } = await saveEtdTerminalPrefs(next)
      if (error) setMsg({ ok: false, text: error })
      else { setPrefDirty(false); setMsg({ ok: true, text: '선사별 기본 터미널을 저장했습니다.' }) }
    })
  }

  const togglePref = (carrier: string, term: string) => {
    setPrefs(prev => {
      const cur = prev[carrier] || []
      const nextList = cur.includes(term) ? cur.filter(t => t !== term) : [...cur, term]
      const next = { ...prev }
      if (nextList.length === 0) delete next[carrier]; else next[carrier] = nextList
      return next
    })
    setPrefDirty(true)
  }

  const openLog = () => {
    setLogOpen(v => !v)
    if (!logRows) fetchEtdSyncLog().then(setLogRows)
  }

  const th = 'px-2 py-2 text-left text-[11px] font-bold text-slate-500 tracking-wider whitespace-nowrap bg-slate-50 border-b-2 border-slate-200 sticky top-0 z-10'
  const td = 'px-2 py-1.5 text-xs text-slate-700 border-b border-slate-100 align-middle'
  const fmtDT = (s: string | null | undefined) => (s || '').slice(5, 16)

  return (
    <div className="space-y-3">
      {/* 상단 동작 */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={runSearch} disabled={loading || isPending || rows.length === 0}
          className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40">
          {loading ? '터미널 스케줄 조회 중...' : `터미널 스케줄 조회 (${new Set(rows.map(r => normVessel(r.vessel_name))).size}척)`}
        </button>
        <button onClick={() => setPrefOpen(v => !v)}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
          선사별 기본 터미널 {Object.keys(prefs).length > 0 && <span className="text-indigo-600 font-bold">({Object.keys(prefs).length})</span>}
        </button>
        <button onClick={openLog}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">반영 이력</button>
        <div className="flex-1" />
        {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
        {cands && sure.length > 0 && (
          <button onClick={() => setChecked(new Set(sure.map(v => v.b.id)))}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
            title="후보가 하나로 좁혀졌고 ETD가 달라진 건만 선택합니다">
            확실한 변경 {sure.length}건 선택
          </button>
        )}
        {checked.size > 0 && (
          <>
            <button onClick={() => setChecked(new Set())}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">선택 해제</button>
            <button onClick={apply} disabled={isPending}
              className="text-sm px-4 py-2 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 disabled:opacity-40">
              {isPending ? '반영 중...' : `선택 ${checked.size}건 ETD 반영`}
            </button>
          </>
        )}
      </div>

      {/* 조회 조건 */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-end gap-3 shadow-sm">
        <div>
          <label className="text-[11px] text-slate-500 block mb-1 font-medium">포워더 담당</label>
          <select value={handlerId} onChange={e => setHandlerId(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">전체</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === currentUserId ? ' (나)' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1 font-medium">선사</label>
          <select value={carrierFilter} onChange={e => setCarrierFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">전체</option>
            {allCarriers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1 font-medium">현재 UPDATED ETD 기간</label>
          <div className="flex items-center gap-1">
            <input type="date" value={etdFrom} onChange={e => setEtdFrom(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
            <span className="text-xs text-slate-400">~</span>
            <input type="date" value={etdTo} onChange={e => setEtdTo(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
          </div>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="text-[11px] text-slate-500 block mb-1 font-medium">검색</label>
          <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="모선명 · 도착지 · 부킹번호"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
        </div>
        <label className="text-xs text-slate-600 flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> 미마감만
        </label>
        <label className="text-xs text-slate-600 flex items-center gap-1.5 pb-1.5" title="기본은 현재 ETD ±21일 안의 후보만 보여줍니다">
          <input type="checkbox" checked={showAllDates} onChange={e => setShowAllDates(e.target.checked)} /> 후보 날짜 제한 없이 보기
        </label>
        <div className="text-xs text-slate-500 pb-1.5">{rows.length}건</div>
      </div>

      {/* 선사별 기본 터미널 */}
      {prefOpen && (
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-bold text-slate-700">선사별 기본 터미널</div>
            <div className="text-xs text-slate-400">모선이 여러 터미널에서 조회되면 여기서 지정한 터미널 후보를 먼저 보여주고 미리 선택해 둡니다. (내 계정에만 저장)</div>
            <div className="flex-1" />
            {prefDirty && (
              <button onClick={() => savePrefs(prefs)} disabled={isPending}
                className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">저장</button>
            )}
          </div>
          <div className="max-h-64 overflow-auto space-y-1.5">
            {allCarriers.map(c => (
              <div key={c} className="flex items-start gap-2">
                <div className="w-24 flex-shrink-0 text-xs font-semibold text-slate-700 pt-1">{c}</div>
                <div className="flex flex-wrap gap-1">
                  {TERMINALS.map(([code, name]) => {
                    const on = (prefs[c] || []).includes(code)
                    return (
                      <button key={code} onClick={() => togglePref(c, code)} title={name}
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${on
                          ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}>
                        {code}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 결과 표 */}
      {!cands ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-400">
          조건을 정한 뒤 <b className="text-slate-600">터미널 스케줄 조회</b>를 누르면, 각 모선의 터미널 일정이 후보로 표시됩니다.
          <div className="mt-1 text-xs">변경은 직접 체크하고 &quot;ETD 반영&quot;을 눌러야만 부킹장에 저장됩니다.</div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-auto max-h-[calc(100vh-340px)]">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th} style={{ width: 36 }}></th>
                <th className={th}>선사</th>
                <th className={th}>최종도착지</th>
                <th className={th}>모선명</th>
                <th className={th}>현재 UPDATED ETD</th>
                <th className={th} style={{ minWidth: 380 }}>터미널 스케줄 (선택)</th>
                <th className={th}>새 ETD</th>
                <th className={th}>변동</th>
                <th className={th}>부킹번호</th>
              </tr>
            </thead>
            <tbody>
              {view.map(({ b, list, sel, newEtd, diff, ambiguous }) => {
                const changed = !!(sel && newEtd && newEtd !== b.updated_etd)
                const pref = prefs[carrierKey(b.carrier)] || []
                const offPref = !!(sel && pref.length > 0 && !pref.includes(sel.source))
                const noPref = !!(sel && pref.length === 0)
                return (
                  <tr key={b.id} className={checked.has(b.id) ? 'bg-rose-50/60' : changed ? 'bg-amber-50/40' : ''}>
                    <td className={td}>
                      <input type="checkbox" disabled={!changed} checked={checked.has(b.id)} onChange={() => toggleCheck(b.id)} />
                    </td>
                    <td className={td}>{b.carrier}</td>
                    <td className={td}>{b.final_destination}</td>
                    <td className={`${td} font-semibold`}>{b.vessel_name}</td>
                    <td className={`${td} tabular-nums`}>{b.updated_etd || '-'}</td>
                    <td className={td}>
                      {list.length === 0 ? (
                        <span className="text-slate-400">일치하는 스케줄 없음{!showAllDates && ' (±21일 내)'}</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={sel ? candKey(sel) : ''}
                            onChange={e => {
                              setChoice(p => ({ ...p, [b.id]: e.target.value }))
                              setChecked(p => { const n = new Set(p); n.delete(b.id); return n })
                            }}
                            className="text-xs border border-slate-200 rounded-lg px-1.5 py-1 bg-white max-w-[380px]">
                            {list.map(c => {
                              const dd = (b.updated_etd && c.etd) ? dayDiff(b.updated_etd, dateOf(c.etd)) : null
                              return (
                                <option key={candKey(c)} value={candKey(c)}>
                                  {`${pref.includes(c.source) ? '★ ' : ''}${c.source}${c.terminal_voyage ? ` ${c.terminal_voyage}` : ''} · ETD ${fmtDT(c.etd)}${dd != null && dd !== 0 ? ` (${dd > 0 ? '+' : ''}${dd}일)` : dd === 0 ? ' (동일)' : ''} · ETA ${fmtDT(c.eta)}${c.cutoff ? ` · CUT ${fmtDT(c.cutoff)}` : ''}`}
                                </option>
                              )
                            })}
                          </select>
                          {ambiguous && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold whitespace-nowrap">{`${list.length}건 중 확인`}</span>}
                          {(offPref || noPref) && sel && carrierKey(b.carrier) && (
                            <button
                              title={`${carrierKey(b.carrier)}의 기본 터미널로 ${sel.source} 저장`}
                              onClick={() => {
                                const k = carrierKey(b.carrier)
                                const next = { ...prefs, [k]: [sel.source] }
                                setPrefs(next); savePrefs(next)
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 whitespace-nowrap">
                              {sel.source}를 {carrierKey(b.carrier)} 기본으로
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={`${td} tabular-nums font-semibold ${changed ? 'text-rose-600' : ''}`}>{newEtd || '-'}</td>
                    <td className={td}>
                      {!sel ? '' : diff === 0
                        ? <span className="text-slate-400">동일</span>
                        : <span className={`font-bold ${(diff ?? 0) > 0 ? 'text-rose-600' : 'text-blue-600'}`}>{diff != null ? `${diff > 0 ? '+' : ''}${diff}일` : '신규'}</span>}
                    </td>
                    <td className={`${td} text-slate-400`}>{bookingNos(b)}</td>
                  </tr>
                )
              })}
              {view.length === 0 && (
                <tr><td colSpan={9} className="text-center text-xs text-slate-400 py-10">조건에 맞는 부킹이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 반영 이력 */}
      {logOpen && (
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
          <div className="text-sm font-bold text-slate-700 mb-2">최근 반영 이력 (40건)</div>
          {!logRows ? <div className="text-xs text-slate-400">불러오는 중...</div>
            : logRows.length === 0 ? <div className="text-xs text-slate-400">이력이 없습니다. (migration_v24 실행 전이면 기록되지 않습니다)</div>
            : (
              <div className="max-h-60 overflow-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-500">
                    <th className="py-1 pr-3">반영 시각</th><th className="pr-3">모선명</th><th className="pr-3">이전 ETD</th>
                    <th className="pr-3">새 ETD</th><th className="pr-3">출처 터미널</th><th>수집 시각</th>
                  </tr></thead>
                  <tbody>
                    {logRows.map(r => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="py-1 pr-3 text-slate-500">{(r.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                        <td className="pr-3 font-semibold">{r.vessel_name}</td>
                        <td className="pr-3 tabular-nums">{r.old_etd || '-'}</td>
                        <td className="pr-3 tabular-nums font-semibold">{r.new_etd}</td>
                        <td className="pr-3">{TERM_NAME[r.terminal] || r.terminal}{r.terminal_voyage ? ` · ${r.terminal_voyage}` : ''}</td>
                        <td className="text-slate-400">{r.collected_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}
    </div>
  )
}
