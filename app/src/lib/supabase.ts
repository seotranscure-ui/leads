import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anon) {
  // Surfaced in the console + login screen if .env.local isn't set up yet.
  console.warn('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local')
}

export const supabase = createClient(url || 'http://localhost', anon || 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})

export const supabaseConfigured = Boolean(url && anon)
