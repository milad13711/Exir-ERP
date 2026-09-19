import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class AcceptOfferDto {
  @IsBoolean()
  accepted!: boolean;

  /** امضای الکترونیک متقاضی (data URL تصویر) — برای پذیرش الزامی است. */
  @IsOptional()
  @IsString()
  @MaxLength(400_000)
  signature?: string;
}
