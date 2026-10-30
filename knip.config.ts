import { existsSync } from 'node:fs';

/** The globs, only for a folder this app has, so knip finds nothing to hint about. */
const whenPresent = (folder: string, glob: string) =>
  existsSync(folder) ? [glob] : [];

export default {
  entry: [
    'open-next.config.ts',
    // Bundled to standalone pages by build:views, never imported.
    ...whenPresent('src/views', 'src/views/*.tsx'),
  ],
  ignore: ['public/**', ...whenPresent('skills', 'skills/**')],
  // Knip reads the `cloudflare:workers` import of the Workflows as a package
  // called `cloudflare`. The @emnapi packages are listed only so the lockfile
  // carries the WebAssembly runtime that `npm ci` needs on Linux.
  ignoreDependencies: ['cloudflare', /^@emnapi\//],
  tags: ['+public'],
};
