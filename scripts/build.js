/**
 * Build script: runs Vite in lib mode for each entry point separately.
 *
 * Vite 8 does not support multiple entry points with UMD format,
 * so we invoke `vite build` once per entry with a dynamic config.
 */

import { build } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { cpSync, mkdirSync } from "fs";
import dts from "vite-plugin-dts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const entries = [
  { name: "core", entry: "src/core/index.ts", global: "DLCore" },
  { name: "adapters/alpine", entry: "src/adapters/alpine.ts", global: "DLAdapters.Alpine" },
  { name: "adapters/react", entry: "src/adapters/react.ts", global: "DLAdapters.React" },
  { name: "adapters/vue", entry: "src/adapters/vue.ts", global: "DLAdapters.Vue" },
  { name: "adapters/svelte", entry: "src/adapters/svelte.ts", global: "DLAdapters.Svelte" },
  { name: "devtools/devtools", entry: "src/devtools/index.ts", global: "VerityDevtools" },
];

for (let i = 0; i < entries.length; i++) {
  const { name, entry, global } = entries[i];
  const isFirst = i === 0;

  console.log(`\nBuilding ${name}...`);

  await build({
    configFile: false,
    root,
    plugins: isFirst
      ? [
          dts({
            rollupTypes: true,
            outDir: "dist",
            include: ["src/**/*.ts"],
            tsconfigPath: "./tsconfig.json",
          }),
        ]
      : [],
    build: {
      lib: {
        entry: resolve(root, entry),
        name: global,
        formats: ["es", "umd"],
        fileName: (format) => {
          if (format === "es") return `${name}.mjs`;
          return `${name}.umd.js`;
        },
      },
      outDir: "dist",
      emptyOutDir: isFirst,
      sourcemap: true,
      minify: "terser",
      rollupOptions: {
        external: ["react", "vue", "svelte", "alpinejs"],
        output: {
          globals: {
            react: "React",
            vue: "Vue",
            svelte: "Svelte",
            alpinejs: "Alpine",
          },
        },
      },
    },
    logLevel: "warn",
  });
}

// Copy devtools CSS
mkdirSync(resolve(root, "dist/devtools"), { recursive: true });
cpSync(
  resolve(root, "src/devtools/devtools.css"),
  resolve(root, "dist/devtools/devtools.css"),
);
console.log("\nCopied devtools.css");
console.log("Build complete.");
