"use client";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Surfaced as a friendly console warning rather than a hard crash so the app
// still renders (and falls back to localStorage) before the keys are wired up.
const configured =
  !!url && !!anonKey && anonKey !== "PASTE_ANON_PUBLIC_KEY_HERE";

if (!configured && typeof window !== "undefined") {
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set in .env.local — " +
      "running in offline (localStorage-only) mode."
  );
}

export const isSupabaseConfigured = configured;

export const supabase = configured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
