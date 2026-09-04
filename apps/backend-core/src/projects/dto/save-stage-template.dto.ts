import { ArrayMinSize, IsArray, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class StageTemplateItemDto {
  @IsString()
  @MinLength(1)
  title!: string;
}

export class SaveStageTemplateDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StageTemplateItemDto)
  items!: StageTemplateItemDto[];
}
