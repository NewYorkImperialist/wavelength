/**
 * Who is connected to which room, and how to tell them something changed.
 *
 * Messages carry no game data. A client that hears `changed` re-fetches the
 * bootstrap endpoint, which is the one place that decides what each player may
 * see, so nothing sent here can leak a target or anyone's guess.
 *
 * Server to client:
 *   { type: "changed", reason }      something in the room moved; re-fetch
 *   { type: "presence", playerIds }  who currently has the room open
 *
 * Clients send nothing. Like `database.mjs`, this lives on `globalThis` so the
 * custom server (which owns the sockets) and the Next route handlers (which
 * know when to notify) share one instance.
 */

/**
 * @typedef {{ readonly playerId: string, send(data: string): void, close(code?: number, reason?: string): void }} Peer
 */

class Hub {
  /** @type {Map<string, Set<Peer>>} */
  #rooms = new Map();

  /**
   * @param {string} roomId
   * @param {Peer} peer
   * @returns {() => void} call when the socket closes
   */
  join(roomId, peer) {
    let peers = this.#rooms.get(roomId);
    if (peers === undefined) {
      peers = new Set();
      this.#rooms.set(roomId, peers);
    }
    peers.add(peer);
    this.#sendPresence(roomId);

    return () => {
      const current = this.#rooms.get(roomId);
      if (current === undefined || !current.delete(peer)) return;
      if (current.size === 0) this.#rooms.delete(roomId);
      else this.#sendPresence(roomId);
    };
  }

  /**
   * @param {string} roomId
   * @param {string} reason a coarse label for debugging — never game data
   */
  notify(roomId, reason) {
    this.#broadcast(roomId, { type: "changed", reason });
  }

  /**
   * Close a departing player's sockets, so the room stops showing them online.
   *
   * @param {string} roomId
   * @param {string} playerId
   */
  disconnect(roomId, playerId) {
    for (const peer of [...(this.#rooms.get(roomId) ?? [])]) {
      if (peer.playerId === playerId) peer.close(4001, "left");
    }
  }

  /** @param {string} roomId */
  online(roomId) {
    return [...new Set([...(this.#rooms.get(roomId) ?? [])].map((peer) => peer.playerId))];
  }

  /** @param {string} roomId */
  #sendPresence(roomId) {
    this.#broadcast(roomId, { type: "presence", playerIds: this.online(roomId) });
  }

  /**
   * @param {string} roomId
   * @param {unknown} message
   */
  #broadcast(roomId, message) {
    const data = JSON.stringify(message);
    for (const peer of this.#rooms.get(roomId) ?? []) {
      try {
        peer.send(data);
      } catch {
        // A socket that died mid-send is cleaned up by its close handler.
      }
    }
  }
}

const KEY = Symbol.for("wavelength.hub");

/** @returns {Hub} */
export function hub() {
  /** @type {Record<symbol, Hub | undefined>} */
  const store = /** @type {any} */ (globalThis);
  return (store[KEY] ??= new Hub());
}
