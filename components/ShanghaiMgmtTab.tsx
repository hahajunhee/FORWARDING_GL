'use client'

import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, isValid, differenceInCalendarDays } from 'date-fns'
import type { Booking, ShanghaiMgmtRow } from '@/types'
import { calcTotalQty } from './BookingTable'
import { saveShanghaiMgmt, saveShanghaiPrevPorts } from '@/app/bookings/actions'

const TITLE = '▶ 모비스 AS) MPA 주요 PDC 스케줄 현황 보고'

// ── 날짜 헬퍼 ─────────────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, '0')

// 다양한 입력 → {mm,dd}
function parseMMDD(raw: string): { mm: number; dd: number } | null {
  if (!raw) return null
  const s = raw.trim()
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return { mm: +iso[2], dd: +iso[3] }
  const k = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/)
  if (k) return { mm: +k[1], dd: +k[2] }
  const sep = s.match(/^(\d{1,2})[./-](\d{1,2})$/)
  if (sep) return { mm: +sep[1], dd: +sep[2] }
  const digits = s.replace(/\D/g, '')
  if (digits.length === 8) return { mm: +digits.slice(4, 6), dd: +digits.slice(6, 8) } // YYYYMMDD
  if (digits.length === 4) return { mm: +digits.slice(0, 2), dd: +digits.slice(2, 4) } // MMDD
  if (digits.length === 3) return { mm: +digits.slice(0, 1), dd: +digits.slice(1, 3) } // MDD
  return null
}
function validMMDD(p: { mm: number; dd: number } | null): p is { mm: number; dd: number } {
  return !!p && p.mm >= 1 && p.mm <= 12 && p.dd >= 1 && p.dd <= 31
}
// 날짜면 "MM월 DD일", 아니면 원문 유지(예: "상해 SKIP")
function normalizeKDate(raw: string): string {
  const p = parseMMDD(raw)
  return validMMDD(p) ? `${pad2(p.mm)}월 ${pad2(p.dd)}일` : raw.trim()
}
function kToDate(raw: string): Date | null {
  const p = parseMMDD(raw)
  if (!validMMDD(p)) return null
  return new Date(new Date().getFullYear(), p.mm - 1, p.dd)
}
function kToISO(raw: string): string {
  const p = parseMMDD(raw)
  if (!validMMDD(p)) return ''
  return `${new Date().getFullYear()}-${pad2(p.mm)}-${pad2(p.dd)}`
}
function diffDaysK(fStr: string, gStr: string): number | null {
  const f = kToDate(fStr), g = kToDate(gStr)
  if (!f || !g) return null
  return Math.round((g.getTime() - f.getTime()) / 86400000)
}
function busanDelay(b?: Booking): number | null {
  if (!b?.proforma_etd || !b?.updated_etd) return null
  const a = parseISO(b.proforma_etd), c = parseISO(b.updated_etd)
  if (!isValid(a) || !isValid(c)) return null
  return differenceInCalendarDays(c, a)
}

// ── 도착지 표시 통일 (별칭 그룹 — 포함 단어 매칭 시 통일 라벨로 표시) ──
const DEST_ALIASES: { match: string[]; label: string }[] = [
  { match: ['ONTARIO', 'RIVERSIDE'], label: 'ONTARIO + RIVERSIDE' },
]
function displayDest(dest: string | null | undefined): string {
  const u = (dest || '').toUpperCase()
  for (const a of DEST_ALIASES) {
    if (a.match.some(m => u.includes(m))) return a.label
  }
  return dest || ''
}

// 실 마감 물량: 서류마감일이 오늘보다 이전(지남)일 때만 표시, 그 외 공란
function finalQtyAfterCutoff(b?: Booking): number | '' {
  if (!b?.doc_cutoff_date) return ''
  try {
    const p = parseISO(b.doc_cutoff_date)
    if (!isValid(p) || differenceInCalendarDays(p, new Date()) >= 0) return ''
  } catch { return '' }
  const q = calcTotalQty(b)
  return q > 0 ? q : ''
}
function toExcelDate(d: string | null | undefined): Date | string {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? p : '' } catch { return '' }
}

type LocalRow = {
  key: string
  booking_seq_no: number | null
  prev_port: string         // 직전 PORT (수동)
  first_departure: string   // F
  current_departure: string // G
  berthing: string          // K (접안일 수동)
  mqc: string               // O MQC(/WK) (수동)
  secured_space: string     // P 확보선복 (수동 — 부킹 원본에 반영)
  remarks: string           // 비고 (수동)
}

type EditField = keyof Omit<LocalRow, 'key' | 'booking_seq_no'>
// 수동 편집 열 순서 (엑셀형 이동/붙여넣기 기준)
const EDITABLE: EditField[] = ['prev_port', 'first_departure', 'current_departure', 'berthing', 'mqc', 'secured_space', 'remarks']
// 날짜 자동정규화 대상 (MQC·확보선복은 숫자라 제외)
const DATE_FIELDS = new Set<EditField>(['first_departure', 'current_departure', 'berthing'])

// 확보선복 기본값 = 부킹의 확보선복, 없으면 실마감물량(TEU)
function securedDefault(b?: Booking): string {
  if (!b) return ''
  if (b.secured_space) return b.secured_space
  const q = calcTotalQty(b)
  return q > 0 ? String(q) : ''
}

interface Props {
  bookings: Booking[]
  initialRows: ShanghaiMgmtRow[]
  initialPrevPorts?: string[]
}

export default function ShanghaiMgmtTab({ bookings, initialRows, initialPrevPorts = [] }: Props) {
  const router = useRouter()
  const bySeq = useMemo(() => {
    const m = new Map<number, Booking>()
    for (const b of bookings) if (b.seq_no != null) m.set(b.seq_no, b)
    return m
  }, [bookings])

  const keyCounter = useRef(0)
  const nextKey = () => `r${keyCounter.current++}`

  const [rows, setRows] = useState<LocalRow[]>(() =>
    initialRows.map(r => {
      const bk = r.booking_seq_no != null ? bookings.find(b => b.seq_no === r.booking_seq_no) : undefined
      return {
        key: r.id,
        booking_seq_no: r.booking_seq_no,
        prev_port: r.prev_port || '',
        first_departure: r.first_departure || '',
        current_departure: r.current_departure || '',
        berthing: r.berthing || '',
        // 저장된 MQC 없으면 부킹의 MQC를 초기값으로
        mqc: r.mqc || (bk?.mqc || ''),
        // 확보선복: 부킹값, 없으면 실마감물량
        secured_space: securedDefault(bk),
        remarks: r.remarks || '',
      }
    })
  )
  // 도착지별 MQC 기본값 입력 (일괄 적용용, 비영속)
  const [mqcDefaults, setMqcDefaults] = useState<Record<string, string>>({})
  const [input, setInput] = useState('')
  const [notFound, setNotFound] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  // 엑셀형 셀 이동용 ref 맵
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const focusCell = (rowIdx: number, col: string) => {
    requestAnimationFrame(() => {
      const el = inputRefs.current[`${rowIdx}:${col}`]
      if (el) { el.focus(); el.select() }
    })
  }
  const handleNav = (e: React.KeyboardEvent, rowIdx: number, col: string) => {
    const cIdx = EDITABLE.indexOf(col as typeof EDITABLE[number])
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault(); focusCell(Math.min(rowIdx + 1, rows.length - 1), col)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); focusCell(Math.max(rowIdx - 1, 0), col)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        if (cIdx > 0) focusCell(rowIdx, EDITABLE[cIdx - 1])
        else if (rowIdx > 0) focusCell(rowIdx - 1, EDITABLE[EDITABLE.length - 1])
      } else {
        if (cIdx < EDITABLE.length - 1) focusCell(rowIdx, EDITABLE[cIdx + 1])
        else if (rowIdx < rows.length - 1) focusCell(rowIdx + 1, EDITABLE[0])
      }
    }
  }
  // 엑셀에서 복사한 값 붙여넣기 (여러 행/열 채우기)
  const handleCellPaste = (e: React.ClipboardEvent, rowIdx: number, col: string) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const lines = text.replace(/\r/g, '').split('\n')
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    if (lines.length === 1 && !lines[0].includes('\t')) return // 단일 값은 기본 붙여넣기 허용
    e.preventDefault()
    const startC = EDITABLE.indexOf(col as typeof EDITABLE[number])
    setRows(prev => {
      const next = prev.map(r => ({ ...r }))
      lines.forEach((line, ri) => {
        line.split('\t').forEach((val, ci) => {
          const tr = rowIdx + ri
          const tc = EDITABLE[startC + ci]
          if (tr < next.length && tc) next[tr][tc] = DATE_FIELDS.has(tc) ? normalizeKDate(val) : val.trim()
        })
      })
      return next
    })
  }

  // 고유번호 입력 → 행 추가
  const handleAdd = () => {
    const tokens = input.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
    if (tokens.length === 0) return
    const existing = new Set(rows.map(r => r.booking_seq_no).filter(v => v != null) as number[])
    const additions: LocalRow[] = []
    const missing: string[] = []
    for (const t of tokens) {
      const n = parseInt(t, 10)
      if (isNaN(n) || !bySeq.has(n)) { missing.push(t); continue }
      if (existing.has(n)) continue
      existing.add(n)
      const bk = bySeq.get(n)
      // 도착지 기본값 있으면 우선, 없으면 부킹 자체 MQC (별칭 통일 기준)
      const dest = displayDest(bk?.final_destination)
      const mqcInit = mqcDefaults[dest] || bk?.mqc || ''
      additions.push({ key: nextKey(), booking_seq_no: n, prev_port: '', first_departure: '', current_departure: '', berthing: '', mqc: mqcInit, secured_space: securedDefault(bk), remarks: '' })
    }
    if (additions.length > 0) setRows(prev => [...prev, ...additions])
    setNotFound(missing)
    setInput('')
  }
  const addBlankRow = () => setRows(prev => [...prev, { key: nextKey(), booking_seq_no: null, prev_port: '', first_departure: '', current_departure: '', berthing: '', mqc: '', secured_space: '', remarks: '' }])
  const updateRow = (key: string, field: EditField, value: string) =>
    setRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r))

  // 도착지별 MQC 기본값 일괄 적용 (해당 도착지 모든 행 덮어쓰기)
  const applyMqcDefault = (dest: string) => {
    const v = (mqcDefaults[dest] ?? '').trim()
    setRows(prev => prev.map(r => {
      const b = r.booking_seq_no != null ? bySeq.get(r.booking_seq_no) : undefined
      return displayDest(b?.final_destination) === dest ? { ...r, mqc: v } : r
    }))
  }
  // 현재 행들의 도착지 목록 (별칭 통일 기준, 중복 제거)
  const distinctDests = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) {
      const b = r.booking_seq_no != null ? bySeq.get(r.booking_seq_no) : undefined
      const d = displayDest(b?.final_destination)
      if (d) s.add(d)
    }
    return Array.from(s).sort()
  }, [rows, bySeq])

  // ── PROFORMA ETD 기준 일괄 추가 ─────────────────────────────────
  const [etdAddFrom, setEtdAddFrom] = useState('')
  const [etdAddTo, setEtdAddTo] = useState('')
  const [etdAddDests, setEtdAddDests] = useState<string[]>([]) // 빈 배열 = 전체 도착지
  // 기간 내 PROFORMA ETD인 부킹 중 아직 추가되지 않은 건 (도착지 필터 전)
  const etdPeriodCandidates = useMemo(() => {
    if (!etdAddFrom && !etdAddTo) return []
    const existing = new Set(rows.map(r => r.booking_seq_no).filter(v => v != null) as number[])
    return bookings
      .filter(b => {
        if (b.seq_no == null || existing.has(b.seq_no)) return false
        const etd = b.proforma_etd
        if (!etd) return false
        if (etdAddFrom && etd < etdAddFrom) return false
        if (etdAddTo && etd > etdAddTo) return false
        return true
      })
      .sort((a, b) => {
        const ea = a.proforma_etd || '', eb = b.proforma_etd || ''
        if (ea !== eb) return ea < eb ? -1 : 1
        return (a.seq_no || 0) - (b.seq_no || 0)
      })
  }, [rows, bookings, etdAddFrom, etdAddTo])
  // 기간 내 후보의 도착지 목록 (별칭 통일 기준, 선택 칩용)
  const etdDestOptions = useMemo(() =>
    Array.from(new Set(etdPeriodCandidates.map(b => displayDest(b.final_destination)).filter(Boolean))).sort()
  , [etdPeriodCandidates])
  // 도착지 필터 적용된 최종 후보
  const etdCandidates = useMemo(() =>
    etdAddDests.length === 0
      ? etdPeriodCandidates
      : etdPeriodCandidates.filter(b => etdAddDests.includes(displayDest(b.final_destination)))
  , [etdPeriodCandidates, etdAddDests])

  const handleEtdAdd = () => {
    if (etdCandidates.length === 0) return
    // 도착지별 MQC 기본값·확보선복 기본값 자동 적용, 맨 마지막에 추가
    setRows(prev => [...prev, ...etdCandidates.map(bk => ({
      key: nextKey(),
      booking_seq_no: bk.seq_no as number,
      prev_port: '',
      first_departure: '',
      current_departure: '',
      berthing: '',
      mqc: mqcDefaults[displayDest(bk.final_destination)] || bk.mqc || '',
      secured_space: securedDefault(bk),
      remarks: '',
    }))])
  }

  // ── 열 제목 클릭 정렬 — 다중 정렬 지원 (행 순서를 실제로 재배치 → 저장 시 영속) ──
  // 클릭: 오름 → 내림 → 해제. 다른 열을 이어서 클릭하면 2차·3차 정렬로 누적.
  const [sortLevels, setSortLevels] = useState<{ key: string; dir: 1 | -1 }[]>([])
  const sortVal = (r: LocalRow, key: string): string | number => {
    const b = r.booking_seq_no != null ? bySeq.get(r.booking_seq_no) : undefined
    const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? s : n }
    switch (key) {
      case 'seq':         return r.booking_seq_no ?? ''
      case 'dest':        return displayDest(b?.final_destination) // 별칭 통일 기준으로 정렬
      case 'prev_port':   return r.prev_port
      case 'carrier':     return b?.carrier || ''
      case 'vessel':      return vesselVoyage(b)
      case 'first_dep':   return kToISO(r.first_departure)
      case 'cur_dep':     return kToISO(r.current_departure)
      case 'delay_sh':    return diffDaysK(r.first_departure, r.current_departure) ?? ''
      case 'busan_first': return b?.proforma_etd || ''
      case 'busan_cur':   return b?.updated_etd || ''
      case 'berthing':    return kToISO(r.berthing)
      case 'delay_bs':    return busanDelay(b) ?? ''
      case 'doc_cutoff':  return b?.doc_cutoff_date || ''
      case 'eta':         return b?.eta || ''
      case 'mqc':         return num(r.mqc)
      case 'secured':     return num(r.secured_space)
      case 'qty':         return finalQtyAfterCutoff(b)
      case 'remarks':     return r.remarks
      default:            return ''
    }
  }
  const cmpRows = (levels: { key: string; dir: 1 | -1 }[]) => (a: LocalRow, b: LocalRow): number => {
    for (const { key, dir } of levels) {
      const va = sortVal(a, key), vb = sortVal(b, key)
      const ea = va === '' || va == null, eb = vb === '' || vb == null
      if (ea && eb) continue
      if (ea) return 1  // 빈 값은 항상 아래로
      if (eb) return -1
      const c = (typeof va === 'number' && typeof vb === 'number')
        ? va - vb
        : String(va).localeCompare(String(vb), 'ko')
      if (c !== 0) return c * dir
    }
    return 0
  }
  const handleSort = (key: string) => {
    const i = sortLevels.findIndex(s => s.key === key)
    let next: { key: string; dir: 1 | -1 }[]
    if (i === -1) next = [...sortLevels, { key, dir: 1 as const }]
    else if (sortLevels[i].dir === 1) next = sortLevels.map((s, si) => si === i ? { ...s, dir: -1 as const } : s)
    else next = sortLevels.filter((_, si) => si !== i)
    setSortLevels(next)
    if (next.length > 0) setRows(r => [...r].sort(cmpRows(next)))
  }
  const arrow = (key: string) => {
    const i = sortLevels.findIndex(s => s.key === key)
    if (i === -1) return ''
    const a = sortLevels[i].dir === 1 ? ' ↑' : ' ↓'
    return sortLevels.length > 1 ? `${a}${i + 1}` : a
  }

  // ── 직전 PORT 목록 (전체 공유, 유저가 직접 관리) ─────────────────
  const [prevPorts, setPrevPorts] = useState<string[]>(initialPrevPorts)
  const [newPort, setNewPort] = useState('')
  const [portSaving, setPortSaving] = useState(false)
  const savePortList = (next: string[]) => {
    setPrevPorts(next)
    setPortSaving(true)
    saveShanghaiPrevPorts(next).finally(() => setPortSaving(false))
  }
  const addPrevPort = () => {
    const v = newPort.trim()
    if (!v || prevPorts.includes(v)) { setNewPort(''); return }
    savePortList([...prevPorts, v].sort())
    setNewPort('')
  }
  const removePrevPort = (p: string) => savePortList(prevPorts.filter(x => x !== p))
  const removeRow = (key: string) => setRows(prev => prev.filter(r => r.key !== key))
  const moveRow = (idx: number, dir: -1 | 1) => setRows(prev => {
    const next = [...prev]; const j = idx + dir
    if (j < 0 || j >= next.length) return prev
    ;[next[idx], next[j]] = [next[j], next[idx]]
    return next
  })

  const handleSave = () => {
    setSaveError(null)
    // 확보선복이 부킹 원본과 달라진 것만 반영
    const securedUpdates: { id: string; secured_space: string }[] = []
    for (const r of rows) {
      if (r.booking_seq_no == null) continue
      const b = bySeq.get(r.booking_seq_no)
      if (b && (r.secured_space || '') !== (b.secured_space || '')) {
        securedUpdates.push({ id: b.id, secured_space: r.secured_space })
      }
    }
    startTransition(async () => {
      setSaveState('saving')
      const result = await saveShanghaiMgmt(
        rows.map(r => ({
          booking_seq_no: r.booking_seq_no,
          prev_port: r.prev_port,
          first_departure: r.first_departure,
          current_departure: r.current_departure,
          berthing: r.berthing,
          mqc: r.mqc,
          remarks: r.remarks,
        })),
        securedUpdates,
      )
      if (result.error) { setSaveError(result.error); setSaveState('error') }
      else {
        setSaveState('saved'); setTimeout(() => setSaveState('idle'), 3000)
        if (securedUpdates.length > 0) router.refresh() // 부킹장 탭에 확보선복 반영
      }
    })
  }

  // ── Excel 다운로드 (캡처 레이아웃 재현) ──────────────────────────
  const exportExcel = () => {
    import('xlsx-js-style').then((mod) => {
      const XLSX = (mod as unknown as { default: typeof import('xlsx-js-style') }).default ?? mod
      const N = rows.length

      // 열 배치(0~18): 법인/대리점/도착지/직전PORT/선사/선명&VOY | 상해(6~8) | 부산(9~14) | MQC/확보/실마감/비고
      const groupRow = ['법인', '법인/대리점', '도착지', '직전 PORT', '선사', '선명 & VOYAGE',
        '상해 / 닝보(PUS 직전 PORT 기준)', '', '', '부산', '', '', '', '', '',
        'MQC (/WK)', '확보 선복', '실 마감 물량', '비고']
      const subRow = ['', '', '', '', '', '', '최초 출항일', '현재 출항일', '지연일',
        '부산출항(최초)', '부산출항(현재 ETD)', '접안일', '지연일', '서류마감', 'P.O.D ETA', '', '', '', '']
      const titleRow = [TITLE, ...Array(18).fill('')]

      const delayNums: { h: number | null; l: number | null }[] = []
      const dataRows = rows.map(r => {
        const b = r.booking_seq_no != null ? bySeq.get(r.booking_seq_no) : undefined
        const h = diffDaysK(r.first_departure, r.current_departure)
        const l = busanDelay(b)
        delayNums.push({ h, l })
        return [
          'MPA', 'MPA',
          displayDest(b?.final_destination), r.prev_port || '', b?.carrier || '', vesselVoyage(b),
          r.first_departure, r.current_departure, h ?? '',
          toExcelDate(b?.proforma_etd), toExcelDate(b?.updated_etd), r.berthing,
          l ?? '',
          toExcelDate(b?.doc_cutoff_date), toExcelDate(b?.eta),
          r.mqc || '', r.secured_space || '', finalQtyAfterCutoff(b), r.remarks || '',
        ]
      })

      const aoa = [titleRow, groupRow, subRow, ...dataRows]
      const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })

      const thin = { style: 'thin', color: { rgb: 'B0B0B0' } }
      const border = { top: thin, bottom: thin, left: thin, right: thin }
      const mk = (bg: string, fg: string) => ({
        font: { bold: true, color: { rgb: fg }, sz: 10, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border,
      })
      const navyHeader = mk('1F4E79', 'FFFFFF')
      const orangeHeader = mk('ED7D31', 'FFFFFF')
      const groupShanghai = mk('F8CBAD', '833C00')
      const groupBusan = mk('FFE699', '7F6000')
      const titleStyle = { font: { bold: true, sz: 13, color: { rgb: '1F4E79' }, name: '맑은 고딕' }, alignment: { horizontal: 'left', vertical: 'center' } }
      const dataBase = (opts: { delay?: boolean; date?: boolean } = {}) => ({
        font: { sz: 10, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: opts.delay ? 'FFF2CC' : 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center' }, border,
        ...(opts.date ? { numFmt: 'mm"월" dd"일"' } : {}),
      })

      const orangeCols = new Set([15, 16, 17, 18])
      for (let c = 0; c <= 18; c++) {
        const gAddr = XLSX.utils.encode_cell({ r: 1, c })
        const sAddr = XLSX.utils.encode_cell({ r: 2, c })
        if (ws[gAddr]) ws[gAddr].s = (c >= 6 && c <= 8) ? groupShanghai : (c >= 9 && c <= 14) ? groupBusan : orangeCols.has(c) ? orangeHeader : navyHeader
        if (ws[sAddr]) ws[sAddr].s = navyHeader
      }
      const tAddr = XLSX.utils.encode_cell({ r: 0, c: 0 })
      if (ws[tAddr]) ws[tAddr].s = titleStyle

      for (let ri = 0; ri < N; ri++) {
        const { h, l } = delayNums[ri]
        for (let c = 0; c <= 18; c++) {
          const addr = XLSX.utils.encode_cell({ r: ri + 3, c })
          if (!ws[addr]) ws[addr] = { t: 's', v: '' }
          const isDate = [9, 10, 13, 14].includes(c)
          const delayCell = (c === 8 && (h ?? 0) > 0) || (c === 12 && (l ?? 0) > 0)
          ws[addr].s = dataBase({ delay: delayCell, date: isDate })
        }
      }

      const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 18 } },
        { s: { r: 1, c: 6 }, e: { r: 1, c: 8 } },
        { s: { r: 1, c: 9 }, e: { r: 1, c: 14 } },
      ]
      for (const c of [0, 1, 2, 3, 4, 5, 15, 16, 17, 18]) merges.push({ s: { r: 1, c }, e: { r: 2, c } })
      if (N > 1) merges.push({ s: { r: 3, c: 0 }, e: { r: 3 + N - 1, c: 0 } })
      for (const c of [2, 4]) {
        let i = 0
        while (i < N) {
          const b = rows[i].booking_seq_no != null ? bySeq.get(rows[i].booking_seq_no!) : undefined
          const v = c === 2 ? displayDest(b?.final_destination) : (b?.carrier || '')
          if (!v) { i++; continue }
          let j = i + 1
          while (j < N) {
            const bj = rows[j].booking_seq_no != null ? bySeq.get(rows[j].booking_seq_no!) : undefined
            const vj = c === 2 ? displayDest(bj?.final_destination) : (bj?.carrier || '')
            if (vj !== v) break
            j++
          }
          if (j - i > 1) merges.push({ s: { r: i + 3, c }, e: { r: j - 1 + 3, c } })
          i = j
        }
      }
      ws['!merges'] = merges
      ws['!cols'] = [6, 10, 16, 10, 12, 18, 11, 11, 7, 12, 14, 12, 7, 11, 11, 9, 9, 11, 16].map(w => ({ wch: w }))
      ws['!rows'] = [{ hpt: 26 }, { hpt: 18 }, { hpt: 30 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '상해발관리')
      XLSX.writeFile(wb, `상해발관리_${format(new Date(), 'yyyyMMdd')}.xlsx`, { cellStyles: true })
    })
  }

  // ── 렌더 ──────────────────────────────────────────────────────
  const th = 'px-2 py-1.5 font-bold text-white border border-blue-800/40 whitespace-nowrap text-center align-middle'
  const thNavy = 'bg-[#1F4E79]'
  const thOrange = 'bg-[#ED7D31]'
  const td = 'px-2 py-1 border border-gray-200 text-xs text-center align-middle whitespace-nowrap'

  return (
    <div className="space-y-4">
      {/* 직전 PORT 목록상자 옵션 (전체 공유) */}
      <datalist id="shanghai-prev-ports">
        {prevPorts.map(p => <option key={p} value={p} />)}
      </datalist>

      {/* 작성방법 안내 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-bold text-blue-900">📌 작성방법</h3>
        <p className="text-xs text-blue-800">상해 / 닝보의 <b>최초·현재 출항일</b>과 <b>접안 터미널</b>은 아래 사이트에서 조회하세요.</p>
        <ul className="text-xs space-y-1 text-blue-800">
          <li>· 상해 스케줄 / 접안터미널 조회: <a href="https://www.fob001.cn/guestbook/cbxx.php" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium break-all">www.fob001.cn/guestbook/cbxx.php</a></li>
          <li>· 닝보 스케줄 / 접안터미널 조회: <a href="https://www.fob001.cn/nb/indexnbvsl.php" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium break-all">www.fob001.cn/nb/indexnbvsl.php</a></li>
        </ul>
        <p className="text-[11px] text-blue-700/80 leading-relaxed">
          · 날짜 셀은 <b>0807</b>처럼 입력하면 <b>08월 07일</b>로 자동 변환됩니다 (📅 아이콘으로 달력 선택도 가능).
          · <b>지연일</b>은 자동 계산됩니다 — 상해=현재출항일−최초출항일, 부산=부산출항(현재 ETD)−부산출항(최초).
          · <b>Enter/Tab/방향키</b>로 셀 이동, 엑셀에서 복사한 값 <b>붙여넣기(Ctrl+V)</b> 지원.
          · <b>열 제목 클릭</b>으로 정렬 — 저장하면 그 순서 그대로 유지됩니다.
        </p>
      </div>

      {/* 고유번호 입력 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1 font-medium">고유번호 입력 (집중관리 대상 추가)</label>
          <p className="text-xs text-gray-400 mb-2">부킹장의 &quot;고유번호&quot; 값을 쉼표·공백·줄바꿈으로 여러 개 입력하세요.</p>
        </div>
        <div className="flex gap-2">
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAdd() }}
            placeholder="예: 12, 15, 23" rows={2}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          <div className="flex flex-col gap-1.5 self-end">
            <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium whitespace-nowrap">추가</button>
            <button onClick={addBlankRow} className="px-4 py-1 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200 transition-colors whitespace-nowrap">빈 행</button>
          </div>
        </div>
        {notFound.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
            <p className="text-xs text-yellow-700">고유번호를 찾을 수 없습니다: <span className="font-mono font-medium">{notFound.join(', ')}</span></p>
          </div>
        )}
      </div>

      {/* PROFORMA ETD 기준 일괄 추가 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
        <div>
          <label className="text-xs text-gray-500 block font-medium">PROFORMA ETD 기준 일괄 추가</label>
          <p className="text-xs text-gray-400 mt-0.5">기간 내 PROFORMA ETD인 부킹 중 <b>아직 추가되지 않은 건</b>을 표 맨 아래에 추가합니다. (도착지별 MQC 기본값·확보선복 기본값 자동 적용)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={etdAddFrom} onChange={e => setEtdAddFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <span className="text-gray-400 text-xs">~</span>
          <input type="date" value={etdAddTo} onChange={e => setEtdAddTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <button onClick={handleEtdAdd} disabled={etdCandidates.length === 0}
            className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors font-medium">
            {etdCandidates.length > 0 ? `${etdCandidates.length}건 추가` : '추가할 건 없음'}
          </button>
          {(etdAddFrom || etdAddTo) && etdCandidates.length > 0 && (
            <span className="text-[11px] text-gray-400">
              고유번호: {etdCandidates.slice(0, 10).map(b => b.seq_no).join(', ')}{etdCandidates.length > 10 ? ` 외 ${etdCandidates.length - 10}건` : ''}
            </span>
          )}
        </div>
        {/* 도착지 선택 (기간 내 후보 기준) */}
        {etdDestOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-gray-400 flex-shrink-0">도착지 선택:</span>
            <button onClick={() => setEtdAddDests([])}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${etdAddDests.length === 0 ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-500 border-gray-200 hover:border-emerald-400'}`}>
              전체
            </button>
            {etdDestOptions.map(d => {
              const on = etdAddDests.includes(d)
              const cnt = etdPeriodCandidates.filter(b => displayDest(b.final_destination) === d).length
              return (
                <button key={d}
                  onClick={() => setEtdAddDests(prev => on ? prev.filter(x => x !== d) : [...prev, d])}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-400'}`}>
                  {d} <span className="opacity-70">({cnt})</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 직전 PORT 목록 관리 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
        <div>
          <label className="text-xs text-gray-500 block font-medium">직전 PORT 목록 관리 {portSaving && <span className="text-blue-500">(저장 중...)</span>}</label>
          <p className="text-xs text-gray-400 mt-0.5">여기에 등록한 항목이 표의 &quot;직전 PORT&quot; 입력 시 목록상자로 나타납니다. (전체 공유)</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {prevPorts.map(p => (
            <span key={p} className="inline-flex items-center gap-1 text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-2 py-0.5">
              {p}
              <button onClick={() => removePrevPort(p)} className="text-sky-300 hover:text-red-500 transition-colors font-bold">✕</button>
            </span>
          ))}
          {prevPorts.length === 0 && <span className="text-xs text-gray-300">등록된 항목 없음 — 예: 상해, 닝보</span>}
          <input value={newPort} onChange={e => setNewPort(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addPrevPort() }}
            placeholder="새 항목"
            className="w-24 border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-400" />
          <button onClick={addPrevPort} disabled={!newPort.trim()}
            className="text-xs px-2 py-0.5 bg-sky-500 text-white rounded hover:bg-sky-600 disabled:opacity-40 transition-colors">추가</button>
        </div>
      </div>

      {/* 도착지별 MQC 기본값 일괄설정 */}
      {distinctDests.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <div>
            <label className="text-xs text-gray-500 block font-medium">도착지별 MQC(/WK) 기본값 일괄설정</label>
            <p className="text-xs text-gray-400 mt-0.5">값을 입력하고 <b>적용</b>하면 해당 도착지의 모든 행이 그 값으로 채워집니다. 이후 행별로 개별 수정 가능.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {distinctDests.map(dest => (
              <div key={dest} className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1 bg-gray-50">
                <span className="text-xs font-medium text-gray-700 max-w-[140px] truncate" title={dest}>{dest}</span>
                <input
                  value={mqcDefaults[dest] ?? ''}
                  onChange={e => setMqcDefaults(prev => ({ ...prev, [dest]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') applyMqcDefault(dest) }}
                  placeholder="MQC"
                  className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white" />
                <button onClick={() => applyMqcDefault(dest)}
                  className="text-xs px-2 py-0.5 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors">적용</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 액션 */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={handleSave} disabled={isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
          {saveState === 'saving' ? '저장 중...' : '저장'}
        </button>
        {saveState === 'saved' && <span className="text-xs text-green-600 font-medium">✓ 저장됨</span>}
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        <button onClick={exportExcel} disabled={rows.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Excel 다운로드
        </button>
        <span className="text-xs text-gray-400">{rows.length}건 관리 중</span>
        {sortLevels.length > 0 && (
          <button onClick={() => setSortLevels([])}
            className="text-xs px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium transition-colors"
            title="정렬 표시를 해제합니다 (현재 행 순서는 유지)">
            정렬 {sortLevels.length}단계 해제
          </button>
        )}
      </div>

      {/* 표 */}
      {rows.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
            <span className="text-sm font-bold text-gray-700">{TITLE}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th rowSpan={2} onClick={() => handleSort('seq')} title="클릭 시 정렬" className={`${th} bg-gray-500 cursor-pointer select-none hover:brightness-110`}>고유<br />번호{arrow('seq')}</th>
                  <th rowSpan={2} className={`${th} ${thNavy}`}>법인</th>
                  <th rowSpan={2} className={`${th} ${thNavy}`}>법인/<br />대리점</th>
                  <th rowSpan={2} onClick={() => handleSort('dest')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>도착지{arrow('dest')}</th>
                  <th rowSpan={2} onClick={() => handleSort('prev_port')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>직전<br />PORT{arrow('prev_port')}</th>
                  <th rowSpan={2} onClick={() => handleSort('carrier')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>선사{arrow('carrier')}</th>
                  <th rowSpan={2} onClick={() => handleSort('vessel')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>선명 &<br />VOYAGE{arrow('vessel')}</th>
                  <th colSpan={3} className={`${th} bg-[#C55A11]`}>상해 / 닝보(PUS 직전 PORT 기준)</th>
                  <th colSpan={6} className={`${th} bg-[#BF9000]`}>부산</th>
                  <th rowSpan={2} onClick={() => handleSort('mqc')} title="클릭 시 정렬" className={`${th} ${thOrange} cursor-pointer select-none hover:brightness-110`}>MQC<br />(/WK){arrow('mqc')}</th>
                  <th rowSpan={2} onClick={() => handleSort('secured')} title="클릭 시 정렬" className={`${th} ${thOrange} cursor-pointer select-none hover:brightness-110`}>확보<br />선복{arrow('secured')}</th>
                  <th rowSpan={2} onClick={() => handleSort('qty')} title="클릭 시 정렬" className={`${th} ${thOrange} cursor-pointer select-none hover:brightness-110`}>실 마감<br />물량{arrow('qty')}</th>
                  <th rowSpan={2} onClick={() => handleSort('remarks')} title="클릭 시 정렬" className={`${th} ${thOrange} cursor-pointer select-none hover:brightness-110`}>비고{arrow('remarks')}</th>
                  <th rowSpan={2} className={`${th} bg-gray-400`}>삭제</th>
                </tr>
                <tr>
                  <th onClick={() => handleSort('first_dep')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>최초<br />출항일{arrow('first_dep')}</th>
                  <th onClick={() => handleSort('cur_dep')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>현재<br />출항일{arrow('cur_dep')}</th>
                  <th onClick={() => handleSort('delay_sh')} title="클릭 시 정렬" className={`${th} bg-[#7F3E0C] cursor-pointer select-none hover:brightness-110`}>지연일{arrow('delay_sh')}<br /><span className="text-[9px] font-normal opacity-80">자동</span></th>
                  <th onClick={() => handleSort('busan_first')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>부산출항<br />(최초){arrow('busan_first')}</th>
                  <th onClick={() => handleSort('busan_cur')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>부산출항<br />(현재 ETD){arrow('busan_cur')}</th>
                  <th onClick={() => handleSort('berthing')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>접안일{arrow('berthing')}</th>
                  <th onClick={() => handleSort('delay_bs')} title="클릭 시 정렬" className={`${th} bg-[#7F3E0C] cursor-pointer select-none hover:brightness-110`}>지연일{arrow('delay_bs')}<br /><span className="text-[9px] font-normal opacity-80">자동</span></th>
                  <th onClick={() => handleSort('doc_cutoff')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>서류마감{arrow('doc_cutoff')}</th>
                  <th onClick={() => handleSort('eta')} title="클릭 시 정렬" className={`${th} ${thNavy} cursor-pointer select-none hover:brightness-110`}>P.O.D<br />ETA{arrow('eta')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const b = r.booking_seq_no != null ? bySeq.get(r.booking_seq_no) : undefined
                  const missing = r.booking_seq_no != null && !b
                  const hDelay = diffDaysK(r.first_departure, r.current_departure)
                  const lDelay = busanDelay(b)
                  const dash = <span className="text-gray-300">-</span>
                  return (
                    <tr key={r.key} className="hover:bg-blue-50/30">
                      {/* 고유번호 + 순서 */}
                      <td className={`${td} bg-gray-50`}>
                        <div className="flex items-center justify-center gap-0.5">
                          <div className="flex flex-col leading-none">
                            <button onClick={() => moveRow(idx, -1)} disabled={idx === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-[9px]">▲</button>
                            <button onClick={() => moveRow(idx, 1)} disabled={idx === rows.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-[9px]">▼</button>
                          </div>
                          <span className={`font-mono font-semibold ${missing ? 'text-red-500' : 'text-gray-500'}`}>{r.booking_seq_no ?? '-'}</span>
                        </div>
                        {missing && <span className="block text-[9px] text-red-400">없음</span>}
                      </td>
                      {/* A,B 고정 */}
                      <td className={`${td} font-semibold text-gray-600 bg-slate-50`}>MPA</td>
                      <td className={`${td} font-semibold text-gray-600 bg-slate-50`}>MPA</td>
                      {/* C 도착지 자동 (별칭 통일 표시) */}
                      <td className={`${td} text-gray-800`} title={b?.final_destination || ''}>{displayDest(b?.final_destination) || dash}</td>
                      {/* 직전 PORT (수동) */}
                      <td className="px-1 py-1 border border-gray-200 bg-sky-50/30">
                        <input value={r.prev_port} list="shanghai-prev-ports"
                          ref={el => { inputRefs.current[`${idx}:prev_port`] = el }}
                          onChange={e => updateRow(r.key, 'prev_port', e.target.value)}
                          onKeyDown={e => handleNav(e, idx, 'prev_port')}
                          onPaste={e => handleCellPaste(e, idx, 'prev_port')}
                          placeholder="직전 PORT"
                          className="w-20 border border-gray-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-sky-400 bg-white" />
                      </td>
                      {/* D 선사 자동 */}
                      <td className={`${td} text-gray-700`}>{b?.carrier || dash}</td>
                      {/* E 선명 & VOYAGE 자동 */}
                      <td className={`${td} text-gray-700`}>{vesselVoyage(b) || dash}</td>
                      {/* F 최초출항일 (수동 날짜) */}
                      <td className="px-1 py-1 border border-gray-200">
                        <DateCell value={r.first_departure} onCommit={v => updateRow(r.key, 'first_departure', v)}
                          onNav={e => handleNav(e, idx, 'first_departure')} onPaste={e => handleCellPaste(e, idx, 'first_departure')}
                          refCb={el => { inputRefs.current[`${idx}:first_departure`] = el }} />
                      </td>
                      {/* G 현재출항일 (수동 날짜) */}
                      <td className="px-1 py-1 border border-gray-200">
                        <DateCell value={r.current_departure} onCommit={v => updateRow(r.key, 'current_departure', v)}
                          onNav={e => handleNav(e, idx, 'current_departure')} onPaste={e => handleCellPaste(e, idx, 'current_departure')}
                          refCb={el => { inputRefs.current[`${idx}:current_departure`] = el }} />
                      </td>
                      {/* H 지연일 (자동) */}
                      <td className={`${td} font-semibold ${(hDelay ?? 0) > 0 ? 'bg-amber-50 text-amber-700' : 'text-gray-500'}`}>{hDelay == null ? dash : hDelay}</td>
                      {/* I,J 자동 날짜 */}
                      <td className={`${td} text-gray-700`}>{fmtCell(b?.proforma_etd) || dash}</td>
                      <td className={`${td} text-gray-700`}>{fmtCell(b?.updated_etd) || dash}</td>
                      {/* K 접안일 (수동 날짜) */}
                      <td className="px-1 py-1 border border-gray-200">
                        <DateCell value={r.berthing} onCommit={v => updateRow(r.key, 'berthing', v)}
                          onNav={e => handleNav(e, idx, 'berthing')} onPaste={e => handleCellPaste(e, idx, 'berthing')}
                          refCb={el => { inputRefs.current[`${idx}:berthing`] = el }} />
                      </td>
                      {/* L 지연일 (자동) */}
                      <td className={`${td} font-semibold ${(lDelay ?? 0) > 0 ? 'bg-amber-50 text-amber-700' : 'text-gray-500'}`}>{lDelay == null ? dash : lDelay}</td>
                      {/* M,N 자동 날짜 */}
                      <td className={`${td} text-gray-700`}>{fmtCell(b?.doc_cutoff_date) || dash}</td>
                      <td className={`${td} text-gray-700`}>{fmtCell(b?.eta) || dash}</td>
                      {/* O MQC (수동 편집) */}
                      <td className="px-1 py-1 border border-gray-200 bg-orange-50/30">
                        <input value={r.mqc}
                          ref={el => { inputRefs.current[`${idx}:mqc`] = el }}
                          onChange={e => updateRow(r.key, 'mqc', e.target.value)}
                          onKeyDown={e => handleNav(e, idx, 'mqc')}
                          onPaste={e => handleCellPaste(e, idx, 'mqc')}
                          placeholder="MQC"
                          className="w-14 border border-gray-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white" />
                      </td>
                      {/* P 확보선복 (수동 편집 — 부킹에도 반영) */}
                      <td className="px-1 py-1 border border-gray-200 bg-orange-50/30">
                        <input value={r.secured_space}
                          ref={el => { inputRefs.current[`${idx}:secured_space`] = el }}
                          onChange={e => updateRow(r.key, 'secured_space', e.target.value)}
                          onKeyDown={e => handleNav(e, idx, 'secured_space')}
                          onPaste={e => handleCellPaste(e, idx, 'secured_space')}
                          placeholder="확보선복"
                          className="w-14 border border-gray-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white" />
                      </td>
                      {/* Q 실마감물량 (자동 — 서류마감일 지난 건만 표시) */}
                      <td className={`${td} font-semibold text-blue-700`}>{finalQtyAfterCutoff(b) || dash}</td>
                      {/* 비고 (수동) */}
                      <td className="px-1 py-1 border border-gray-200">
                        <input value={r.remarks}
                          ref={el => { inputRefs.current[`${idx}:remarks`] = el }}
                          onChange={e => updateRow(r.key, 'remarks', e.target.value)}
                          onKeyDown={e => handleNav(e, idx, 'remarks')}
                          onPaste={e => handleCellPaste(e, idx, 'remarks')}
                          placeholder="비고"
                          className="w-28 border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
                      </td>
                      {/* 삭제 */}
                      <td className={td}><button onClick={() => removeRow(r.key)} className="text-gray-300 hover:text-red-500 transition-colors">✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400">
          <p className="text-sm">위에서 고유번호를 입력해 집중관리 대상을 추가하세요.</p>
        </div>
      )}
    </div>
  )
}

// 자동 날짜 셀 표시 (MM월 DD일)
function fmtCell(d: string | null | undefined): string {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? format(p, "MM'월' dd'일'") : '' } catch { return '' }
}

// 선명 & VOYAGE 합쳐서 표시
function vesselVoyage(b?: Booking): string {
  if (!b) return ''
  return [b.vessel_name, b.voyage].filter(Boolean).join(' / ')
}

// ── 날짜 셀 (캘린더 + 0807 빠른입력 + 자유입력) — 모듈 스코프로 remount 방지 ──
function DateCell({ value, onCommit, onNav, onPaste, refCb }: {
  value: string
  onCommit: (v: string) => void
  onNav: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent) => void
  refCb: (el: HTMLInputElement | null) => void
}) {
  const [local, setLocal] = useState(value)
  const dateRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setLocal(value) }, [value])
  const commit = () => { const n = normalizeKDate(local); if (n !== local) setLocal(n); if (n !== value) onCommit(n) }
  return (
    <div className="flex items-center gap-0.5 relative">
      <input ref={refCb} value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); onNav(e) }}
        onPaste={onPaste}
        placeholder="MM월 DD일"
        className="w-[76px] border border-gray-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
      <button type="button" tabIndex={-1} onMouseDown={e => e.preventDefault()}
        onClick={() => { const el = dateRef.current; if (el) { if (el.showPicker) { try { el.showPicker() } catch { el.click() } } else el.click() } }}
        className="text-gray-300 hover:text-blue-500 text-xs leading-none" title="달력에서 선택">📅</button>
      <input ref={dateRef} type="date" tabIndex={-1} value={kToISO(local)}
        onChange={e => { if (e.target.value) { const n = normalizeKDate(e.target.value); setLocal(n); onCommit(n) } }}
        className="absolute right-0 bottom-0 w-4 h-4 opacity-0 pointer-events-none" />
    </div>
  )
}
