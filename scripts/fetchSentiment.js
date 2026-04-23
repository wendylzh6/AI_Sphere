/**
 * fetchSentiment.js
 *
 * Pipeline:
 *   1. For each of the 51 handles, fetch their last ~100 tweets via RapidAPI (Twitter API45)
 *   2. Filter to original posts only (no retweets), keep AI-relevant ones
 *   3. Send a batch to Gemini and score on 5 sentiment dimensions
 *   4. Write results to scripts/sentimentOutput.json
 *
 * Usage:
 *   node --env-file=.env.local scripts/fetchSentiment.js
 *
 * Required env vars (.env.local):
 *   RAPIDAPI_KEY=...
 *   RAPIDAPI_HOST=twttrapi.p.rapidapi.com   (Twitter API45 host)
 *   GEMINI_API_KEY=...
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!RAPIDAPI_KEY || !RAPIDAPI_HOST) {
  console.error('Missing RAPIDAPI_KEY or RAPIDAPI_HOST in env');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in env');
  process.exit(1);
}

// ── The 51 handles to process ────────────────────────────────────────────────
const HANDLES = [
  'sama', 'satyanadella', 'levie', 'karpathy', 'barmstrong',
  'andrewng', 'ylecun', 'gdb', 'demishassabis', 'palmerluckey',
  'fchollet', 'ilyasut', 'drfeifei', 'geoffreyhinton', 'paraga',
  'akhaliq', 'austen', 'miramurati', 'jeffdean', 'rasbt',
  'hardmaru', 'alexwang', 'addyosmani', 'iangoodfellow', 'jimfan',
  'minchoi', 'deryaunutmaz', 'emostaque', 'sriramk', 'omarsar0',
  'soumith', 'logank', 'jeremyhoward', 'steipete', 'tunguz',
  'bcherny', 'mustafasuleyman', 'gavinbaker', 'eliezeryud', 'yacinemtb',
  'kazufujisawa', 'oriolvinyals', 'clementdelangue', 'aelluswamy',
  'schmidhuber', 'rileygoodside', 'mitchellh', 'darioamodei',
  'arankomatsuzaki', 'chrmanning', 'elonmusk',
];

// ── AI keyword filter for tweets ─────────────────────────────────────────────
const AI_KEYWORDS = [
  'ai', 'ml', 'llm', 'gpt', 'model', 'neural', 'deep learning',
  'machine learning', 'openai', 'anthropic', 'deepmind', 'gemini',
  'claude', 'chatgpt', 'agent', 'alignment', 'safety', 'agi',
  'inference', 'training', 'transformer', 'diffusion', 'robotics',
  'regulation', 'gpu', 'nvidia', 'data', 'research', 'paper',
];

function isAITweet(text) {
  const lower = text.toLowerCase();
  return AI_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

async function apiCall(endpoint, params = {}) {
  const url = new URL(`https://${RAPIDAPI_HOST}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => v !== undefined && url.searchParams.append(k, v));
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-key':  RAPIDAPI_KEY,
      'x-rapidapi-host': RAPIDAPI_HOST,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// Fetch up to ~100 recent tweets for a handle.
// Twitter API45 timeline endpoint: /timeline.php?screenname=...
async function fetchTweets(handle) {
  try {
    const data = await apiCall('/timeline.php', { screenname: handle });
    await delay(1200); // stay well under rate limit

    // The API returns tweets under various keys depending on version
    const raw =
      data?.timeline         ||
      data?.tweets           ||
      data?.data?.tweets     ||
      data?.data?.timeline   ||
      [];

    if (!Array.isArray(raw)) return [];

    return raw
      .filter(t => {
        const text = t?.text || t?.full_text || t?.content || '';
        // Drop retweets and empty tweets
        if (!text || text.startsWith('RT ')) return false;
        return isAITweet(text);
      })
      .slice(0, 60)  // cap at 60 AI tweets per person
      .map(t => (t?.text || t?.full_text || t?.content || '').replace(/https?:\/\/\S+/g, '').trim());
  } catch (err) {
    console.warn(`  ⚠ fetchTweets(${handle}): ${err.message}`);
    return [];
  }
}

// ── Gemini scoring ────────────────────────────────────────────────────────────
async function scoreTweets(handle, tweets) {
  if (tweets.length === 0) return null;

  const sample = tweets.slice(0, 40).join('\n---\n');

  const prompt = `You are analyzing the AI sentiment of a public figure based on their actual tweets.

Handle: @${handle}

Recent tweets (AI-related only, newest first):
${sample}

Based ONLY on these tweets, score their stance on each dimension:
- trends: overall outlook on AI progress ("optimistic", "pessimistic", or "neutral")
- regulation: -1 (strongly against AI regulation) to 1 (strongly pro regulation)
- usage: -1 (very cautious/restrictive about AI use) to 1 (highly enthusiastic)
- trust: -1 (views AI as existential risk) to 1 (high trust in AI safety)
- agent: -1 (skeptical of AI agents) to 1 (very bullish on AI agents)

If there is not enough evidence for a dimension, use 0.
Return valid JSON only, no explanation.`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    const clamp = v => Math.max(-1, Math.min(1, Number(v) || 0));
    const validTrends = ['optimistic', 'pessimistic', 'neutral'];
    return {
      trends:     validTrends.includes(parsed.trends) ? parsed.trends : 'neutral',
      regulation: clamp(parsed.regulation),
      usage:      clamp(parsed.usage),
      trust:      clamp(parsed.trust),
      agent:      clamp(parsed.agent),
    };
  } catch (err) {
    console.warn(`  ⚠ scoreTweets(${handle}): ${err.message}`);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Tweet-based Sentiment Pipeline ===\n');
  console.log(`Processing ${HANDLES.length} handles...\n`);

  // Resume from existing output if interrupted
  const outputPath = path.join(__dirname, 'sentimentOutput.json');
  let results = {};
  if (fs.existsSync(outputPath)) {
    results = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    console.log(`Resuming — ${Object.keys(results).length} already done\n`);
  }

  for (const handle of HANDLES) {
    if (results[handle]) {
      console.log(`⏭  Skipping @${handle} (already scored)`);
      continue;
    }

    console.log(`\n▶ @${handle}`);

    // 1. Fetch tweets
    process.stdout.write('  Fetching tweets... ');
    const tweets = await fetchTweets(handle);
    console.log(`${tweets.length} AI tweets found`);

    if (tweets.length === 0) {
      console.log('  No AI tweets — recording nulls');
      results[handle] = null;
    } else {
      // 2. Score with Gemini
      process.stdout.write('  Scoring with Gemini... ');
      await delay(500);
      const scores = await scoreTweets(handle, tweets);
      if (scores) {
        console.log(`done → trends=${scores.trends}, reg=${scores.regulation}, use=${scores.usage}, tru=${scores.trust}, age=${scores.agent}`);
      } else {
        console.log('scoring failed');
      }
      results[handle] = scores;
    }

    // Save after each person so we can resume if interrupted
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

    // Pause between people to avoid rate limits
    await delay(1500);
  }

  console.log('\n=== Done ===');
  console.log(`Results written to ${outputPath}`);

  // Print summary
  const scored   = Object.values(results).filter(Boolean).length;
  const skipped  = Object.values(results).filter(v => v === null).length;
  console.log(`Scored: ${scored}  |  No tweets found: ${skipped}`);
  console.log('\nNext step: copy scores from sentimentOutput.json into preview.html / constants.ts');
}

main().catch(console.error);
