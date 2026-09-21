/**
 * The effect interpreter.
 *
 * The engine is pure and merely *emits* effects; something has to carry them
 * out. That something needs randomness and a card deck, which is exactly why
 * it lives outside `src/lib/game/`. In multiplayer this same job is done by
 * the server, with a CSPRNG.
 *
 * Kept free of React so a whole game can be played in a test.
 */

import { drawCard, SPECTRUM_DECK, type SpectrumCard } from "@/lib/game/deck";
import {
  defaultControllerId,
  nextPsychicId,
  transition,
  type Effect,
  type GameAction,
} from "@/lib/game/state-machine";
import { generateTargetCenter } from "@/lib/game/target";
import type { RoomState } from "@/lib/game/types";

export interface RunnerDeps {
  readonly rng: () => number;
  readonly deck?: readonly SpectrumCard[];
}

/** Guards against a malformed effect chain spinning forever. */
const MAX_EFFECT_DEPTH = 16;

/**
 * Carry out `effects` against `room`, following any effects they produce in
 * turn, until the machine settles.
 */
export function runEffects(
  room: RoomState,
  effects: readonly Effect[],
  deps: RunnerDeps,
): RoomState {
  const deck = deps.deck ?? SPECTRUM_DECK;
  let current = room;
  const pending: Effect[] = [...effects];
  let depth = 0;

  while (pending.length > 0 && depth++ < MAX_EFFECT_DEPTH) {
    const effect = pending.shift();
    if (effect === undefined) break;

    if (effect.type === "prepareRound") {
      const state = current.public;
      const psychicId = nextPsychicId(state, state.activeTeam);
      if (psychicId === null) break;

      const card = drawCard(deck, state.usedCardIds, deps.rng);
      const action: GameAction = {
        type: "roundPrepared",
        cardId: card.id,
        psychicId,
        controllerId: defaultControllerId(state, state.activeTeam, psychicId),
        // Locally the "server" and the psychic are the same device, so the
        // real target goes in. Over the network this is null for everyone but
        // the psychic.
        targetCenter: generateTargetCenter(deps.rng),
      };
      const result = transition(current, action);
      if (result.ok) {
        current = result.state;
        pending.push(...result.effects);
      }
      continue;
    }

    if (effect.type === "revealTarget") {
      const targetCenter = current.secret?.targetCenter;
      if (targetCenter === undefined) break;
      const result = transition(current, { type: "targetRevealed", targetCenter });
      if (result.ok) {
        current = result.state;
        pending.push(...result.effects);
      }
      continue;
    }

    // `persistResult` is a no-op locally: `history` already holds the result.
  }

  return current;
}

/** Apply an action and settle its effects. Returns the room unchanged on error. */
export function dispatchAndSettle(
  room: RoomState,
  action: GameAction,
  deps: RunnerDeps,
): RoomState {
  const result = transition(room, action);
  if (!result.ok) return room;
  return runEffects(result.state, result.effects, deps);
}
