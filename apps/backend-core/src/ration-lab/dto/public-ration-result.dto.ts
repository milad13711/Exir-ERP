import { IsString } from 'class-validator';

export class RequestResultOtpDto {
  @IsString()
  phone!: string;
}

export class VerifyResultOtpDto {
  @IsString()
  phone!: string;

  @IsString()
  code!: string;
}

export class ListResultSamplesDto {
  @IsString()
  resultToken!: string;
}

export class GetResultSampleDto {
  @IsString()
  resultToken!: string;
}
