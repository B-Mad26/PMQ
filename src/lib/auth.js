"use client";

import { supabase, isSupabaseConfigured } from "./supabaseClient";

// Thin wrappers around Supabase Auth. Each returns { data, error } so callers
// can branch without throwing. When Supabase isn't configured yet, they return
// a soft error so the UI can fall back to local-only mode.

const notConfigured = {
  data: null,
  error: { message: "Supabase is not configured yet." },
};

export async function signUp(name, email, password) {
  if (!isSupabaseConfigured) return notConfigured;
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
}

export async function signIn(email, password) {
  if (!isSupabaseConfigured) return notConfigured;
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  if (!isSupabaseConfigured) return { error: null };
  return supabase.auth.signOut();
}

export async function getSession() {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

// Subscribe to auth changes. Returns an unsubscribe fn.
export function onAuthChange(cb) {
  if (!isSupabaseConfigured) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session);
  });
  return () => data?.subscription?.unsubscribe();
}
