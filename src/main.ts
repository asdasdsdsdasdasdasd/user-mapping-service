import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = configureApp(app);
  setupSwagger(app, config);

  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `Listening on http://localhost:${config.port}/${config.globalPrefix} (${config.env})`,
  );
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    'The application failed to start',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
