import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['iPhone 13'],
    // WebKit未インストール環境でも動くよう、iPhoneビューポートのままChromiumで実行する
    browserName: 'chromium',
    launchOptions: {
      // コンテナ環境（root実行）向け。通常環境では無害。
      args: ['--no-sandbox']
    }
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 60000
  }
});
