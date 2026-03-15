# Deploying Protocol Validator to Production

## Prerequisites

- Cloudflare account
- Wrangler CLI (`npm install -g wrangler` or use `pnpm exec wrangler`)
- Logged in: `wrangler login`

## Step 1: Create KV Namespace

```bash
cd protocol-validator

# Create production KV namespace
wrangler kv namespace create AUTH_KV
```

You'll get output like:
```
Add the following to your wrangler.json:
{ "binding": "AUTH_KV", "id": "abc123..." }
```

Update `wrangler.json` — replace `REPLACE_WITH_KV_NAMESPACE_ID` with the returned `id`.

## Step 2: Set Secrets

```bash
# Required for magic link emails
wrangler secret put RESEND_API_KEY

# Your production URL (e.g. https://protocol-validator.yourdomain.com)
wrangler secret put APP_URL

# For Admin API (managing whitelist)
wrangler secret put ADMIN_SECRET

# Optional: initial whitelist when KV is empty
wrangler secret put EMAIL_WHITELIST
```

When prompted, enter each value. Use strong, random values for `ADMIN_SECRET` in production.

## Step 3: Resend Production Setup

1. Go to [resend.com/domains](https://resend.com/domains)
2. Add and verify your domain (e.g. `yourdomain.com`)
3. Update `app/lib/magic-link.ts` — change the `from` address from `onboarding@resend.dev` to your verified domain (e.g. `noreply@yourdomain.com`)

## Step 4: Build and Deploy

```bash
# Build the app
pnpm run build

# Deploy to Cloudflare Workers
pnpm run deploy
```

Or in one step:
```bash
pnpm run build && pnpm run deploy
```

## Step 5: Configure Custom Domain (Optional)

1. In [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → your worker
2. Go to **Settings** → **Triggers** → **Custom Domains**
3. Add your domain (e.g. `protocol-validator.yourdomain.com`)

## Step 6: Seed the Whitelist

After first deploy, add emails to the whitelist:

```bash
# Via Admin API (use your production URL)
curl -X POST -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@yourcompany.com"}' \
  https://your-worker.workers.dev/api/admin/whitelist

# Or via KV CLI
wrangler kv:key put --binding AUTH_KV "whitelist:emails" '["admin@yourcompany.com"]'
```

## Checklist

- [ ] KV namespace created and ID in `wrangler.json`
- [ ] `RESEND_API_KEY` secret set
- [ ] `APP_URL` secret set (production URL)
- [ ] `ADMIN_SECRET` secret set
- [ ] Resend domain verified; `from` address updated in code
- [ ] Build succeeds
- [ ] Deploy succeeds
- [ ] Whitelist seeded with at least one email
- [ ] Magic link flow tested end-to-end
