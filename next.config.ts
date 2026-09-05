import type { NextConfig } from 'next';

import { cacheProfiles } from './lib/cache/profiles';
import { buildConfig } from './lib/config';
import { cspHeader } from './lib/content-security-policy';

const urls = buildConfig.get('urls');

// `cacheHandlers` is only wired up when self-hosting. On Vercel the platform
// supplies both the default and remote handlers, and overriding them would be a
// downgrade. Off-platform, `CACHE_HANDLER=kv` points `use cache: remote` at the
// same KV infrastructure the proxy already uses for route resolution.
const cacheHandlers =
  process.env.CACHE_HANDLER === 'kv'
    ? {
        default: './lib/cache/handlers/kv.ts',
        remote: './lib/cache/handlers/kv.ts',
      }
    : undefined;

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The whole point of this project. Enables `use cache`, `use cache: private`,
  // `use cache: remote`, `cacheLife`, `cacheTag`, partial prerendering, and the
  // instant-navigation validation that keeps us honest about what's in the shell.
  cacheComponents: true,

  // Prefetch the static parts of a route ahead of navigation.
  partialPrefetching: true,

  // Registered profiles, callable as `cacheLife('product')`. See lib/cache/profiles.ts
  // for why the `stale` value on each is the load-bearing decision.
  cacheLife: cacheProfiles,

  ...(cacheHandlers && { cacheHandlers }),

  // BigCommerce generates canonical URLs with a trailing slash by default. This
  // must agree with the normalization in proxies/with-routes.ts or redirects loop.
  trailingSlash: process.env.TRAILING_SLASH !== 'false',

  typedRoutes: true,

  images: {
    // Product images are served straight from the BigCommerce CDN, which does its
    // own resizing via the `{:size}` token — see lib/image-loader.ts. These
    // patterns only cover images that still go through Next's optimizer.
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com', pathname: '/vi/**' },
      ...urls.cdnUrls.map((hostname) => ({ protocol: 'https' as const, hostname })),
    ],
  },


  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: cspHeader.replace(/\n/g, '') },
          // Warm the connection to the image CDN before the first <img> parses.
          ...urls.cdnUrls.map((url) => ({
            key: 'Link',
            value: `<https://${url}>; rel=preconnect`,
          })),
        ],
      },
    ];
  },
};

export default nextConfig;
