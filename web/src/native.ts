import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { Network } from "@capacitor/network";

type NativeBackHandler = () => boolean;
type NativeKeyboardHideHandler = () => void;

type NativeListenerHandle = { remove(): Promise<void> | void };
type NativeAppState = { isActive: boolean };
type NativeNetworkStatus = { connected: boolean; connectionType: string };

export type NativeConnectionLifecycleEvent =
  | { type: "suspend" }
  | { type: "resume" }
  | { type: "networkChange" };

export type NativeConnectionLifecycleSource = {
  isNativeAndroid(): boolean;
  loadApp(): Promise<{
    getState(): Promise<NativeAppState>;
    addStateListener(listener: (state: NativeAppState) => void): Promise<NativeListenerHandle>;
    addPauseListener(listener: () => void): Promise<NativeListenerHandle>;
    addResumeListener(listener: () => void): Promise<NativeListenerHandle>;
  }>;
  loadNetwork(): Promise<{
    getStatus(): Promise<NativeNetworkStatus>;
    addListener(
      event: "networkStatusChange",
      listener: (status: NativeNetworkStatus) => void,
    ): Promise<NativeListenerHandle>;
  }>;
};

const noop = () => undefined;
let nativeControlsStarted = false;
const nativeBackHandlers: NativeBackHandler[] = [];
const nativeConnectionLifecycleSubscribers = new Set<
  (event: NativeConnectionLifecycleEvent) => void
>();

export function startNativeControls() {
  if (nativeControlsStarted || !Capacitor.isNativePlatform()) {
    return;
  }
  nativeControlsStarted = true;

  void App.addListener("backButton", ({ canGoBack }) => {
    for (const handler of [...nativeBackHandlers].reverse()) {
      if (handler()) {
        return;
      }
    }
    if (canGoBack) {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });
}

export function createCapacitorConnectionLifecycleSource(): NativeConnectionLifecycleSource {
  return {
    isNativeAndroid,
    loadApp: async () => ({
      getState: () => App.getState(),
      addStateListener: (listener) => App.addListener("appStateChange", listener),
      addPauseListener: (listener) => App.addListener("pause", listener),
      addResumeListener: (listener) => App.addListener("resume", listener),
    }),
    loadNetwork: async () => ({
      getStatus: () => Network.getStatus(),
      addListener: (event, listener) => Network.addListener(event, listener),
    }),
  };
}

const defaultConnectionLifecycleSource = createCapacitorConnectionLifecycleSource();

export function addNativeConnectionLifecycleSubscriber(
  subscriber: (event: NativeConnectionLifecycleEvent) => void,
): () => void {
  nativeConnectionLifecycleSubscribers.add(subscriber);
  return () => {
    nativeConnectionLifecycleSubscribers.delete(subscriber);
  };
}

export function addNativeConnectionLifecycleHandler(
  handler: (event: NativeConnectionLifecycleEvent) => void,
  source: NativeConnectionLifecycleSource = defaultConnectionLifecycleSource,
) {
  if (!source.isNativeAndroid()) {
    return noop;
  }

  let disposed = false;
  let appActive = true;
  let appLifecycleEventObserved = false;
  let networkEventVersion = 0;
  let networkSignature: string | null = null;
  const listenerHandles: NativeListenerHandle[] = [];
  const emit = (event: NativeConnectionLifecycleEvent) => {
    for (const subscriber of nativeConnectionLifecycleSubscribers) {
      subscriber(event);
    }
    handler(event);
  };

  const observeNetworkStatus = (status: NativeNetworkStatus, emitChange: boolean) => {
    const nextSignature = `${status.connected}:${status.connectionType}`;
    const changed = networkSignature !== null && networkSignature !== nextSignature;
    networkSignature = nextSignature;
    if (changed && emitChange && appActive && !disposed) {
      emit({ type: "networkChange" });
    }
  };

  void Promise.all([source.loadApp(), source.loadNetwork()])
    .then(async ([app, network]) => {
      const observeAppActive = (isActive: boolean) => {
        appLifecycleEventObserved = true;
        if (disposed) {
          return;
        }
        if (!isActive) {
          appActive = false;
          emit({ type: "suspend" });
          return;
        }
        if (appActive) {
          return;
        }
        appActive = true;
        emit({ type: "resume" });
        const networkVersionBeforeRefresh = networkEventVersion;
        void network
          .getStatus()
          .then((status) => {
            if (!disposed && networkEventVersion === networkVersionBeforeRefresh) {
              observeNetworkStatus(status, false);
            }
          })
          .catch((error) => {
            console.warn("native network status refresh unavailable", error);
          });
      };
      const [appStateHandle, pauseHandle, resumeHandle, networkHandle] = await Promise.all([
        app.addStateListener(({ isActive }) => observeAppActive(isActive)),
        app.addPauseListener(() => observeAppActive(false)),
        app.addResumeListener(() => observeAppActive(true)),
        network.addListener("networkStatusChange", (status) => {
          networkEventVersion += 1;
          observeNetworkStatus(status, true);
        }),
      ]);
      listenerHandles.push(appStateHandle, pauseHandle, resumeHandle, networkHandle);
      if (disposed) {
        await Promise.all(listenerHandles.map((handle) => handle.remove()));
        return;
      }
      const [initialAppState, initialNetworkStatus] = await Promise.all([
        app.getState(),
        network.getStatus(),
      ]);
      if (disposed) {
        return;
      }
      if (!appLifecycleEventObserved) {
        appActive = initialAppState.isActive;
        if (!appActive) {
          emit({ type: "suspend" });
        }
      }
      if (networkEventVersion === 0) {
        observeNetworkStatus(initialNetworkStatus, false);
      }
    })
    .catch((error) => {
      console.warn("native connection lifecycle unavailable", error);
    });

  return () => {
    disposed = true;
    for (const listenerHandle of listenerHandles.splice(0)) {
      void listenerHandle.remove();
    }
  };
}

export function addNativeBackHandler(handler: NativeBackHandler) {
  nativeBackHandlers.push(handler);
  return () => {
    const index = nativeBackHandlers.lastIndexOf(handler);
    if (index >= 0) {
      nativeBackHandlers.splice(index, 1);
    }
  };
}

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function addNativeKeyboardHideHandler(handler: NativeKeyboardHideHandler) {
  if (!isNativeAndroid() || !Capacitor.isPluginAvailable("Keyboard")) {
    return noop;
  }

  let disposed = false;
  let removeListener: (() => void) | null = null;
  void Keyboard.addListener("keyboardDidHide", handler)
    .then((handle) => {
      removeListener = () => {
        void handle.remove();
      };
      if (disposed) {
        removeListener();
      }
    })
    .catch((error) => {
      console.warn("keyboard hide listener unavailable", error);
    });

  return () => {
    disposed = true;
    removeListener?.();
  };
}
