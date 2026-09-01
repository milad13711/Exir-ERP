import { IsString, Matches, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,48}$/, {
    message: 'شناسه باید فقط شامل حروف کوچک انگلیسی، عدد و خط تیره باشد',
  })
  slug!: string;

  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل مالک نامعتبر است' })
  ownerPhone!: string;

  @IsString()
  @MinLength(2)
  ownerName!: string;

  @IsString()
  planCode!: string;
}
