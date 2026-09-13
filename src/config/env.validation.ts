import * as Joi from 'joi';

/**
 * Fail fast on boot when the configuration is invalid, so the application never
 * starts with a half-configured database or Redis connection.
 * Secret values are supplied through the environment and never defaulted here.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  API_GLOBAL_PREFIX: Joi.string().default('api'),

  DB_TYPE: Joi.string().valid('mysql', 'better-sqlite3').default('mysql'),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(3306),
  DB_USERNAME: Joi.string().when('DB_TYPE', {
    is: 'mysql',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  DB_PASSWORD: Joi.string().allow('').default(''),
  DB_DATABASE: Joi.string().when('DB_TYPE', {
    is: 'mysql',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().allow('').default(':memory:'),
  }),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),
  DB_POOL_SIZE: Joi.number().integer().min(1).max(100).default(10),

  // Optional by design: leaving REDIS_URL empty disables the Redis cache and lock.
  REDIS_URL: Joi.string().allow('').default(''),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_KEY_PREFIX: Joi.string().default('user-mapping:'),
  REDIS_CACHE_TTL_SECONDS: Joi.number().integer().min(1).default(900),
  REDIS_LOCK_TTL_MS: Joi.number().integer().min(1000).default(5000),
});
