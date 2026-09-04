import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  { ignores: ["main.js", "node_modules/**", "esbuild/**"] },
  ...obsidianmd.configs.recommended,
  {
    // `createEl` types only HTML tags. The PDF export builds Electron's
    // `<webview>`, which is not one of them, so the rule's fix would not
    // compile. The config forbids silencing this rule inline, so the
    // exception is stated here instead.
    files: ["src/export/pdf.ts"],
    rules: { "obsidianmd/prefer-create-el": "off" },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.*"] },
      },
    },
  },
]);
