// ---------------------------------------------------------------------------
// verity-dl  –  Svelte adapter (stores)
// ---------------------------------------------------------------------------

import {
  init as coreInit,
  onChange as coreOnChange,
  fetchCollection,
  fetchItem,
  applyDirectives,
  state as coreState,
  createType,
  createCollection,
  configureDirectiveSource,
  configureSse,
  configureMemory,
  connectDirectiveSource,
  connectSse,
  disconnectDirectiveSource,
  disconnectSse,
  ingestDirectiveEnvelope,
  onLifecycle,
  clientId,
  devtools,
  isItemLoading,
  isCollectionLoading,
  hasAnyInFlightRequests,
  type InitOptions,
  type CollectionRef,
  type ItemRef,
} from "../core/index.js";

// ---- Types ----------------------------------------------------------------

type SubscriberRun<T> = (value: T) => void;
type SubscriberInvalidate = () => void;
type Subscriber<T> = [SubscriberRun<T>, SubscriberInvalidate];
type StopFn = () => void;
type StartFn<T> = (set: (value: T) => void) => StopFn | null | void;

interface Readable<T> {
  subscribe: (
    run: SubscriberRun<T>,
    invalidate?: SubscriberInvalidate,
  ) => () => void;
}

// ---- Store factory --------------------------------------------------------

const noop: () => void = () => {};

function createStore<T>(
  initialValue: T | undefined,
  start: StartFn<T>,
): Readable<T | undefined> {
  let value: T | undefined = initialValue;
  let stop: StopFn = noop;
  const subscribers = new Set<Subscriber<T | undefined>>();
  let started = false;

  function set(nextValue: T | undefined): void {
    value = nextValue;
    if (!subscribers.size) return;

    const runs: SubscriberRun<T | undefined>[] = [];

    for (const subscriber of subscribers) {
      const invalidate = subscriber[1];
      if (typeof invalidate === "function") {
        try {
          invalidate();
        } catch {
          /* ignore subscriber errors */
        }
      }
      runs.push(subscriber[0]);
    }

    for (const run of runs) {
      try {
        run(value);
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  function cleanup(): void {
    if (typeof stop === "function" && stop !== noop) {
      try {
        stop();
      } catch {
        /* ignore cleanup errors */
      }
    }
    stop = noop;
    started = false;
  }

  return {
    subscribe(
      run: SubscriberRun<T | undefined>,
      invalidate: SubscriberInvalidate = noop,
    ): () => void {
      if (typeof run !== "function") return noop;

      const subscriber: Subscriber<T | undefined> = [run, invalidate];
      subscribers.add(subscriber);

      if (!started) {
        started = true;
        try {
          const teardown =
            typeof start === "function" ? start(set as (v: T) => void) : null;
          stop = typeof teardown === "function" ? teardown : noop;
        } catch (err) {
          subscribers.delete(subscriber);
          started = false;
          stop = noop;
          throw err;
        }
      }

      if (value !== undefined) {
        try {
          run(value);
        } catch {
          /* ignore subscriber errors */
        }
      }

      return () => {
        subscribers.delete(subscriber);
        if (!subscribers.size) {
          cleanup();
        }
      };
    },
  };
}

// ---- Store constructors ---------------------------------------------------

export function collectionStore(
  name: string,
  opts: Record<string, unknown> = {},
): Readable<CollectionRef | undefined> {
  if (!name) {
    throw new Error("collectionStore requires a collection name");
  }

  let ref: CollectionRef;

  return createStore<CollectionRef>(undefined, (set) => {
    ref = fetchCollection(name, opts);
    set(ref);

    const unsubscribe = coreOnChange(() => {
      set(ref);
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  });
}

export function itemStore(
  typeName: string,
  id: unknown,
  level: string | null = null,
  opts: Record<string, unknown> = {},
): Readable<ItemRef | undefined> {
  if (!typeName) {
    throw new Error("itemStore requires a type name");
  }
  if (id === undefined || id === null) {
    throw new Error("itemStore requires an id");
  }

  let ref: ItemRef;

  return createStore<ItemRef>(undefined, (set) => {
    ref = fetchItem(typeName, id, level, opts);
    set(ref);

    const unsubscribe = coreOnChange(() => {
      set(ref);
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  });
}

export function stateStore(
  selector: ((snapshot: unknown) => unknown) | null = null,
): Readable<unknown> {
  const select =
    typeof selector === "function"
      ? (snapshot: unknown) => selector(snapshot)
      : (snapshot: unknown) => snapshot;

  return createStore<unknown>(undefined, (set) => {
    const emit = (): void => {
      const snapshot = coreState();
      set(select(snapshot));
    };

    emit();
    const unsubscribe = coreOnChange(emit);

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  });
}

export function manualStore(
  readValue: () => unknown,
): Readable<unknown> {
  if (typeof readValue !== "function") {
    throw new Error(
      "manualStore requires a function that returns the next value",
    );
  }

  return createStore<unknown>(undefined, (set) => {
    const emit = (): void => {
      set(readValue());
    };

    emit();
    const unsubscribe = coreOnChange(emit);

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  });
}

// ---- Init wrapper ---------------------------------------------------------

export function init(options: InitOptions = {}): void {
  return coreInit(options);
}

// ---- Re-exports from core -------------------------------------------------

export {
  coreOnChange as onChange,
  fetchCollection,
  fetchItem,
  applyDirectives,
  coreState as state,
  createType,
  createCollection,
  configureDirectiveSource,
  configureSse,
  configureMemory,
  connectDirectiveSource,
  connectSse,
  disconnectDirectiveSource,
  disconnectSse,
  ingestDirectiveEnvelope,
  onLifecycle,
  clientId,
  devtools,
  isItemLoading,
  isCollectionLoading,
  hasAnyInFlightRequests,
};
