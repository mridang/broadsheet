/**
 * @packageDocumentation
 *
 * The typefaces and the page frame's own classes: what the root layout puts on
 * `<html>` and `<body>`. Per app, with the same export names in every app, so
 * the layout itself is shared.
 */

import { Lora, Source_Serif_4 } from 'next/font/google';

/**
 * The body face of the FT theme. Both theme faces are exposed as CSS variables,
 * which the newspaper stylesheet switches between per `data-theme`.
 */
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  weight: ['400', '600', '700', '900'],
  style: ['normal', 'italic'],
});

/** The body face of the Economist theme. */
const lora = Lora({
  subsets: ['latin'],
  variable: '--font-lora',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
});

/** The classes of `<html>`: the font variables. */
export const HTML_CLASS = `${sourceSerif.variable} ${lora.variable}`;

/** The classes of `<body>`: the page colours and type come from the stylesheet. */
export const BODY_CLASS = 'min-h-full';

/** Extra attributes for `<html>`: the default theme, which the theme script may change before first paint. */
export const HTML_ATTRIBUTES: Readonly<Record<string, string>> = {
  'data-theme': 'ft',
};
