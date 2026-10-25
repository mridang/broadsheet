export default {
  entry: ['open-next.config.ts'],
  ignore: ['public/**'],
  // Listed only so the lockfile carries the WebAssembly runtime that
  // `npm ci` needs on Linux; nothing imports them directly.
  ignoreDependencies: [/^@emnapi\//],
  tags: ['+public'],
};
