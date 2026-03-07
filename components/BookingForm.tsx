'use client'

import { useState, useTransition } from 'react'
import type { Booking, BookingFormData, Profile } from '@/types'
import { CARRIERS, MAJOR_PORTS } from '@/types'
import { createBooking, updateBooking } from '@/app/bookings/actions'

interface BookingFormProps {
  mode: 'create' | 'edit'
  booking?: Booking
  profiles: Profile[]
  currentUserId: string
}

type CtrKey = 'qty_20_normal' | 'qty_20_dg' | 'qty_20_reefer' | 'qty_40_normal' | 'qty_40_dg' | 'qty_40_reefer'
const CTR_FIELDS: { key: CtrKey; label: string }[] = [
  { key: 'qty_20_normal', label: '20ft 일반' }, { key: 'qty_40_normal', label: '40ft 일반' },
  { key: 'qty_20_dg',     label: '20ft DG'   }, { key: 'qty_40_dg',     label: '40ft DG'   },
  { key: 'qty_20_reefer', label: '20ft 리퍼' }, { key: 'qty_40_reefer', label: '40ft 리퍼' },
]

const EMPTY: BookingFormData = {
  booking_no: '', final_destination: '', discharge_port: '', carrier: '', vessel_name: '',
  secured_space: '', mqc: '', customer_doc_handler: '', forwarder_handler_id: '',
  doc_cutoff_date: '', proforma_etd: '', updated_etd: '', eta: '',
  qty_20_normal: 0, qty_20_dg: 0, qty_20_reefer: 0,
  qty_40_normal: 0, qty_40_dg: 0, qty_40_reefer: 0, remarks: '',
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  )
}

export default function BookingForm({ mode, booking, profiles, currentUserId }: BookingFormProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<BookingFormData>(() => {
    if (mode === 'edit' && booking) {
      return {
        booking_no: booking.booking_no || '',
        final_destination: booking.final_destination || '',
        discharge_port: booking.discharge_port || '',
        carrier: booking.carrier || '',
        vessel_name: booking.vessel_name || '',
        secured_space: booking.secured_space || '',
        mqc: booking.mqc || '',
        customer_doc_handler: booking.customer_doc_handler || '',
        forwarder_handler_id: booking.forwarder_handler_id || '',
        doc_cutoff_date: booking.doc_cutoff_date || '',
        proforma_etd: booking.proforma_etd || '',
        updated_etd: booking.updated_etd || '',
        eta: booking.eta || '',
        qty_20_normal: booking.qty_20_normal || 0,
        qty_20_dg: booking.qty_20_dg || 0,
        qty_20_reefer: booking.qty_20_reefer || 0,
        qty_40_normal: booking.qty_40_normal || 0,
        qty_40_dg: booking.qty_40_dg || 0,
        qty_40_reefer: booking.qty_40_reefer || 0,
        remarks: booking.remarks || '',
      }
    }
    return { ...EMPTY, forwarder_handler_id: currentUserId }
  })

  const set = (key: keyof BookingFormData, value: string | number) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.booking_no.trim()) { setError('부킹번호를 입력해주세요.'); return }
    setError(null)
    startTransition(async () => {
      if (mode === 'create') {
        const result = await createBooking(form)
        if (result?.error) setError(result.error)
      } else if (booking) {
        const result = await updateBooking(booking.id, form)
        if (result?.error) setError(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FieldGroup title="기본 정보">
        <div className="md:col-span-2">
          <label className="label">부킹번호 *</label>
          <input type="text" value={form.booking_no} onChange={e => set('booking_no', e.target.value)}
            placeholder="예: MSCU1234567" required className="input-field font-mono" />
        </div>
        <div>
          <label className="label">담당선사</label>
          <select value={form.carrier} onChange={e => set('carrier', e.target.value)} className="input-field">
            <option value="">선택</option>
            {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">모선명</label>
          <input type="text" value={form.vessel_name} onChange={e => set('vessel_name', e.target.value)}
            placeholder="예: MSC MERAVIGLIA" className="input-field uppercase" />
        </div>
        <div>
          <label className="label">양하항</label>
          <input type="text" value={form.discharge_port} onChange={e => set('discharge_port', e.target.value)}
            placeholder="예: HAMBURG (DE)" list="port-list" className="input-field" />
          <datalist id="port-list">{MAJOR_PORTS.map(p => <option key={p} value={p} />)}</datalist>
        </div>
        <div>
          <label className="label">최종도착지</label>
          <input type="text" value={form.final_destination} onChange={e => set('final_destination', e.target.value)}
            placeholder="예: MUNICH" className="input-field" />
        </div>
        <div>
          <label className="label">확보선복</label>
          <input type="text" value={form.secured_space} onChange={e => set('secured_space', e.target.value)}
            placeholder="확보된 선복 수량/조건" className="input-field" />
        </div>
        <div>
          <label className="label">MQC</label>
          <input type="text" value={form.mqc} onChange={e => set('mqc', e.target.value)}
            placeholder="최소 물량 약정" className="input-field" />
        </div>
      </FieldGroup>

      <FieldGroup title="담당자">
        <div>
          <label className="label">포워더 담당자</label>
          <select value={form.forwarder_handler_id} onChange={e => set('forwarder_handler_id', e.target.value)} className="input-field">
            <option value="">선택 안 함</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}
          </select>
        </div>
        <div>
          <label className="label">고객사 서류담당자</label>
          <input type="text" value={form.customer_doc_handler} onChange={e => set('customer_doc_handler', e.target.value)}
            placeholder="예: 김철수 팀장" className="input-field" />
        </div>
      </FieldGroup>

      <FieldGroup title="일정">
        <div>
          <label className="label">서류마감일</label>
          <input type="date" value={form.doc_cutoff_date} onChange={e => set('doc_cutoff_date', e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="label">예정출항일 (Proforma ETD) <span className="text-xs text-gray-400">부킹 당일 기준</span></label>
          <input type="date" value={form.proforma_etd} onChange={e => set('proforma_etd', e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="label">Updated ETD / ATD <span className="text-xs text-gray-400">실제 출항일</span></label>
          <input type="date" value={form.updated_etd} onChange={e => set('updated_etd', e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="label">예상도착일 (ETA)</label>
          <input type="date" value={form.eta} onChange={e => set('eta', e.target.value)} className="input-field" />
        </div>
      </FieldGroup>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">컨테이너 수량</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {CTR_FIELDS.map(({ key, label }) => (
            <div key={key}>
              <label className="label">{label}</label>
              <input type="number" min={0} max={99} value={form[key] || 0}
                onChange={e => set(key, parseInt(e.target.value) || 0)}
                className="input-field text-center" />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">비고</h3>
        <textarea value={form.remarks} onChange={e => set('remarks', e.target.value)}
          placeholder="특이사항, 메모 등을 입력하세요" rows={3} className="input-field resize-none" />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <a href="/bookings" className="btn-secondary">취소</a>
        <button type="submit" disabled={isPending} className="btn-primary flex items-center gap-2 disabled:opacity-50">
          {isPending ? (
            <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>저장 중...</>
          ) : (mode === 'create' ? '부킹 등록' : '수정 완료')}
        </button>
      </div>
    </form>
  )
}
