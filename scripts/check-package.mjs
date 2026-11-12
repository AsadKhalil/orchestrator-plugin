// Release gate: inspects what `npm pack` would publish. Run after `npm run build`. No network or keys needed.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [pack] = JSON.parse(execSync('npm pack --dry-run --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
const paths = pack.files.map(f => f.path.replaceAll('\\', '/'));
const problems = [];

const forbidden = [
  [/^(tests|docs|scripts)\//, 'repository-only directory'],
  [/(^|\/)\.env(\.|$)/, 'environment file'],
  [/\.(sqlite|sqlite3|db)(-wal|-shm)?$/i, 'database file'],
  // Data formats only: source modules may legitimately be named after benchmarks.
  [/benchmark.*.(json|csv|tsv|ndjson|jsonl|parquet|xlsx|ya?ml)$/i, 'possible benchmark data dump'],
];
for (const p of paths) for (const [re, why] of forbidden) if (re.test(p)) problems.push(`${p}: ${why}`);
for (const required of ['dist/index.js', 'dist/gui-experimental.cjs']) if (!paths.includes(required)) problems.push(`${required}: missing (run npm run build first)`);

// Obvious secret shapes only; this is a tripwire, not a scanner.
const secrets = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'sk- style API key'],
  [/\b(api[_-]?key|secret|token)\b["']?\s*[:=]\s*["'][A-Za-z0-9_\-./+=]{24,}["']/i, 'key assignment with a long literal'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
];
for (const p of paths.filter(p => p.startsWith('dist/') && /\.(js|cjs|mjs|json|map|d\.ts)$/.test(p))) {
  const text = readFileSync(p, 'utf8');
  for (const [re, why] of secrets) if (re.test(text)) problems.push(`${p}: ${why}`);
}

if (problems.length) {
  console.error(`Package check failed:\n${problems.map(p => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Package check passed: ${paths.length} files, ${(pack.size / 1024).toFixed(1)} kB packed.`);
