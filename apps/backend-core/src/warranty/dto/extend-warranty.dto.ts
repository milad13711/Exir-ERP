import { IsDateString } from 'class-validator';

export class ExtendWarrantyDto {
  @IsDateString()
  expiresAt!: string;
}
