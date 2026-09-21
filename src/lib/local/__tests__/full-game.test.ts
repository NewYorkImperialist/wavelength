/**
 * Plays complete games through the engine and the effect runner, with no
 * React and no browser. If a full Wavelength game can't reach a winner here,
 * nothing in the UI will save it.
 */
import { describe, expect, it } from "vitest";

import { WINNING_SCORE } from "@/lib/game/constants";
import { scoreNeedle, scoreOpponentPrediction } from "@/lib/game/scoring";
import {
  createInitialRoom,
  transition,
  type GameAction,
} from "@/lib/game/state-machine";
import type { RoomState, Side } from "@/lib/game/types";
import { dispatchAndSettle, runEffects, type RunnerDeps } from "../runner";

/** Deterministic PRNG so a failure can be reproduced from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seatedRoom(): RoomState {
  let room = createInitialRoom("p0", "Ada", 0);
  const joins: GameAction[] = [
    { type: "playerJoined", playerId: "p1", name: "Alan", team: "teamA", at: 1 },
    { type: "playerJoined", playerId: "p2", name: "Bo", team: "teamB", at: 2 },
    { type: "playerJoined", playerId: "p3", name: "Bea", team: "teamB", at: 3 },
  ];
  for (const action of joins) {
    const result = transition(room, action);
    if (!result.ok) throw new Error(`setup failed: ${result.error}`);
    room = result.state;
  }
  return room;
}

function startGame(deps: RunnerDeps): RoomState {
  const result = transition(seatedRoom(), { type: "startGame", by: "p0" });
  if (!result.ok) throw new Error(`startGame failed: ${result.error}`);
  return runEffects(result.state, result.effects, deps);
}

interface PlayedGame {
  readonly room: RoomState;
  readonly rounds: number;
}

/**
 * Play until someone wins. `needleFor` decides how good the guess is, so the
 * same driver can simulate sharp teams and hopeless ones.
 */
function playToCompletion(
  deps: RunnerDeps,
  needleFor: (target: number, rng: () => number) => number,
  maxRounds = 200,
): PlayedGame {
  let room = startGame(deps);
  let rounds = 0;

  while (room.public.phase !== "gameOver" && rounds < maxRounds) {
    const state = room.public;
    const round = state.round;
    if (round === null) break;

    const opponentTeam = state.activeTeam === "teamA" ? "teamB" : "teamA";
    const opponentId = state.teams[opponentTeam].rotation[0];
    if (opponentId === undefined) break;

    const target = room.secret?.targetCenter;
    expect(target).toBeDefined();

    const needle = needleFor(target!, deps.rng);
    const side: Side = deps.rng() < 0.5 ? "left" : "right";

    room = dispatchAndSettle(room, { type: "submitClue", by: round.psychicId, clue: "Batman" }, deps);
    room = dispatchAndSettle(room, { type: "moveNeedle", by: round.controllerId, position: needle }, deps);
    room = dispatchAndSettle(room, { type: "lockNeedle", by: round.controllerId }, deps);
    room = dispatchAndSettle(room, { type: "submitPrediction", by: opponentId, side }, deps);

    rounds++;
    expect(["reveal", "gameOver"]).toContain(room.public.phase);

    if (room.public.phase === "reveal") {
      room = dispatchAndSettle(room, { type: "acknowledgeReveal", by: "p0" }, deps);
    }
  }

  return { room, rounds };
}

/** A competent team: normally distributed error around the true target. */
function noisyNeedle(sigma: number) {
  return (target: number, rng: () => number): number => {
    // Box-Muller, using the injected rng so the game stays reproducible.
    const u = Math.max(rng(), Number.EPSILON);
    const v = rng();
    const gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.min(1, Math.max(0, target + gauss * sigma));
  };
}

describe("a complete game", () => {
  it("reaches a winner and respects the victory condition", () => {
    const deps: RunnerDeps = { rng: mulberry32(1) };
    const { room, rounds } = playToCompletion(deps, noisyNeedle(0.06));
    const state = room.public;

    expect(state.phase).toBe("gameOver");
    expect(state.winner).not.toBeNull();
    expect(rounds).toBeGreaterThan(0);

    const winnerScore = state.teams[state.winner!].score;
    const loserScore = state.teams[state.winner === "teamA" ? "teamB" : "teamA"].score;

    expect(winnerScore).toBeGreaterThan(loserScore);
    // Either someone crossed the line, or it was settled in sudden death.
    expect(
      winnerScore >= WINNING_SCORE || state.suddenDeath !== null,
    ).toBe(true);
  });

  it("reaches a winner from many different seeds", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const deps: RunnerDeps = { rng: mulberry32(seed) };
      const { room } = playToCompletion(deps, noisyNeedle(0.08));
      expect(room.public.phase, `seed ${seed} did not finish`).toBe("gameOver");
      expect(room.public.winner, `seed ${seed} has no winner`).not.toBeNull();
    }
  });

  it("still finishes when both teams are hopeless", () => {
    // Every guess is wild, so almost all points come from the left/right bonus.
    const deps: RunnerDeps = { rng: mulberry32(7) };
    const { room } = playToCompletion(deps, (_target, rng) => rng(), 400);
    expect(room.public.phase).toBe("gameOver");
  });

  it("alternates the active team every round", () => {
    const deps: RunnerDeps = { rng: mulberry32(3) };
    const { room } = playToCompletion(deps, noisyNeedle(0.06));
    const teams = room.public.history.map((r) => r.activeTeam);

    for (let i = 1; i < teams.length; i++) {
      expect(teams[i]).not.toBe(teams[i - 1]);
    }
  });

  it("rotates the psychic within each team", () => {
    const deps: RunnerDeps = { rng: mulberry32(11) };
    const { room } = playToCompletion(deps, noisyNeedle(0.06));

    for (const team of ["teamA", "teamB"] as const) {
      const psychics = room.public.history
        .filter((r) => r.activeTeam === team)
        .map((r) => r.psychicId);
      for (let i = 1; i < psychics.length; i++) {
        expect(psychics[i], `${team} repeated a psychic`).not.toBe(psychics[i - 1]);
      }
    }
  });

  it("records a history whose scores add up exactly", () => {
    const deps: RunnerDeps = { rng: mulberry32(5) };
    const { room } = playToCompletion(deps, noisyNeedle(0.06));

    const totals = { teamA: 0, teamB: 0 };
    for (const result of room.public.history) {
      const opposing = result.activeTeam === "teamA" ? "teamB" : "teamA";
      // Every recorded result must match the one authoritative scorer.
      expect(result.activeTeamPoints).toBe(
        scoreNeedle(result.targetCenter, result.needlePosition),
      );
      expect(result.opposingTeamPoints).toBe(
        scoreOpponentPrediction(result.targetCenter, result.needlePosition, result.prediction),
      );
      totals[result.activeTeam] += result.activeTeamPoints;
      totals[opposing] += result.opposingTeamPoints;
    }

    expect(room.public.teams.teamA.score).toBe(totals.teamA);
    expect(room.public.teams.teamB.score).toBe(totals.teamB);
  });

  it("never draws the same spectrum twice in a game", () => {
    const deps: RunnerDeps = { rng: mulberry32(13) };
    const { room } = playToCompletion(deps, noisyNeedle(0.06));
    const cards = room.public.history.map((r) => r.cardId);
    expect(new Set(cards).size).toBe(cards.length);
  });

  it("keeps the target out of public state for the whole game", () => {
    const deps: RunnerDeps = { rng: mulberry32(17) };
    let room = startGame(deps);

    for (let i = 0; i < 6 && room.public.phase !== "gameOver"; i++) {
      const round = room.public.round;
      if (round === null) break;
      const target = room.secret!.targetCenter;
      const opponentTeam = room.public.activeTeam === "teamA" ? "teamB" : "teamA";
      const opponentId = room.public.teams[opponentTeam].rotation[0]!;

      room = dispatchAndSettle(room, { type: "submitClue", by: round.psychicId, clue: "Batman" }, deps);
      room = dispatchAndSettle(room, { type: "moveNeedle", by: round.controllerId, position: 0.4 }, deps);
      room = dispatchAndSettle(room, { type: "lockNeedle", by: round.controllerId }, deps);

      // Up to the moment of reveal, the public state must not contain it.
      expect(JSON.stringify(room.public)).not.toContain(String(target));

      room = dispatchAndSettle(room, { type: "submitPrediction", by: opponentId, side: "left" }, deps);
      // Now it may — and must — be public.
      expect(room.public.round?.revealedTarget).toBe(target);

      if (room.public.phase === "reveal") {
        room = dispatchAndSettle(room, { type: "acknowledgeReveal", by: "p0" }, deps);
      }
    }
  });
});
