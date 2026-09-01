import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';

export class UpsertModuleDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{1,48}$/, { message: 'کد ماژول باید فقط شامل حروف کوچک انگلیسی، عدد، - و _ باشد' })
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  description!: string;

  @IsString()
  @MinLength(2)
  category!: string;

  @IsInt()
  @Min(0)
  priceMonthly!: number;

  @IsOptional()
  @IsBoolean()
  isCore?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  features?: string[];
}
