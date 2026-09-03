import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class SaveIndustryTemplateFromTenantDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,48}$/, { message: 'کد قالب باید فقط شامل حروف کوچک انگلیسی، عدد و - باشد' })
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
