import 'reflect-metadata';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { databaseConfig, DatabaseConfig } from '../config';
import { UserMapping } from '../user-mapping/entities/user-mapping.entity';

loadEnv();

const database: DatabaseConfig = databaseConfig();

const shared = {
  entities: [UserMapping],
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
  migrationsTableName: 'migrations',
  synchronize: false,
};

const options: DataSourceOptions =
  database.type === 'better-sqlite3'
    ? {
        ...shared,
        type: 'better-sqlite3',
        database: database.database || ':memory:',
      }
    : {
        ...shared,
        type: 'mysql',
        host: database.host,
        port: database.port,
        username: database.username,
        password: database.password,
        database: database.database,
        charset: 'utf8mb4',
        timezone: 'Z',
      };

/**
 * DataSource used by the TypeORM CLI (npm run migration:*).
 * The running application builds its own options in DatabaseModule.
 * The default export is the single export on purpose: the CLI refuses files
 * that export more than one DataSource.
 */
export default new DataSource(options);
