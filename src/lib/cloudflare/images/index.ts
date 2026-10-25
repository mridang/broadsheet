/**
 * @packageDocumentation
 *
 * The client-safe render surface of the Cloudflare image proxy: the functions
 * that build our own `/img` addresses for pictures on other sites and decide
 * which pictures are ours to proxy ({@link imageSrc}, {@link imageSrcSet},
 * {@link isProxyableUrl}, and the allowed hosts/widths they read). This is all
 * a page or component needs to render an image, and it reaches no runtime
 * bindings, so importing it pulls no server code into the client bundle. The
 * server half — fetching, scaling, caching, signing and the request service —
 * lives in `./server`.
 */

export * from './address';
