import { IsString, MinLength } from 'class-validator';

/** Shared body shape for every module's bulk-import endpoint — the file arrives base64-encoded in JSON, same convention this codebase already uses for other binary uploads (see e.g. SignInvoiceDto's signatureDataUrl), rather than introducing multipart/form-data handling just for this. */
export class ImportExcelDto {
  @IsString()
  @MinLength(1)
  fileBase64!: string;
}
