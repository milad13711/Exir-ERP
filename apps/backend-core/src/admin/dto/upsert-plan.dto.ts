import { IsBoolean, IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';

export class UpsertPlanDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{1,48}$/, { message: 'کد پلن باید فقط شامل حروف کوچک انگلیسی، عدد، - و _ باشد' })
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsInt()
  @Min(0)
  priceMonthly!: number;

  @IsInt()
  @Min(1)
  userLimit!: number;

  @IsOptional()
  @IsBoolean()
  isPubliclySold?: boolean;
}
