import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';

@Module({
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
