import { describe, expect, it } from "vitest";
import {
  addNativeConnectionLifecycleHandler,
  addNativeConnectionLifecycleSubscriber,
  createCapacitorConnectionLifecycleSource,
  type NativeConnectionLifecycleEvent,
  type NativeConnectionLifecycleSource,
} from "../native";

type AppState = { isActive: boolean };
type NetworkStatus = { connected: boolean; connectionType: string };

type Listener<T> = (event: T) => void;

function createSource(initialAppState: AppState = { isActive: true }) {
  let appStateListener: Listener<AppState> | null = null;
  let pauseListener: (() => void) | null = null;
  let resumeListener: (() => void) | null = null;
  let networkListener: Listener<NetworkStatus> | null = null;
  let status: NetworkStatus = { connected: true, connectionType: "wifi" };
  let deferNextStatus = false;
  let resolveDeferredStatus: (() => void) | null = null;
  const removed: string[] = [];

  const source: NativeConnectionLifecycleSource = {
    isNativeAndroid: () => true,
    loadApp: async () => ({
      getState: async () => initialAppState,
      addStateListener: async (listener) => {
        appStateListener = listener;
        return { remove: async () => void removed.push("app-state") };
      },
      addPauseListener: async (listener) => {
        pauseListener = listener;
        return { remove: async () => void removed.push("pause") };
      },
      addResumeListener: async (listener) => {
        resumeListener = listener;
        return { remove: async () => void removed.push("resume") };
      },
    }),
    loadNetwork: async () => ({
      getStatus: () => {
        const result = status;
        if (!deferNextStatus) {
          return Promise.resolve(result);
        }
        deferNextStatus = false;
        return new Promise((resolve) => {
          resolveDeferredStatus = () => resolve(result);
        });
      },
      addListener: async (_event, listener) => {
        networkListener = listener;
        return { remove: async () => void removed.push("network") };
      },
    }),
  };

  return {
    source,
    removed,
    setStatus(next: NetworkStatus) {
      status = next;
    },
    deferNetworkStatus() {
      deferNextStatus = true;
    },
    resolveNetworkStatus() {
      resolveDeferredStatus?.();
      resolveDeferredStatus = null;
    },
    emitAppState(next: AppState) {
      appStateListener?.(next);
    },
    emitPause() {
      pauseListener?.();
    },
    emitResume() {
      resumeListener?.();
    },
    emitNetwork(next: NetworkStatus) {
      status = next;
      networkListener?.(next);
    },
  };
}

async function flushAsyncSetup() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe("native connection lifecycle", () => {
  it("loads a plain network adapter instead of exposing the Capacitor proxy as a thenable", async () => {
    const source = createCapacitorConnectionLifecycleSource();

    await expect(source.loadNetwork()).resolves.toEqual({
      getStatus: expect.any(Function),
      addListener: expect.any(Function),
    });
  });

  it("starts suspended when Android is already inactive", async () => {
    const fake = createSource({ isActive: false });
    const events: NativeConnectionLifecycleEvent[] = [];
    const remove = addNativeConnectionLifecycleHandler((event) => events.push(event), fake.source);
    await flushAsyncSetup();

    expect(events).toEqual([{ type: "suspend" }]);
    remove();
  });

  it("notifies in-process socket subscribers synchronously before React state work", async () => {
    const fake = createSource();
    const subscriberEvents: NativeConnectionLifecycleEvent[] = [];
    const handlerEvents: NativeConnectionLifecycleEvent[] = [];
    const removeSubscriber = addNativeConnectionLifecycleSubscriber((event) => {
      subscriberEvents.push(event);
    });
    const remove = addNativeConnectionLifecycleHandler((event) => {
      expect(subscriberEvents.at(-1)).toEqual(event);
      handlerEvents.push(event);
    }, fake.source);
    await flushAsyncSetup();

    fake.emitAppState({ isActive: false });
    fake.emitAppState({ isActive: true });

    expect(subscriberEvents).toEqual([{ type: "suspend" }, { type: "resume" }]);
    expect(handlerEvents).toEqual(subscriberEvents);
    remove();
    removeSubscriber();
  });

  it("replays raw suspend signals even when native state was already inactive", async () => {
    const fake = createSource();
    const events: NativeConnectionLifecycleEvent[] = [];
    const remove = addNativeConnectionLifecycleHandler((event) => events.push(event), fake.source);
    await flushAsyncSetup();

    fake.emitAppState({ isActive: false });
    fake.emitPause();

    expect(events).toEqual([{ type: "suspend" }, { type: "suspend" }]);
    remove();
  });

  it("emits suspend on Android activity pause before app state stops", async () => {
    const fake = createSource();
    const events: NativeConnectionLifecycleEvent[] = [];
    const remove = addNativeConnectionLifecycleHandler((event) => events.push(event), fake.source);
    await flushAsyncSetup();

    fake.emitPause();
    fake.emitResume();
    fake.emitAppState({ isActive: true });

    expect(events).toEqual([{ type: "suspend" }, { type: "resume" }]);
    remove();
  });

  it("emits suspend and resume from Android app state", async () => {
    const fake = createSource();
    const events: NativeConnectionLifecycleEvent[] = [];
    const remove = addNativeConnectionLifecycleHandler((event) => events.push(event), fake.source);
    await flushAsyncSetup();

    fake.emitAppState({ isActive: false });
    fake.emitAppState({ isActive: true });
    await flushAsyncSetup();

    expect(events).toEqual([{ type: "suspend" }, { type: "resume" }]);
    remove();
  });

  it("emits only real network path changes while active", async () => {
    const fake = createSource();
    const events: NativeConnectionLifecycleEvent[] = [];
    const remove = addNativeConnectionLifecycleHandler((event) => events.push(event), fake.source);
    await flushAsyncSetup();

    fake.emitNetwork({ connected: true, connectionType: "wifi" });
    fake.emitNetwork({ connected: true, connectionType: "cellular" });
    fake.emitNetwork({ connected: true, connectionType: "cellular" });

    expect(events).toEqual([{ type: "networkChange" }]);
    remove();
  });

  it("folds a path change during suspension into the resume event", async () => {
    const fake = createSource();
    const events: NativeConnectionLifecycleEvent[] = [];
    const remove = addNativeConnectionLifecycleHandler((event) => events.push(event), fake.source);
    await flushAsyncSetup();

    fake.emitAppState({ isActive: false });
    fake.emitNetwork({ connected: true, connectionType: "cellular" });
    fake.emitAppState({ isActive: true });
    await flushAsyncSetup();

    expect(events).toEqual([{ type: "suspend" }, { type: "resume" }]);
    remove();
  });

  it("does not block resume or later path changes on a deferred network snapshot", async () => {
    const fake = createSource();
    const events: NativeConnectionLifecycleEvent[] = [];
    const remove = addNativeConnectionLifecycleHandler((event) => events.push(event), fake.source);
    await flushAsyncSetup();

    fake.emitAppState({ isActive: false });
    fake.deferNetworkStatus();
    fake.emitAppState({ isActive: true });

    expect(events).toEqual([{ type: "suspend" }, { type: "resume" }]);

    fake.emitNetwork({ connected: true, connectionType: "cellular" });
    expect(events).toEqual([
      { type: "suspend" },
      { type: "resume" },
      { type: "networkChange" },
    ]);

    fake.resolveNetworkStatus();
    await flushAsyncSetup();
    expect(events).toEqual([
      { type: "suspend" },
      { type: "resume" },
      { type: "networkChange" },
    ]);
    remove();
  });

  it("does not emit an initial snapshot after disposal", async () => {
    const fake = createSource({ isActive: false });
    fake.deferNetworkStatus();
    const events: NativeConnectionLifecycleEvent[] = [];
    const remove = addNativeConnectionLifecycleHandler((event) => events.push(event), fake.source);
    await flushAsyncSetup();

    remove();
    fake.resolveNetworkStatus();
    await flushAsyncSetup();

    expect(events).toEqual([]);
  });

  it("removes both native listeners", async () => {
    const fake = createSource();
    const remove = addNativeConnectionLifecycleHandler(() => undefined, fake.source);
    await flushAsyncSetup();

    remove();
    await flushAsyncSetup();

    expect(fake.removed.sort()).toEqual(["app-state", "network", "pause", "resume"]);
  });

  it("does not load native plugins in a browser", async () => {
    let loaded = false;
    const source: NativeConnectionLifecycleSource = {
      isNativeAndroid: () => false,
      loadApp: async () => {
        loaded = true;
        throw new Error("unexpected");
      },
      loadNetwork: async () => {
        loaded = true;
        throw new Error("unexpected");
      },
    };

    const remove = addNativeConnectionLifecycleHandler(() => undefined, source);
    await flushAsyncSetup();
    remove();

    expect(loaded).toBe(false);
  });
});
