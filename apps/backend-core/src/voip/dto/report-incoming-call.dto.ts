import { IsOptional, IsString, MinLength } from 'class-validator';

export class ReportIncomingCallDto {
  @IsString()
  @MinLength(1)
  fromNumber!: string;

  /** SIP Call-ID header — نه اجباری، ولی اگر داشته باشیم برای ردیابی بهتر است. */
  @IsOptional()
  @IsString()
  sipCallId?: string;
}
