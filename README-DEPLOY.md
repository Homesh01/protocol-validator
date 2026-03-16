# Deploying Protocol Validator to Production

## Prerequisites

- Cloudflare account
- Wrangler CLI (`npm install -g wrangler` or use `pnpm exec wrangler`)
- Logged in: `wrangler login`

## Step 1: Create KV Namespace (Required before deploy)

**Option A: Via CLI**

```bash
cd protocol-validator
wrangler login   # if not already logged in
wrangler kv namespace create AUTH_KV
```

Copy the `id` from the output and replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.json`.

**Option B: Via Cloudflare Dashboard**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **KV**
2. Click **Create namespace**
3. Name it `AUTH_KV` (or any name)
4. Copy the **Namespace ID** from the list
5. In `wrangler.json`, replace `REPLACE_WITH_KV_NAMESPACE_ID` with that ID

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

# Required for production: verified domain sender (e.g. Protocol Validator <noreply@yourdomain.com>)
wrangler secret put MAGIC_LINK_FROM
```

When prompted, enter each value. Use strong, random values for `ADMIN_SECRET` in production.

## Step 3: Resend Production Setup

1. Go to [resend.com/domains](https://resend.com/domains)
2. Add and verify your domain (e.g. `yourdomain.com`)
3. Set the `MAGIC_LINK_FROM` secret with your verified domain address:
   ```bash
   wrangler secret put MAGIC_LINK_FROM
   # Enter: Protocol Validator <noreply@yourdomain.com>
   ```

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
- [ ] Resend domain verified; `MAGIC_LINK_FROM` secret set
- [ ] Build succeeds
- [ ] Deploy succeeds
- [ ] Whitelist seeded with at least one email
- [ ] Magic link flow tested end-to-end
