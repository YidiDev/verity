/**
 * Build script: runs Vite in lib mode for each entry point separately.
 *
 * Vite 8 does not support multiple entry points with UMD format,
 * so we invoke `vite build` once per entry with a dynamic config.
 */

import { build } from "vite";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { cpSync, mkdirSync, writeFileSync } from "fs";
import dts from "vite-plugin-dts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const coreCjsTypes = [
  "InitOptions",
  "CreateTypeOptions",
  "CreateTypeLevelOptions",
  "CreateCollectionOptions",
  "FetchItemOptions",
  "FetchCollectionOptions",
  "SseConfig",
  "MemoryConfig",
  "Directive",
  "DirectiveResult",
  "ApplyDirectivesOptions",
  "DirectiveEnvelope",
  "DirectiveSourceInput",
  "CustomDirectiveSourceInput",
  "DirectiveSourceDescriptor",
  "DirectiveSourceHelpers",
  "CollectionRef",
  "CollectionData",
  "CollectionMeta",
  "ItemRef",
  "ItemMeta",
  "LifecyclePayload",
];

const devtoolsCjsTypes = [
  "DLAdapter",
  "DLAdaptersMap",
  "DevtoolsSnapshot",
  "DevtoolsStore",
  "DevtoolsLayout",
  "DevtoolsElements",
  "PanelDefinition",
  "EventEntry",
  "EventKind",
  "EventKindMeta",
  "LifecyclePayload",
];

const entries = [
  { name: "core", entry: "src/core/index.ts", types: "core/index", cjsTypes: coreCjsTypes, global: "DLCore" },
  { name: "adapters/alpine", entry: "src/adapters/alpine.ts", types: "adapters/alpine", global: "DLAdapters.Alpine" },
  { name: "adapters/react", entry: "src/adapters/react.ts", types: "adapters/react", global: "DLAdapters.React" },
  { name: "adapters/vue", entry: "src/adapters/vue.ts", types: "adapters/vue", global: "DLAdapters.Vue" },
  { name: "adapters/svelte", entry: "src/adapters/svelte.ts", types: "adapters/svelte", global: "DLAdapters.Svelte" },
  { name: "devtools/devtools", entry: "src/devtools/index.ts", types: "devtools/index", cjsTypes: devtoolsCjsTypes, global: "VerityDevtools" },
];

for (let i = 0; i < entries.length; i++) {
  const { name, entry, types, cjsTypes = [], global } = entries[i];
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

  cpSync(
    resolve(root, `dist/${name}.umd.js`),
    resolve(root, `dist/${name}.cjs`),
  );
  const declarationName = basename(types);
  const namespace = cjsTypes.length
    ? [
        "",
        "declare namespace api {",
        ...cjsTypes.map((typeName) => `  type ${typeName} = esm.${typeName};`),
        "}",
      ]
    : [];
  writeFileSync(
    resolve(root, `dist/${types}.d.cts`),
    [
      `import type * as esm from "./${declarationName}.js" with { "resolution-mode": "import" };`,
      "",
      "declare const api: typeof esm;",
      ...namespace,
      "export = api;",
      "",
    ].join("\n"),
  );
}

// Copy devtools CSS
mkdirSync(resolve(root, "dist/devtools"), { recursive: true });
cpSync(
  resolve(root, "src/devtools/devtools.css"),
  resolve(root, "dist/devtools/devtools.css"),
);
console.log("\nCopied devtools.css");
console.log("Build complete.");
