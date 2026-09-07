import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Matches, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class StoreOrderLineDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateStoreOrderDto {
  @IsString()
  @MinLength(2)
  customerName!: string;

  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  customerPhone!: string;

  @IsString()
  @MinLength(5)
  shippingAddress!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  sessionToken?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StoreOrderLineDto)
  lines!: StoreOrderLineDto[];
}
