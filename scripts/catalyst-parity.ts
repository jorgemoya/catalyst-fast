import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reports upstream Catalyst releases this repo has not yet reconciled.
 *
 *   pnpm parity            # fetch upstream tags, report undecided changes
 *   pnpm parity --all      # include entries already decided
 *   pnpm parity --no-fetch # use whatever tags are already local
 *
 * Reads `catalyst-parity.json` — the baseline release and one decision per
 * upstream PR — then walks every core release newer than the baseline and lists
 * each changelog entry with its status. Anything missing from the ledger is
 * reported as UNREVIEWED, and the script exits non-zero while any exist, so it
 * can gate CI.
 *
 * **Changelog entries, not commits, are the unit.** Catalyst ships through
 * changesets, so every user-facing change carries a PR-numbered entry, while
 * raw commits include release plumbing, CI, and the Makeswift variant. Upstream
 * commits that never reach a changelog are listed separately under the latest
 * release so a quiet internal change cannot slip past unnoticed.
 */

interface Decision {
  status: 'ported' | 'not-applicable' | 'pending';
  note?: string;
}

interface Ledger {
  upstream: { repo: string; remote: string; tagPrefix: string };
  baseline: string;
  decisions: Record<string, Decision>;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Plain semver compare; release tags here never carry pre-release suffixes. */
const compare = (a: string, b: string): number => {
  const [pa, pb] = [a, b].map((v) => v.split('.').map(Number));

  for (let i = 0; i < 3; i += 1) {
    const diff = (pa?.[i] ?? 0) - (pb?.[i] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
};

interface Entry {
  version: string;
  pr: string;
  summary: string;
}

/** Changelog entries for every version in (baseline, latest]. */
function changelogEntries(changelog: string, baseline: string): Entry[] {
  const entries: Entry[] = [];
  let version: string | null = null;

  for (const line of changelog.split('\n')) {
    const heading = /^## (\d+\.\d+\.\d+)\s*$/u.exec(line);

    if (heading?.[1]) {
      version = heading[1];
      continue;
    }

    if (!version || compare(version, baseline) <= 0) {
      continue;
    }

    const item = /^- \[#(\d+)\]\([^)]*\).*?! - (.*)$/u.exec(line);

    if (item?.[1] && item[2]) {
      // First sentence only — the entries run to several paragraphs.
      entries.push({ version, pr: item[1], summary: item[2].split(/(?<=\.)\s/u)[0] ?? item[2] });
    }
  }

  return entries;
}

function printUnreleased(repo: string, ledger: Ledger, latestTag: string): void {
  const unreleased = git(repo, 'log', '--format=%h %s', `${latestTag}..${ledger.upstream.remote}/canary`, '--', 'core')
    .split('\n')
    .filter((line) => line && !/Version Packages/u.test(line));

  if (unreleased.length > 0) {
    console.log('\nOn canary but not yet released (informational):');

    for (const line of unreleased) {
      console.log(`  ${line}`);
    }

    console.log('');
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const ledger = JSON.parse(await readFile(join(ROOT, 'catalyst-parity.json'), 'utf8')) as Ledger;
  const repo = resolve(ROOT, ledger.upstream.repo);

  if (!args.has('--no-fetch')) {
    // `--force`: upstream moves floating tags (`@latest`) on every release, and a
    // plain fetch refuses to clobber them. Version tags themselves never move.
    git(repo, 'fetch', '--tags', '--force', '--quiet', ledger.upstream.remote);
  }

  const releases = git(repo, 'tag', '-l', `${ledger.upstream.tagPrefix}*`)
    .split('\n')
    .map((tag) => tag.slice(ledger.upstream.tagPrefix.length))
    .filter((version) => /^\d+\.\d+\.\d+$/u.test(version))
    .sort(compare);

  const latest = releases.at(-1);

  if (!latest) {
    throw new Error(`No ${ledger.upstream.tagPrefix}* release tags found in ${repo}.`);
  }

  const latestTag = `${ledger.upstream.tagPrefix}${latest}`;
  const newer = releases.filter((version) => compare(version, ledger.baseline) > 0);

  console.log(`Baseline ${ledger.baseline} → latest release ${latest}`);

  if (newer.length === 0) {
    console.log('Up to date.');
    // Still worth seeing what is coming — it is the only advance notice.
    printUnreleased(repo, ledger, latestTag);

    return;
  }

  console.log(`Releases since baseline: ${newer.join(', ')}\n`);

  const entries = changelogEntries(git(repo, 'show', `${latestTag}:core/CHANGELOG.md`), ledger.baseline);
  let unreviewed = 0;
  let pending = 0;

  for (const version of [...newer].reverse()) {
    const inVersion = entries.filter((entry) => entry.version === version);

    if (inVersion.length === 0) {
      continue;
    }

    console.log(`## ${version}`);

    for (const entry of inVersion) {
      const decision = ledger.decisions[entry.pr];
      const status = decision?.status ?? 'UNREVIEWED';

      if (!decision) {
        unreviewed += 1;
      } else if (decision.status === 'pending') {
        pending += 1;
      }

      if (!args.has('--all') && (decision?.status === 'ported' || decision?.status === 'not-applicable')) {
        continue;
      }

      console.log(`  [${status}] #${entry.pr} ${entry.summary}`);

      if (decision?.note) {
        console.log(`      ${decision.note}`);
      }
    }

    console.log('');
  }

  /*
   * Changes that shipped in a release without a changelog entry. Filtered to
   * core, and to commits that are not the release bot's own "Version Packages".
   */
  const baselineTag = `${ledger.upstream.tagPrefix}${ledger.baseline}`;
  const silent = git(repo, 'log', '--format=%h %s', `${baselineTag}..${latestTag}`, '--', 'core')
    .split('\n')
    .filter((line) => line && !/Version Packages/u.test(line))
    .filter((line) => !entries.some((entry) => line.includes(`(#${entry.pr})`)));

  if (silent.length > 0) {
    console.log('Core commits in these releases without a changelog entry:');

    for (const line of silent) {
      console.log(`  ${line}`);
    }

    console.log('');
  }

  printUnreleased(repo, ledger, latestTag);

  console.log(`Summary: ${unreviewed} unreviewed, ${pending} pending.`);

  if (unreviewed > 0) {
    console.log('Add a decision for each unreviewed PR to catalyst-parity.json.');
    process.exitCode = 1;
  } else if (pending === 0) {
    console.log(`Everything through ${latest} is reconciled — bump "baseline" to ${latest}.`);
  }
}

main().catch((error: unknown) => {
  console.error('[parity] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
