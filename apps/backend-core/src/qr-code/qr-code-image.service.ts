import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';

/** Thin wrapper around the `qrcode` package — همان الگوی EventsQrService. */
@Injectable()
export class QrCodeImageService {
  toPngBuffer(text: string): Promise<Buffer> {
    return QRCode.toBuffer(text, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 480 });
  }

  toDataUrl(text: string): Promise<string> {
    return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 480 });
  }
}
