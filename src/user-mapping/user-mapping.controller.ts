import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ResolveUserMappingDto } from './dto/resolve-user-mapping.dto';
import { UserMappingResponseDto } from './dto/user-mapping-response.dto';
import { UserMappingService } from './user-mapping.service';

@ApiTags('user-mappings')
@Controller({ path: 'user-mappings', version: '1' })
export class UserMappingController {
  constructor(private readonly userMappingService: UserMappingService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve the userID for an id1/id2 pair',
    description:
      'Returns the stored userID when the pair already exists, otherwise generates a UUID v4, stores it and returns it. Idempotent: the same pair always returns the same userID.',
  })
  @ApiOkResponse({
    description: 'The existing or newly generated userID.',
    type: UserMappingResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'The request body is missing or invalid.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The datastore is temporarily unreachable.',
    type: ApiErrorDto,
  })
  async resolve(
    @Body() dto: ResolveUserMappingDto,
  ): Promise<UserMappingResponseDto> {
    const { userId } = await this.userMappingService.resolve(dto);
    return { userID: userId };
  }
}
