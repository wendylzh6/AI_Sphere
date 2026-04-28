/**
 * applyScores.js
 *
 * Reads scripts/sentimentOutput.json and patches the sentiment scores
 * and bioTags in preview.html for every person that was successfully scored.
 *
 * Usage:
 *   node scripts/applyScores.js
 *
 * Dry run (preview changes without writing):
 *   node scripts/applyScores.js --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SCORES_PATH = path.join(__dirname, 'sentimentOutput.json');
const HTML_PATH   = path.join(__dirname, '..', 'preview.html');
const DRY_RUN     = process.argv.includes('--dry-run');

if (!fs.existsSync(SCORES_PATH)) {
  console.error('sentimentOutput.json not found — run scoreSentiment.js first');
  process.exit(1);
}

const scores = JSON.parse(fs.readFileSync(SCORES_PATH, 'utf8'));
let html = fs.readFileSync(HTML_PATH, 'utf8');

let patchCount = 0;
let skipCount  = 0;

for (const [personId, result] of Object.entries(scores)) {
  if (!result) { skipCount++; continue; }

  const { sentiment, topics } = result;

  // ── Patch sentiment scores ───────────────────────────────────────────────
  // Matches: sentiment:{trends:'optimistic', regulation:0.30, usage:0.90, trust:0.75, agent:0.90}
  // (tolerates varying whitespace and number formats)
  const sentimentPattern = new RegExp(
    `(id:'${personId}'[^}]*?sentiment:\\{)trends:'[^']*',\\s*regulation:[^,]+,\\s*usage:[^,]+,\\s*trust:[^,]+,\\s*agent:[^}]+\\}`,
    's'
  );

  const newSentiment = `$1trends:'${sentiment.trends}', regulation:${sentiment.regulation.toFixed(2)}, usage:${sentiment.usage.toFixed(2)}, trust:${sentiment.trust.toFixed(2)}, agent:${sentiment.agent.toFixed(2)}}`;

  if (sentimentPattern.test(html)) {
    html = html.replace(sentimentPattern, newSentiment);
    console.log(`✓ ${personId}: sentiment patched (${sentiment.trends}, reg=${sentiment.regulation.toFixed(2)})`);
    patchCount++;
  } else {
    console.warn(`⚠ ${personId}: sentiment pattern not found — skipped`);
    skipCount++;
    continue;
  }

  // ── Patch bioTags (topics) ───────────────────────────────────────────────
  if (topics && topics.length > 0) {
    const tagsStr = topics.map(t => `'${t}'`).join(',');
    const bioTagsPattern = new RegExp(
      `(id:'${personId}'[^}]*?bioTags:\\[)[^\\]]*\\]`,
      's'
    );
    if (bioTagsPattern.test(html)) {
      html = html.replace(bioTagsPattern, `$1${tagsStr}]`);
      console.log(`  topics: [${topics.join(', ')}]`);
    }
  }
}

console.log(`\n${patchCount} people patched, ${skipCount} skipped`);

if (DRY_RUN) {
  console.log('\nDry run — no files written');
} else {
  // Back up original before writing
  fs.writeFileSync(HTML_PATH + '.bak', fs.readFileSync(HTML_PATH));
  fs.writeFileSync(HTML_PATH, html);
  console.log(`\npreview.html updated (backup saved as preview.html.bak)`);
}
