type Listener = (payload?: string) => void;

declare global {
  var __resistance_room_listeners__:
    | Map<string, Set<Listener>>
    | undefined;
}

function getRegistry() {
  if (!globalThis.__resistance_room_listeners__) {
    globalThis.__resistance_room_listeners__ = new Map();
  }

  return globalThis.__resistance_room_listeners__;
}

export function subscribeToRoom(roomCode: string, listener: Listener) {
  const registry = getRegistry();
  const listeners = registry.get(roomCode) ?? new Set<Listener>();
  listeners.add(listener);
  registry.set(roomCode, listeners);

  return () => {
    const current = registry.get(roomCode);
    if (!current) {
      return;
    }

    current.delete(listener);

    if (current.size === 0) {
      registry.delete(roomCode);
    }
  };
}

export function notifyRoom(roomCode: string, payload?: string) {
  const listeners = getRegistry().get(roomCode);
  if (!listeners) {
    return;
  }

  listeners.forEach((listener) => listener(payload));
}
