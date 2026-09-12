import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { RedisService } from '../redis/redis.service';

type ComponentStatus = 'up' | 'down' | 'disabled';

interface HealthResponse {
  status: 'ok' | 'error';
  database: ComponentStatus;
  redis: ComponentStatus;
}

/** Liveness/readiness probe used by Docker Compose and monitoring. */
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Report the health of the application dependencies',
  })
  @ApiOkResponse({ description: 'The application and its datastore are up.' })
  @ApiServiceUnavailableResponse({ description: 'The datastore is down.' })
  async check(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponse> {
    const database = await this.checkDatabase();
    const redis = await this.checkRedis();

    // Only MySQL is required: without Redis the application still behaves correctly.
    const healthy = database === 'up';
    response.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return { status: healthy ? 'ok' : 'error', database, redis };
  }

  private async checkDatabase(): Promise<ComponentStatus> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<ComponentStatus> {
    if (!this.redis.isEnabled) {
      return 'disabled';
    }
    return (await this.redis.ping()) ? 'up' : 'down';
  }
}
