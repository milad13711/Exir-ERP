import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LockPeriodDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UnlockPeriodDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
