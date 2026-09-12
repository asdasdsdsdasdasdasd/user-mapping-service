import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const MAX_ID_LENGTH = 64;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Request body of POST /api/v1/user-mappings. Both identifiers are required. */
export class ResolveUserMappingDto {
  @ApiProperty({
    example: 'ABC123',
    maxLength: MAX_ID_LENGTH,
    description: 'First identifier of the pair',
  })
  @Transform(trim)
  @IsString({ message: 'id1 must be a string' })
  @IsNotEmpty({ message: 'id1 should not be empty' })
  @MaxLength(MAX_ID_LENGTH, {
    message: `id1 must be shorter than or equal to ${MAX_ID_LENGTH} characters`,
  })
  id1: string;

  @ApiProperty({
    example: 'XYZ456',
    maxLength: MAX_ID_LENGTH,
    description: 'Second identifier of the pair',
  })
  @Transform(trim)
  @IsString({ message: 'id2 must be a string' })
  @IsNotEmpty({ message: 'id2 should not be empty' })
  @MaxLength(MAX_ID_LENGTH, {
    message: `id2 must be shorter than or equal to ${MAX_ID_LENGTH} characters`,
  })
  id2: string;
}
