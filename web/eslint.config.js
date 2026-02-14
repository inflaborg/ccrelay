import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Disable - common pattern in shadcn/ui
      "react-refresh/only-export-components": "off",
      // Allow empty object types for React component props extensions
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    files: ["src/features/logs/Logs.tsx"],
    rules: {
      // Disable - intentional ref pattern for performance
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
]);
