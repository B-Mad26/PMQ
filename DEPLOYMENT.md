# Deploying PM Sim Lab

Next.js 16 app → **Vercel** (zero-config). Two phases: a free **soft-launch** preview (payments off), then **production** (Stripe + domain).

---

## Phase 1 — Soft-launch (free `*.vercel.app`, payments disabled)

Everything works except paid checkout, which shows a graceful "certification opening soon" message until Stripe is wired.

### 1. Push the branch to GitHub
```bash
# from pmquest-app/
git remote add origin https://github.com/<you>/pmsimlab.git
git push -u origin feat/supabase-backend
```

### 2. Import to Vercel
- vercel.com → **Add New → Project** → import the repo.
- Framework preset: **Next.js** (auto-detected). Root dir: `./`. Leave build/output defaults.

### 3. Set Environment Variables (Vercel → Project → Settings → Environment Variables)
Copy these from your local `.env.local` — **do not commit them**:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tdpountkbnrwipjwwuru.supabase.co` | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_…` | public |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` | **server-only** — never `NEXT_PUBLIC` |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-app>.vercel.app` | set after first deploy gives you the URL |

(Leave the `STRIPE_*` vars unset for the preview — checkout will degrade gracefully.)

### 4. Configure Supabase Auth for the live URL
Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://<your-app>.vercel.app`
- **Redirect URLs** (allow-list): add `https://<your-app>.vercel.app/**`

Without this, email-confirmation and OAuth links point at `localhost` and break in production.

### 5. Redeploy & smoke-test
- Visit the site, sign up (check the confirmation email lands), sign in, solve a scenario, view a certificate, hit `/verify/<id>`.

---

## Phase 2 — Production (take real money)

1. **Register the domain** (`pmsimlab.com`) and add it in Vercel → Domains. Update `NEXT_PUBLIC_SITE_URL` to the apex domain, and add it to the Supabase redirect allow-list.
2. **Stripe**:
   - Add `STRIPE_SECRET_KEY` (start with `sk_test_…`; switch to `sk_live_…` only after testing).
   - Stripe dashboard → Developers → Webhooks → add endpoint `https://pmsimlab.com/api/stripe/webhook`, event `checkout.session.completed` → copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. **Apply the self-grant lockdown**: run `supabase/payments.sql` in the Supabase SQL editor. Do this **only after** Stripe works, since it makes premium grantable solely by the webhook.
4. **Test the full charge** with card `4242 4242 4242 4242` (test mode), confirm an `entitlements` row appears and premium unlocks.
5. Flip Stripe to live keys + a live webhook, and you're selling.

---

## Local development
```bash
npm run dev          # http://localhost:3000
# webhook testing:
stripe listen --forward-to localhost:3000/api/stripe/webhook   # prints whsec_… for STRIPE_WEBHOOK_SECRET
```

`.env*` is gitignored — keys never enter the repo.
