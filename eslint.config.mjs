import typescriptEslint from "@typescript-eslint/parser";
import typescriptEslintPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [
      "out",
      "dist",
      "**/*.d.ts",
      "node_modules",
      "packages/core/src/api/version.generated.ts",
      "packages/vscode/out",
      "packages/desktop/dist",
      "packages/desktop/out",
    ],
  },
  {
    files: ["packages/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: typescriptEslint,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptEslintPlugin,
    },
    rules: {
      ...typescriptEslintPlugin.configs["recommended-type-checked"].rules,
      "@typescript-eslint/naming-convention": "warn",
      semi: "off",
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
