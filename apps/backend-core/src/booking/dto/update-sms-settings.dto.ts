import { IsString, MinLength } from 'class-validator';

export class UpdateBookingSmsSettingsDto {
  @IsString()
  @MinLength(2)
  confirmationTemplate!: string;
}
