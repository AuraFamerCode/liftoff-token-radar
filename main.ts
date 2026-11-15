import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// The entry's own files are read from beside this script, never from the working directory: the
// grader runs `node /bot/main.ts` from outside the repository.
const here = fileURLToPath(new URL('./', import.meta.url));

// 1. Argument parsing
let inputArg = '/input';
let outputArg = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--input' && i + 1 < process.argv.length) {
    inputArg = process.argv[++i];
  } else if (arg.startsWith('--input=')) {
    inputArg = arg.slice('--input='.length);
  } else if (arg === '--output' && i + 1 < process.argv.length) {
    outputArg = process.argv[++i];
  } else if (arg.startsWith('--output=')) {
    outputArg = arg.slice('--output='.length);
  }
}

// Resolve snapshot file path
let snapshotPath = inputArg;
if (existsSync(snapshotPath) && statSync(snapshotPath).isDirectory()) {
  snapshotPath = join(snapshotPath, 'snapshot.json');
}

if (!existsSync(snapshotPath)) {
  console.error(`Error: snapshot file not found at ${snapshotPath}`);
  process.exit(2);
}

// 2. Read, parse, buildRadar, validate board
let text: string;
try {
  text = readFileSync(snapshotPath, 'utf8');
} catch (err) {
  console.error(`Error reading snapshot file: ${(err as Error).message}`);
  process.exit(2);
}

const snapshot = parseSnapshot(text);
const { board, radar } = buildRadar(snapshot);

const issue = boardIssue(board, snapshot);
if (issue !== null) {
  console.error(`Board contract validation error: ${issue}`);
  process.exit(1);
}

// 3. Write board.json and data.js
mkdirSync(outputArg, { recursive: true });
writeFileSync(join(outputArg, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(outputArg, 'data.js'), dataScript(radar));

// Print summary line to stdout
const watchlistCount = board.filter(r => r.tier === 'watchlist').length;
const earlyCount = board.filter(r => r.tier === 'early').length;
const top3 = board
  .slice(0, 3)
  .map(r => `${r.slug} ($${(r.implied_value_usd / 1e9).toFixed(2)}B)`)
  .join(', ');
console.log(
  `Protocols: ${snapshot.protocols.length} | Watchlist: ${snapshot.watchlist.length} | Board: ${board.length} (${watchlistCount} watchlist + ${earlyCount} early) | Live: ${radar.live.length} | Top 3: ${top3}`
);

// 4. Copy dashboard files
const dashboardSrc = join(here, 'dashboard');
const dashboardDest = join(outputArg, 'dashboard');
function copyDashboard(src: string, dest: string) {
  if (!existsSync(src) || !statSync(src).isDirectory()) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDashboard(s, d);
    } else if (entry.isFile()) {
      copyFileSync(s, d);
    }
  }
}
copyDashboard(dashboardSrc, dashboardDest);

// 4 & 5. Copy screenshots and write dossier
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const screenshotsSrc = join(here, 'screenshots');
const screenshotsDest = join(outputArg, 'screenshots');
mkdirSync(screenshotsDest, { recursive: true });

let shotNames: string[] = [];
if (existsSync(screenshotsSrc) && statSync(screenshotsSrc).isDirectory()) {
  shotNames = readdirSync(screenshotsSrc, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.'))
    .map(e => e.name);
}

if (shotNames.length < 3) {
  console.error(`Error: hand in 3 screenshots in screenshots/ (found ${shotNames.length})`);
  process.exit(1);
}

for (const name of shotNames) {
  if (!PLAIN_NAME.test(name)) {
    console.error(`Error: screenshot name "${name}" is not valid (must match /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/)`);
    process.exit(1);
  }
  copyFileSync(join(screenshotsSrc, name), join(screenshotsDest, name));
}

// 5. Write dossier.json last
const dossierBytes = buildDossier(outputArg, {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outputArg, 'dossier.json'), dossierBytes);
