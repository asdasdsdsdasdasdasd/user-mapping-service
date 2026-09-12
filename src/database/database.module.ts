import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DatabaseConfig } from '../config';
import { UserMapping } from '../user-mapping/entities/user-mapping.entity';

export function buildTypeOrmOptions(
  database: DatabaseConfig,
): TypeOrmModuleOptions {
  const shared = {
    entities: [UserMapping],
    migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
    migrationsTableName: 'migrations',
    synchronize: database.synchronize,
    logging: database.logging,
    autoLoadEntities: false,
  };

  if (database.type === 'better-sqlite3') {
    // Test-only driver: lets the integration tests run without Docker.
    return {
      ...shared,
      type: 'better-sqlite3',
      database: database.database || ':memory:',
    };
  }

  return {
    ...shared,
    type: 'mysql',
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.database,
    charset: 'utf8mb4',
    timezone: 'Z',
    extra: { connectionLimit: database.poolSize },
  };
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions =>
        buildTypeOrmOptions(
          configService.getOrThrow<DatabaseConfig>('database'),
        ),
    }),
  ],
})
export class DatabaseModule {}
