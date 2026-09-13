import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisConfig } from '../config';

/**
 * Handle for a lock we own. Releasing is idempotent and only removes the lock
 * when the stored token is still ours.
 */
export interface LockHandle {
  release(): Promise<void>;
}

const RELEASE_LOCK_SCRIPT = [
  "if redis.call('get', KEYS[1]) == ARGV[1] then",
  "  return redis.call('del', KEYS[1])",
  'end',
  'return 0',
].join('\n');

/**
 * Thin, failure-tolerant wrapper around Redis.
 *
 * Redis is used as a cache and as a best-effort lock, never as the source of
 * truth: every method resolves to a neutral value when Redis is unreachable or
 * disabled, so a Redis outage degrades performance but never correctness.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private readonly keyPrefix: string;
  private readonly lockTtlMs: number;
  private readonly cacheTtlSeconds: number;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<RedisConfig>('redis');
    this.keyPrefix = config.keyPrefix;
    this.lockTtlMs = config.lockTtlMs;
    this.cacheTtlSeconds = config.cacheTtlSeconds;

    if (!config.enabled) {
      this.client = null;
      this.logger.log('Redis is disabled (REDIS_URL is empty); MySQL only');
      return;
    }

    this.client = new Redis(config.url, {
      password: config.password.length > 0 ? config.password : undefined,
      // Fail fast instead of queueing commands while Redis is unreachable.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (attempt: number) => Math.min(attempt * 500, 5000),
    });
    // An unhandled 'error' event would otherwise crash the process.
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  /** False when REDIS_URL is empty: no cache, no lock, still fully correct. */
  get isEnabled(): boolean {
    return this.client !== null;
  }

  async get(key: string): Promise<string | null> {
    return this.execute('GET', (client) => client.get(this.prefixed(key)));
  }

  async set(key: string, value: string): Promise<void> {
    await this.execute('SET', (client) =>
      client.set(this.prefixed(key), value, 'EX', this.cacheTtlSeconds),
    );
  }

  /**
   * SET NX with a TTL: if the process dies while holding the lock, Redis
   * releases it on expiry and no request is blocked forever.
   */
  async acquireLock(
    key: string,
    ttlMs: number = this.lockTtlMs,
  ): Promise<LockHandle | null> {
    const lockKey = this.prefixed(key);
    const token = randomUUID();
    const result = await this.execute('SET NX', (client) =>
      client.set(lockKey, token, 'PX', ttlMs, 'NX'),
    );

    if (result !== 'OK') {
      return null;
    }

    return {
      release: async (): Promise<void> => {
        await this.execute('EVAL', (client) =>
          client.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token),
        );
      },
    };
  }

  async ping(): Promise<boolean> {
    return (await this.execute('PING', (client) => client.ping())) === 'PONG';
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  private prefixed(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private async execute<T>(
    operation: string,
    run: (client: Redis) => Promise<T>,
  ): Promise<T | null> {
    if (!this.client) {
      return null;
    }
    try {
      return await run(this.client);
    } catch (error) {
      this.logger.warn(
        `Redis ${operation} failed (${(error as Error).message}); continuing without Redis`,
      );
      return null;
    }
  }
}
