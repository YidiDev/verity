import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

/**
 * Vite library-mode configuration for verity-dl.
 *
 * Produces multiple entry points, each as:
 *   - ESM  (.mjs)        – for bundlers / `import`
 *   - UMD  (.umd.js)     – for CDN `<script>` tags and `require()`
 *
 * Minified with sourcemaps. Type declarations (.d.ts) bundled via vite-plugin-dts.
 */

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      outDir: "dist",
      include: ["src/**/*.ts"],
      tsconfigPath: "./tsconfig.json",
    }),
  ],

  build: {
    lib: {
      entry: {
        core: resolve(__dirname, "src/core/index.ts"),
        "adapters/alpine": resolve(__dirname, "src/adapters/alpine.ts"),
        "adapters/react": resolve(__dirname, "src/adapters/react.ts"),
        "adapters/vue": resolve(__dirname, "src/adapters/vue.ts"),
        "adapters/svelte": resolve(__dirname, "src/adapters/svelte.ts"),
        "devtools/devtools": resolve(__dirname, "src/devtools/index.ts"),
      },
      name: "DLCore",
      formats: ["es", "umd"],
      fileName: (format, entryName) => {
        if (format === "es") return `${entryName}.mjs`;
        return `${entryName}.umd.js`;
      },
    },

    outDir: "dist",
    emptyOutDir: true,
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
});
