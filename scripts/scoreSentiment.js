/**
 * scoreSentiment.js
 *
 * Scores AI sentiment + extracts topics for all 18 people with tweet data.
 *
 * Strategy:
 *   - Enough tweets (≥15 AI tweets): score from tweets alone
 *   - Too few tweets (<15): use Gemini with Google Search grounding to
 *     supplement — Gemini searches online for the person's public AI views
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

const TWEET_THRESHOLD = 15; // below this, supplement with web search

// ── Handle → app person ID ────────────────────────────────────────────────────
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

// Full names for web search fallback
const PERSON_NAMES = {
  elonmusk:       'Elon Musk',
  sama:           'Sam Altman',
  satyanadella:   'Satya Nadella',
  levie:          'Aaron Levie',
  karpathy:       'Andrej Karpathy',
  barmstrong:     'Brian Armstrong',
  andrewng:       'Andrew Ng',
  ylecun:         'Yann LeCun',
  gdb:            'Greg Brockman',
  demishassabis:  'Demis Hassabis',
  palmerluckey:   'Palmer Luckey',
  fchollet:       'François Chollet',
  ilyasut:        'Ilya Sutskever',
  drfeifei:       'Fei-Fei Li',
  geoffreyhinton: 'Geoffrey Hinton',
  paraga:         'Parag Agrawal',
  akhaliq:        'AK (@_akhaliq)',
  austen:         'Austen Allred',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

function parseNum(s) {
  const str = String(s || 0).replace(/,/g, '').trim();
  if (/k$/i.test(str)) return parseFloat(str) * 1e3;
  if (/m$/i.test(str)) return parseFloat(str) * 1e6;
  return parseFloat(str) || 0;
}

function engagement(t) {
  return parseNum(t.likes) + parseNum(t.retweets) * 3;
}

// ── Load all JSON tweet files ─────────────────────────────────────────────────
function loadTweets() {
  const byPerson = {};
  const seen     = {};

  function add(personId, tweet) {
    if (!personId) return;
    if (!byPerson[personId]) { byPerson[personId] = []; seen[personId] = new Set(); }
    const id = tweet.id || tweet.text?.slice(0, 40);
    if (seen[personId].has(id)) return;
    seen[personId].add(id);
    byPerson[personId].push(tweet);
  }

  const jsonFiles = fs.readdirSync(TWEETS_DIR).filter(f => f.endsWith('.json'));

  for (const file of jsonFiles) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(TWEETS_DIR, file), 'utf8')); }
    catch (e) { console.warn(`  ⚠ Skip ${file}: ${e.message}`); continue; }

    if (Array.isArray(data)) {
      for (const t of data) {
        const handle = (t.handle || '').toLowerCase().replace(/^@/, '');
        add(HANDLE_MAP[handle], t);
      }
    } else if (data && typeof data === 'object') {
      for (const [handle, tweets] of Object.entries(data)) {
        const personId = HANDLE_MAP[handle.toLowerCase().replace(/^@/, '')];
        if (Array.isArray(tweets)) tweets.forEach(t => add(personId, t));
      }
    }
  }
  return byPerson;
}

function selectTweets(tweets, max = 80) {
  return tweets
    .filter(t => {
      const text = (t.text || '').trim();
      return text.length >= 20 && !text.startsWith('RT ');
    })
    .sort((a, b) => engagement(b) - engagement(a))
    .slice(0, max);
}

// ── Gemini: standard call (structured JSON) ───────────────────────────────────
async function callGemini(prompt, schema) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: 'You are an expert AI research analyst. You analyse social media posts and public statements to understand a person\'s views on artificial intelligence. Your analysis is evidence-based.' }]
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

// ── Gemini: with Google Search grounding (for thin-tweet fallback) ────────────
// Mirrors the URL-grounding approach in Tweet-Analysis/services/geminiService.ts
async function callGeminiWithSearch(prompt, schema) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: 'You are an expert AI research analyst. Use Google Search to find recent public statements, interviews, and articles about the person, then score their AI sentiment. Always end your response with a JSON code block containing the scores.' }]
        },
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    }
  );
  const data = await res.json();
  if (data?.error) throw new Error(JSON.stringify(data.error));
  // Search grounding returns free text — extract JSON block from the response
  const text = data?.candidates?.[0]?.content?.parts?.filter(p => p.text).map(p => p.text).join('') || '';
  // Try ```json ... ``` first, then bare { ... }
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1].trim());
  const bare = text.match(/\{[\s\S]*"trends"[\s\S]*\}/);
  if (bare) return JSON.parse(bare[0]);
  throw new Error('No JSON found in grounded response. Raw: ' + text.slice(0, 300));
}

const SENTIMENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    trends:     { type: 'STRING', description: 'optimistic, pessimistic, or neutral' },
    regulation: { type: 'NUMBER', description: '-1 (against) to 1 (pro regulation)' },
    usage:      { type: 'NUMBER', description: '-1 (restrictive) to 1 (enthusiastic)' },
    trust:      { type: 'NUMBER', description: '-1 (existential risk) to 1 (high trust)' },
    agent:      { type: 'NUMBER', description: '-1 (skeptical) to 1 (bullish on agents)' },
    reasoning:  { type: 'STRING', description: 'one sentence key signal' },
    source:     { type: 'STRING', description: 'tweets, web-search, or mixed' },
  },
  required: ['trends', 'regulation', 'usage', 'trust', 'agent', 'reasoning', 'source'],
};

// ── Sentiment analysis: tweets → (if thin) supplement with web search ─────────
async function analyzeSentiment(personId, tweets) {
  const clamp = v => Math.max(-1, Math.min(1, Number(v) || 0));
  const validTrends = ['optimistic', 'pessimistic', 'neutral'];
  const name = PERSON_NAMES[personId] || personId;

  if (tweets.length >= TWEET_THRESHOLD) {
    // ── Path A: enough tweets — score from tweets only ──────────────────────
    const sample = tweets.slice(0, 60)
      .map(t => `[${(t.timestamp || '').slice(0, 7)}] ${t.text.replace(/\n+/g, ' ').trim()}`)
      .join('\n---\n');

    const prompt = `Analyze the AI-related opinions of ${name} based on their tweets (2023–2026), sorted by engagement:

${sample}

Score their stance on each dimension based strictly on evidence in these tweets.
Set source to "tweets".`;

    const result = await callGemini(prompt, SENTIMENT_SCHEMA);
    return {
      trends:     validTrends.includes(result.trends) ? result.trends : 'neutral',
      regulation: clamp(result.regulation),
      usage:      clamp(result.usage),
      trust:      clamp(result.trust),
      agent:      clamp(result.agent),
      reasoning:  result.reasoning || '',
      source:     'tweets',
    };

  } else {
    // ── Path B: too few tweets — use web search to supplement ───────────────
    const tweetSnippet = tweets.length > 0
      ? `\n\nTheir ${tweets.length} available tweet(s):\n` +
        tweets.map(t => `- ${t.text.replace(/\n+/g, ' ').trim()}`).join('\n')
      : '';

    const prompt = `I need to score ${name}'s stance on AI across 5 dimensions.
${tweetSnippet}

The tweet data is too thin to be conclusive. Please search online for:
- ${name}'s recent interviews, blog posts, or public statements about AI
- Their known positions on AI regulation, AI safety, AI agents, and AI usage

Then return a JSON object with these exact fields:
{
  "trends": "optimistic" | "pessimistic" | "neutral",
  "regulation": <number -1 to 1>,
  "usage": <number -1 to 1>,
  "trust": <number -1 to 1>,
  "agent": <number -1 to 1>,
  "reasoning": "<one sentence summarising the key evidence>",
  "source": "web-search" | "mixed"
}`;

    const result = await callGeminiWithSearch(prompt, null);
    return {
      trends:     validTrends.includes(result.trends) ? result.trends : 'neutral',
      regulation: clamp(result.regulation),
      usage:      clamp(result.usage),
      trust:      clamp(result.trust),
      agent:      clamp(result.agent),
      reasoning:  result.reasoning || '',
      source:     result.source || 'web-search',
    };
  }
}

// ── Topic extraction ──────────────────────────────────────────────────────────
async function extractTopics(personId, tweets) {
  const name = PERSON_NAMES[personId] || personId;

  if (tweets.length >= TWEET_THRESHOLD) {
    const sample = tweets.slice(0, 100)
      .map(t => t.text.replace(/\n+/g, ' ').trim())
      .join('\n---\n');

    const prompt = `Analyze these tweets from ${name} and identify up to 5 specific AI topics they tweet about most (e.g. "LLMs", "AI Safety", "Robotics"). Be specific, not generic.\n\n${sample}`;

    const schema = {
      type: 'OBJECT',
      properties: {
        topics: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['topics'],
    };
    const result = await callGemini(prompt, schema);
    return (result.topics || []).slice(0, 5);

  } else {
    // Use web search to find their known AI focus areas
    const prompt = `Search online for ${name}'s main areas of focus in AI. What specific AI topics do they research, build, or publicly discuss most? Return a JSON object: { "topics": ["topic1", "topic2", ...] } with up to 5 short topic labels (1-3 words each).`;

    const result = await callGeminiWithSearch(prompt, null);
    return (result.topics || []).slice(0, 5);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== AI Sentiment Scorer ===\n');
  console.log(`Threshold: tweets < ${TWEET_THRESHOLD} → supplement with Google Search\n`);

  let results = {};
  if (fs.existsSync(OUTPUT)) {
    results = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    console.log(`Resuming — ${Object.keys(results).length} already done\n`);
  }

  console.log('Loading tweet files...');
  const byPerson = loadTweets();
  console.log(`Tweet data found for: ${Object.keys(byPerson).join(', ')}\n`);

  for (const [personId, allTweets] of Object.entries(byPerson)) {
    if (results[personId]) {
      console.log(`⏭  ${personId} already scored`);
      continue;
    }

    const selected = selectTweets(allTweets);
    const mode = selected.length >= TWEET_THRESHOLD ? 'tweets' : 'tweets + web search';
    console.log(`\n▶ ${personId} (${selected.length} AI tweets) → using ${mode}`);

    try {
      process.stdout.write('  Sentiment... ');
      const sentiment = await analyzeSentiment(personId, selected);
      console.log(`✓ [${sentiment.source}] ${sentiment.trends} | reg=${sentiment.regulation.toFixed(2)} use=${sentiment.usage.toFixed(2)} tru=${sentiment.trust.toFixed(2)} age=${sentiment.agent.toFixed(2)}`);
      console.log(`  → ${sentiment.reasoning}`);

      await delay(800);

      process.stdout.write('  Topics... ');
      const topics = await extractTopics(personId, selected);
      console.log(`✓ ${topics.join(', ')}`);

      results[personId] = { sentiment, topics, tweetCount: selected.length };
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
      results[personId] = null;
    }

    fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
    await delay(1500);
  }

  console.log('\n=== Complete ===');
  const fromTweets = Object.values(results).filter(r => r?.sentiment?.source === 'tweets').length;
  const fromSearch = Object.values(results).filter(r => r?.sentiment?.source !== 'tweets' && r).length;
  const failed     = Object.values(results).filter(r => r === null).length;
  console.log(`From tweets: ${fromTweets} | Web search supplement: ${fromSearch} | Failed: ${failed}`);
  console.log(`\nOutput → ${OUTPUT}`);
  console.log('Next: node scripts/applyScores.js --dry-run');
}

main().catch(console.error);
