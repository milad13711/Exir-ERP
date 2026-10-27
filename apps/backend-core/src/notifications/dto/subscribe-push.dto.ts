import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class SubscribePushDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  @Matches(/^https:\/\//i, { message: 'endpoint باید https باشد' })
  endpoint!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  p256dh!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  auth!: string;

  /** نام دلخواه دستگاه؛ بدون آن از User-Agent ساخته می‌شود. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}

export class RenameDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;
}

export class PushTestDto {
  /** فقط همین دستگاه؛ بدون آن همه‌ی دستگاه‌های کاربر. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  subscriptionId?: string;
}

export class MarkDeliveredDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}
