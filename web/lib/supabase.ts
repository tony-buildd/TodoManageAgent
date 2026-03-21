import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Supabase client — lazy-cached singleton (client-side safe)
// ---------------------------------------------------------------------------

let cachedClient: SupabaseClient | null = null;

/**
 * Return a shared Supabase client instance. The client is created once on
 * first call and reused for the lifetime of the page/module.
 *
 * Throws when the required environment variables are missing so callers get
 * an explicit error instead of a silent failure.
 */
export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  cachedClient = createClient(url, key);
  return cachedClient;
}
