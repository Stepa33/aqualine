import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { locale: 'ru-RU', timezoneId: 'Europe/Kyiv', trace: 'retain-on-failure' },
});
