import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAppointmentDto {
  @IsString()
  serviceTypeId!: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  providerUserId?: string;

  @IsString()
  @MinLength(2)
  customerName!: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsDateString()
  startAt!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
