import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateListingDto {
  @IsBoolean()
  isPubliclyListed!: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'شناسه‌ی عمومی فقط می‌تواند حروف لاتین کوچک، عدد و خط تیره داشته باشد' })
  publicSlug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  publicDescription?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  publicImages?: string[];
}
