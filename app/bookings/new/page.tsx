import { createClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import BookingForm from '@/components/BookingForm'
import Link from 'next/link'
import type { Profile } from '@/types'

export default async function NewBookingPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profiles } = await supabase.from('profiles').select('*').order('name')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/bookings" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <h1 className="text-base font-bold text-gray-900">새 부킹 등록</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <BookingForm
          mode="create"
          profiles={(profiles || []) as Profile[]}
          currentUserId={user.id}
        />
      </main>
    </div>
  )
}
