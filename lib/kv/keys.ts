const VERSION = 'v1';

export const STORE_STATUS_KEY = 'storeStatus';

/**
 * Namespaced, versioned key. The version segment means a change to the cached
 * value's shape can't collide with entries written by a previous deploy — bump
 * it whenever the stored structure changes.
 */
export const kvKey = (key: string, channelId?: string): string => {
  const namespace = process.env.KV_NAMESPACE ?? process.env.BIGCOMMERCE_STORE_HASH ?? 'store';
  const id = channelId ?? process.env.BIGCOMMERCE_CHANNEL_ID ?? '1';

  return `${namespace}_${id}_${VERSION}_${key}`;
};
