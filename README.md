# Staaaaack

A mobile-first 15-word memory game. One game per UTC day.

The play screen is a dark mobile chrome: hamburger menu, yellow wordmark SVG, timer ring, stack pane, and a pullable 3×5 word sheet.

## Local

Needs Node 18+ and a Convex project (`npx convex dev` will create one).

```bash
npm install
npx convex dev
```

In a second terminal:

```bash
npm run dev
```

Open the URL Vite prints (port **4747**). Copy `.env.example` to `.env.local` if `VITE_CONVEX_URL` is missing; `npx convex dev` writes that value.

## Deploy Convex

```bash
npx convex deploy
```

Use the production deployment URL as `VITE_CONVEX_URL` for the static build.

## Deploy the static app to Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name=staaaaack
```

Or upload `dist` in the Cloudflare dashboard. Set `VITE_CONVEX_URL` in the Pages project so the build can talk to Convex. A GitHub mirror is not required.

## Play

- Claim a handle (3–16 `a-zA-Z0-9_`) and a passphrase (6+). New browser: sign in again.
- Today’s 15 words come from the server. Lists loop after day 99.
- One 30s budget for the whole run. It ticks in every phase. Each correct word adds +1s.
- After the computer adds, the word sheet collapses. Pull it back up when you’ve memorized, then rebuild.
- After 15, the same list loops and score doubles (15, 30, 60, …).
- One submitted run per player per UTC day. After that: See board / Back tomorrow.
- The hamburger opens Leaderboard (global top 50), Feedback, and Sign out.
