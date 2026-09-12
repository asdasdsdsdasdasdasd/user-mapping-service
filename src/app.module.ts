import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration, envValidationSchema } from './config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { UserMappingModule } from './user-mapping/user-mapping.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: configuration,
      validationSchema: envValidationSchema,
      // Joi rejects unknown keys by default, which would fail on unrelated
      // process environment variables, and stops at the first error.
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    DatabaseModule,
    RedisModule,
    UserMappingModule,
    HealthModule,
  ],
})
export class AppModule {}
