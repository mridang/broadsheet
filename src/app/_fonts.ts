/**
 * @packageDocumentation
 *
 * The typefaces and the page frame's own classes: what the root layout puts on
 * `<html>` and `<body>`. Per app, with the same export names in every app, so
 * the layout itself is shared.
 */

import { Source_Serif_4 } from 'next/font/google';

/** The reading face: the full text of a story, as a CSS variable. */
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  weight: ['400', '600', '700', '900'],
  style: ['normal', 'italic'],
});

/** The classes of `<html>`: the font variables. */
export const HTML_CLASS = sourceSerif.variable;

/** The classes of `<body>`: the app's sans; the page colours come from the stylesheet. */
export const BODY_CLASS = 'min-h-full font-sans';

/** Extra attributes for `<html>`: none, as light and dark follow the device. */
export const HTML_ATTRIBUTES: Readonly<Record<string, string>> = {};
