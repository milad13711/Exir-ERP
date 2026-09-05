import { IsOptional, IsString } from 'class-validator';

export class CompleteStageDto {
  @IsOptional()
  @IsString()
  report?: string;
}
