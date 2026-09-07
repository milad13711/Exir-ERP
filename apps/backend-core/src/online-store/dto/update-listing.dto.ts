import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

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

  /**
   * قیمت «قبل از تخفیف» برای نشان‌دادن نشان تخفیف — فقط وقتی از salePrice
   * بیشتر باشد اعمال می‌شود. مقدار null یعنی «تخفیف را پاک کن» (برخلاف
   * undefined که یعنی «این فیلد را دست‌نخورده بگذار») — @IsOptional هر دو
   * را از اعتبارسنجی معاف می‌کند، بنابراین null هم مجاز است.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  publicCompareAtPrice?: number | null;
}
