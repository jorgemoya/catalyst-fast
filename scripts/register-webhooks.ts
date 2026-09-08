/**
 * Creates (or repoints) the BigCommerce webhook subscriptions this storefront
 * needs, so cache invalidation is driven by catalog changes rather than by
 * timers. Run once per environment, and again whenever the destination origin
 * changes.
 *
 *   pnpm register-webhooks          # create/update
 *   pnpm register-webhooks --list   # show what exists, change nothing
 *   pnpm register-webhooks --prune  # also delete our stale destinations
 *
 * Uses the **Management API** (`/v3/hooks`) with `BIGCOMMERCE_ACCESS_TOKEN`,
 * which is a different credential from the storefront token the app runs on.
 *
 * Idempotent by design: it reconciles against the scopes below rather than
 * blindly creating, because running it twice on a store that already has
 * subscriptions would otherwise double every webhook — and BigCommerce happily
 * lets you register the same scope and destination twice.
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });

/**
 * The scopes worth paying for. Each one maps to tags in `domain/webhooks.ts`;
 * subscribing to a scope that maps to nothing just costs requests.
 *
 * Deliberately *not* subscribing to order or customer scopes: those invalidate
 * `'use cache: private'` data, which lives in the browser and cannot be reached
 * by a server-side tag write. Those paths are kept fresh by `updateTag` +
 * `refresh()` from the actions that cause them.
 */
const SCOPES = [
  'store/product/created',
  'store/product/updated',
  'store/product/deleted',
  'store/product/inventory/updated',
  'store/product/inventory/order/updated',
  'store/category/created',
  'store/category/updated',
  'store/category/deleted',
  'store/brand/created',
  'store/brand/updated',
  'store/brand/deleted',
  'store/settings/general/updated',
  'store/settings/currency/updated',
] as const;

interface Hook {
  id: number;
  scope: string;
  destination: string;
  is_active: boolean;
}

const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
const accessToken = process.env.BIGCOMMERCE_ACCESS_TOKEN;
const origin = process.env.WEBHOOK_DESTINATION_ORIGIN;
const secret = process.env.BIGCOMMERCE_WEBHOOK_SECRET;

function requireEnv(): void {
  const missing = [
    !storeHash && 'BIGCOMMERCE_STORE_HASH',
    !accessToken && 'BIGCOMMERCE_ACCESS_TOKEN',
    !origin && 'WEBHOOK_DESTINATION_ORIGIN',
    !secret && 'BIGCOMMERCE_WEBHOOK_SECRET',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    console.error(
      '\nBIGCOMMERCE_ACCESS_TOKEN is a Management API token with the "Information & ' +
        'settings" scope, not the storefront token the app runs on.',
    );
    process.exit(1);
  }

  /*
   * BigCommerce will not deliver to a non-public URL, and a localhost
   * destination fails at creation time with a message that does not make the
   * cause obvious. Catch it here instead.
   */
  if (origin && /localhost|127\.0\.0\.1/.test(origin)) {
    console.error(
      `WEBHOOK_DESTINATION_ORIGIN is ${origin}, which BigCommerce cannot reach.\n` +
        'Use a public origin, or a tunnel (e.g. ngrok) when testing locally.',
    );
    process.exit(1);
  }
}

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3${path}`, {
    ...init,
    headers: {
      'X-Auth-Token': accessToken ?? '',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
};

async function listHooks(): Promise<Hook[]> {
  const { data } = await api<{ data: Hook[] }>('/hooks');

  return data;
}

async function main(): Promise<void> {
  const listOnly = process.argv.includes('--list');
  const prune = process.argv.includes('--prune');

  requireEnv();

  /*
   * The trailing slash is load-bearing, not cosmetic.
   *
   * `trailingSlash: true` is set in next.config.ts, so a POST to
   * `/api/webhooks/bigcommerce` answers **308** rather than running the handler.
   * Webhook senders generally do not replay a POST body across a redirect, so
   * registering the unslashed URL produces a subscription that silently never
   * invalidates anything — and looks healthy from the BigCommerce side, because
   * a 308 is not an error.
   *
   * Verified locally: unslashed → 308 for every request; slashed → 401/400/200
   * as intended.
   */
  const destination = `${origin?.replace(/\/$/, '')}/api/webhooks/bigcommerce/`;
  const existing = await listHooks();

  if (listOnly) {
    console.log(`${existing.length} subscription(s) on store ${storeHash}:\n`);
    for (const hook of existing) {
      console.log(`  ${hook.is_active ? '●' : '○'} ${hook.scope.padEnd(40)} → ${hook.destination}`);
    }

    return;
  }

  let created = 0;
  let kept = 0;

  for (const scope of SCOPES) {
    // Match on scope *and* destination: a store may legitimately have another
    // integration subscribed to the same scope, and clobbering it would break
    // somebody else's system.
    const match = existing.find((hook) => hook.scope === scope && hook.destination === destination);

    if (match) {
      kept++;
      continue;
    }

    await api('/hooks', {
      method: 'POST',
      body: JSON.stringify({
        scope,
        destination,
        is_active: true,
        // BigCommerce does not sign webhook bodies; this header is the shared
        // secret the receiver checks in constant time.
        headers: { 'x-webhook-token': secret },
      }),
    });

    created++;
    console.log(`  + ${scope}`);
  }

  console.log(`\n${created} created, ${kept} already correct → ${destination}`);

  if (prune) {
    /*
     * Only ever deletes hooks pointing at *our* destination path on a different
     * origin — a redeploy to a new domain leaves the old subscriptions behind,
     * silently delivering to a dead host until BigCommerce deactivates them.
     * Hooks belonging to other integrations are never touched.
     */
    const stale = existing.filter(
      (hook) =>
        hook.destination !== destination && hook.destination.endsWith('/api/webhooks/bigcommerce'),
    );

    for (const hook of stale) {
      await api(`/hooks/${hook.id}`, { method: 'DELETE' });
      console.log(`  - ${hook.scope} (${hook.destination})`);
    }

    console.log(`${stale.length} stale subscription(s) pruned`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
