import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { AttachmentsController } from './attachments.controller.js';
import { AttachmentAccessService } from './attachment-access.service.js';

@Module({ imports: [PermissionsModule], controllers: [AttachmentsController], providers: [AttachmentAccessService] })
export class AttachmentsModule {}
