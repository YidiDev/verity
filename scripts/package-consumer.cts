import core = require("verity-dl");
import alpine = require("verity-dl/adapters/alpine");
import react = require("verity-dl/adapters/react");
import vue = require("verity-dl/adapters/vue");
import svelte = require("verity-dl/adapters/svelte");
import tools = require("verity-dl/devtools");

const options: core.InitOptions = {};
const snapshot = null as unknown as tools.DevtoolsSnapshot;

core.init(options);
alpine.ensureAlpineStore();
react.useCollection("items");
vue.useDL();
svelte.stateStore();
tools.initDevtools();

void snapshot;
