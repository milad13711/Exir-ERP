import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePublicAppointmentDto {
  /** Short-lived JWT from POST /public/booking/:slug/otp/verify, proves phone ownership. */
  @IsString()
  bookingToken!: string;

  @IsString()
  serviceTypeId!: string;

  @IsOptional()
  @IsString()
  providerUserId?: string;

  @IsString()
  @MinLength(2)
  customerName!: string;

  @IsDateString()
  startAt!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
