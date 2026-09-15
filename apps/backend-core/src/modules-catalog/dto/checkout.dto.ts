import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsString, ValidateNested } from 'class-validator';

export class CheckoutItemDto {
  @IsString()
  code!: string;

  @IsIn(['MONTHLY', 'YEARLY', 'LICENSE'])
  billingMode!: 'MONTHLY' | 'YEARLY' | 'LICENSE';
}

export class CheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];
}
