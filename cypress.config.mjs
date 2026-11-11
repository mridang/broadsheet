import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    browser: 'chrome',
    defaultCommandTimeout: 10_000,
    requestTimeout: 10_000,
  },
});
