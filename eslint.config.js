
import js from "@eslint/js";
import node from "eslint-plugin-n";

/** @type {import("eslint").FlatConfig[]} */
export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
    },
    plugins: {
      n: node,
    },
    rules: {
      "no-restricted-globals": ["error", "name", "length"],
      "prefer-arrow-callback": "error",
      "quotes": ["error", "double", { allowTemplateLiterals: true }],
      "max-len": ["warn", { code: 120, ignoreUrls: true }],
      "object-curly-spacing": ["error", "always"],
      "comma-dangle": ["error", "always-multiline"],
      "no-unused-vars": "warn",
      "indent": ["error", 2],
      "semi": ["error", "always"],
      "require-jsdoc": "off",
      "valid-jsdoc": "off",
      "arrow-parens": ["error", "always"],
      "no-undef": "off",
    },
  },
];
