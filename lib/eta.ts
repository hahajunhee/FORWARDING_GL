// 선사 + 양하항 조합별 운송일수 → UPDATED ETD 변경 시 ETA 자동 계산
//  키 형식: "선사|양하항" (대문자). 선사만/양하항만 지정한 기본값도 지원한다.
export type TransitMap = Record<string, number>

const up = (v: string | null | undefined) => (v || '').trim().toUpperCase()

export function transitKey(carrier: string | null | undefined, port: string | null | undefined): string {
  return `${up(carrier)}|${up(port)}`
}

export function transitDaysFor(
  map: TransitMap | undefined,
  carrier: string | null | undefined,
  port: string | null | undefined,
): number | null {
  const m = map || {}
  const candidates = [
    transitKey(carrier, port),   // 선사 + 양하항
    transitKey(carrier, ''),     // 선사 공통
    transitKey('', port),        // 양하항 공통
  ]
  for (const k of candidates) {
    const v = m[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

export function addDaysIso(iso: string | null | undefined, days: number): string | null {
  if (!iso) return null
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// UPDATED ETD 기준 ETA 계산 (규칙이 없으면 null → 기존 ETA 유지)
export function calcEta(
  updatedEtd: string | null | undefined,
  carrier: string | null | undefined,
  port: string | null | undefined,
  map: TransitMap | undefined,
): string | null {
  const days = transitDaysFor(map, carrier, port)
  if (days === null) return null
  return addDaysIso(updatedEtd, days)
}

export function diffDaysIso(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null
  const pa = a.match(/^(\d{4})-(\d{2})-(\d{2})/), pb = b.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!pa || !pb) return null
  const da = new Date(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3])).getTime()
  const db = new Date(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3])).getTime()
  return Math.round((db - da) / 86400000)
}
