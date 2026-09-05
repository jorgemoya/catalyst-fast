// @ts-check
// Ported from core/scripts/generate.cjs. Regenerates the BigCommerce schema SDL
// and the gql.tada introspection types from the live store.
const { generateSchema, generateOutput } = require('@gql.tada/cli-utils');
const { join } = require('node:path');

const graphqlApiDomain = process.env.BIGCOMMERCE_GRAPHQL_API_DOMAIN ?? 'mybigcommerce.com';

/** @param {string} name */
const required = (name) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  }

  return value;
};

const getEndpoint = () => {
  const storeHash = required('BIGCOMMERCE_STORE_HASH');
  const channelId = process.env.BIGCOMMERCE_CHANNEL_ID;

  // Not all stores have the channel-specific canonical URL backfilled, so
  // channel 1 uses the bare host. Kept from upstream (see MSF-2643).
  if (!channelId || channelId === '1') {
    return `https://store-${storeHash}.${graphqlApiDomain}/graphql`;
  }

  return `https://store-${storeHash}-${channelId}.${graphqlApiDomain}/graphql`;
};

const generate = async () => {
  try {
    await generateSchema({
      input: getEndpoint(),
      headers: { Authorization: `Bearer ${required('BIGCOMMERCE_STOREFRONT_TOKEN')}` },
      output: join(__dirname, '../bigcommerce.graphql'),
      tsconfig: undefined,
    });

    await generateOutput({
      disablePreprocessing: false,
      output: undefined,
      tsconfig: undefined,
    });
  } catch (error) {

    console.error(error);
    process.exit(1);
  }
};

generate();
