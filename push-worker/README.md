# R&M News: breaking-news notifications (push server)

This is a small **Cloudflare Worker** on the **free plan**. It:

- stores the devices that turned on **Breaking news alerts** (Cloudflare KV, free tier);
- checks realtynmore.com every **10 minutes** and sends a notification for each new story. If more than 3 stories appear at once, it sends one summary instead.

It sends only what is already public on realtynmore.com: the title, a link inside the app and the featured image. On its first run it just records the latest post, so nobody gets a burst of old stories.

## One-time setup (company accounts only)

1. Create a free Cloudflare account with **desk@realtynmore.com** at <https://dash.cloudflare.com/sign-up>.
2. In this folder:

   ```bash
   npm install
   npx wrangler login                      # opens the browser: sign in as desk@realtynmore.com
   npx wrangler kv namespace create SUBS   # copy the printed id into wrangler.jsonc → kv_namespaces[0].id
   npx wrangler secret put VAPID_PRIVATE_KEY   # paste the value from .dev.vars (kept only on the build PC)
   npx wrangler deploy                     # prints the address, e.g. https://rnm-news-push.<name>.workers.dev
   ```

3. Put that address in `.github/workflows/deploy.yml` as `VITE_PUSH_API` and push. The app then shows **Settings ▸ Notifications** and a "Get breaking news alerts" card on Home.

## Keys

- `VAPID_PUBLIC_KEY` is in `wrangler.jsonc`. It's public by design.
- `VAPID_PRIVATE_KEY` is a Cloudflare secret. A local copy is in `.dev.vars`, which git ignores. If it's lost, generate a new pair. Readers then have to turn alerts on again.

## Free-plan limits (well above current needs)

| Resource | Free per day | Used |
|---|---|---|
| Worker requests | 100,000 | sign-ups plus 144 checks |
| KV reads | 100,000 | 1 per subscribed device per new story |
| KV writes / lists | 1,000 each | a few per new story and per sign-up |

Past a few thousand subscribed devices, move the storage to Cloudflare D1 (also free).

## Local testing

```bash
npm test                                    # encryption round-trip, VAPID signature, new-post logic
npx wrangler dev --test-scheduled           # local server on :8787, no Cloudflare account needed
curl "http://localhost:8787/__scheduled?cron=*/10+*+*+*+*"   # run the 10-minute check once
```

## Where notifications work

- Android (Chrome), Windows/Mac (Chrome, Edge, Firefox): yes.
- iPhone/iPad (iOS 16.4+): yes, **only after the app is added to the Home Screen**.
- The Capacitor APK: not yet, because Android's in-app browser doesn't support Web Push. That needs Firebase Cloud Messaging (also free) as a later step.
