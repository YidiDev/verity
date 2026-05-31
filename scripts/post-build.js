/**
 * Post-build script: copies adapter and devtools files into dist/
 *
 * The adapters and devtools are plain JS IIFEs that depend on
 * window.DLCore being loaded first. They aren't bundled through
 * Vite -- they're shipped as-is alongside the Vite-built core.
 */

import { cpSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

// Ensure output directories exist
mkdirSync(resolve(dist, "adapters"), { recursive: true });
mkdirSync(resolve(dist, "devtools"), { recursive: true });

// Copy adapters
const adapters = ["alpine.js", "react.js", "vue.js", "svelte.js"];
for (const file of adapters) {
  cpSync(
    resolve(root, "src/adapters", file),
    resolve(dist, "adapters", file),
  );
  console.log(`  copied adapters/${file}`);
}

// Copy devtools
cpSync(
  resolve(root, "src/devtools/devtools.js"),
  resolve(dist, "devtools/devtools.js"),
);
console.log("  copied devtools/devtools.js");

cpSync(
  resolve(root, "src/devtools/devtools.css"),
  resolve(dist, "devtools/devtools.css"),
);
console.log("  copied devtools/devtools.css");

console.log("Post-build copy complete.");
