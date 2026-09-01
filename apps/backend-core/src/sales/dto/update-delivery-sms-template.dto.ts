import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateDeliverySmsTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  template!: string;
}
