import {defineConfig, devices} from "@playwright/test";

export default defineConfig({
  testDir: "scripts/browser",
  testMatch: "*.spec.mts",
  globalSetup: "scripts/browser/global-setup.mts",
  // A layout check reads one engine's own rendering, so a retry would only
  // hide a flaky layout. We keep the first answer.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  projects: [
    {name: "chromium", use: {...devices["Desktop Chrome"]}},
    {name: "firefox", use: {...devices["Desktop Firefox"]}},
    {name: "webkit", use: {...devices["Desktop Safari"]}},
  ],
});
