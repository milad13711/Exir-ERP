import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateOfferDto {
  @IsString()
  @MinLength(2)
  jobDescription!: string;

  @IsIn(['پاره‌وقت', 'تمام‌وقت', 'کارآموزی', 'پروژه‌ای'])
  collaborationType!: string;

  @IsOptional()
  @IsString()
  workingHours?: string;

  @IsInt()
  @Min(0)
  salary!: number;

  @IsOptional()
  @IsString()
  benefits?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMonths?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}
