# AI Sphere

An interactive 3D map of the top AI influencers — explore who they are, what they do, what they think, and how they're connected.

## 🌐 Live Site

**[https://ai-sphere-indol.vercel.app/](https://ai-sphere-indol.vercel.app/)**

---

## 💡 Why I Built This

There are millions of pieces of AI news and information generated every second on X and LinkedIn — and for new users, it can get really overwhelming. To figure out which accounts were actually worth following, and to visualize what the AI community on X and LinkedIn actually looks like, I built this 3D interactive platform. It's a tool for anyone trying to navigate the AI space and find their footing in it.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite |
| 3D visualization | Three.js + react-force-graph-3d |
| AI (sentiment analysis + chatbot) | Google Gemini API |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| Hosting | Vercel |
| Data pipeline | Node.js + RapidAPI (X/Twitter) |

---

## 🧩 Details Panel (per-influencer)

Selecting any node in the graph pops open a details panel. Every row is also available in the GitHub Pages preview (`preview.html`) so the two experiences stay in sync.

| Row | Component | What it shows |
|---|---|---|
| 1 | `components/ProfileCards.tsx` | X (Twitter) snapshot + LinkedIn snapshot side-by-side (avatar, bio, followers / connections, Follow / View buttons). LinkedIn avatars are fetched via `unavatar.io/linkedin/{slug}` with a chained fallback to the X avatar, then an initials placeholder. |
| 2 | `components/CareerMobility.tsx` | Horizontal career timeline (oldest → newest) sourced from `data/profileExtras.ts#careerHistory`. |
| 3 | `components/SentimentEvolutionChart.tsx` | Before/after mini-bar comparison showing how the person's AI views shifted at their most significant career transition, across 4 dimensions (Regulation / Usage / Trust / Agents). Hidden if no dimension changed significantly. |
| 4 | `components/TopicChips.tsx` | The influencer's AI focus areas, pulled from `bioTags` in `constants.ts`. |

The curated LinkedIn URLs, LinkedIn bios, LinkedIn extras (connections + location),
career history, and per-stage sentiment data all live in
[`data/profileExtras.ts`](./data/profileExtras.ts) and are keyed by the
same influencer `id` used in `constants.ts`. Profiles that don't have
curated data simply render fewer rows (the panel is defensive against
missing keys).

### 51-Person Shortlist

The default React experience renders a hand-curated 51-person shortlist
so it matches `preview.html` exactly. The full crawled dataset is still
available as `ALL_INITIAL_DATA` in
[`constants.ts`](./constants.ts); swap the `INITIAL_DATA` export (or
change which ids are in `PREVIEW_INFLUENCER_IDS`) to opt into the
larger graph.

---

## 💬 Sentiment Analysis

Sentiment scores are **pre-computed offline** from each person's exported X posts using the Gemini API — no API key is needed at runtime to view them. The pipeline:

1. Tweet JSON files for all 51 people live in `data/tweets/`
2. `node scripts/scoreSentiment.js` reads the tweets, calls Gemini, and writes `scripts/sentimentOutput.json`
3. `node scripts/applyScoresToReact.js` converts that into `data/sentimentScores.ts` (static TypeScript imported by the app)

To re-run scoring after updating tweet data, set `GEMINI_API_KEY` in `.env.local` and run both scripts in sequence.

---

## 🤖 In-App AI Assistant

AI Sphere ships with a floating Gemini-powered chatbot in the bottom-right corner. It has been pre-briefed on the app's layout, features, and methodology, so users can ask things like:

- "What do the node colors mean?"
- "How is the sentiment analysis computed?"
- "How do I filter by researchers only?"

The component lives in `components/AIChatbot.tsx`. It requires a `GEMINI_API_KEY` environment variable — without it, the rest of the app works normally but the chatbot will not respond.

---

## 🚀 Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and paste your Gemini API key
   (get one at https://aistudio.google.com/app/apikey).
3. Run the React app: `npm run dev`

| Script | What it does |
|---|---|
| `npm run dev` | Start Vite dev server on the React app (`index.html`). |
| `npm run build` | Production build to `dist/`. |
| `npm run typecheck` | Run `tsc --noEmit`. |
| `npm run fetch-influencers` | Refresh X profile data via RapidAPI. |
| `node scripts/scoreSentiment.js` | Re-score sentiment from tweet data (requires `GEMINI_API_KEY`). |
| `node scripts/applyScoresToReact.js` | Convert `sentimentOutput.json` → `data/sentimentScores.ts`. |

---

## 🙏 Acknowledgements

Forked from [mit-bunny/AI_Influencers_X](https://github.com/mit-bunny/AI_Influencers_X)
