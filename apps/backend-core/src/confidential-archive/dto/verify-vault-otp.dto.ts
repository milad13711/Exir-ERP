import { IsString, Length } from 'class-validator';

export class VerifyVaultOtpDto {
  @IsString()
  @Length(4, 4)
  code!: string;
}
