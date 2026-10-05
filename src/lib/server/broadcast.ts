import "server-only";

import { hub } from "../../../server/hub.mjs";

/**
 * Tell a room that something changed.
 *
 * The payload is deliberately empty. Clients react by re-fetching the
 * bootstrap endpoint, which is the one place that decides what a given player
 * is allowed to see. A notification that carries no data cannot leak anything,
 * and there is no second serialisation path to audit.
 *
 * The sockets live in this same process (see `server/index.mjs`), so this is
 * a loop over open connections, not a network call. It cannot fail the
 * mutation that triggered it; a client that misses one catches up by polling.
 */
export function notifyRoom(roomId: string, reason: string): void {
  hub().notify(roomId, reason);
}

/** Close a departed player's sockets so they stop showing as online. */
export function disconnectPlayer(roomId: string, playerId: string): void {
  hub().disconnect(roomId, playerId);
}
