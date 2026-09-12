import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { UserMapping } from './entities/user-mapping.entity';
import { UserMappingService } from './user-mapping.service';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const duplicateKeyError = (): QueryFailedError =>
  new QueryFailedError(
    'INSERT INTO user_mappings',
    [],
    Object.assign(
      new Error(
        "Duplicate entry 'ABC123-XYZ456' for key 'uq_user_mappings_id1_id2'",
      ),
      { code: 'ER_DUP_ENTRY', errno: 1062 },
    ),
  );

interface RepositoryMock {
  findOne: jest.Mock;
  insert: jest.Mock;
}

interface RedisMock {
  get: jest.Mock;
  set: jest.Mock;
  acquireLock: jest.Mock;
}

describe('UserMappingService', () => {
  let service: UserMappingService;
  let repository: RepositoryMock;
  let redis: RedisMock;
  let releaseLock: jest.Mock;

  const dto = { id1: 'ABC123', id2: 'XYZ456' };

  beforeEach(async () => {
    releaseLock = jest.fn().mockResolvedValue(undefined);
    repository = {
      findOne: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      acquireLock: jest.fn().mockResolvedValue({ release: releaseLock }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserMappingService,
        {
          provide: getRepositoryToken(UserMapping),
          useValue: repository,
        },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(UserMappingService);
  });

  it('creates and stores a UUID v4 userID the first time a pair is seen', async () => {
    const result = await service.resolve(dto);

    expect(result.created).toBe(true);
    expect(result.userId).toMatch(UUID_V4);
    expect(repository.insert).toHaveBeenCalledWith({
      id1: 'ABC123',
      id2: 'XYZ456',
      userId: result.userId,
    });
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), result.userId);
    expect(releaseLock).toHaveBeenCalled();
  });

  it('returns the stored userID when the pair already exists', async () => {
    repository.findOne.mockResolvedValue({
      id: '1',
      id1: 'ABC123',
      id2: 'XYZ456',
      userId: '550e8400-e29b-41d4-a716-446655440000',
    });

    const result = await service.resolve(dto);

    expect(result).toEqual({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      created: false,
    });
    expect(repository.insert).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('answers from the cache without touching the database on a cache hit', async () => {
    redis.get.mockResolvedValue('cached-user-id');

    const result = await service.resolve(dto);

    expect(result).toEqual({ userId: 'cached-user-id', created: false });
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('returns the winner userID when a concurrent request inserts the pair first', async () => {
    repository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: 'winner-user-id' });
    repository.insert.mockRejectedValue(duplicateKeyError());

    const result = await service.resolve(dto);

    expect(result).toEqual({ userId: 'winner-user-id', created: false });
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      'winner-user-id',
    );
    expect(releaseLock).toHaveBeenCalled();
  });

  it('propagates unexpected database errors', async () => {
    repository.insert.mockRejectedValue(new Error('connection lost'));

    await expect(service.resolve(dto)).rejects.toThrow('connection lost');
    expect(redis.set).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalled();
  });

  it('stays correct when Redis is unavailable', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(null);
    redis.acquireLock.mockResolvedValue(null);

    const result = await service.resolve(dto);

    expect(result.created).toBe(true);
    expect(result.userId).toMatch(UUID_V4);
    expect(repository.insert).toHaveBeenCalledTimes(1);
  });
});
