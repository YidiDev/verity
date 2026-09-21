import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "verity-package-"));
const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
const entrypoints = [
  "verity-dl",
  "verity-dl/adapters/alpine",
  "verity-dl/adapters/react",
  "verity-dl/adapters/vue",
  "verity-dl/adapters/svelte",
  "verity-dl/devtools",
];

function run(command, args, cwd = temp, capture = false) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
}

try {
  const packOutput = run(
    "npm",
    ["pack", "--json", "--pack-destination", temp],
    root,
    true,
  );
  const [{ filename }] = JSON.parse(packOutput);
  const tarball = join(temp, filename);

  writeFileSync(
    join(temp, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    tarball,
  ]);

  writeFileSync(
    join(temp, "runtime.cjs"),
    `for (const id of ${JSON.stringify(entrypoints)}) require(id);\n`,
  );
  writeFileSync(
    join(temp, "runtime.mjs"),
    `for (const id of ${JSON.stringify(entrypoints)}) await import(id);\n`,
  );
  run(process.execPath, ["runtime.cjs"]);
  run(process.execPath, ["runtime.mjs"]);

  writeFileSync(
    join(temp, "consumer.cts"),
    readFileSync(new URL("package-consumer.cts", import.meta.url), "utf8"),
  );
  writeFileSync(
    join(temp, "consumer.mts"),
    readFileSync(new URL("package-consumer.mts", import.meta.url), "utf8"),
  );

  for (const moduleKind of ["Node16", "NodeNext"]) {
    const config = `tsconfig.${moduleKind.toLowerCase()}.json`;
    writeFileSync(
      join(temp, config),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: moduleKind,
          moduleResolution: moduleKind,
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: [],
        },
        files: ["consumer.cts", "consumer.mts"],
      }),
    );
    run(process.execPath, [tsc, "-p", config]);
  }

  console.log("Packed package entrypoints and declarations verified");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
