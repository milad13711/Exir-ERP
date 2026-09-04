import { IsOptional, IsString, MinLength } from 'class-validator';

export class OriginateCallDto {
  @IsString()
  @MinLength(1)
  toNumber!: string;

  @IsOptional()
  @IsString()
  contactId?: string;
}
