import { ApiProperty } from '@nestjs/swagger';

export class UserMappingResponseDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description:
      'Stable userID for the submitted id1/id2 pair. The same pair always returns the same value.',
  })
  userID: string;
}
