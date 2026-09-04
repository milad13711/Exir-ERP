import { IsString, MinLength } from 'class-validator';

export class SaveExtensionDto {
  @IsString()
  @MinLength(1)
  extension!: string;
}
