import { IsString, MinLength } from 'class-validator';

export class SuspendTenantDto {
  @IsString()
  @MinLength(3, { message: 'دلیل تعلیق را بنویسید' })
  reason!: string;
}
