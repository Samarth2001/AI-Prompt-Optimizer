### AI Prompt Optimizer

Enhances user prompts on popular AI chat sites via a Chrome extension backed by a Cloudflare Worker. Secure by default with server-side system prompt injection, per-user rate limiting, and optional BYOK.

### What’s included
- One-click prompt enhancement across Claude, ChatGPT, Gemini, Grok, Perplexity
- Cloudflare Worker API (Hono) with strict CORS and JWT auth
- Durable Objects for daily rate limits, token gating, and usage aggregation
- Cloudflare Turnstile for human verification
- BYOK mode with client-side AES-GCM encryption for stored keys

### Chrome Web Store
- Install: [Chrome Web Store](https://chromewebstore.google.com/detail/prompt-enhancer/jcnkcglepjnmblgdeeloojnbiaopammh)
### Prerequisites
- Node.js 18+ and npm
- Cloudflare account and Wrangler CLI v4+
- Google Chrome 102+

### Quick start
1) Clone and install
```bash
git clone <this-repo-url>
cd "AI Prompt Optimizer"
cd api && npm install
```
2) Authenticate and configure
```bash
npx wrangler login
```
- In `api/wrangler.toml`, set `ALLOWED_ORIGINS` to include your extension id (e.g., `chrome-extension://<your-id>`).

3) Set required secrets
```bash
cd api
wrangler secret put OPENROUTER_API_KEY
wrangler secret put JWT_SECRET
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put SYSTEM_PROMPT
```

4) Deploy the Worker
```bash
cd api
wrangler deploy
```

5) Load the Chrome extension
- Visit `chrome://extensions`, toggle Developer mode, click “Load unpacked”, select the repo root.
- Confirm host permissions include the Worker URL.

6) Use
- Open a supported site, click the Enhance button to optimize your prompt.
- Open the popup to switch between Proxy and BYOK modes and view usage.

### Cloudflare architecture
- Worker (API): `api/src/index.ts` (Hono)
  - Endpoints
    - `POST /api/token` – verify Turnstile and issue JWT
    - `GET  /api/config` – return client config (rate limit, model, hosts)
    - `GET  /api/ratelimit` – peek current limits
    - `GET  /api/usage` – per-user usage stats
    - `POST /api/enhance` – proxy enhancement using server key
    - `POST /api/enhance/byok` – enhancement using user-provided key
    - `GET  /turnstile`, `GET /turnstile-embed` – Turnstile flows
  - Security
    - CORS allowlist: `ALLOWED_ORIGINS` with the extension id
    - JWT auth for protected routes
    - Server-side system prompt injection (never shipped to clients)
    - Payload validation (zod), payload size caps, timeouts
- Durable Objects
  - `RateLimiter` – per-user+IP daily allowance (default 100/day)
  - `TokenGate` – IP-based anti-abuse backoff while fetching JWT
  - `UsageAggregator` – daily/monthly/total counters per user
- Config via Wrangler
  - `api/wrangler.toml` defines DO bindings and non-secret vars
  - Secrets are set with Wrangler and never committed

### Secrets and variables
- Secrets (set via Wrangler; not in git)
  - `OPENROUTER_API_KEY` – upstream LLM key (proxy mode)
  - `JWT_SECRET` – Worker JWT signing key
  - `TURNSTILE_SECRET_KEY` – Turnstile private key
  - `SYSTEM_PROMPT` – stored as a secret or bound KV; injected server-side
- Non-secret vars (in `api/wrangler.toml`)
  - `TURNSTILE_SITE_KEY` (public), `ALLOWED_ORIGINS`, `ALLOWED_HOSTS`, `RATE_LIMIT_PER_DAY`, `DEFAULT_MODEL`, etc.

Set secrets
```bash
cd api
wrangler secret put OPENROUTER_API_KEY
wrangler secret put JWT_SECRET
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put SYSTEM_PROMPT
```

### Deploy (Cloudflare Worker)
```bash
cd api
npm install
wrangler deploy
```

### Chrome extension
- Load unpacked from the repo root: `manifest.json`, `service-worker.js`, `content.js`, `popup.html`, `popup.js`
- Default mode uses proxy (free daily quota). BYOK mode stores the user’s OpenRouter key encrypted with Web Crypto (AES-GCM) and optional passphrase.

### Using BYOK mode
1) Open the extension popup
2) Click “+ New”, enter a name, your OpenRouter key, and a passphrase, then Save
3) Select the saved key, enter your passphrase, click Unlock
4) Toggle mode to BYOK

### Security model (high level)
- Keys and prompts are never persisted server-side beyond processing
- System prompt lives only on the server via secret/kv binding
- Rate limiting and gating enforced with Durable Objects at the edge
- Extension storage is encrypted (AES-GCM) and supports passphrase mode

### Project structure
- Root (extension): manifest and UI (`manifest.json`, `service-worker.js`, `content.js`, `popup.html`, `popup.js`, `icons/`, `config/`, `services/`, `utils/`)
- `api/` (Cloudflare Worker): Hono app, Durable Objects, Wrangler config

### Local development
- Do not commit secrets; use `wrangler secret put` for all sensitive values
- Recommended: run `wrangler dev --remote` in `api/` for parity with edge runtime
- Load the extension as “unpacked” during development and reload after changes

### License and attribution
- MIT License. Not affiliated with OpenAI, Anthropic, Google, X, or any AI provider