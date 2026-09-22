/**
 * Vote-skip: discarding a card the room cannot work with.
 *
 * Kept pure, so the threshold and the rules about which votes still stand can
 * be tested without a database — the same split `free-for-all.ts` has from the
 * server module that persists its results.
 */

export interface SkipVote {
  readonly playerId: string;
  /** The card this vote was cast against, not necessarily the current one. */
  readonly cardId: string;
}

export interface SkipTally {
  /** Votes that still stand, after the exclusions in `tallySkipVotes`. */
  readonly voterIds: readonly string[];
  readonly connectedPlayers: number;
  readonly required: number;
  readonly carried: boolean;
}

/**
 * A strict majority, so a tie keeps the card: both players in a room of two,
 * two of three, three of four. Half would let one player of two bin a card
 * the other was perfectly happy to clue.
 */
export function votesToSkip(connectedPlayers: number): number {
  return Math.floor(connectedPlayers / 2) + 1;
}

export function skipCarries(votes: number, connectedPlayers: number): boolean {
  return votes >= votesToSkip(connectedPlayers);
}

/**
 * Which votes count, and whether they are enough.
 *
 * Two kinds of vote are dropped here rather than in SQL, because both are
 * really rules about the game and not about storage:
 *
 * A vote against a different card is stale. A skip rewrites the card on the
 * same round row, so without this a vote cast on the card just discarded
 * would carry straight over to its replacement.
 *
 * A vote from someone who has left goes with them. They are already out of
 * the denominator, so counting them in the numerator could carry a skip that
 * nobody still in the room asked for.
 */
export function tallySkipVotes(
  connectedPlayerIds: readonly string[],
  votes: readonly SkipVote[],
  currentCardId: string,
): SkipTally {
  const present = new Set(connectedPlayerIds);
  const voterIds = votes
    .filter((vote) => vote.cardId === currentCardId && present.has(vote.playerId))
    .map((vote) => vote.playerId);

  return {
    voterIds,
    connectedPlayers: present.size,
    required: votesToSkip(present.size),
    carried: skipCarries(voterIds.length, present.size),
  };
}
