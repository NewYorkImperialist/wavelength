import "server-only";

import { randomBytes } from "node:crypto";

import { tallySkipVotes, type SkipTally, type SkipVote } from "@/lib/game/vote-skip";

import { commitToTarget, generateTargetSteps, pickCard } from "./createRound";
import { serviceClient } from "./db";
import { ApiError } from "./errors";

/**
 * Vote-skip plumbing: read the tally, and reroll the card once it carries.
 *
 * Which votes count and how many are needed is decided in
 * `@/lib/game/vote-skip`, which has no database in it. Nothing in this file
 * makes that judgement itself, so there is exactly one implementation of the
 * threshold and the tests reach it directly.
 */

/** Who is in the room, for both sides of the fraction. */
async function connectedPlayerIds(roomId: string): Promise<string[]> {
  const db = serviceClient();
  const { data } = await db
    .from("players")
    .select("id")
    .eq("room_id", roomId)
    .is("left_at", null)
    .returns<{ id: string }[]>();
  return (data ?? []).map((player) => player.id);
}

export async function loadSkipVotes(roundId: string): Promise<SkipVote[]> {
  const db = serviceClient();
  const { data } = await db
    .from("round_skip_votes")
    .select("player_id, card_id")
    .eq("round_id", roundId)
    .returns<{ player_id: string; card_id: string }[]>();
  return (data ?? []).map((row) => ({ playerId: row.player_id, cardId: row.card_id }));
}

export async function skipTally(
  roomId: string,
  roundId: string,
  cardId: string,
): Promise<SkipTally> {
  const [present, votes] = await Promise.all([
    connectedPlayerIds(roomId),
    loadSkipVotes(roundId),
  ]);
  return tallySkipVotes(present, votes, cardId);
}

/**
 * Cast or withdraw one player's vote against the card in play.
 *
 * Pressing the button twice is not an error — the row is keyed by round,
 * player and card, so a repeated vote is the same vote.
 */
export async function setSkipVote(input: {
  roundId: string;
  playerId: string;
  cardId: string;
  voting: boolean;
}): Promise<void> {
  const db = serviceClient();

  if (!input.voting) {
    const { error } = await db
      .from("round_skip_votes")
      .delete()
      .eq("round_id", input.roundId)
      .eq("player_id", input.playerId)
      .eq("card_id", input.cardId);
    if (error !== null) throw new ApiError("SERVER_ERROR", "Could not withdraw your vote.");
    return;
  }

  const { error } = await db
    .from("round_skip_votes")
    .upsert(
      { round_id: input.roundId, player_id: input.playerId, card_id: input.cardId },
      { onConflict: "round_id,player_id,card_id", ignoreDuplicates: true },
    );
  if (error !== null) throw new ApiError("SERVER_ERROR", "Could not record your vote.");
}

/**
 * Deal a replacement card to the same Psychic.
 *
 * False means the card had already moved on — either another voter's request
 * rerolled it first, or the Psychic's clue landed and the round left the clue
 * phase. Both are ordinary outcomes of two people acting at once, not errors,
 * so callers report success and let the client re-read the room.
 */
export async function rerollCard(input: {
  roundId: string;
  gameId: string;
  cardId: string;
}): Promise<boolean> {
  const db = serviceClient();

  const replacement = await pickCard(input.gameId, [input.cardId]);
  const targetSteps = generateTargetSteps();
  const nonce = randomBytes(16);
  const { commitment } = commitToTarget(targetSteps, nonce);

  // A fresh target, not just a fresh card: the Psychic has already seen the
  // one belonging to the card being thrown away, and the dial does not move
  // between the two.
  const { data, error } = await db.rpc("reroll_round_card", {
    p_round_id: input.roundId,
    p_expect_card: input.cardId,
    p_card_id: replacement,
    p_target: targetSteps,
    p_nonce: `\\x${nonce.toString("hex")}`,
    p_commitment: `\\x${commitment.toString("hex")}`,
  });

  if (error !== null) {
    throw new ApiError("SERVER_ERROR", `Could not skip the card: ${error.message}`);
  }
  return data === true;
}

export interface SkipOutcome {
  readonly tally: SkipTally;
  readonly skipped: boolean;
}

/** Read the tally and act on it, which is all any caller ever wants. */
export async function resolveSkipVotes(input: {
  roomId: string;
  roundId: string;
  gameId: string;
  cardId: string;
}): Promise<SkipOutcome> {
  const tally = await skipTally(input.roomId, input.roundId, input.cardId);
  if (!tally.carried) return { tally, skipped: false };

  const skipped = await rerollCard({
    roundId: input.roundId,
    gameId: input.gameId,
    cardId: input.cardId,
  });
  return { tally, skipped };
}

/**
 * Re-check the tally after the roster changes.
 *
 * A departure shrinks the denominator, so votes that were one short can
 * become a majority with nobody pressing anything. Without this the room
 * would sit on a card it had already voted out until someone thought to
 * toggle their vote off and on again.
 */
export async function reconsiderSkipVotes(roomId: string): Promise<boolean> {
  const db = serviceClient();

  const { data: round } = await db
    .from("rounds")
    .select("id, game_id, card_id")
    .eq("room_id", roomId)
    .eq("phase", "clue")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; game_id: string; card_id: string }>();

  if (round === null) return false;

  const { skipped } = await resolveSkipVotes({
    roomId,
    roundId: round.id,
    gameId: round.game_id,
    cardId: round.card_id,
  });
  return skipped;
}
