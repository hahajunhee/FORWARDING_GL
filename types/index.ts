export interface BookingEntry {
  no: string
  ctr_type: string
  ctr_qty: number
  ci?: string     // (구버전 호환) 첫 번째 C/I
  cis?: string[]  // C/I 번호 목록 (부킹번호당 여러 개 가능, 서류마감 후 입력)
}

export interface ColumnDefinition {
  id: string
  key: string
  label: string
  description: string
  display_order: number
  created_at: string
}

export interface TableStyle {
  cellBorderColor: string
  cellBorderWidth: number
  groupBorderColor: string
  groupBorderWidth: number
}

export const DEFAULT_TABLE_STYLE: TableStyle = {
  cellBorderColor: '#d1d5db',
  cellBorderWidth: 1,
  groupBorderColor: '#6b7280',
  groupBorderWidth: 2,
}

export interface VesselPrefs {
  order?: string[]
  visible?: string[] | null
}

export interface Profile {
  id: string
  email: string
  name: string
  column_order: string[] | null
  pinned_columns: string[] | null
  vessel_prefs?: VesselPrefs | null
  doc_template: string | null
  color: string | null
  region: string | null
  customers: string | null
  is_active: boolean | null
  table_style: TableStyle | null
  created_at: string
}

export interface Booking {
  id: string
  seq_no: number
  booking_no: string
  final_destination: string
  discharge_port: string
  carrier: string
  vessel_name: string
  voyage: string
  secured_space: string
  mqc: string
  customer_doc_handler: string
  forwarder_handler_id: string | null
  forwarder_handler?: Profile
  doc_cutoff_date: string | null
  proforma_etd: string | null
  updated_etd: string | null
  updated_etd_prev: string | null
  eta: string | null
  qty_20_normal: number
  qty_20_dg: number
  qty_20_reefer: number
  qty_40_normal: number
  qty_40_dg: number
  qty_40_reefer: number
  con_pickup_qty: number
  alloc_qty: number | null
  is_closed?: boolean | null
  ci_qty?: string | null    // CI_수량 (엑셀 업로드로 자동 입력)
  ci_dest?: string | null   // CI_도착지
  ci_vessel?: string | null // CI_모선명
  etd_history?: Record<string, string> | null // 기준일별 ETD 스냅샷 (확보선복취합)
  remarks: string
  booking_entries: BookingEntry[] | null
  extra_data: Record<string, string> | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface BookingFormData {
  booking_no: string
  final_destination: string
  discharge_port: string
  carrier: string
  vessel_name: string
  secured_space: string
  mqc: string
  customer_doc_handler: string
  forwarder_handler_id: string
  doc_cutoff_date: string
  proforma_etd: string
  updated_etd: string
  eta: string
  qty_20_normal: number
  qty_20_dg: number
  qty_20_reefer: number
  qty_40_normal: number
  qty_40_dg: number
  qty_40_reefer: number
  remarks: string
}


// 주요 스케줄(new) — 최종도착지 매핑 그룹
// 서로 다른 최종도착지를 하나의 표시명으로 묶어 병합 표시한다.
export interface ScheduleDestGroup {
  label: string      // 표시명 (줄바꿈 가능: "ONTARIO(LA)\nJEFFERSON(LA)")
  members: string[]  // 포함되는 최종도착지 원본값
}

export interface CustomList {
  id: string
  user_id: string
  list_type: 'destination' | 'port' | 'carrier'
  name: string
  color: string | null
  sort_order: number
  created_at: string
}

export const DEFAULT_COLUMN_ORDER = [
  'seq_no',
  'booking_no',
  'final_destination',
  'discharge_port',
  'carrier',
  'vessel_name',
  'voyage',
  'secured_space',
  'mqc',
  'customer_doc_handler',
  'forwarder_handler',
  'handler_region',
  'handler_customers',
  'doc_cutoff_date',
  'proforma_etd',
  'updated_etd',
  'eta',
  'containers',
  'final_qty',
  'con_pickup_qty',
  'remarks',
  'week_no',
  'is_closed',
]

export const DEFAULT_PINNED_COLUMNS = ['forwarder_handler', 'discharge_port', 'final_destination']

export const COLUMN_LABELS: Record<string, string> = {
  seq_no:               '고유번호',
  booking_no:           '부킹번호',
  final_destination:    '최종도착지',
  discharge_port:       '양하항',
  carrier:              '선사',
  vessel_name:          '모선명',
  voyage:               'VOYAGE',
  secured_space:        '확보선복',
  mqc:                  'MQC',
  customer_doc_handler: '고객사 서류',
  forwarder_handler:    '포워더 담당',
  handler_region:       '담당지역',
  handler_customers:    '담당고객사',
  doc_cutoff_date:      '서류마감',
  proforma_etd:         'PROFORMA ETD',
  updated_etd:          'UPDATED ETD',
  eta:                  'ETA',
  containers:           '컨테이너',
  final_qty:            '최종수량',
  con_pickup_qty:       '컨픽업수량',
  remarks:              '비고',
  is_closed:            '마감',
}

export const CARRIERS = [
  'MSC',
  'EVERGREEN',
  'COSCO',
  'ONE',
  'HMM',
  'YANG MING',
  'MAERSK',
  'CMA CGM',
  'HAPAG-LLOYD',
  'PIL',
  'WANHAI',
  'ZIM',
  '기타',
] as const

export const MAJOR_PORTS = [
  'BUSAN (KR)',
  'INCHEON (KR)',
  'GWANGYANG (KR)',
  'SHANGHAI (CN)',
  'NINGBO (CN)',
  'QINGDAO (CN)',
  'TIANJIN (CN)',
  'SHENZHEN (CN)',
  'GUANGZHOU (CN)',
  'XIAMEN (CN)',
  'SINGAPORE (SG)',
  'PORT KLANG (MY)',
  'TANJUNG PELEPAS (MY)',
  'LAEM CHABANG (TH)',
  'HO CHI MINH (VN)',
  'HAIPHONG (VN)',
  'JAKARTA (ID)',
  'SURABAYA (ID)',
  'MANILA (PH)',
  'TOKYO (JP)',
  'YOKOHAMA (JP)',
  'OSAKA (JP)',
  'KOBE (JP)',
  'NAGOYA (JP)',
  'DUBAI/JEBEL ALI (AE)',
  'NHAVA SHEVA (IN)',
  'MUNDRA (IN)',
  'CHENNAI (IN)',
  'HAMBURG (DE)',
  'ROTTERDAM (NL)',
  'ANTWERP (BE)',
  'FELIXSTOWE (GB)',
  'BARCELONA (ES)',
  'GENOA (IT)',
  'PIRAEUS (GR)',
  'LOS ANGELES (US)',
  'LONG BEACH (US)',
  'NEW YORK (US)',
  'SAVANNAH (US)',
  'SEATTLE (US)',
  'VANCOUVER (CA)',
  'SYDNEY (AU)',
  'MELBOURNE (AU)',
  'AUCKLAND (NZ)',
]

export const DEFAULT_DESTINATIONS = [
  'TORONTO',
  'MONTREAL',
  'VANCOUVER',
  'NEW YORK',
  'LOS ANGELES',
  'CHICAGO',
  'DALLAS',
  'ATLANTA',
  'SEATTLE',
  'ROTTERDAM',
  'HAMBURG',
  'LONDON',
  'AMSTERDAM',
  'FRANKFURT',
  'PARIS',
  'MILAN',
  'BARCELONA',
  'ISTANBUL',
  'SYDNEY',
  'MELBOURNE',
  'AUCKLAND',
  'DUBAI',
  'RIYADH',
  'JEDDAH',
  'MUMBAI',
  'DELHI',
  'TOKYO',
  'OSAKA',
  'NAGOYA',
  'SINGAPORE',
  'KUALA LUMPUR',
  'BANGKOK',
  'JAKARTA',
  'HO CHI MINH',
  'HANOI',
  'MANILA',
]
