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

- Sign in with a handle (3–16 `a-zA-Z0-9_`) and password (6+), or switch to Sign up. New browser: sign in again.
- First play shows a six-slide how-to (including Tutorial), then a guided 5-word run with highlights and tips. That tutorial is not skippable for new accounts. Open the how-to again from How to play in the hamburger.
- After the tutorial, Play starts today’s ranked 15-word run.
- `/playtest` is unranked and replayable. Use the Tutorial menu toggle to force the carousel + guided run; default is Off.
- Today’s 15 words come from the server. Lists loop after day 99.
- One 60s budget for the whole run. It ticks in every phase. Each correct word adds +3s.
- After the computer adds, the word sheet collapses. Pull it back up when you’ve memorized, then rebuild.
- After 15, the same list loops and score doubles (15, 30, 60, …).
- One submitted run per player per UTC day. After that: See board / Back tomorrow.
- The hamburger opens Leaderboard (global top 50), Feedback, and Sign out.
