export interface BookingEntry {
  no: string
  ctr_type: string
  ctr_qty: number
}

export interface ColumnDefinition {
  id: string
  key: string
  label: string
  description: string
  display_order: number
  created_at: string
}

export interface Profile {
  id: string
  email: string
  name: string
  column_order: string[] | null
  pinned_columns: string[] | null
  doc_template: string | null
  color: string | null
  region: string | null
  customers: string | null
  is_active: boolean | null
  created_at: string
}

export interface Booking {
  id: string
  booking_no: string
  final_destination: string
  discharge_port: string
  carrier: string
  vessel_name: string
  secured_space: string
  mqc: string
  customer_doc_handler: string
  forwarder_handler_id: string | null
  forwarder_handler?: Profile
  doc_cutoff_date: string | null
  proforma_etd: string | null
  updated_etd: string | null
  eta: string | null
  qty_20_normal: number
  qty_20_dg: number
  qty_20_reefer: number
  qty_40_normal: number
  qty_40_dg: number
  qty_40_reefer: number
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

export interface CustomList {
  id: string
  user_id: string
  list_type: 'destination' | 'port' | 'carrier'
  name: string
  sort_order: number
  created_at: string
}

export const DEFAULT_COLUMN_ORDER = [
  'booking_no',
  'final_destination',
  'discharge_port',
  'carrier',
  'vessel_name',
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
  'remarks',
]

export const DEFAULT_PINNED_COLUMNS = ['forwarder_handler', 'discharge_port', 'final_destination']

export const COLUMN_LABELS: Record<string, string> = {
  booking_no:           '부킹번호',
  final_destination:    '최종도착지',
  discharge_port:       '양하항',
  carrier:              '선사',
  vessel_name:          '모선명',
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
  remarks:              '비고',
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
