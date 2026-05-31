// ---------------------------------------------------------------------------
// verity-dl devtools – Object tree rendering, inspector view, clipboard
// ---------------------------------------------------------------------------

// ---- Primitive & object inspection helpers --------------------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function isTreeExpandable(
  value: unknown,
): value is unknown[] | Record<string, unknown> {
  return Array.isArray(value) || isPlainObject(value);
}

export function isTreeEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

export function getTreeEntries(
  value: unknown,
): [string | number, unknown][] {
  if (Array.isArray(value)) {
    return value.map((item, index) => [index, item]);
  }
  return Object.entries((value ?? {}) as Record<string, unknown>);
}

export function formatPrimitive(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return value.toString() + "n";
  if (typeof value === "symbol") return value.toString();
  return String(value as string);
}

export function toJsonString(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return value.toString() + "n";
  try {
    if (typeof value === "string") {
      return JSON.stringify(value);
    }
    return JSON.stringify(value, null, 2);
  } catch {
    try {
      return String(value as string);
    } catch {
      return "";
    }
  }
}

// ---- Clipboard -----------------------------------------------------------

export async function copyTextToClipboard(text: unknown): Promise<boolean> {
  const str = typeof text === "string" ? text : String(text);
  if (!str) return false;
  try {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(str);
      return true;
    }
  } catch {
    // fall back
  }
  const area = document.createElement("textarea");
  area.value = str;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    area.remove();
    return false;
  }
}

// ---- Object tree ---------------------------------------------------------

export interface TreeOptions {
  collapseDepth?: number;
  rootLabel?: string | null;
  emptyLabel?: string;
}

function buildNode(
  key: string | number | null,
  nodeValue: unknown,
  depth: number,
  collapseDepth: number,
): HTMLDivElement {
  const node = document.createElement("div");
  node.className = "vdl-tree-node";

  const row = document.createElement("div");
  row.className = "vdl-tree-row";
  row.style.paddingLeft = `${depth * 14}px`;
  node.appendChild(row);

  const isCollection = isTreeExpandable(nodeValue);
  const entries = isCollection ? getTreeEntries(nodeValue) : [];
  const hasChildren = entries.length > 0;
  let toggleButton: HTMLButtonElement | null = null;

  if (hasChildren) {
    row.classList.add("is-expandable");
    row.tabIndex = 0;
    toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "vdl-tree-toggle";
    row.appendChild(toggleButton);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "vdl-tree-toggle is-placeholder";
    row.appendChild(spacer);
  }

  if (key != null) {
    const keySpan = document.createElement("span");
    keySpan.className = "vdl-tree-key";
    keySpan.textContent = String(key) + ":";
    row.appendChild(keySpan);
  }

  if (isCollection) {
    const summary = document.createElement("span");
    summary.className = "vdl-tree-summary";
    if (Array.isArray(nodeValue)) {
      summary.textContent = `Array(${nodeValue.length})`;
    } else {
      summary.textContent = `Object(${Object.keys((nodeValue ?? {}) as Record<string, unknown>).length})`;
    }
    row.appendChild(summary);
  } else {
    const valueSpan = document.createElement("span");
    valueSpan.className = "vdl-tree-value";
    valueSpan.textContent = formatPrimitive(nodeValue);
    row.appendChild(valueSpan);
  }

  if (hasChildren) {
    const children = document.createElement("div");
    children.className = "vdl-tree-children";
    entries.forEach(([childKey, childValue]) => {
      children.appendChild(buildNode(childKey, childValue, depth + 1, collapseDepth));
    });
    node.appendChild(children);

    let collapsed = depth >= collapseDepth;
    const tb = toggleButton;

    const applyState = (next: boolean): void => {
      collapsed = next;
      children.hidden = collapsed;
      if (tb) tb.textContent = collapsed ? "\u25b8" : "\u25be";
      node.classList.toggle("is-collapsed", collapsed);
    };

    applyState(collapsed);

    const toggleState = (event?: Event): void => {
      if (event) event.stopPropagation();
      applyState(!collapsed);
    };

    if (tb) {
      tb.addEventListener("click", toggleState);
    }
    row.addEventListener("click", (event) => {
      if (tb && (event.target === tb || tb.contains(event.target as Node))) {
        return;
      }
      toggleState(event);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleState(event);
      }
    });
  }

  return node;
}

export function createObjectTree(
  value: unknown,
  options: TreeOptions = {},
): HTMLDivElement {
  const { collapseDepth = 1, rootLabel = null } = options;
  const tree = document.createElement("div");
  tree.className = "vdl-tree";

  if (!isTreeExpandable(value) || rootLabel != null) {
    tree.appendChild(buildNode(rootLabel, value, 0, collapseDepth));
  } else {
    const entries = getTreeEntries(value);
    if (!entries.length) {
      tree.appendChild(buildNode(rootLabel, value, 0, collapseDepth));
    } else {
      entries.forEach(([childKey, childValue]) => {
        tree.appendChild(buildNode(childKey, childValue, 0, collapseDepth));
      });
    }
  }

  return tree;
}

// ---- Inspector view (tree + JSON toggle + copy) --------------------------

export function renderTreeInto(
  target: Element | null,
  value: unknown,
  options: TreeOptions = {},
): void {
  if (!target || !(target instanceof HTMLElement)) return;
  target.innerHTML = "";
  const emptyLabel = options.emptyLabel ?? "No data available.";

  if (value == null || (isTreeExpandable(value) && isTreeEmpty(value))) {
    const empty = document.createElement("p");
    empty.className = "vdl-empty";
    empty.textContent = emptyLabel;
    target.appendChild(empty);
    return;
  }

  const viewContainer = document.createElement("div");
  viewContainer.className = "vdl-inspector";
  const toolbar = document.createElement("div");
  toolbar.className = "vdl-inspector-toolbar";
  const actions = document.createElement("div");
  actions.className = "vdl-inspector-actions";

  let viewMode: "tree" | "json" =
    target.dataset["viewMode"] === "json" ? "json" : "tree";
  target.dataset["viewMode"] = viewMode;

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "vdl-btn vdl-btn-ghost";
  toggleBtn.title = "Toggle between tree and JSON views";

  const updateToggleLabel = (): void => {
    const isJson = viewMode === "json";
    toggleBtn.textContent = isJson ? "View tree" : "View JSON";
    toggleBtn.setAttribute("aria-pressed", isJson ? "true" : "false");
  };
  updateToggleLabel();

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "vdl-btn";
  copyBtn.textContent = "Copy";
  copyBtn.title = "Copy JSON to clipboard";

  const content = document.createElement("div");
  content.className = "vdl-inspector-view";

  const renderView = (): void => {
    content.innerHTML = "";
    if (viewMode === "json") {
      const pre = document.createElement("pre");
      pre.className = "vdl-json-view";
      pre.textContent = toJsonString(value);
      content.appendChild(pre);
    } else if (isTreeExpandable(value)) {
      const treeOptions: TreeOptions = { ...options };
      delete treeOptions.emptyLabel;
      content.appendChild(createObjectTree(value, treeOptions));
    } else {
      const primitive = document.createElement("div");
      primitive.className = "vdl-tree-primitive";
      primitive.textContent = formatPrimitive(value);
      content.appendChild(primitive);
    }
  };

  toggleBtn.addEventListener("click", () => {
    viewMode = viewMode === "json" ? "tree" : "json";
    target.dataset["viewMode"] = viewMode;
    updateToggleLabel();
    renderView();
  });

  copyBtn.addEventListener("click", async () => {
    const payload = toJsonString(value);
    const success = await copyTextToClipboard(payload);
    if (success) {
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = original;
      }, 1500);
    }
  });

  actions.appendChild(toggleBtn);
  actions.appendChild(copyBtn);
  toolbar.appendChild(actions);
  viewContainer.appendChild(toolbar);
  viewContainer.appendChild(content);
  target.appendChild(viewContainer);
  renderView();
}
