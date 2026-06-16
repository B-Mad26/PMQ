import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// Stripe → us. This is the ONLY trusted source of "the user paid".
// Signature is verified against the raw body so the event can't be forged.
export async function POST(request) {
  if (!stripe || !supabaseAdmin) {
    return new Response("Payments not configured.", { status: 503 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = request.headers.get("stripe-signature");
  const body = await request.text(); // raw body — required for signature check

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    return new Response(`Webhook signature verification failed: ${e.message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const userId = s.metadata?.user_id || s.client_reference_id;
    if (userId && s.payment_status === "paid") {
      await grantEntitlement(userId, s.id);
    }
  }

  return Response.json({ received: true });
}

// Service-role writes — bypass RLS. Idempotent on (user_id, product).
async function grantEntitlement(userId, sessionId) {
  await supabaseAdmin.from("entitlements").upsert(
    {
      user_id: userId,
      product: "certification_track",
      source: "stripe",
      reference: sessionId,
      active: true,
    },
    { onConflict: "user_id,product" }
  );
  // Denormalized fast-read flag (only the service role may set this once the guard trigger is applied).
  await supabaseAdmin.from("profiles").update({ premium: true }).eq("id", userId);
}
