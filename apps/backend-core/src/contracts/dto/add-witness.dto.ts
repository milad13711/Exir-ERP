import { IsString, Matches, MinLength } from 'class-validator';

export class AddWitnessDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;
}
