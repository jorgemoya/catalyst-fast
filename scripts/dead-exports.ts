import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Finds exported symbols that nothing imports.
 *
 * **Written because this repo kept shipping the same bug.** Four separate
 * defects in one working session were all the same shape — a value that existed,
 * was documented, and was never actually read:
 *
 *   `StoreLocale.isDefault`      fed the language switcher the wrong default
 *   `ChannelConfig.channelId`    every query went to the default channel anyway
 *   `StoreCurrency.symbol`       carried from BigCommerce, rendered nowhere
 *   `cacheProfiles.route`        registered a cache profile with no callers
 *
 * None of them failed a type check, a test, or a build. Two of them made
 * `channels.ts` claim behaviour the code did not have, which is worse than the
 * dead code itself: the comment is what the next person believes.
 *
 * **Deliberately narrow, and reports rather than fails.** It scans the modules
 * where the bugs actually happened — pure config, domain logic, and the data
 * layer — and skips `app/` entirely, because Next's file conventions
 * (`default`, `generateMetadata`, `generateStaticParams`, route handlers) are
 * exports nothing imports *by design*. A checker that cries wolf about those
 * would be turned off within a week.
 *
 * A hit is a question, not a verdict: "is this wired up, or does it just look
 * like it is?" Sometimes the answer is "delete it" and sometimes it is "wire it
 * in" — `channelId` needed the second.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the bugs were. Pure modules whose exports should all have callers. */
const SCANNED = ['data', 'domain', 'lib'];

/** Everything that might reference a symbol, including the scanned dirs. */
const SEARCHED = ['app', 'data', 'domain', 'lib', 'ui', 'proxies', 'i18n', 'scripts'];

const SKIP_DIR = new Set(['node_modules', '.next']);

/** Root-level files that consume exports without living in a scanned directory. */
const ROOT_FILES = ['next.config.ts', 'proxy.ts', 'instrumentation.ts'];

/*
 * Exports that exist to be consumed from outside the repo, or by a framework,
 * rather than by another module here. Each needs a reason.
 */
const ALLOWED = new Map<string, string>([
  ['proxy', 'Next middleware entry point'],
  ['config', 'Next middleware matcher'],
]);

async function walk(dir: string, out: string[] = [], includeSpecs = false): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) {
        await walk(join(dir, entry.name), out, includeSpecs);
      }
    } else if (/\.tsx?$/u.test(entry.name)) {
      // Specs are never *scanned* — a spec exports nothing anyone imports — but
      // they must be *searched*, or every symbol that only a test exercises
      // looks dead. Getting this backwards produced a wall of false positives.
      if (includeSpecs || !/\.spec\.tsx?$/u.test(entry.name)) {
        out.push(join(dir, entry.name));
      }
    }
  }

  return out;
}

/**
 * Exported **values** declared in a file — not types.
 *
 * Types are excluded on purpose. Most are used structurally rather than by name
 * (a return type, a field's type), so a name-based search calls them dead when
 * they are load-bearing. Including them buried the real findings under about
 * twenty false ones, which is how a check gets ignored.
 */
function exportedNames(source: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/gu,
    /export\s+(?:const|let|class|enum)\s+(\w+)/gu,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  }

  return [...names];
}

async function main(): Promise<void> {
  const scanned = (await Promise.all(SCANNED.map((dir) => walk(join(ROOT, dir))))).flat();
  const searched = [
    ...(await Promise.all(SEARCHED.map((dir) => walk(join(ROOT, dir), [], true)))).flat(),
    ...ROOT_FILES.map((file) => join(ROOT, file)),
  ];

  const sources = new Map<string, string>();

  await Promise.all(
    [...new Set([...scanned, ...searched])].map(async (file) => {
      sources.set(file, await readFile(file, 'utf8'));
    }),
  );

  const dead: string[] = [];

  for (const file of scanned) {
    const own = sources.get(file) ?? '';

    for (const name of exportedNames(own)) {
      if (ALLOWED.has(name)) {
        continue;
      }

      /*
       * Word-boundary match across every other file. Crude on purpose: a
       * substring hit is a false negative (we stay quiet), never a false alarm,
       * and staying quiet is the right failure mode for an advisory check.
       */
      const referenced = [...sources.entries()].some(
        ([other, text]) => other !== file && new RegExp(`\\b${name}\\b`, 'u').test(text),
      );

      if (!referenced) {
        dead.push(`${relative(ROOT, file)} — ${name}`);
      }
    }
  }

  if (dead.length === 0) {
    console.log('No unreferenced exports.');

    return;
  }

  console.log(`Unreferenced exports (${dead.length}) — wired up, or only look it?\n`);

  for (const entry of dead.sort()) {
    console.log(`  ${entry}`);
  }
}

main().catch((error: unknown) => {
  console.error('[dead-exports] failed:', error);
  process.exit(1);
});
