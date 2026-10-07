import { defineConfig, devices } from "@playwright/test";

// Smoke tests of the built app with the API answered from a fixture: screens render, no errors.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://localhost:4173",
    serviceWorkers: "block",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: { command: "pnpm exec vite preview --port 4173 --strictPort", port: 4173 },
});
