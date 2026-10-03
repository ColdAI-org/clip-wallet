import { defineConfig } from "vitest/config";

// SES lockdown() freezes the realm it runs in, so every test file gets its own process.
export default defineConfig({ test: { pool: "forks", isolate: true } });
