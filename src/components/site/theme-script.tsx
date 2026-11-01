/**
 * The script that applies a saved theme before the first paint, if the app has
 * a theme to save. This app has none, so it draws nothing; the root layout
 * renders it in every app all the same, which keeps the layout shared. (An app
 * with a theme reads this response's nonce from the `x-nonce` header here, as
 * the Content Security Policy only lets an inline script that carries it run.)
 */
export function ThemeScript(): null {
  return null;
}
