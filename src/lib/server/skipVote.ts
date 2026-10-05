import "server-only";

import { randomBytes } from "node:crypto";

import { tallySkipVotes, type SkipTally, type SkipVote } from "@/lib/game/vote-skip";

import { commitToTarget, generateTargetSteps, pickCard } from "./createRound";
import { all, one, run, transaction } from "./db";

/**
 * Vote-skip plumbing: read the tally, and reroll the card once it carries.
 *
 * Which votes count and how many are needed is decided in
 * `@/lib/game/vote-skip`, which has no database in it. Nothing in this file
 * makes that judgement itself, so there is exactly one implementation of the
 * threshold and the tests reach it directly.
 */

/** Who is in the room, for both sides of the fraction. */
function connectedPlayerIds(roomId: string): string[] {
  return all<{ id: string }>(
    "select id from players where room_id = ? and left_at is null",
    roomId,
  ).map((player) => player.id);
}

export function loadSkipVotes(roundId: string): SkipVote[] {
  return all<{ player_id: string; card_id: string }>(
    "select player_id, card_id from round_skip_votes where round_id = ?",
    roundId,
  ).map((row) => ({ playerId: row.player_id, cardId: row.card_id }));
}

export function skipTally(roomId: string, roundId: string, cardId: string): SkipTally {
  return tallySkipVotes(connectedPlayerIds(roomId), loadSkipVotes(roundId), cardId);
}

/**
 * Cast or withdraw one player's vote against the card in play.
 *
 * Pressing the button twice is not an error — the row is keyed by round,
 * player and card, so a repeated vote is the same vote.
 */
export function setSkipVote(input: {
  roundId: string;
  playerId: string;
  cardId: string;
  voting: boolean;
}): void {
  if (!input.voting) {
    run(
      "delete from round_skip_votes where round_id = ? and player_id = ? and card_id = ?",
      input.roundId,
      input.playerId,
      input.cardId,
    );
    return;
  }

  run(
    `insert into round_skip_votes (round_id, player_id, card_id) values (?, ?, ?)
     on conflict do nothing`,
    input.roundId,
    input.playerId,
    input.cardId,
  );
}

/**
 * Deal a replacement card, and a fresh target, to the same Psychic.
 *
 * False means the card had already moved on — either another voter's request
 * rerolled it first, or the Psychic's clue landed and the round left the clue
 * phase. Both are ordinary outcomes of two people acting at once, not errors,
 * so callers report success and let the client re-read the room.
 */
export function rerollCard(input: { roundId: string; gameId: string; cardId: string }): boolean {
  return transaction(() => {
    const replacement = pickCard(input.gameId, [input.cardId]);
    // A fresh target, not just a fresh card: the Psychic has already seen the
    // one belonging to the card being thrown away.
    const targetSteps = generateTargetSteps();
    const nonce = randomBytes(16);
    const { commitment } = commitToTarget(targetSteps, nonce);

    // Compare-and-swap on the card and the phase: a clue already given, or a
    // card someone else's vote already replaced, means this skip is too late.
    const swapped = run(
      `update rounds set card_id = ?, target_commitment = ?
        where id = ? and phase = 'clue' and card_id = ?`,
      replacement,
      commitment,
      input.roundId,
      input.cardId,
    );
    if (swapped === 0) return false;

    // The target and its commitment move together or the published
    // commitment is a lie. The transaction is what guarantees that.
    run(
      `insert into round_targets (round_id, target_center, nonce) values (?, ?, ?)
       on conflict (round_id) do update set
         target_center = excluded.target_center,
         nonce = excluded.nonce`,
      input.roundId,
      targetSteps,
      nonce,
    );

    // The skipped card stays recorded as used, so a card the room rejected
    // cannot come back this game. The replacement is recorded now too.
    run(
      "insert into game_used_cards (game_id, card_id) values (?, ?) on conflict do nothing",
      input.gameId,
      replacement,
    );
    return true;
  });
}

export interface SkipOutcome {
  readonly tally: SkipTally;
  readonly skipped: boolean;
}

/** Read the tally and act on it, which is all any caller ever wants. */
export function resolveSkipVotes(input: {
  roomId: string;
  roundId: string;
  gameId: string;
  cardId: string;
}): SkipOutcome {
  return transaction(() => {
    const tally = skipTally(input.roomId, input.roundId, input.cardId);
    if (!tally.carried) return { tally, skipped: false };

    const skipped = rerollCard({
      roundId: input.roundId,
      gameId: input.gameId,
      cardId: input.cardId,
    });
    return { tally, skipped };
  });
}

/**
 * Re-check the tally after the roster changes.
 *
 * A departure shrinks the denominator, so votes that were one short can
 * become a majority with nobody pressing anything. Without this the room
 * would sit on a card it had already voted out until someone thought to
 * toggle their vote off and on again.
 */
export function reconsiderSkipVotes(roomId: string): boolean {
  const round = one<{ id: string; game_id: string; card_id: string }>(
    `select id, game_id, card_id from rounds
      where room_id = ? and phase = 'clue'
      order by rowid desc limit 1`,
    roomId,
  );
  if (round === null) return false;

  return resolveSkipVotes({
    roomId,
    roundId: round.id,
    gameId: round.game_id,
    cardId: round.card_id,
  }).skipped;
}
