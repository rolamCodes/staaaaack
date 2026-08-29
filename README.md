# Staaaaack

A mobile-first 15-word memory game. One game per day with themed word lists.

## About

Staaaaack is a daily memory challenge where you:
- Add words to your stack (player taps, computer adds one more)
- Rebuild your stack oldest-first after the grid shuffles
- Double your score with each successful pass in endurance mode
- Compete on the global leaderboard

One timer runs throughout each round—ADD and REBUILD share the same clock. No untimed study phase.

## Tech Stack

- **Frontend**: Vanilla TypeScript + Vite
- **Backend**: Convex (database + serverless functions)
- **Deployment**: Cloudflare Pages (static hosting)
- **Auth**: Handle + passphrase (PBKDF2 hashing)

## Local Development

### Prerequisites

- Node.js 18+ and npm
- A Convex account (free at [convex.dev](https://convex.dev))

### Setup

1. **Clone and install dependencies**:
   ```bash
   git clone <your-repo-url>
   cd staaaaack
   npm install
   ```

2. **Initialize Convex**:
   ```bash
   npx convex dev
   ```
   
   This will:
   - Create a new Convex project (or link to existing)
   - Generate `.env.local` with your `VITE_CONVEX_URL`
   - Start watching your Convex functions

3. **Start the dev server** (in a new terminal):
   ```bash
   npm run dev
   ```

4. **Open the app**:
   - Visit `http://localhost:5173` (or the port Vite shows)
   - Create a handle to start playing

### Development Workflow

Keep both processes running:
- `npx convex dev` watches Convex functions
- `npm run dev` runs the Vite dev server

Hot reload works for both frontend and backend changes.

## Production Deployment

### 1. Deploy Convex Backend

```bash
npx convex deploy --cmd 'npm run build'
```

This deploys your Convex functions and schema to production. Save the production `CONVEX_DEPLOYMENT_URL`.

### 2. Build Static Site

```bash
npm run build
```

This creates optimized production files in `./dist`.

### 3. Deploy to Cloudflare Pages

#### Option A: Wrangler CLI

```bash
npm install -g wrangler
wrangler pages deploy dist --project-name=staaaaack
```

#### Option B: Cloudflare Dashboard

1. Go to [Cloudflare Pages](https://dash.cloudflare.com/pages)
2. Click "Create a project"
3. Connect your Git repository (or upload `dist` folder)
4. Build settings:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/`
5. Add environment variable:
   - **Name**: `VITE_CONVEX_URL`
   - **Value**: Your production Convex URL
6. Deploy!

#### Option C: Direct Upload (No Git Required)

```bash
# After running npm run build
npx wrangler pages deploy dist --project-name=staaaaack
```

### Environment Variables

Make sure `VITE_CONVEX_URL` points to your production Convex deployment in the Cloudflare Pages settings.

## Project Structure

```
staaaaack/
├── convex/              # Convex backend
│   ├── schema.ts        # Database schema
│   ├── lists.ts         # 100 daily themed word lists
│   ├── auth.ts          # Password hashing (Node.js actions)
│   ├── players.ts       # Auth functions
│   └── game.ts          # Game functions
├── src/
│   ├── main.ts          # Frontend application
│   └── style.css        # Styles
├── index.html           # HTML entry point
├── wrangler.toml        # Cloudflare Pages config
└── package.json
```

## Game Rules

- **One game per day**: Each UTC day brings a new themed word list
- **Timer bands**:
  - 1-5 words: 12 seconds
  - 6-10 words: 18 seconds
  - 11-15 words: 24 seconds
- **Endurance mode** (after clearing all 15):
  - Pass 1: 24s
  - Pass 2: 18s
  - Pass 3: 13s
  - Pass 4: 10s
  - Pass 5+: 8s
- **Scoring**: 15 points for the first pass, doubles each successful pass (15, 30, 60, 120, 240...)

## Database Schema

### players
- `handle`: Unique username (3-16 chars, alphanumeric + underscore)
- `passwordHash`: PBKDF2 hash
- `sessionTokenHash`: SHA-256 hash of session token
- `onboarded`: Boolean for first-time tutorial

### runs
- `playerId`: Reference to player
- `dayId`: YYYY-MM-DD string
- `score`: Final score (clamped to 15 * 2^12)
- `theme`: Theme of that day's list
- `finishedAt`: Timestamp

## Credits

Built with:
- [Convex](https://convex.dev) - Reactive backend platform
- [Vite](https://vitejs.dev) - Build tool
- [Cloudflare Pages](https://pages.cloudflare.com) - Hosting

## License

MIT
