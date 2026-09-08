import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

/*
 * Playwright does not read `.env.local` — neither for the web server it spawns
 * nor for the test process itself. Without this, `next start` comes up with no
 * `AUTH_SECRET` (so every auth flow 500s) and the signed-in suite silently skips
 * because it can't see the test credentials. Both failures look like "nothing to
 * do here" rather than "misconfigured", which is the worst way for them to
 * present.
 */
loadEnv({ path: '.env.local', quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3200);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Runs against a **production build**, not `next dev`. Everything this suite
 * exists to protect — static shells, PPR streaming, proxy rewrites — behaves
 * differently in dev, so testing dev would test the wrong thing.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',

    /*
     * Start every test as a shopper who has already answered the cookie banner.
     *
     * The banner is `position: fixed` along the bottom of the viewport, so on a
     * store with cookie consent enabled it sits on top of whatever is down
     * there and swallows clicks. That is correct behaviour for a consent banner
     * and a miserable thing to run a test suite against — it surfaced as the
     * wishlist round-trip failing at an `aria-pressed` assertion, several steps
     * after the click it had actually eaten.
     *
     * Seeding the cookie is also the more realistic baseline: a returning
     * shopper has made this choice once and never sees the banner again. Tests
     * that specifically cover the banner should clear this cookie themselves.
     */
    storageState: {
      cookies: [
        {
          name: 'cf.consent',
          value: encodeURIComponent(
            `i.t:${Date.now()},c.necessary:1,c.functionality:1,c.marketing:1,c.measurement:1`,
          ),
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Same env the app gets from `pnpm start`, so the server under test
    // behaves identically to a real one.
    command: `npx dotenv -e .env.local -- next start -p ${PORT}`,
    /*
     * next-auth refuses to build callback URLs from an untrusted `Host` header,
     * which is the right default — a spoofed Host would otherwise let an attacker
     * redirect the OAuth/credentials flow to their own domain. It auto-trusts on
     * Vercel; everywhere else it must be opted into.
     *
     * Set here because the suite talks to 127.0.0.1, where the Host cannot be
     * spoofed by a third party. **A self-hosted deployment needs the same
     * variable set**, or every auth request fails with an opaque `UntrustedHost`.
     */
    env: { AUTH_TRUST_HOST: 'true' },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
