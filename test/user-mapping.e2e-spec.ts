import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { UserMapping } from '../src/user-mapping/entities/user-mapping.entity';

const ENDPOINT = '/api/v1/user-mappings';
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UserMappingBody {
  userID: string;
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * Every test works on its own pair, and the run id keeps two runs of this suite
 * apart: identifiers are never deleted in production, so without it a Redis
 * cache filled by an earlier run would answer for the same pair and hide the
 * behaviour under test.
 */
const RUN_ID = randomUUID().slice(0, 8);

const pair = (name: string, family = 'A'): { id1: string; id2: string } => ({
  id1: `${RUN_ID}-${name}-${family}`,
  id2: `${RUN_ID}-${name}-${family}-B`,
});

describe('POST /api/v1/user-mappings (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let repository: Repository<UserMapping>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    // A real listening socket: supertest would otherwise start an ephemeral
    // server per request, which cannot serve the concurrent requests below.
    await app.listen(0);
    server = app.getHttpServer() as Server;

    repository = app.get(DataSource).getRepository(UserMapping);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await repository.clear();
  });

  const post = (body: object | string) =>
    request(server).post(ENDPOINT).send(body);

  const userIDOf = (response: request.Response): string =>
    (response.body as UserMappingBody).userID;

  const errorOf = (response: request.Response): ErrorBody =>
    response.body as ErrorBody;

  const countOf = (id1: string, id2: string): Promise<number> =>
    repository.count({ where: { id1, id2 } });

  it('generates and stores a UUID v4 for a pair seen for the first time', async () => {
    const { id1, id2 } = pair('CREATE');
    const response = await post({ id1, id2 });
    const userID = userIDOf(response);

    expect(response.status).toBe(200);
    expect(userID).toMatch(UUID_V4);

    const stored = await repository.find({ where: { id1, id2 } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id1, id2, userId: userID });
  });

  it('returns the same userID on every later request with the same pair', async () => {
    const { id1, id2 } = pair('REPEAT');

    const first = await post({ id1, id2 });
    const second = await post({ id1, id2 });
    const third = await post({ id1, id2 });

    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(userIDOf(second)).toBe(userIDOf(first));
    expect(userIDOf(third)).toBe(userIDOf(first));
    await expect(countOf(id1, id2)).resolves.toBe(1);
  });

  it('treats the pair as ordered and independent', async () => {
    const forward = pair('ORDER');
    const reversed = { id1: forward.id2, id2: forward.id1 };
    const different = pair('ORDER', 'C');

    const forwardResponse = await post(forward);
    const reversedResponse = await post(reversed);
    const differentResponse = await post(different);

    expect(userIDOf(reversedResponse)).not.toBe(userIDOf(forwardResponse));
    expect(userIDOf(differentResponse)).not.toBe(userIDOf(forwardResponse));
    await expect(countOf(forward.id1, forward.id2)).resolves.toBe(1);
    await expect(countOf(reversed.id1, reversed.id2)).resolves.toBe(1);
    await expect(countOf(different.id1, different.id2)).resolves.toBe(1);
  });

  it('trims whitespace around identifiers', async () => {
    const { id1, id2 } = pair('TRIM');

    const padded = await post({ id1: `  ${id1} `, id2: ` ${id2}  ` });
    const plain = await post({ id1, id2 });

    expect(userIDOf(padded)).toBe(userIDOf(plain));
    await expect(countOf(id1, id2)).resolves.toBe(1);
  });

  it('returns a single userID when identical requests arrive together', async () => {
    const { id1, id2 } = pair('RACE');

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => post({ id1, id2 })),
    );

    const userIds = new Set(responses.map(userIDOf));

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(userIds.size).toBe(1);
    expect([...userIds][0]).toMatch(UUID_V4);
    await expect(countOf(id1, id2)).resolves.toBe(1);
  });

  describe('validation', () => {
    it.each([
      ['an empty body', {}],
      ['a missing id2', { id1: 'ABC123' }],
      ['a blank id1', { id1: '   ', id2: 'XYZ456' }],
      ['a non-string id2', { id1: 'ABC123', id2: 42 }],
      [
        'an identifier longer than 64 characters',
        { id1: 'A'.repeat(65), id2: 'XYZ456' },
      ],
      [
        'an unknown extra field',
        { id1: 'ABC123', id2: 'XYZ456', role: 'admin' },
      ],
    ])('rejects %s with 400', async (_name, body) => {
      const response = await post(body);

      expect(response.status).toBe(400);
      expect(errorOf(response)).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        path: ENDPOINT,
      });
      expect(errorOf(response).message.length).toBeGreaterThan(0);
      await expect(repository.count()).resolves.toBe(0);
    });

    it('explains which field is wrong', async () => {
      const response = await post({ id1: 'ABC123' });
      const message = errorOf(response).message;
      const text = Array.isArray(message) ? message.join(' ') : message;

      expect(response.status).toBe(400);
      expect(text).toContain('id2');
    });

    it.each([
      ['a malformed JSON body', '{"id1": "ABC123",'],
      ['a JSON array', '[{"id1": "ABC123", "id2": "XYZ456"}]'],
    ])('rejects %s with 400', async (_name, body) => {
      const response = await request(server)
        .post(ENDPOINT)
        .set('Content-Type', 'application/json')
        .send(body);

      expect(response.status).toBe(400);
      expect(errorOf(response).statusCode).toBe(400);
    });
  });

  it('answers unknown routes with the shared error shape', async () => {
    const response = await request(server).get(ENDPOINT);

    expect(response.status).toBe(404);
    expect(errorOf(response)).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
    });
    expect(errorOf(response).timestamp).toEqual(expect.any(String));
  });
});
