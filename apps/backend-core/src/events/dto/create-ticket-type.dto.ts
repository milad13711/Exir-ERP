import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateTicketTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
