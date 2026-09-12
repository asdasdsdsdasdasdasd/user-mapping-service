import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisConfig } from '../config';
import { RedisService } from './redis.service';

const mockClient = {
  get: jest.fn(),
  set: jest.fn(),
  eval: jest.fn(),
  ping: jest.fn(),
  quit: jest.fn(),
  disconnect: jest.fn(),
  on: jest.fn(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => mockClient),
}));

const RedisConstructor = Redis as unknown as jest.Mock;

const createConfigService = (
  overrides: Partial<RedisConfig> = {},
): ConfigService =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      enabled: true,
      url: 'redis://localhost:6379',
      keyPrefix: 'test:',
      cacheTtlSeconds: 60,
      lockTtlMs: 1000,
      ...overrides,
    }),
  }) as unknown as ConfigService;

describe('RedisService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.on.mockReturnValue(mockClient);
    mockClient.quit.mockResolvedValue('OK');
  });

  it('reads and writes with the configured key prefix and TTL', async () => {
    const service = new RedisService(createConfigService());
    mockClient.get.mockResolvedValue('user-id');
    mockClient.set.mockResolvedValue('OK');

    await expect(service.get('id:abc')).resolves.toBe('user-id');
    await service.set('id:abc', 'user-id');

    expect(mockClient.get).toHaveBeenCalledWith('test:id:abc');
    expect(mockClient.set).toHaveBeenCalledWith(
      'test:id:abc',
      'user-id',
      'EX',
      60,
    );
  });

  it('returns a lock handle that releases only its own token', async () => {
    const service = new RedisService(createConfigService());
    mockClient.set.mockResolvedValue('OK');
    mockClient.eval.mockResolvedValue(1);

    const lock = await service.acquireLock('lock:abc');

    expect(lock).not.toBeNull();
    expect(mockClient.set).toHaveBeenCalledWith(
      'test:lock:abc',
      expect.any(String),
      'PX',
      1000,
      'NX',
    );

    await lock?.release();

    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get', KEYS[1])"),
      1,
      'test:lock:abc',
      expect.any(String),
    );
  });

  it('returns null when another holder owns the lock', async () => {
    const service = new RedisService(createConfigService());
    mockClient.set.mockResolvedValue(null);

    await expect(service.acquireLock('lock:abc')).resolves.toBeNull();
  });

  it('degrades gracefully when Redis fails', async () => {
    const service = new RedisService(createConfigService());
    mockClient.get.mockRejectedValue(new Error('connection refused'));
    mockClient.set.mockRejectedValue(new Error('connection refused'));
    mockClient.ping.mockRejectedValue(new Error('connection refused'));

    await expect(service.get('id:abc')).resolves.toBeNull();
    await expect(service.set('id:abc', 'user-id')).resolves.toBeUndefined();
    await expect(service.ping()).resolves.toBe(false);
  });

  it('does not connect at all when Redis is not configured', async () => {
    const service = new RedisService(createConfigService({ enabled: false }));

    expect(service.isEnabled).toBe(false);
    expect(RedisConstructor).not.toHaveBeenCalled();
    await expect(service.get('id:abc')).resolves.toBeNull();
    await expect(service.acquireLock('lock:abc')).resolves.toBeNull();
  });

  it('closes the connection on shutdown', async () => {
    const service = new RedisService(createConfigService());

    await service.onModuleDestroy();

    expect(mockClient.quit).toHaveBeenCalled();
  });
});
