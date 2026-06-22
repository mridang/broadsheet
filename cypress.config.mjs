import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    browser: 'chrome',
    defaultCommandTimeout: 10000,
    execTimeout: 120000,
    requestTimeout: 10000,
  },
});
