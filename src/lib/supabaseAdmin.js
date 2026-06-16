import { createClient } from "@supabase/supabase-js";

// SERVER-ONLY. Uses the service-role key, which bypasses RLS.
// Never import this from a client component or anything that ships to the browser.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin =
  url && serviceKey
    ? createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
