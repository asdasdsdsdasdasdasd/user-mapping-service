import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isDatabaseUnavailableError } from '../errors/database-error.util';

const SERVER_ERROR_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR;

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * Single place where errors become HTTP responses.
 *
 * Expected errors (validation, not found, ...) keep their status and message.
 * Unexpected errors are logged with their stack and answered with a generic
 * message, so internals such as SQL or connection details never leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const body = this.toErrorResponse(exception, request);

    this.log(exception, request, body);
    response.status(body.statusCode).json(body);
  }

  private toErrorResponse(
    exception: unknown,
    request: Request,
  ): ErrorResponseBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return this.build(status, exception.name, payload, request);
      }

      const { error, message } = payload as {
        error?: string;
        message?: string | string[];
      };
      return this.build(
        status,
        error ?? exception.name,
        message ?? exception.message,
        request,
      );
    }

    if (isDatabaseUnavailableError(exception)) {
      return this.build(
        HttpStatus.SERVICE_UNAVAILABLE,
        'Service Unavailable',
        'The service is temporarily unable to reach its datastore. Please try again later.',
        request,
      );
    }

    return this.build(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal Server Error',
      'An unexpected error occurred.',
      request,
    );
  }

  private build(
    statusCode: number,
    error: string,
    message: string | string[],
    request: Request,
  ): ErrorResponseBody {
    return {
      statusCode,
      error,
      message,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    };
  }

  private log(
    exception: unknown,
    request: Request,
    body: ErrorResponseBody,
  ): void {
    const summary = `${request.method} ${request.originalUrl} -> ${body.statusCode}`;
    if (body.statusCode >= SERVER_ERROR_STATUS) {
      this.logger.error(
        summary,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }
    this.logger.warn(`${summary}: ${JSON.stringify(body.message)}`);
  }
}
