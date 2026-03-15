# Protocol Validator - Magic Link Authentication

Magic link authentication with email whitelist. Session cookie lasts 1 hour.

## Whitelist Storage

The whitelist is stored in **KV** as a JSON array. This allows:

- **Admin API** – Add/remove emails without redeploying
- **Scalability** – No env var size limits
- **Fallback** – If KV is empty, falls back to `EMAIL_WHITELIST` env var (comma-separated)

### Managing the Whitelist

**Option 1: Admin API** (recommended)

Set `ADMIN_SECRET` in your env, then use the API:

```bash
# List all whitelisted emails
curl -H "X-Admin-Secret: your-secret" https://your-app.com/api/admin/whitelist

# Add an email
curl -X POST -H "X-Admin-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@company.com"}' \
  https://your-app.com/api/admin/whitelist

# Remove an email
curl -X DELETE -H "X-Admin-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@company.com"}' \
  https://your-app.com/api/admin/whitelist
```

**Option 2: Wrangler KV CLI**

```bash
# Set whitelist (replaces entire list)
wrangler kv:key put --binding AUTH_KV "whitelist:emails" '["alice@co.com","bob@co.com"]'

# View current whitelist
wrangler kv:key get --binding AUTH_KV "whitelist:emails"
```

**Option 3: Env var (initial setup only)**

Use `EMAIL_WHITELIST` as a fallback when KV is empty. Once you add emails via the Admin API or KV CLI, the KV store takes precedence.

## Setup

### 1. Create KV Namespace

```bash
# Production
wrangler kv namespace create AUTH_KV

# Development (optional, for local testing)
wrangler kv namespace create AUTH_KV --preview
```

Update `wrangler.json` with the returned IDs.

### 2. Configure Secrets

```bash
# Resend API key (from resend.com)
wrangler secret put RESEND_API_KEY

# App URL for magic links
wrangler secret put APP_URL

# Admin API secret (for managing whitelist)
wrangler secret put ADMIN_SECRET

# Optional: initial whitelist when KV is empty
wrangler secret put EMAIL_WHITELIST
```

### 3. Local Development

Create `.dev.vars` in the **protocol-validator** directory:

```
EMAIL_WHITELIST=your@email.com
RESEND_API_KEY=re_xxxxx
APP_URL=http://localhost:8787
ADMIN_SECRET=your-admin-secret
```

**Important:** Use `npm run start` (wrangler dev) to test auth.

**Whitelist behavior:** The session email is re-checked against the whitelist on every request. If you remove someone from the whitelist, they lose access immediately.

**Note:** Resend's `onboarding@resend.dev` sender works for testing. For production, verify your domain at resend.com/domains and update the `from` address in `app/lib/magic-link.ts`.

## Flow

1. User visits `/login` and enters email
2. If email is in whitelist (KV or env fallback), a magic link is sent via Resend
3. User clicks link → session cookie set (1 hour) → redirect to `/`
4. Non-whitelisted emails receive "not authorized" and no email is sent
