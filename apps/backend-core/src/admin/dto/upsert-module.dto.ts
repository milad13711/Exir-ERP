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

  /** خالی و licenseUsd>۰ یعنی از قیمت دلاری مشتق می‌شود */
  @IsOptional()
  @IsInt()
  @Min(0)
  priceMonthly?: number;

  /** قیمت پایه‌ی دلاری (لایسنس مادام‌العمر) — سالانه = ÷۴ و ماهانه = ÷۱۰ آن، تومان با نرخ روز */
  @IsOptional()
  @IsInt()
  @Min(0)
  licenseUsd?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceYearly?: number;

  @IsOptional()
  @IsBoolean()
  isCore?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'ورژن باید به شکل x.y.z باشد' })
  version?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  dependsOn?: string[];

  @IsOptional()
  @IsString()
  demoDescription?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  demoValueProps?: string[];

  @IsOptional()
  @IsString()
  demoScreenshot1Url?: string;

  @IsOptional()
  @IsString()
  demoScreenshot2Url?: string;
}
