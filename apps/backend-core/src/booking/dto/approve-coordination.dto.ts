import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ApproveCoordinationDto {
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsString()
  providerUserId?: string;
}
