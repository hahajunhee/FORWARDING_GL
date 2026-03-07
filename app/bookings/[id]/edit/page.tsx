import { createClient } from '@/lib/supabase-server'
import { redirect, notFound } from 'next/navigation'
import BookingForm from '@/components/BookingForm'
import Link from 'next/link'
import type { Booking, Profile } from '@/types'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditBookingPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: booking }, { data: profiles }] = await Promise.all([
    supabase.from('bookings').select('*').eq('id', id).single(),
    supabase.from('profiles').select('*').order('name'),
  ])

  if (!booking) notFound()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/bookings" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-base font-bold text-gray-900">부킹 수정</h1>
            <p className="text-xs text-gray-500">{booking.booking_no}</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <BookingForm
          mode="edit"
          booking={booking as Booking}
          profiles={(profiles || []) as Profile[]}
          currentUserId={user.id}
        />
      </main>
    </div>
  )
}
