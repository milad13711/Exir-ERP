import { IsString, MinLength } from 'class-validator';

export class RevokeLicenseDto {
  @IsString()
  @MinLength(2)
  reason!: string;
}
