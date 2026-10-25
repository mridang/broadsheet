/**
 * @packageDocumentation
 *
 * The Cloudflare image proxy: our own `/img` address for pictures on other
 * sites, fetched once, scaled with the Images binding and kept at the edge.
 * This is the one place in `lib` that reaches the Cloudflare runtime (the
 * `IMAGES` binding and the edge cache), so it lives under the `cloudflare`
 * vendor package rather than with the portable libraries.
 *
 * Public surface: the pure address/signing codec ({@link ImageCatalog},
 * {@link ImageSigner}), the capped fetch ({@link fetchImage}), the request
 * service ({@link serveImage} and its {@link ImageAccess} port), and the
 * runtime bindings ({@link imagesBinding}, {@link imageCache},
 * {@link imageSigner}, {@link runInBackground}).
 */

export * from './address';
export * from './signer';
export * from './proxy';
export * from './service';
export * from './runtime';
