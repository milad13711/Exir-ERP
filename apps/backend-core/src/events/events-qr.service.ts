import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';

/** Thin wrapper around the `qrcode` package — kept as its own service so the encoding choice (error-correction level, margin) lives in one place. */
@Injectable()
export class EventsQrService {
  toPngBuffer(text: string): Promise<Buffer> {
    return QRCode.toBuffer(text, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 360 });
  }

  toDataUrl(text: string): Promise<string> {
    return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 360 });
  }
}
