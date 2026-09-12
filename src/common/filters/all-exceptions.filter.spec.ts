import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

interface TestContext {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock<void, [ErrorBody]>;
}

const bodyOf = (json: jest.Mock<void, [ErrorBody]>): ErrorBody =>
  json.mock.calls[0][0];

const createContext = (): TestContext => {
  const json = jest.fn<void, [ErrorBody]>();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        originalUrl: '/api/v1/user-mappings',
      }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
};

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the status and validation messages of HTTP exceptions', () => {
    const context = createContext();

    filter.catch(
      new BadRequestException(['id1 should not be empty']),
      context.host,
    );

    const body = bodyOf(context.json);

    expect(context.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: ['id1 should not be empty'],
      path: '/api/v1/user-mappings',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('renders a not found exception as a 404 body', () => {
    const context = createContext();

    filter.catch(new NotFoundException('Cannot POST /unknown'), context.host);

    expect(context.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(bodyOf(context.json)).toMatchObject({
      statusCode: 404,
      message: 'Cannot POST /unknown',
    });
  });

  it('hides internal details of unexpected errors', () => {
    const context = createContext();

    filter.catch(
      new Error('ER_ACCESS_DENIED_ERROR: Access denied for user root'),
      context.host,
    );

    expect(context.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(bodyOf(context.json)).toMatchObject({
      statusCode: 500,
      message: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(context.json.mock.calls)).not.toContain(
      'ER_ACCESS_DENIED_ERROR',
    );
  });

  it('answers 503 when the database is unreachable', () => {
    const context = createContext();
    const error = new Error('connect ECONNREFUSED 127.0.0.1:3306');
    error.name = 'ConnectionError';

    filter.catch(error, context.host);

    expect(context.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(bodyOf(context.json)).toMatchObject({
      statusCode: 503,
      error: 'Service Unavailable',
    });
  });

  it('answers 500 for a duplicate key error that reached the filter', () => {
    const context = createContext();

    filter.catch(
      new QueryFailedError(
        'INSERT INTO user_mappings',
        [],
        Object.assign(new Error('Duplicate entry'), {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
        }),
      ),
      context.host,
    );

    expect(context.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });
});
