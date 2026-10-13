// Rich and ancient gathering nodes (SPEC §4.3): now and then a node turns
// rich (gold tint) or ancient (violet) for a while and drops more. The states
// live in memory only and are rebuilt on boot.
//
// Phase 0 stub with the final signatures: every node stays normal.

export const NODE_STATE = { normal: 0, rich: 1, ancient: 2 };

// Called from the channel tick: start and end states on this channel's nodes.
export function tickNodeStates(ch, now) {}

// A node's state for snapshots and loot: 0 normal, 1 rich, 2 ancient.
export function stateOf(n) {
  return n?.st ?? NODE_STATE.normal;
}
