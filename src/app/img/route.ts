/**
 * Pictures from other websites, served from our own address (see
 * `lib/images/address.ts` for why).
 *
 *   GET /img?url=<picture address>&w=<width>
 *
 * Who may ask, and for what, is each app's own rule (`lib/images/access.ts`),
 * so it can't become a free image proxy for the web. Answers come from the
 * edge cache when they can, and a browser keeps them for a month.
 */

import * as access from '@/lib/images/access';
import {
  imageCache,
  imagesBinding,
  runInBackground,
} from '@/lib/images/runtime';
import { serveImage } from '@/lib/images/service';

/**
 * `GET /img?url=…&w=…`: the picture at `url`, scaled to the nearest
 * allowed width and kept at the edge. Answers 200 with the image (304 when the
 * browser's copy is current), 400 for an address that is not a public image,
 * 403 when the app does not serve it to this caller, 404 when its site no
 * longer has it, 413 when it is too large, 415 when it is not a raster image
 * and 502 when its site fails. Errors are short plain text that no cache keeps.
 */
export async function GET(request: Request): Promise<Response> {
  return serveImage(request, {
    access,
    cache: imageCache(),
    images: imagesBinding(),
    background: runInBackground,
  });
}
