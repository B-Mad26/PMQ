import Stripe from "stripe";

// SERVER-ONLY. The secret key must never reach the browser.
const key = process.env.STRIPE_SECRET_KEY;
const configured = !!key && key.startsWith("sk_") && !key.includes("PASTE");

export const stripe = configured ? new Stripe(key) : null;

export const CERT_PRICE_CENTS = 4900; // $49.00 one-time
