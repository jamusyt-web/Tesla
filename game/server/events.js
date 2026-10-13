// The game's event bus. Systems say what happened (a tree fell, a fish was
// landed, a monster died) and anything that cares listens: the tutorial
// today; quests, the journal and telemetry later. Nobody has to edit the code
// that raised the event to react to it.
//
// emit(c, ev, data): c is the connected Client it happened to (null when no
// one is online for it, e.g. gold paid to an offline seller).
// on(ev, fn): fn(c, data) is called for each emit; returns a function that
// stops listening.
//
// Events: gather, fish, kill, craft, stock, sell, trade, deliver, travel,
// attune, dungeonClear, jobDelivered, jobExpired, marketFill, gold, pos (1 Hz).
// A listener's error is logged and never breaks the action that raised it.

const LISTENERS = new Map(); // ev → [fn]

export function on(ev, fn) {
  if (!LISTENERS.has(ev)) LISTENERS.set(ev, []);
  LISTENERS.get(ev).push(fn);
  return () => {
    const list = LISTENERS.get(ev);
    const i = list?.indexOf(fn) ?? -1;
    if (i >= 0) list.splice(i, 1);
  };
}

export function emit(c, ev, data = {}) {
  const list = LISTENERS.get(ev);
  if (!list?.length) return;
  for (const fn of [...list]) {
    try {
      fn(c, data);
    } catch (e) {
      console.error(`event listener error (${ev})`, e);
    }
  }
}

export const listening = (ev) => !!LISTENERS.get(ev)?.length;
