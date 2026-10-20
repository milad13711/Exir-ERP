import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const LETTER_TYPES = ['INCOMING', 'OUTGOING', 'INTERNAL', 'ANY'] as const;
export type CorrLetterType = (typeof LETTER_TYPES)[number];

export class CreateTemplateDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsIn(LETTER_TYPES) letterType?: CorrLetterType;
  @IsOptional() @IsString() @MaxLength(100) categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsString() @MaxLength(700_000) bodyHtml!: string;
  @IsOptional() @IsString() @MaxLength(100) defaultLetterheadId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsIn(LETTER_TYPES) letterType?: CorrLetterType;
  @IsOptional() @IsString() @MaxLength(100) categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsOptional() @IsString() @MaxLength(700_000) bodyHtml?: string;
  @IsOptional() @IsString() @MaxLength(100) defaultLetterheadId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}

/** مقدارهای جانشین‌ها برای رندر/پیش‌نمایش؛ مقدار نیامده = جانشین دست‌نخورده می‌ماند. */
export class RenderTemplateDto {
  @IsOptional() @IsObject() context?: Record<string, string | null>;
}
