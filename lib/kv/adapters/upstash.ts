import { Redis } from '@upstash/redis';

import type { KvAdapter, SetCommandOptions } from '../types';

export class UpstashKvAdapter implements KvAdapter {
  private upstashKv = Redis.fromEnv();

  async mget<Data>(...keys: string[]): Promise<Array<Data | null>> {
    return this.upstashKv.mget<Data[]>(keys);
  }

  async set<Data>(key: string, value: Data, opts?: SetCommandOptions): Promise<Data | null> {
    const response = await this.upstashKv.set(key, value, opts);

    return response === 'OK' ? null : response;
  }
}
