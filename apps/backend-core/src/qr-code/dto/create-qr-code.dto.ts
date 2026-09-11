import { IsString, IsUrl, MinLength } from 'class-validator';

export class CreateQrCodeDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  targetUrl!: string;
}
