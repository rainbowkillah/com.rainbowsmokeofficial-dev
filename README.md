# RainbowSmokeOfficial.com

Mr. RainbowSmoke’s multi-surface Cloudflare Worker deploy — rainbow-themed, fan-facing, and Cloudflare-native.

## Highlights
- Single Worker powers the entire site: static assets, HTML pages, APIs, and automation.
- Durable Object counts visits per page and updates asynchronously for live metrics.
- Contact form writes directly into Cloudflare D1 (and returns MembersOnly access codes).
- KV stores signed-in sessions for the NSFW area.
- R2 supplies media for both the public gallery (`gallery/` prefix) and MembersOnly content (`nsfw/` prefix).
- Worker AI + AI Gateway deliver an on-site AI concierge branded “Ask RainbowSmoke”.
- Microsoft Customer Connect chat widget is wired into every primary page.

## Project Layout
```
├── wrangler.toml              # Cloudflare bindings & config
├── src/worker.js              # Worker entry (routes, APIs, Durable Object)
├── public/                    # Static assets served via Workers Assets binding
│   ├── index.html ...         # Pages (home, about, contact, gallery, privacy, nsfw)
│   ├── styles/site.css
│   ├── scripts/main.js
│   └── assets/*.svg           # Rainbow-themed placeholders
├── migrations/0001_init.sql   # D1 schema for contact submissions
└── package.json               # Wrangler dev + deploy scripts
```

## Cloudflare Resource Checklist
| Resource | Binding | Notes |
|----------|---------|-------|
| Worker Assets | `ASSETS` | Serves everything in `/public` |
| KV Namespace | `SESSION_KV` | Stores signed-in NSFW sessions (`session:<uuid>`) |
| Durable Object | `VisitCounter` | Tracks per-page visit counts |
| D1 Database | `RAINBOW_DB` | Stores contact submissions & NSFW access codes |
| R2 Bucket | `rainbow-media` → `MEDIA_BUCKET` | Prefix `gallery/` for public, `nsfw/` for gated |
| Worker AI | `AI` (implicit) | Model defined in `AI_MODEL` env var |
| AI Gateway | `AI_GATEWAY_BASE_URL` + `AI_GATEWAY_TOKEN` | Routes Worker AI traffic through your gateway |

> Update `wrangler.toml` with the actual IDs/UUIDs from your Cloudflare dashboard. Secrets like `AI_GATEWAY_TOKEN` should be set via `wrangler secret put` (see below).

## Initial Setup
1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create resources (examples)**
   ```bash
   wrangler kv namespace create SESSION_KV
   wrangler d1 create rainbow_db
   wrangler r2 bucket create rainbow-media
   wrangler deployment create rainbowsmokeofficial
   ```

3. **Bind resources**
   - Update the generated IDs inside `wrangler.toml` (`SESSION_KV.id`, `RAINBOW_DB.database_id`, `MEDIA_BUCKET.bucket_name`, etc.).
   - If you change the bucket name or database name, keep bindings in sync.

4. **Run D1 migration**
   ```bash
   npm run d1:migrate
   ```

5. **Secrets & environment variables**
   ```bash
   wrangler secret put AI_GATEWAY_TOKEN
   wrangler secret put ACCESS_CODE_SALT        # optional override for stronger hashing salt
   ```
   - `AI_GATEWAY_BASE_URL` should follow `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>`.
   - `AI_MODEL` defaults to `@cf/meta/llama-3-8b-instruct`; tweak as desired.

## Local Development
```bash
npm run dev
```
- `wrangler dev` emulates KV, D1, R2, Durable Objects, and assets locally.
- Visit `http://127.0.0.1:8787` to browse the site.
- Console logs in the terminal help debug Worker + Durable Object activity.

## Deployment
```bash
npm run deploy
```
- Ensure every binding in `wrangler.toml` matches production resources.
- After deploy, upload gallery assets to R2, e.g.
  ```bash
  wrangler r2 object put rainbow-media/gallery/behind-the-scenes.jpg --file=./media/behind-the-scenes.jpg
  wrangler r2 object put rainbow-media/nsfw/teaser.mp4 --file=./media/nsfw/teaser.mp4 --content-type video/mp4
  ```

## Feature Notes
- **Visit Counter**: Each page increments its counter via a Durable Object (`VisitCounter`). Counts stream back to the homepage hero in real time.
- **Contact Form → D1**: Submissions insert into `contacts` with a generated access code. The response returns the code up-front; you can later flip `nsfw_access` to `0/1` or update codes directly with D1 queries.
- **MembersOnly Auth**: Login expects email + access code. Success writes a session token to KV and sets a secure, short-lived cookie. The NSFW page uses that cookie to gate R2 media.
- **R2 Media Flow**: Public gallery objects get short-lived signed URLs. NSFW objects are proxied through the Worker (`/media/nsfw/:key`) to keep them private.
- **AI Concierge**: `/api/ai/chat` forwards prompts to Worker AI through your AI Gateway. Responses appear in the “Ask RainbowSmoke” panel on the home page.
- **Live Chat**: Microsoft Customer Connect widget is embedded on every major page via the provided script tag.

## Extending the Experience
- **OBS/RTSP embeds**: Drop your player markup into `public/nsfw.html` (the notice block marks the spot).
- **Analytics & Audit**: Add more D1 tables (e.g., NSFW access audit logs) or log events to R2/Analytics Engine.
- **Email / Discord Webhooks**: Hook the contact submission handler to send notifications before returning the JSON response.
- **AI Personalization**: Store per-user preferences in KV and seed the Worker AI messages array for tailored answers.

## Security Checklist
- Rotate `ACCESS_CODE_SALT` periodically and store it only as a secret.
- Moderate who gets `nsfw_access = 1` inside D1.
- Serve the Worker over HTTPS (automatic with Cloudflare). Cookies are `Secure` + `HttpOnly` + `SameSite=Strict`.
- Keep R2 `nsfw/` assets private; never mark the bucket public.

## Troubleshooting
- **AI request fails**: Confirm the AI Gateway URL and token, and that the gateway routes to Worker AI.
- **Gallery empty**: Upload media to `gallery/` prefix or ensure the Worker has `Read` permissions on the bucket.
- **Visit counter stuck**: Reset Durable Object storage with `wrangler do storage delete --binding VisitCounter --class VisitCounter` during testing.
- **NSFW login loops**: Check that the submitted email exists in D1 and that the access code hash matches (hashing uses SHA-256 with your salt).

Glow on and keep iterating! 🚀🌈
