import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { BookOrderFormatCode } from '../../book-store/book-store.service.js';

export class CreatePublicBookOrderDto {
  /** Short-lived JWT from POST /public/book/:slug/otp/verify, proves the buyer's phone ownership. */
  @IsString()
  bookingToken!: string;

  @IsIn(['PRINT', 'EBOOK', 'AUDIO'])
  format!: BookOrderFormatCode;

  @IsString()
  @MinLength(2)
  buyerName!: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;
}
