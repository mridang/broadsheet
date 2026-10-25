/**
 * @packageDocumentation
 *
 * The server half of the Cloudflare image proxy: everything that reaches the
 * runtime (the IMAGES binding, the edge cache, the request context) and so
 * must stay out of the client bundle. The package index re-exports only the
 * pure render surface; route handlers import this module.
 *
 * {@link ImageService} is the handle a route mounts: build it with the request
 * dependencies (the access rules, the picture catalog, the optional bindings)
 * and call {@link ImageService.serve}. The signing codec, the capped fetch,
 * the low-level `serveImage` and the runtime accessors are re-exported here
 * too.
 */

import { serveImage, type ImageServiceDeps } from './service';

export * from './signer';
export * from './proxy';
export * from './service';
export * from './runtime';

/**
 * Serves `/img` requests: a thin handle over {@link serveImage} built with the
 * request dependencies, so a route mounts it as `new ImageService(deps).serve`.
 */
export class ImageService {
  readonly #deps: ImageServiceDeps;

  constructor(deps: ImageServiceDeps) {
    this.#deps = deps;
  }

  /** Answer one `GET /img` request. */
  serve(request: Request): Promise<Response> {
    return serveImage(request, this.#deps);
  }
}
