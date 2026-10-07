import { defineConfig } from "vitest/config";

// Plain Node: the tests here exercise routing and auth, not Workers bindings.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
