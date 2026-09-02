import { IsDataURI, IsString, MinLength } from 'class-validator';

export class AcceptPublicQuotationDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(1)
  @IsDataURI()
  signatureDataUrl!: string;
}
