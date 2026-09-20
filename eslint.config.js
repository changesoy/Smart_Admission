import globals from "globals";
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
        L: "readonly",
        turf: "readonly",
      },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "warn",
      "prefer-arrow-callback": "warn",
      "prefer-template": "warn",
      "prefer-destructuring": ["warn", { array: true, object: true }],
      "object-shorthand": ["warn", "always"],
      "template-curly-spacing": "error",
      "arrow-spacing": "error",
      "no-useless-concat": "error",
      "no-prototype-builtins": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "vite.config.js", "eslint.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: [
      "node_modules/",
      "dist/",
      "data/",
      "docs/",
      "**/.venv/",
      "**/__pycache__/",
      "**/site-packages/",
    ],
  },
];
