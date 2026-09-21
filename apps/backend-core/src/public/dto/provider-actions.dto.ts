import { IsDateString, IsString, MinLength } from 'class-validator';

export class ProviderRejectDto {
  @IsString()
  @MinLength(2)
  reason!: string;
}

export class ProviderRescheduleDto {
  @IsDateString()
  startAt!: string;
}
