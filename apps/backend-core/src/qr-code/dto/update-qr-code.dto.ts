import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class UpdateQrCodeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  targetUrl?: string;
}
