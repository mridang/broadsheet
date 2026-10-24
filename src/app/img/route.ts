/**
 * Pictures from other websites, served from our own address (see
 * `lib/images/address.ts` for why).
 *
 *   GET /img?url=<picture address>&w=<width>
 *
 * Who may ask, and for what, is each app's own rule, so it can't become a free
 * image proxy for the web. Stories come from any site, so there is no host
 * allow-list: the rule is the signature, which only this server can make.
 * Answers come from the edge cache when they can, and a browser keeps them for
 * a month.
 */

import { imageCatalog } from '@/domain/images/site';
import {
  imageCache,
  imageSigner,
  imagesBinding,
  runInBackground,
} from '@/core/images/runtime';
import { serveImage, type ImageAccess } from '@/core/images/service';

/**
 * `GET /img?url=…&w=…`: the picture at `url`, scaled to the nearest
 * allowed width and kept at the edge. Answers 200 with the image (304 when the
 * browser's copy is current), 400 for an address that is not a public image,
 * 403 when the app does not serve it to this caller, 404 when its site no
 * longer has it, 413 when it is too large, 415 when it is not a raster image
 * and 502 when its site fails. Errors are short plain text that no cache keeps.
 */
export async function GET(request: Request): Promise<Response> {
  const signer = imageSigner();
  const access: ImageAccess = {
    // Nobody is turned away before the address is looked at: the signature is
    // the rule.
    authenticate: () => Promise.resolve(undefined),
    // With no secret nothing is accepted, rather than trusting any signature.
    signatureValid: (url, signature) =>
      signer ? signer.verify(url, signature) : Promise.resolve(false),
    // A signed address may be fetched.
    mayFetch: () => Promise.resolve(true),
  };
  return serveImage(request, {
    access,
    catalog: imageCatalog,
    cache: imageCache(),
    images: imagesBinding(),
    background: runInBackground,
  });
}
