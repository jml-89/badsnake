import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // --- Tooling scripts: Node + in-page (page.evaluate) globals ---
  // Not part of the app; repro.mjs runs under Node but also contains a callback
  // that executes inside the browser page, so it references DOM globals too.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", document: "readonly" },
    },
  },

  // --- Architecture boundary: the pure -> impure import ban ---
  // Impure code may import pure code freely; pure code may not import
  // impure code. Enforced mechanically; a violation fails the build.
  {
    files: ["src/**/*.ts"],
    plugins: { boundaries },
    settings: {
      "import/resolver": { typescript: { alwaysTryTypes: true } },
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        { type: "core", pattern: "src/core/**" },
        { type: "adapters", pattern: "src/adapters/**" },
        { type: "app", pattern: "src/app/**" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            {
              from: { element: { types: "core" } },
              allow: { to: { element: { types: "core" } } },
            },
            {
              from: { element: { types: "adapters" } },
              allow: { to: { element: { types: { anyOf: ["core", "adapters"] } } } },
            },
            {
              from: { element: { types: "app" } },
              allow: { to: { element: { types: { anyOf: ["core", "adapters", "app"] } } } },
            },
          ],
        },
      ],
    },
  },

  // --- Purity: no impure globals inside the kernel ---
  // Time, randomness, DOM and storage are dependencies. The kernel receives
  // them as data/ports; it must never reach for them directly. This is also
  // what guarantees replay determinism cannot silently diverge.
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "performance", message: "core is pure: inject time, don't read a clock." },
        { name: "Date", message: "core is pure: inject time, don't read a clock." },
        { name: "requestAnimationFrame", message: "core is pure: no frame scheduling in the kernel." },
        { name: "window", message: "core is pure: no DOM in the kernel." },
        { name: "document", message: "core is pure: no DOM in the kernel." },
        { name: "localStorage", message: "core is pure: no storage in the kernel." },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "core is pure: use the seeded RNG (nextRng), not Math.random.",
        },
      ],
    },
  },
);
