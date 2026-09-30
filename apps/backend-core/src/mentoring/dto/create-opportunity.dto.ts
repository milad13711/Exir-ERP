import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';

const STAGES = ['NEW', 'CONTACTED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const;

export class CreateOpportunityDto {
  @IsString()
  @MinLength(2)
  title!: string;

  /** خلاصه‌ی چیزی که در جلسه/نوبت مطرح شد — پرسنل دستی وارد می‌کند. */
  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsIn(STAGES)
  stage?: (typeof STAGES)[number];

  @IsOptional()
  @IsISO8601()
  expectedCloseAt?: string;
}
