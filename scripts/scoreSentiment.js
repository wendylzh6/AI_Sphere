/**
 * scoreSentiment.js
 *
 * Reads tweet JSON files from ~/Desktop/tweets data/,
 * scores each person's AI sentiment + extracts their top AI topics via Gemini.
 *
 * Inspired by: github.com/wendylzh6/Tweet-Analysis
 *
 * Usage:
 *   node --env-file=.env.local scripts/scoreSentiment.js
 *
 * Required env:
 *   GEMINI_API_KEY=...
 *
 * Output: scripts/sentimentOutput.json
 *   {
 *     "personId": {
 *       "sentiment": { trends, regulation, usage, trust, agent },
 *       "topics": ["LLMs", "AI Safety", ...],
 *       "tweetCount": 42
 *     }
 *   }
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const TWEETS_DIR = path.join(process.env.HOME, 'Desktop', 'tweets data');
const OUTPUT     = path.join(__dirname, 'sentimentOutput.json');
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_KEY) { console.error('Missing GEMINI_API_KEY in env'); process.exit(1); }

// ── Filename → app person ID ──────────────────────────────────────────────────
// Maps the JSON file keys / tweet handles to IDs used in preview.html
const HANDLE_MAP = {
  elonmusk:        'elonmusk',
  sama:            'sama',
  satyanadella:    'satyanadella',
  levie:           'levie',
  karpathy:        'karpathy',
  brian_armstrong: 'barmstrong',
  andrewng:        'andrewng',
  andrewyng:       'andrewng',
  ylecun:          'ylecun',
  gdb:             'gdb',
  demishassabis:   'demishassabis',
  palmerluckey:    'palmerluckey',
  fchollet:        'fchollet',
  ilyasut:         'ilyasut',
  drfeifei:        'drfeifei',
  geoffreyhinton:  'geoffreyhinton',
  paraga:          'paraga',
  _akhaliq:        'akhaliq',
  akhaliq:         'akhaliq',
  austen:          'austen',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

// Parse "2.6K" / "1.2M" / "441" → number  (mirrors Tweet-Analysis formatNumber)
function parseNum(s) {
  const str = String(s || 0).replace(/,/g, '').trim();
  if (/k$/i.test(str)) return parseFloat(str) * 1e3;
  if (/m$/i.test(str)) return parseFloat(str) * 1e6;
  return parseFloat(str) || 0;
}

// Engagement score: likes + retweets×3
// (views are all 0 in these files so we can't use likes/views ratio)
function engagement(t) {
  return parseNum(t.likes) + parseNum(t.retweets) * 3;
}

// ── Load + consolidate all JSON tweet files ───────────────────────────────────
function loadTweets() {
  const byPerson = {};  // personId → Tweet[]
  const seen     = {};  // personId → Set<tweetId>  (dedup)

  function add(personId, tweet) {
    if (!personId) return;
    if (!byPerson[personId]) { byPerson[personId] = []; seen[personId] = new Set(); }
    const id = tweet.id || tweet.text?.slice(0, 40);
    if (seen[personId].has(id)) return;
    seen[personId].add(id);
    byPerson[personId].push(tweet);
  }

  // Only process .json files
  const jsonFiles = fs.readdirSync(TWEETS_DIR)
    .filter(f => f.endsWith('.json'));

  for (const file of jsonFiles) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(TWEETS_DIR, file), 'utf8')); }
    catch (e) { console.warn(`  ⚠ Skip ${file}: ${e.message}`); continue; }

    if (Array.isArray(data)) {
      // Individual file: array of tweet objects
      for (const t of data) {
        const handle = (t.handle || '').toLowerCase().replace(/^@/, '');
        add(HANDLE_MAP[handle], t);
      }
    } else if (data && typeof data === 'object') {
      // Bulk file: { handle: tweets[] }
      for (const [handle, tweets] of Object.entries(data)) {
        const personId = HANDLE_MAP[handle.toLowerCase().replace(/^@/, '')];
        if (Array.isArray(tweets)) tweets.forEach(t => add(personId, t));
      }
    }
  }

  return byPerson;
}

// ── Select best tweets for analysis ──────────────────────────────────────────
// Drop retweets, sort by engagement, take top N (mirrors Tweet-Analysis sampling)
function selectTweets(tweets, max = 80) {
  return tweets
    .filter(t => {
      const text = (t.text || '').trim();
      return text.length >= 20 && !text.startsWith('RT ');
    })
    .sort((a, b) => engagement(b) - engagement(a))
    .slice(0, max);
}

// ── Gemini call (structured JSON output, mirrors Tweet-Analysis approach) ─────
async function callGemini(prompt, schema) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: 'You are an expert AI research analyst. You analyze social media posts to understand a person\'s views on artificial intelligence. Your analysis is evidence-based, citing only what is present in the tweets provided.' }]
        },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.1,
        },
      }),
    }
  );
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(JSON.stringify(data?.error || 'no response'));
  return JSON.parse(text);
}

// ── Sentiment analysis ────────────────────────────────────────────────────────
async function analyzeSentiment(personId, tweets) {
  // Use top 60 tweets by engagement (mirrors 50-tweet sample in Tweet-Analysis)
  const sample = tweets.slice(0, 60)
    .map(t => `[${(t.timestamp || '').slice(0, 7)}] ${t.text.replace(/\n+/g, ' ').trim()}`)
    .join('\n---\n');

  const prompt = `Analyze the AI-related opinions of @${personId} based on these tweets (2023–2026), sorted by engagement (most impactful first):

${sample}

Score their stance on each dimension based strictly on evidence in these tweets:
- trends: overall outlook on AI progress
- regulation: stance on AI regulation
- usage: enthusiasm vs caution about using AI
- trust: trust in AI safety vs existential risk concerns
- agent: stance on AI agents specifically`;

  const schema = {
    type: 'OBJECT',
    properties: {
      trends:     { type: 'STRING',  description: 'optimistic, pessimistic, or neutral' },
      regulation: { type: 'NUMBER',  description: '-1 (against) to 1 (pro regulation)' },
      usage:      { type: 'NUMBER',  description: '-1 (restrictive) to 1 (enthusiastic)' },
      trust:      { type: 'NUMBER',  description: '-1 (existential risk) to 1 (high trust)' },
      agent:      { type: 'NUMBER',  description: '-1 (skeptical) to 1 (bullish on agents)' },
      reasoning:  { type: 'STRING',  description: 'one sentence explaining the key signal' },
    },
    required: ['trends', 'regulation', 'usage', 'trust', 'agent', 'reasoning'],
  };

  const result = await callGemini(prompt, schema);
  const clamp = v => Math.max(-1, Math.min(1, Number(v) || 0));
  const validTrends = ['optimistic', 'pessimistic', 'neutral'];

  return {
    trends:     validTrends.includes(result.trends) ? result.trends : 'neutral',
    regulation: clamp(result.regulation),
    usage:      clamp(result.usage),
    trust:      clamp(result.trust),
    agent:      clamp(result.agent),
    reasoning:  result.reasoning || '',
  };
}

// ── Topic extraction (mirrors analyzeTopics from Tweet-Analysis) ──────────────
async function extractTopics(personId, tweets) {
  // Use first 100 tweets (chronological gives broader topic coverage)
  const sample = tweets.slice(0, 100)
    .map(t => t.text.replace(/\n+/g, ' ').trim())
    .join('\n---\n');

  const prompt = `Analyze these tweets from @${personId} and identify their top AI-related content topics.

Tweets:
${sample}

Identify up to 5 specific AI topics or themes this person tweets about most (e.g. "LLMs", "AI Safety", "Robotics", "AI Policy", "Open Source AI"). Be specific, not generic.`;

  const schema = {
    type: 'OBJECT',
    properties: {
      topics: {
        type: 'ARRAY',
        items: { type: 'STRING', description: 'A specific AI topic or theme, 1-3 words' },
        description: 'Top AI topics this person tweets about, max 5',
      },
    },
    required: ['topics'],
  };

  const result = await callGemini(prompt, schema);
  return (result.topics || []).slice(0, 5);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== AI Sentiment Scorer (tweet-based) ===\n');

  // Resume support
  let results = {};
  if (fs.existsSync(OUTPUT)) {
    results = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    console.log(`Resuming — ${Object.keys(results).length} already done\n`);
  }

  console.log(`Loading JSON files from: ${TWEETS_DIR}`);
  const byPerson = loadTweets();
  const people   = Object.keys(byPerson);
  console.log(`Found tweet data for ${people.length} people: ${people.join(', ')}\n`);

  for (const [personId, allTweets] of Object.entries(byPerson)) {
    if (results[personId]) {
      console.log(`⏭  ${personId} already scored`);
      continue;
    }

    const selected = selectTweets(allTweets);
    console.log(`\n▶ ${personId}: ${allTweets.length} tweets → ${selected.length} selected`);

    if (selected.length < 5) {
      console.log(`  Too few tweets — keeping existing hardcoded score`);
      results[personId] = null;
      fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
      continue;
    }

    try {
      // Sentiment
      process.stdout.write('  Sentiment... ');
      const sentiment = await analyzeSentiment(personId, selected);
      console.log(`✓ ${sentiment.trends} | reg=${sentiment.regulation.toFixed(2)} use=${sentiment.usage.toFixed(2)} tru=${sentiment.trust.toFixed(2)} age=${sentiment.agent.toFixed(2)}`);
      console.log(`  → ${sentiment.reasoning}`);

      await delay(800);

      // Topics
      process.stdout.write('  Topics... ');
      const topics = await extractTopics(personId, selected);
      console.log(`✓ ${topics.join(', ')}`);

      results[personId] = { sentiment, topics, tweetCount: selected.length };
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
      results[personId] = null;
    }

    fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
    await delay(1200); // stay within Gemini free-tier rate limit
  }

  // ── Summary ──
  console.log('\n=== Complete ===');
  const scored  = Object.values(results).filter(Boolean).length;
  const skipped = Object.values(results).filter(v => v === null).length;
  console.log(`Scored: ${scored} | Skipped: ${skipped}`);
  console.log(`Output: ${OUTPUT}`);
  console.log('\nNext step: run applyScores.js to patch preview.html with the new values');
}

main().catch(console.error);
