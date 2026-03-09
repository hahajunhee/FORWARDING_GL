import { createClient } from '@supabase/supabase-js'

// WARNING: This client bypasses RLS. Never import this in client components.
// SUPABASE_SERVICE_ROLE_KEY must never have the NEXT_PUBLIC_ prefix.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
