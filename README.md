# AI Sphere

An interactive 3D map of the top AI influencers — explore who they are, what they do, what they think, and how they're connected.

## 🌐 Live Site

**[wendylzh6.github.io/AI_Sphere/preview.html](https://wendylzh6.github.io/AI_Sphere/preview.html)**

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
| AI (network expansion) | Google Gemini API |
| Styling | Tailwind CSS (CDN) |
| Icons | Lucide React |
| Analytics | Vercel Analytics |
| Data pipeline | Node.js + RapidAPI (X/Twitter) |

---

## 🤖 In-App AI Assistant

AI Sphere ships with a floating Gemini-powered chatbot ("Tauhid D. Luffy")
in the bottom-left corner. It has been pre-briefed on the app's layout,
features, and methodology, so users can ask things like:

- "What do the node colors mean?"
- "How is the sentiment analysis computed?"
- "How do I filter by researchers only?"

The component lives in `components/AIChatbot.tsx` and reads the same
`GEMINI_API_KEY` env var that the sentiment analyzer uses.

---

## 🚀 Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and paste your Gemini API key
   (get one at https://aistudio.google.com/app/apikey).
3. Run the app: `npm run dev`
