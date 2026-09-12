import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isDuplicateKeyError } from '../common/errors/database-error.util';
import { RedisService } from '../redis/redis.service';
import { ResolveUserMappingDto } from './dto/resolve-user-mapping.dto';
import { UserMapping } from './entities/user-mapping.entity';

export interface UserMappingResolution {
  userId: string;
  created: boolean;
}

@Injectable()
export class UserMappingService {
  private readonly logger = new Logger(UserMappingService.name);

  constructor(
    @InjectRepository(UserMapping)
    private readonly userMappings: Repository<UserMapping>,
    private readonly redis: RedisService,
  ) {}

  /**
   * Returns the userID stored for the given id1/id2 pair, creating it on first
   * sight. The operation is idempotent: repeated calls always answer with the
   * same userID.
   */
  async resolve(dto: ResolveUserMappingDto): Promise<UserMappingResolution> {
    const { id1, id2 } = dto;
    const cacheKey = this.pairKey('id', id1, id2);

    const cachedUserId = await this.redis.get(cacheKey);
    if (cachedUserId) {
      return { userId: cachedUserId, created: false };
    }

    const stored = await this.findByPair(id1, id2);
    if (stored) {
      await this.redis.set(cacheKey, stored.userId);
      return { userId: stored.userId, created: false };
    }

    return this.createMapping(id1, id2, cacheKey);
  }

  private async createMapping(
    id1: string,
    id2: string,
    cacheKey: string,
  ): Promise<UserMappingResolution> {
    // Best-effort lock so that two identical requests arriving together do not
    // both reach the insert. Not acquiring it is normal (Redis down, or another
    // request holds it) - the unique index below is the real guarantee.
    const lock = await this.redis.acquireLock(this.pairKey('lock', id1, id2));
    try {
      // Re-check while holding the lock: the row may have appeared between our
      // first SELECT and the lock acquisition.
      const stored = await this.findByPair(id1, id2);
      if (stored) {
        await this.redis.set(cacheKey, stored.userId);
        return { userId: stored.userId, created: false };
      }

      const userId = randomUUID();
      try {
        await this.userMappings.insert({ id1, id2, userId });
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
        // Lost the race: another request stored the pair first, so return its
        // userID instead of failing or creating a duplicate.
        const winner = await this.findByPair(id1, id2);
        if (!winner) {
          throw error;
        }
        await this.redis.set(cacheKey, winner.userId);
        return { userId: winner.userId, created: false };
      }

      await this.redis.set(cacheKey, userId);
      this.logger.log(`Created user mapping for id1=${id1} id2=${id2}`);
      return { userId, created: true };
    } finally {
      await lock?.release();
    }
  }

  private findByPair(id1: string, id2: string): Promise<UserMapping | null> {
    return this.userMappings.findOne({ where: { id1, id2 } });
  }

  /**
   * Redis keys are derived from a hash so that arbitrary identifiers cannot
   * collide or leak into the key space.
   */
  private pairKey(kind: 'id' | 'lock', id1: string, id2: string): string {
    const digest = createHash('sha256')
      .update(id1)
      .update('\u0000')
      .update(id2)
      .digest('hex');
    return `${kind}:${digest}`;
  }
}
