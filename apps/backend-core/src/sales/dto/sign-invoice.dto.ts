import { IsDataURI, IsString, MinLength } from 'class-validator';

export class SignInvoiceDto {
  @IsString()
  @MinLength(1)
  @IsDataURI()
  signatureDataUrl!: string;
}
