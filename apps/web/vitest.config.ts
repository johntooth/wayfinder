import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // tsconfig says jsx: "preserve" because Next owns the app build; vitest has no
  // Next pipeline behind it, so it needs the runtime named here or any test that
  // actually evaluates JSX fails on an undefined React.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Playwright e2e specs under e2e/ are driven by the e2e skill, not vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
