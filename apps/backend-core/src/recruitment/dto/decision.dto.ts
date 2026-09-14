import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DecisionDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
