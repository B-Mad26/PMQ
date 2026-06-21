import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Captures B2B "for teams" interest. Service-role insert (bypasses RLS).
export async function POST(request) {
  if (!supabaseAdmin) {
    return Response.json({ error: "Not configured." }, { status: 503 });
  }
  let body = {};
  try { body = await request.json(); } catch {}
  const email = (body.email || "").toString().trim();
  const seats = (body.seats || "").toString().slice(0, 40);
  const company = (body.company || "").toString().slice(0, 120);
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }
  try {
    const { error } = await supabaseAdmin
      .from("team_leads")
      .insert({ email, seats, company, source: "landing" });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e?.message || "Could not save." }, { status: 500 });
  }
}
