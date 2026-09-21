import { init, type InitOptions } from "verity-dl";
import { ensureAlpineStore } from "verity-dl/adapters/alpine";
import { useCollection } from "verity-dl/adapters/react";
import { useDL } from "verity-dl/adapters/vue";
import { stateStore } from "verity-dl/adapters/svelte";
import { initDevtools, type DevtoolsSnapshot } from "verity-dl/devtools";

const options: InitOptions = {};
const snapshot = null as unknown as DevtoolsSnapshot;

init(options);
ensureAlpineStore();
useCollection("items");
useDL();
stateStore();
initDevtools();

void snapshot;
