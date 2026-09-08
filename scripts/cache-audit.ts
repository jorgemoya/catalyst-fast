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
  // Matches a call or an import, not the bare word: `data/cart.ts` legitimately
  // says "read and mutate that cart" in a comment, and an audit that fires on
  // prose gets silenced rather than fixed.
  {
    pattern: /(?:^|[^.\w])mutate\s*\(|import\s*\{[^}]*\bmutate\b[^}]*\}/,
    reason: 'writes must never sit in a cached body — they would re-run on every miss',
  },
];

/** Explicit, reasoned exemption. The em dash and reason are required. */
const DYNAMIC_OPT_OUT = /\/\/\s*cache-audit:\s*dynamic\s*—\s*\S/;

interface Finding {
  file: string;
  message: string;
}

/**
 * Slices the source into exported async functions, so each can be checked on its
 * own.
 *
 * A regex rather than a real parse, which is the right trade for a lint of this
 * size — but it means "the function body" is approximated as *everything up to
 * the next export*, and the preceding comment block is included so an opt-out
 * written above the signature counts. Both approximations err toward reporting,
 * never toward silence.
 */
function* exportedFunctions(source: string): Generator<{ name: string; body: string }> {
  const matches = [...source.matchAll(EXPORTED_ASYNC_FN)];

  for (const [index, match] of matches.entries()) {
    const name = match[1];

    if (!name || match.index === undefined) {
      continue;
    }

    // Back up over any comment immediately preceding the signature.
    const precedingBreak = source.lastIndexOf('\n\n', match.index);
    const start = precedingBreak === -1 ? 0 : precedingBreak;
    const end = matches[index + 1]?.index ?? source.length;

    yield { name, body: source.slice(start, end) };
  }
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

    /*
     * Every public read declares its cache behaviour explicitly — checked **per
     * function**, not per file.
     *
     * This used to test the whole file for any directive, which meant one cached
     * export made every other export in that file invisible to the audit. That
     * is not hypothetical: `data/gift-certificates.ts` has a cached settings
     * read and a deliberately uncached balance lookup, and the file-level check
     * passed without ever looking at the second one. A file is exactly where
     * related reads live together, so it is the worst possible granularity.
     *
     * A read that genuinely must be dynamic opts out in writing:
     *
     *   // cache-audit: dynamic — <why>
     *   export async function getThing() { … }
     *
     * which keeps the exemption next to the code and forces a reason.
     */
    for (const { name, body } of exportedFunctions(source)) {
      if (CACHE_DIRECTIVE.test(body) || DYNAMIC_OPT_OUT.test(body)) {
        continue;
      }

      findings.push({
        file: rel,
        message:
          `exports async ${name} with no cache directive. Add one, or opt out with ` +
          '"// cache-audit: dynamic — <reason>" if it must not be cached.',
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
