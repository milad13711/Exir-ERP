import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateTicketTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
