import { IsHexColor, IsOptional } from 'class-validator';

export class UpdateBrandingDto {
  @IsOptional()
  @IsHexColor()
  themeColor?: string;
}
