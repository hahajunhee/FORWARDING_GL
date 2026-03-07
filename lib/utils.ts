import { format, differenceInCalendarDays, parseISO, isValid } from 'date-fns'

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return '-'
    return format(date, 'MM/dd')
  } catch {
    return '-'
  }
}

export function formatDateFull(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return '-'
    return format(date, 'yyyy-MM-dd')
  } catch {
    return '-'
  }
}

/** 서류마감일 기준 긴박도 색상 클래스 반환 */
export function getDocCutoffClass(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return ''
    const daysLeft = differenceInCalendarDays(date, new Date())
    if (daysLeft < 0) return 'bg-gray-100 text-gray-400'
    if (daysLeft <= 3) return 'bg-red-100 text-red-700 font-semibold'
    if (daysLeft <= 7) return 'bg-yellow-100 text-yellow-700'
    return ''
  } catch {
    return ''
  }
}

/** D-n 라벨 반환 */
export function getDaysLabel(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return ''
    const daysLeft = differenceInCalendarDays(date, new Date())
    if (daysLeft < 0) return `D+${Math.abs(daysLeft)}`
    if (daysLeft === 0) return 'D-day'
    return `D-${daysLeft}`
  } catch {
    return ''
  }
}

export function formatExcelDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return ''
    return format(date, 'yyyy-MM-dd')
  } catch {
    return ''
  }
}
