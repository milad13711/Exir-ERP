import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

class PublicEventAttendeeDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class CreatePublicEventBookingDto {
  /** Short-lived JWT from POST /public/events/:slug/otp/verify, proves the buyer's phone ownership. */
  @IsString()
  bookingToken!: string;

  @IsString()
  ticketTypeId!: string;

  @IsString()
  @MinLength(2)
  buyerName!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PublicEventAttendeeDto)
  attendees!: PublicEventAttendeeDto[];
}
