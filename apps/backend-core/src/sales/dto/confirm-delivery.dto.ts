import { IsDataURI, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const METHODS = ['CODE', 'SIGNATURE'] as const;

export class ConfirmDeliveryDto {
  @IsIn(METHODS)
  method!: (typeof METHODS)[number];

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  @IsDataURI()
  signatureDataUrl?: string;

  @IsString()
  @MinLength(1)
  confirmerName!: string;
}
