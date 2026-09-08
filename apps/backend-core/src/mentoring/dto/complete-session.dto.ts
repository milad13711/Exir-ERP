import { IsOptional, IsString } from 'class-validator';

export class CompleteSessionDto {
  @IsOptional()
  @IsString()
  minutesNote?: string;
}
