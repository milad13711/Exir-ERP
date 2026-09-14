import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class InterviewScoreItemDto {
  @IsString()
  criterion!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class RecordInterviewReportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InterviewScoreItemDto)
  scores!: InterviewScoreItemDto[];

  @IsOptional()
  @IsString()
  overallNote?: string;

  @IsIn(['DONE', 'NO_SHOW'])
  status!: 'DONE' | 'NO_SHOW';
}
