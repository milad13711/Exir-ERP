import { ArrayMaxSize, IsArray, IsHexColor, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class UpsertIndustryTemplateDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,48}$/, { message: 'کد قالب باید فقط شامل حروف کوچک انگلیسی، عدد و - باشد' })
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Kept as free-form JSON on the wire — validated as "is an array" here,
  // the same way seed.ts has always shaped them; a full nested-schema
  // validator would just re-describe the Prisma Json columns.
  @IsArray()
  roles!: unknown[];

  @IsArray()
  chartOfAccounts!: unknown[];

  @IsArray()
  @IsString({ each: true })
  productCategories!: string[];

  @IsArray()
  orgChart!: unknown[];

  @IsOptional()
  @IsHexColor()
  suggestedThemeColor?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  defaultModules?: string[];
}
