import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class GenerateChecklistReportDto {
  @IsISO8601()
  date!: string;

  @IsOptional()
  @IsString()
  forUserId?: string;
}
