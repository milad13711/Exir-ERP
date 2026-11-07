import { IsString } from 'class-validator';

export class BookLibraryDto {
  /** همان توکن کوتاه‌عمر POST /public/book/:slug/otp/verify — مالکیت شماره را ثابت می‌کند. */
  @IsString()
  bookingToken!: string;
}
