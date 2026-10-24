# R&M News: RealtyNMore news app (PWA + Android)

A mobile-first, installable news app for **Realty & More**. It shows real published content only:

- **News, images, dates, categories and original links:** read-only from the public WordPress REST API at `https://realtynmore.com/wp-json/wp/v2/`.
- **Videos and podcasts:** the Realty & More YouTube channel's free RSS feeds (latest uploads, *R&M Podcasts & Teasers*, *R&M Podium*, *Realty Web Series*, *R&M 7th Anniversary*).

Nothing is invented, and nothing is ever written to the live website. The app only makes GET requests.

## Screens

Home · News (with category filters) · Categories · Search · Article reader (full text, Save, Share, "Read on website") · Videos · Podcasts · Saved (stored on the device, readable offline).

The app supports light and dark mode, a bottom tab bar on phones and a top navigation bar on desktop.

## Run it locally

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. During development, Vite fetches the YouTube feeds on the app's behalf (`/yt` proxy), because YouTube doesn't allow browsers to read them directly.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Unit tests for data mapping, feed parsing and HTML cleaning |
| `npm run build` | Saves the YouTube snapshot (`public/data/youtube.json`), type-checks and builds `dist/` with the service worker |
| `npm run preview` | Serves the production build at <http://localhost:4173> (test install and offline here) |
| `npm run icons` | Rebuilds PWA icons and logos from the brand files in `../interview-1014` |
| `npm run android:sync` | Builds and copies the app into the Android project (see [ANDROID.md](ANDROID.md)) |

## Offline and caching (service worker)

| What | Strategy | Limit |
|---|---|---|
| App shell (HTML, JS, CSS, Latin fonts, icons) | Precached | ~1 MB |
| News API responses | Network first, cached copy after 6 s or when offline | 150 responses, 5 days |
| Article images | Cache first | 250 images, 30 days |
| YouTube thumbnails | Cache first | 120, 14 days |
| `data/youtube.json` | Network first | 7 days |
| Saved articles | IndexedDB on the device (full text) | Until removed |

Only GET requests to these hosts are cached. When a new version is deployed, the app shows a "New version is ready · Reload" bar.

## Hosting (GitHub Pages, free) — not set up yet

`.github/workflows/deploy.yml` builds and publishes the app on every push to `main` and **every 30 minutes**, which also refreshes the YouTube video list.

1. Create a GitHub repository (Pages is free on public repositories) and push this folder to `main`.
2. In the repo, go to **Settings ▸ Pages ▸ Build and deployment ▸ Source** and choose **GitHub Actions**.
3. The app will be live at `https://<user>.github.io/<repo>/`. Phones can install it from there (HTTPS is required for installing).

Note: GitHub pauses scheduled workflows in a public repository after 60 days with no commits. Any push, or re-enabling the workflow in the **Actions** tab, restarts it.

## Project layout

```
src/lib/wp.ts           WordPress API client + curated category list
src/lib/youtubeFeed.ts  YouTube feed list and parser (shared with the build script)
src/lib/videos.ts       Picks the feed source per platform (dev proxy / Android direct / hosted JSON)
src/lib/sanitize.ts     Cleans article HTML (DOMPurify; only YouTube/Vimeo iframes allowed)
src/lib/saved.ts        Saved articles (IndexedDB)
src/pages/*             Screens
scripts/fetch-youtube.ts  Writes public/data/youtube.json (keeps the last good copy if YouTube fails)
android/                Capacitor Android project
```

## Known limits

- YouTube's free RSS feed only lists the **latest 15 videos** per channel or playlist. The app links to YouTube for older ones. Showing more would need the YouTube Data API (free quota, but needs an API key).
- The site's API doesn't expose author names (`/users` returns 401), so bylines aren't shown.
- The website's own "Videos" category hasn't had a new post since 2019, so Videos come from YouTube instead.
- Categories that are empty or haven't been used for years ("Budget 2015-16", "test", "ads", etc.) are hidden. Edit `CURATED_CATEGORIES` in `src/lib/wp.ts` to change the list.
