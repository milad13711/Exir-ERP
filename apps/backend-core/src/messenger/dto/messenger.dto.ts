import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { GROUP_CREATION_MODES, MESSENGER_POLICIES } from '../messenger-policy.js';

export class CreateDirectDto {
  @IsUUID()
  userId!: string;
}

export class CreateGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  memberIds!: string[];
}

export class RenameGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title!: string;
}

export class AddMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  userIds!: string[];
}

export class SetRoleDto {
  @IsIn(['ADMIN', 'MEMBER'])
  role!: 'ADMIN' | 'MEMBER';
}

export class MuteDto {
  @IsBoolean()
  muted!: boolean;
}

export class PinChatDto {
  @IsBoolean()
  pinned!: boolean;
}

export class ArchiveChatDto {
  @IsBoolean()
  archived!: boolean;
}

export class SendMessageDto {
  /** شناسه‌ی سمت کلاینت برای ارسال idempotent (تلاش دوباره‌ی صف آفلاین تکرار نمی‌سازد). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @IsOptional()
  @IsUUID()
  mediaId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  mentionIds?: string[];
}

export class EditMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;
}

export class ForwardDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  conversationIds!: string[];
}

export class ReactDto {
  @IsString()
  @MaxLength(16)
  emoji!: string;
}

export class ReadDto {
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  seq!: number;
}

export class PresenceDto {
  @IsBoolean()
  hidden!: boolean;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsIn([...MESSENGER_POLICIES])
  policy?: string;

  @IsOptional()
  @IsIn([...GROUP_CREATION_MODES])
  groupCreation?: string;

  @IsOptional()
  @IsBoolean()
  hidePreview?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays?: number | null;

  @IsOptional()
  @IsBoolean()
  showPresence?: boolean;
}
