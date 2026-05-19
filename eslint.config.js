import globals from "globals";
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
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
    ignores: ["node_modules/", "data/", "docs/"],
  },
];
