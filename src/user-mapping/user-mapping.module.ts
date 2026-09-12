import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '../redis/redis.module';
import { UserMapping } from './entities/user-mapping.entity';
import { UserMappingController } from './user-mapping.controller';
import { UserMappingService } from './user-mapping.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserMapping]), RedisModule],
  controllers: [UserMappingController],
  providers: [UserMappingService],
})
export class UserMappingModule {}
