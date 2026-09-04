import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAppointmentDto {
  @IsOptional()
  @IsString()
  serviceTypeId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  providerUserId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
