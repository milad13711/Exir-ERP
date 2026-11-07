import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** اعتبارسنجی ساختاری؛ پاک‌سازی/اعتبارسنجی معنایی (HTML، لینک، طول) در module-release.logic.ts انجام می‌شود. */
export class ReleaseChangeDto {
  @IsOptional() @IsString() @MaxLength(20) type?: string;
  @IsString() @MaxLength(2000) title!: string;
  @IsOptional() @IsString() @MaxLength(6000) description?: string;
  @IsOptional() @IsString() @MaxLength(4000) valueText?: string;
  @IsOptional() @IsString() @MaxLength(400) deepLink?: string;
}

export class CreateModuleReleaseDto {
  @IsString() @MaxLength(80) moduleCode!: string;
  @IsString() @MaxLength(64) version!: string;
  @IsString() @MaxLength(2000) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) summary?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ReleaseChangeDto) changes?: ReleaseChangeDto[];
}

export class UpdateModuleReleaseDto {
  @IsOptional() @IsString() @MaxLength(2000) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) summary?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ReleaseChangeDto) changes?: ReleaseChangeDto[];
}

export class ReleaseChannelsDto {
  @IsOptional() @IsBoolean() notify?: boolean;
  @IsOptional() @IsBoolean() ticket?: boolean;
  @IsOptional() @IsBoolean() sms?: boolean;
}

export class PublishModuleReleaseDto {
  @ValidateNested() @Type(() => ReleaseChannelsDto) channels!: ReleaseChannelsDto;
  /** تأیید صریح پس از دیدن تعداد گیرندگان */
  @IsBoolean() confirm!: boolean;
}

export class TestSendModuleReleaseDto {
  @IsString() @MaxLength(64) tenantId!: string;
  @ValidateNested() @Type(() => ReleaseChannelsDto) channels!: ReleaseChannelsDto;
}

export class ReleasePrefsDto {
  @IsOptional() @IsBoolean() notify?: boolean;
  @IsOptional() @IsBoolean() ticket?: boolean;
  @IsOptional() @IsBoolean() sms?: boolean;
}
