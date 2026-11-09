// 터미널 스케줄 API 호출 (서버 전용). 키는 서버 환경변수에만 둔다.
//   TERMINAL_API_BASE = https://terminal-collector.tailb40a03.ts.net
//   TERMINAL_API_KEY  = (VM의 ~/terminal/.env 의 API_KEY)

export interface TerminalCandidate {
  source: string            // 터미널 코드 (BCT, PNC, HPNT ...)
  terminal: string          // 터미널 표시명
  vessel: string
  terminal_voyage: string | null
  carrier: string | null    // 선사 코드
  berth: string | null
  cutoff: string | null     // 'YYYY-MM-DD HH:MM'
  eta: string | null
  etd: string | null
  status: string | null
  collected_at: string
}

interface ApiRow {
  source: string; terminal: string; vessel: string | null; terminal_voyage: string | null
  carrier: string | null; berth: string | null; cutoff: string | null; eta: string | null
  etd: string | null; status: string | null; collected_at: string
}

export const normVessel = (s: string | null | undefined) =>
  (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** 부킹장 모선명과 터미널 모선명이 같은 배인지: 정규화 후 같거나(3점), 한쪽이 다른 쪽을 포함(2점, 5자 이상). */
export function vesselScore(bookingVessel: string, terminalVessel: string): number {
  const a = normVessel(bookingVessel), b = normVessel(terminalVessel)
  if (!a || !b) return 0
  if (a === b) return 3
  if (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))) return 2
  return 0
}

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 모선명 하나에 대한 후보 조회. 환경변수가 없거나 호출이 실패하면 error 문자열을 돌려준다. */
export async function fetchCandidates(vessel: string): Promise<{ rows: TerminalCandidate[]; error?: string }> {
  const base = process.env.TERMINAL_API_BASE
  const key = process.env.TERMINAL_API_KEY
  if (!base || !key) return { rows: [], error: 'TERMINAL_API_BASE / TERMINAL_API_KEY 환경변수가 설정되지 않았습니다.' }

  const now = new Date()
  const from = new Date(now); from.setDate(from.getDate() - 14)
  const to = new Date(now); to.setDate(to.getDate() + 75)
  const qs = new URLSearchParams({ q: vessel.trim().replace(/\s+/g, ' '), field: 'etd', from: ymd(from), to: ymd(to), limit: '200' })

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/schedule?${qs}`, {
      headers: { 'X-API-Key': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
    if (!r.ok) return { rows: [], error: `스케줄 서버 응답 오류 (${r.status})` }
    const j = (await r.json()) as { rows: ApiRow[] }
    const rows: TerminalCandidate[] = (j.rows || [])
      .filter(x => x.vessel && vesselScore(vessel, x.vessel) > 0)
      .map(x => ({
        source: x.source, terminal: x.terminal, vessel: x.vessel as string, terminal_voyage: x.terminal_voyage,
        carrier: x.carrier, berth: x.berth, cutoff: x.cutoff, eta: x.eta, etd: x.etd, status: x.status,
        collected_at: x.collected_at,
      }))
    return { rows }
  } catch {
    return { rows: [], error: '스케줄 서버에 연결하지 못했습니다.' }
  }
}

/** 모선명 여러 개를 API 한 번(POST /api/schedule/batch)으로 조회. 정규화한 모선명 → 후보 목록. */
export async function fetchCandidatesBatch(
  names: string[],
): Promise<{ byKey: Record<string, TerminalCandidate[]>; error?: string }> {
  const base = process.env.TERMINAL_API_BASE
  const key = process.env.TERMINAL_API_KEY
  if (!base || !key) return { byKey: {}, error: 'TERMINAL_API_BASE / TERMINAL_API_KEY 환경변수가 설정되지 않았습니다.' }

  const uniq = new Map<string, string>()
  for (const n of names) { const k = normVessel(n); if (k && !uniq.has(k)) uniq.set(k, n) }
  if (uniq.size === 0) return { byKey: {} }

  const now = new Date()
  const from = new Date(now); from.setDate(from.getDate() - 14)
  const to = new Date(now); to.setDate(to.getDate() + 150)

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/schedule/batch`, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: [...uniq.values()], from: ymd(from), to: ymd(to), field: 'etd' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(25000),
    })
    if (!r.ok) return { byKey: {}, error: `스케줄 서버 응답 오류 (${r.status})` }
    const j = (await r.json()) as { rows: ApiRow[] }
    const byKey: Record<string, TerminalCandidate[]> = {}
    for (const [k, name] of uniq) byKey[k] = []
    for (const x of j.rows || []) {
      if (!x.vessel) continue
      const tv = normVessel(x.vessel)
      for (const [k, name] of uniq) {
        if (vesselScore(name, x.vessel) > 0 || tv === k) {
          byKey[k].push({
            source: x.source, terminal: x.terminal, vessel: x.vessel, terminal_voyage: x.terminal_voyage,
            carrier: x.carrier, berth: x.berth, cutoff: x.cutoff, eta: x.eta, etd: x.etd, status: x.status,
            collected_at: x.collected_at,
          })
        }
      }
    }
    return { byKey }
  } catch {
    return { byKey: {}, error: '스케줄 서버에 연결하지 못했습니다.' }
  }
}
