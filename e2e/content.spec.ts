import { expect, test } from '@playwright/test';

import { BLOG_POST, BLOG_TAG, CONTACT_PAGE, NORMAL_PAGE, SEARCH_TERM } from './fixtures';

/**
 * Phase 5: search, web pages, blog, and the SEO routes.
 */



test.describe('search', () => {
  test('prompts rather than listing the whole catalog when there is no term', async ({ page }) => {
    // The failure this guards: an empty search key is an *unfiltered* listing,
    // so without the short-circuit this page would show the entire store and
    // spend a SearchProducts query doing it.
    await page.goto('/search/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Search');
    await expect(page.getByText('What are you looking for?')).toBeVisible();
    await expect(page.getByTestId('result-count')).toHaveCount(0);
  });

  test('returns results for a term, with facets and a count', async ({ page }) => {
    await page.goto(`/search/?term=${SEARCH_TERM}`);

    await expect(page.getByTestId('result-count').last()).toContainText(/product/);
    await expect(page.locator('article').filter({ visible: true }).first()).toBeVisible();
  });

  test('reports no matches without erroring', async ({ page }) => {
    await page.goto('/search/?term=zzzzzznotathing');

    await expect(page.getByText('No results')).toBeVisible();
  });

  test('submitting the field navigates to a term URL', async ({ page }) => {
    await page.goto('/search/');

    // Scoped to the page body: the header's quick-search trigger also has the
    // accessible name "Search", so an unscoped query is ambiguous.
    const main = page.locator('#main');

    await main.getByLabel('Search products').fill(SEARCH_TERM);
    await main.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`term=${SEARCH_TERM}`));
    await expect(page.getByTestId('result-count').last()).toBeVisible();
  });

  test('puts the term in the document title but not the heading', async ({ page }) => {
    // The h1 stays static so it can live in the prerendered shell; the tab title
    // is resolved separately and can be specific.
    await page.goto(`/search/?term=${SEARCH_TERM}`);

    await expect(page).toHaveTitle(new RegExp(SEARCH_TERM, 'i'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Search');
  });

  test('is excluded from indexing', async ({ page }) => {
    // Search pages are an unbounded URL space with thin, duplicated content —
    // the classic crawl-budget sink. Category pages are the indexable surface.
    await page.goto(`/search/?term=${SEARCH_TERM}`);

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
  });
});

test.describe('quick search', () => {
  test('suggests products from the header and links through', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByLabel('Search products').fill(SEARCH_TERM);

    const suggestions = page.getByTestId('search-suggestions');

    await expect(suggestions).toBeVisible();
    await expect(suggestions.getByRole('link').first()).toBeVisible();

    await suggestions.getByRole('link').first().click();
    await expect(page.getByTestId('add-to-cart')).toBeVisible();
  });

  test('stays quiet below the minimum query length', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByLabel('Search products').fill('pl');

    // Two characters must not produce a request — every keystroke below the
    // threshold would be a cache miss on a key nobody else will request.
    await expect(page.getByTestId('search-suggestions')).toHaveCount(0);
  });
});

test.describe('blog', () => {
  test('lists posts', async ({ page }) => {
    await page.goto('/blog/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('blog-posts').getByRole('listitem').first()).toBeVisible();
  });

  test('renders a post reached by its vanity URL', async ({ page }) => {
    // The proxy resolves the merchant's post path to /blog/{entityId}.
    await page.goto(BLOG_POST);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/);
    await expect(page.locator('time')).toBeVisible();
    await expect(page).toHaveURL(BLOG_POST);
  });

  test('tag links filter the index', async ({ page }) => {
    await page.goto(BLOG_POST);

    const tag = page.getByRole('link', { name: BLOG_TAG });

    await expect(tag).toBeVisible();
    await tag.click();

    await expect(page).toHaveURL(new RegExp(`tag=${BLOG_TAG}`));
    await expect(page.getByTestId('blog-posts')).toBeVisible();
  });
});

test.describe('web pages', () => {
  test('renders a normal page at its vanity URL', async ({ page }) => {
    // The proxy resolves the merchant path to /webpages/{nodeId}/normal/.
    await page.goto(NORMAL_PAGE);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/);
    await expect(page).toHaveURL(NORMAL_PAGE);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
  });

  test('renders the contact page with the fields the merchant enabled', async ({ page }) => {
    await page.goto(CONTACT_PAGE);

    // This page enables all five optional fields; email and comments are always
    // present because BigCommerce treats them as implicit and required.
    for (const label of ['Full name', 'Company', 'Phone number', 'Order number', 'RMA number']) {
      await expect(page.getByLabel(label)).toBeVisible();
    }

    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Message')).toBeVisible();
  });

  test('blocks an invalid address before it reaches the server', async ({ page }) => {
    /*
     * `type="email" required` means the browser refuses to submit, so the action
     * never runs — which is the desired behavior and is why this asserts on
     * native validity rather than on a server-rendered error.
     *
     * The server-side schema is the real guard (a crafted POST bypasses the
     * browser entirely) and is covered by `domain/contact.spec.ts`. It is *not*
     * exercised end to end here on purpose: a valid submission sends a real email
     * to the merchant's inbox, which is not something a test suite should do to a
     * live store.
     */
    await page.goto(CONTACT_PAGE);

    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Message').fill('Hello');
    await page.getByRole('button', { name: 'Send message' }).click();

    const emailValid = await page
      .getByLabel('Email')
      .evaluate((element) => (element as HTMLInputElement).validity.valid);

    expect(emailValid).toBe(false);
    // Still on the form, nothing sent, input preserved.
    await expect(page.getByTestId('contact-success')).toHaveCount(0);
    await expect(page.getByLabel('Message')).toHaveValue('Hello');
  });
});

test.describe('internal routes', () => {
  test('a blog post is not reachable at its rewrite target', async ({ request }) => {
    /*
     * Same rule products and categories already followed: `/blog/1` is what the
     * proxy rewrites *to*, never a URL a shopper or crawler should hold. Serving
     * it would publish the same post at a second, non-canonical address — and
     * `notFound()` cannot set a status once a PPR shell has flushed, so it would
     * be a 200.
     */
    expect((await request.get('/blog/1/')).status()).toBe(404);
  });

  test('a web page is not reachable at its rewrite target', async ({ request }) => {
    expect((await request.get('/webpages/anything/normal/')).status()).toBe(404);
    expect((await request.get('/webpages/anything/contact/')).status()).toBe(404);
  });

  test('the blog index itself stays reachable', async ({ page }) => {
    // The guard must not catch `/blog` — that one is a real, canonical URL.
    await page.goto('/blog/');
    await expect(page.getByTestId('blog-posts')).toBeVisible();
  });
});

test.describe('SEO routes', () => {
  test('sitemap.xml serves a sitemap index', async ({ request }) => {
    const response = await request.get('/sitemap.xml');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('xml');
    expect(await response.text()).toContain('<sitemapindex');
  });

  test('robots.txt carries a Sitemap directive', async ({ request }) => {
    const response = await request.get('/robots.txt');
    const body = await response.text();

    expect(response.status()).toBe(200);
    // Appended by us rather than left to the merchant: their stored robots.txt
    // may still point at the legacy /xmlsitemap.php path.
    expect(body).toContain('Sitemap:');
    expect(body).toContain('/sitemap.xml');
  });

  test('the legacy Stencil sitemap path redirects permanently', async ({ request }) => {
    const response = await request.get('/xmlsitemap.php', { maxRedirects: 0 });

    expect(response.status()).toBe(308);
    expect(response.headers().location).toContain('/sitemap.xml');
  });
});
