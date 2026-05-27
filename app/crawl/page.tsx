import { createClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import CrawlClient from './CrawlClient'

export const dynamic = 'force-dynamic'

export default async function CrawlPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <CrawlClient />
}
