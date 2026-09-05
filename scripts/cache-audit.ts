import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural guard on the data-access layer.
 *
 * The organizing rule of this codebase is that every BigCommerce read lives in
 * `data/`, and the kind of read is visible from its path:
 *
 *   data/           public catalog, cached, scalar args only, NO customer token
 *   data/customer/  customer-scoped, dynamic or 'use cache: private'
 *
 * Catalyst's central defect was that this boundary didn't exist: a
 * `customerAccessToken` parameter was threaded into shared queries at ~76 call
 * sites, and its mere presence flipped the whole query to `no-store`. That is
 * easy to reintroduce one innocuous-looking parameter at a time, so it gets a
 * CI gate rather than a code-review convention.
 *
 * Runs as `npm run cache-audit`. Wire into CI alongside typecheck.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');

const CACHE_DIRECTIVE = /^\s*['"]use cache(?::\s*(?:private|remote))?['"]\s*;/m;
const PRIVATE_DIRECTIVE = /['"]use cache:\s*private['"]/;
const EXPORTED_ASYNC_FN = /export\s+async\s+function\s+(\w+)/g;
const BANNED_IN_PUBLIC = [
  { pattern: /customerAccessToken/, reason: 'customer tokens must never reach a public cached read' },
  { pattern: /from ['"]next\/headers['"]/, reason: 'request APIs are illegal in a public cache scope' },
  { pattern: /from ['"]next-intl\/server['"]/, reason: 'request-scoped translators throw inside use cache' },
  { pattern: /customerQuery/, reason: 'customerQuery is dynamic; use query() in data/' },
];

interface Finding {
  file: string;
  message: string;
}

async function walk(dir: string): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        return walk(path);
      }

      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    }),
  );

  return files.flat();
}

async function audit(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = await walk(DATA_DIR);

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const rel = relative(ROOT, file);
    const isCustomerScoped = rel.startsWith(join('data', 'customer'));

    if (isCustomerScoped) {
      // Customer-scoped reads may be dynamic or private, but never a public
      // cache — a public scope would key across identities.
      if (CACHE_DIRECTIVE.test(source) && !PRIVATE_DIRECTIVE.test(source)) {
        findings.push({
          file: rel,
          message: "uses a public 'use cache' directive; customer-scoped reads must be dynamic or 'use cache: private'",
        });
      }

      continue;
    }

    for (const { pattern, reason } of BANNED_IN_PUBLIC) {
      if (pattern.test(source)) {
        findings.push({ file: rel, message: `${pattern.source} — ${reason}` });
      }
    }

    // Every public read should declare its cache behavior explicitly. An
    // undirected async export is almost always an uncached BigCommerce call.
    const exported = [...source.matchAll(EXPORTED_ASYNC_FN)].map((match) => match[1]);

    if (exported.length > 0 && !CACHE_DIRECTIVE.test(source)) {
      findings.push({
        file: rel,
        message: `exports async ${exported.join(', ')} but declares no cache directive`,
      });
    }
  }

  return findings;
}

const findings = await audit();

if (findings.length > 0) {
  console.error('Cache audit failed:\n');

  for (const finding of findings) {
    console.error(`  ${finding.file}\n    ${finding.message}\n`);
  }

  process.exit(1);
}

console.log('Cache audit passed.');
