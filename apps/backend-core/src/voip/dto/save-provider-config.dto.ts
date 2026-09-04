import { IsObject, IsString, MinLength } from 'class-validator';

export class SaveProviderConfigDto {
  @IsString()
  @MinLength(1)
  providerCode!: string;

  @IsObject()
  config!: Record<string, unknown>;
}
