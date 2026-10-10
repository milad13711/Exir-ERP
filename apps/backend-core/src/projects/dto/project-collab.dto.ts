import { IsBoolean, IsOptional, IsString, IsUrl, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SetPublicLinkDto {
  @IsBoolean()
  enabled!: boolean;
}

export class CreateProjectNoteDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  @IsOptional() @IsUUID() stageId?: string;
  /** پاسخ به یک یادداشت/کامنت مشتری (فقط یادداشت سطح بالا) */
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsBoolean() visibleToCustomer?: boolean;
}

export class SetVisibilityDto {
  @IsBoolean()
  visibleToCustomer!: boolean;
}

export class CreateStageLinkDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(2000) url!: string;
  @IsOptional() @IsBoolean() visibleToCustomer?: boolean;
}

export class LinkDocumentDto {
  @IsOptional() @IsBoolean() showOnPublicLink?: boolean;
}

export class SetShowOnPublicDto {
  @IsBoolean()
  showOnPublicLink!: boolean;
}

export class PublicProjectCommentDto {
  @IsString() @MinLength(1) @MaxLength(1000) body!: string;
  @IsOptional() @IsString() @MaxLength(60) name?: string;
}
