import { ArrayMaxSize, IsArray, IsIn, IsString } from 'class-validator';

export class QuotePlanDto {
  @IsString()
  planCode!: string;

  @IsIn(['monthly', 'yearly'])
  billingCycle!: 'monthly' | 'yearly';

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  moduleCodes!: string[];
}
