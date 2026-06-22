export default {
  entry: ['open-next.config.ts'],
  ignore: ['knip.config.ts'],
  ignoreDependencies: [/^@semantic-release\//, /^postcss$/, /^cloudflare$/],
  tags: ['+public'],
};
