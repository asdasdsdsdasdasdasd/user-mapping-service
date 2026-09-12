import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResolveUserMappingDto } from './resolve-user-mapping.dto';

const validatePayload = async (payload: unknown): Promise<string[]> => {
  const errors = await validate(
    plainToInstance(ResolveUserMappingDto, payload),
  );
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
};

describe('ResolveUserMappingDto', () => {
  it('accepts a well formed pair', async () => {
    await expect(
      validatePayload({ id1: 'ABC123', id2: 'XYZ456' }),
    ).resolves.toEqual([]);
  });

  it('trims surrounding whitespace', () => {
    const dto = plainToInstance(ResolveUserMappingDto, {
      id1: '  ABC123  ',
      id2: ' XYZ456 ',
    });

    expect(dto).toEqual({ id1: 'ABC123', id2: 'XYZ456' });
  });

  it.each([
    ['id1 is missing', { id2: 'XYZ456' }, 'id1'],
    ['id2 is missing', { id1: 'ABC123' }, 'id2'],
    ['id1 is blank', { id1: '   ', id2: 'XYZ456' }, 'id1'],
    ['id1 is not a string', { id1: 123, id2: 'XYZ456' }, 'id1'],
    ['id2 is null', { id1: 'ABC123', id2: null }, 'id2'],
    ['id1 is too long', { id1: 'A'.repeat(65), id2: 'XYZ456' }, 'id1'],
  ])('rejects the payload when %s', async (_name, payload, field) => {
    const messages = await validatePayload(payload);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join(' ')).toContain(field);
  });
});
