import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfig } from './config';

/**
 * HTTP wiring shared by the running application and the integration tests, so
 * both exercise exactly the same pipeline.
 */
export function configureApp(app: INestApplication): AppConfig {
  const config = app.get(ConfigService).getOrThrow<AppConfig>('app');

  app.setGlobalPrefix(config.globalPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  return config;
}

export function setupSwagger(app: INestApplication, config: AppConfig): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('User Mapping API')
      .setDescription(
        'Resolves a stable userID for an (id1, id2) pair, creating it on first sight.',
      )
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup(`${config.globalPrefix}/docs`, app, document);
}
