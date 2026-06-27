/* eslint-env node */
// Accessibility-only lint config. Runs the jsx-a11y "strict" ruleset in
// isolation (no TypeScript or stylistic rules) so validate.sh can gate the
// build on WCAG 2.2 AA accessibility independently of the general lint pass.
//
// Keep the jsx-a11y rule set here in sync with .eslintrc.cjs.
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["jsx-a11y"],
  extends: ["plugin:jsx-a11y/strict"],
  ignorePatterns: ["dist", ".next", "node_modules"],
  settings: {
    "jsx-a11y": {
      components: {
        Button: "button",
        Input: "input",
        Textarea: "textarea",
        Label: "label",
      },
    },
  },
};
