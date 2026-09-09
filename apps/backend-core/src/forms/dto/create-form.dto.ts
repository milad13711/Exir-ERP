import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { FormFieldDto } from './form-field.dto.js';

const FORM_TYPES = ['SURVEY', 'QUIZ', 'QUESTIONNAIRE', 'REGISTRATION'] as const;

export class CreateFormDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'شناسه‌ی عمومی فقط می‌تواند شامل حروف انگلیسی کوچک، عدد و خط تیره باشد' })
  slug!: string;

  @IsIn(FORM_TYPES)
  type!: (typeof FORM_TYPES)[number];

  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsBoolean()
  collectPhone?: boolean;

  @IsOptional()
  @IsBoolean()
  requirePhone?: boolean;

  @IsOptional()
  @IsBoolean()
  createContact?: boolean;

  @IsOptional()
  @IsDateString()
  closesAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  passScorePercent?: number;

  @IsOptional()
  @IsString()
  thankYouMessage?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields!: FormFieldDto[];
}
