"use client";

import { supabase, isSupabaseConfigured } from "./supabaseClient";

// Maps between the app's `pmq_state` object and the Supabase tables.
// Everything is best-effort: on any error we log and return a fallback so the
// app keeps working from its localStorage cache.

const DEFAULT_MASTERY = { risk: 20, stake: 20, plan: 30, agile: 15, budget: 10 };

// Load the full game state for a signed-in user, shaped like `pmq_state`.
export async function loadRemoteState(userId) {
  if (!isSupabaseConfigured || !userId) return null;
  try {
    const [profileRes, progressRes, entRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase
        .from("progress")
        .select("scenario_id,title,points")
        .eq("user_id", userId)
        .order("solved_at", { ascending: true }),
      supabase
        .from("entitlements")
        .select("product,active")
        .eq("user_id", userId)
        .eq("active", true),
    ]);

    const p = profileRes.data;
    if (!p) return null;

    const premium =
      p.premium ||
      (entRes.data || []).some(
        (e) => e.product === "certification_track" && e.active
      );

    return {
      auth: { name: p.name, email: p.email },
      pmp: p.pmp ?? 0,
      level: p.level ?? 1,
      streak: p.streak ?? 0,
      score: p.score ?? 0,
      premium,
      certified: p.certified ?? false,
      badges: p.badges ?? [],
      mastery: p.mastery ?? { ...DEFAULT_MASTERY },
      solved: (progressRes.data || []).map((r) => r.scenario_id),
      log: (progressRes.data || []).map((r) => ({
        title: r.title,
        pts: r.points,
      })),
      missions: [],
    };
  } catch (e) {
    console.warn("[db] loadRemoteState failed:", e?.message || e);
    return null;
  }
}

// Persist the headline progression fields (the parts that live on `profiles`).
export async function saveProfile(userId, state) {
  if (!isSupabaseConfigured || !userId) return;
  try {
    await supabase
      .from("profiles")
      .update({
        name: state.auth?.name ?? null,
        email: state.auth?.email ?? null,
        pmp: state.pmp ?? 0,
        level: state.level ?? 1,
        streak: state.streak ?? 0,
        score: state.score ?? 0,
        premium: !!state.premium,
        certified: !!state.certified,
        badges: state.badges ?? [],
        mastery: state.mastery ?? DEFAULT_MASTERY,
      })
      .eq("id", userId);
  } catch (e) {
    console.warn("[db] saveProfile failed:", e?.message || e);
  }
}

// Upsert one solved scenario. Idempotent via the (user_id, scenario_id) unique.
export async function recordSolved(userId, { scenarioId, title, domain, points, firstTry }) {
  if (!isSupabaseConfigured || !userId) return;
  try {
    await supabase.from("progress").upsert(
      {
        user_id: userId,
        scenario_id: String(scenarioId),
        title: title ?? null,
        domain: domain ?? null,
        points: points ?? 0,
        first_try: firstTry ?? null,
      },
      { onConflict: "user_id,scenario_id", ignoreDuplicates: true }
    );
  } catch (e) {
    console.warn("[db] recordSolved failed:", e?.message || e);
  }
}

// Issue a certificate row; returns its shareable id (or null).
export async function issueCertificate(userId, recipient, score) {
  if (!isSupabaseConfigured || !userId) return null;
  try {
    const { data, error } = await supabase
      .from("certificates")
      .insert({ user_id: userId, recipient, score: score ?? null })
      .select("id")
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (e) {
    console.warn("[db] issueCertificate failed:", e?.message || e);
    return null;
  }
}
