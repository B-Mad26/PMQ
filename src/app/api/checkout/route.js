import { stripe, CERT_PRICE_CENTS } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Creates a Stripe Checkout Session for the certification track.
// The user is identified from their Supabase access token (verified server-side),
// never from a client-supplied id — so the purchase can't be spoofed for someone else.
export async function POST(request) {
  if (!stripe || !supabaseAdmin) {
    return Response.json({ error: "Payments are not configured." }, { status: 503 });
  }

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user } = {}, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Already paid? Don't charge twice.
  const { data: existing } = await supabaseAdmin
    .from("entitlements")
    .select("id")
    .eq("user_id", user.id)
    .eq("product", "certification_track")
    .eq("active", true)
    .maybeSingle();
  if (existing) return Response.json({ alreadyOwned: true });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "PM Sim Lab — Certification Track",
              description: "Lifetime access · one-time payment",
            },
            unit_amount: CERT_PRICE_CENTS,
          },
          quantity: 1,
        },
      ],
      client_reference_id: user.id,
      metadata: { user_id: user.id, product: "certification_track" },
      customer_email: user.email,
      success_url: `${SITE}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/?checkout=cancel`,
    });
    return Response.json({ url: session.url });
  } catch (e) {
    return Response.json({ error: e?.message || "Checkout failed." }, { status: 500 });
  }
}
