import { IsString, MinLength } from 'class-validator';

export class SubmitContractEditRequestDto {
  @IsString()
  ticket!: string;

  @IsString()
  @MinLength(2)
  text!: string;
}
