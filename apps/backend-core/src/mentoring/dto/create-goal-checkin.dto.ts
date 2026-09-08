import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateGoalCheckInDto {
  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}
