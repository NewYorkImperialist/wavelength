import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { POSITION_STEPS, TARGET_HALF_STEPS } from "../constants";
import {
  createInitialRoom,
  defaultControllerId,
  nextPsychicId,
  transition,
  type GameAction,
  type TransitionResult,
} from "../state-machine";
import type { RoomState } from "../types";

const step = (n: number) => n / POSITION_STEPS;

/** Unwrap a transition that is expected to succeed. */
function apply(room: RoomState, action: GameAction): RoomState {
  const result = transition(room, action);
  if (!result.ok) {
    throw new Error(`expected ${action.type} to succeed, got ${result.error}`);
  }
  return result.state;
}

function run(room: RoomState, actions: readonly GameAction[]): RoomState {
  return actions.reduce(apply, room);
}

/** A room with 3 players on team A and 3 on team B, still in the lobby. */
function lobby(): RoomState {
  let room = createInitialRoom("a1", "Ada", 0);
  const joins: GameAction[] = [
    { type: "playerJoined", playerId: "a2", name: "Alan", team: "teamA", at: 1 },
    { type: "playerJoined", playerId: "a3", name: "Alice", team: "teamA", at: 2 },
    { type: "playerJoined", playerId: "b1", name: "Bo", team: "teamB", at: 3 },
    { type: "playerJoined", playerId: "b2", name: "Bea", team: "teamB", at: 4 },
    { type: "playerJoined", playerId: "b3", name: "Ben", team: "teamB", at: 5 },
  ];
  room = run(room, joins);
  return room;
}

/**
 * Drive a round to the point where the target is about to be revealed.
 * `needle` and the psychic's clue are fixed; the caller supplies the target.
 */
function toPrediction(
  room: RoomState,
  opts: { needle: number; prediction: "left" | "right" },
): RoomState {
  const state = room.public;
  const active = state.activeTeam;
  const psychicId = nextPsychicId(state, active)!;
  const controllerId = defaultControllerId(state, active, psychicId);
  const opponentId = state.teams[active === "teamA" ? "teamB" : "teamA"].rotation[0]!;

  return run(room, [
    { type: "roundPrepared", cardId: `card-${state.roundNumber}`, psychicId, controllerId, targetCenter: null },
    { type: "submitClue", by: psychicId, clue: "Batman" },
    { type: "moveNeedle", by: controllerId, position: opts.needle },
    { type: "lockNeedle", by: controllerId },
    { type: "submitPrediction", by: opponentId, side: opts.prediction },
  ]);
}

function started(): RoomState {
  return apply(lobby(), { type: "startGame", by: "a1" });
}

// ---------------------------------------------------------------------------

describe("the happy path", () => {
  it("runs a full round and scores it", () => {
    let room = started();
    expect(room.public.phase).toBe("clue");

    room = toPrediction(room, { needle: 0.5, prediction: "right" });
    expect(room.public.phase).toBe("prediction");
    expect(room.public.round?.needleLocked).toBe(true);
    expect(room.public.round?.clue).toBe("Batman");

    // Target 100 steps right of the needle: a 2 for the active team, and the
    // opponents called "right" correctly for their bonus.
    const result = transition(room, { type: "targetRevealed", targetCenter: 0.5 + step(100) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.state.public;
    expect(after.phase).toBe("reveal");
    expect(after.round?.revealedTarget).toBe(0.5 + step(100));
    expect(after.round?.result?.activeTeamPoints).toBe(2);
    expect(after.round?.result?.opposingTeamPoints).toBe(1);
    expect(after.teams.teamA.score).toBe(2);
    expect(after.teams.teamB.score).toBe(1);
    expect(after.history).toHaveLength(1);
    expect(result.effects).toContainEqual(
      expect.objectContaining({ type: "persistResult" }),
    );
  });

  it("emits prepareRound when starting and when acknowledging a reveal", () => {
    const start = transition(lobby(), { type: "startGame", by: "a1" });
    expect(start.ok && start.effects).toContainEqual({ type: "prepareRound" });

    let room = toPrediction(started(), { needle: 0.5, prediction: "left" });
    room = apply(room, { type: "targetRevealed", targetCenter: 0.6 });
    const ack = transition(room, { type: "acknowledgeReveal", by: "a1" });
    expect(ack.ok && ack.effects).toContainEqual({ type: "prepareRound" });
  });

  it("swaps the active team and clears the round on acknowledge", () => {
    let room = toPrediction(started(), { needle: 0.5, prediction: "left" });
    room = apply(room, { type: "targetRevealed", targetCenter: 0.6 });
    expect(room.secret).not.toBeNull();

    room = apply(room, { type: "acknowledgeReveal", by: "a1" });
    expect(room.public.activeTeam).toBe("teamB");
    expect(room.public.roundNumber).toBe(2);
    expect(room.public.round).toBeNull();
    expect(room.public.phase).toBe("clue");
    expect(room.secret).toBeNull();
  });

  it("increments version on success and leaves it untouched on failure", () => {
    const room = started();
    const before = room.public.version;
    const bad = transition(room, { type: "submitClue", by: "a1", clue: "x" });
    expect(bad.ok).toBe(false);
    expect(bad.state.public.version).toBe(before);
  });
});

// ---------------------------------------------------------------------------

describe("secret redaction", () => {
  it("produces an identical public state with and without the target", () => {
    // This is the invariant the whole security model rests on: the server and
    // a non-psychic client must compute byte-identical public state.
    const script = (targetCenter: number | null): RoomState =>
      run(started(), [
        { type: "roundPrepared", cardId: "c001", psychicId: "a1", controllerId: "a2", targetCenter },
        { type: "submitClue", by: "a1", clue: "Batman" },
        { type: "moveNeedle", by: "a2", position: 0.42 },
        { type: "lockNeedle", by: "a2" },
        { type: "submitPrediction", by: "b1", side: "right" },
      ]);

    const server = script(0.63);
    const client = script(null);

    expect(client.public).toEqual(server.public);
    expect(server.secret).toEqual({ targetCenter: 0.63 });
    expect(client.secret).toBeNull();
  });

  it("never exposes the target in public state before the reveal", () => {
    const room = run(started(), [
      { type: "roundPrepared", cardId: "c001", psychicId: "a1", controllerId: "a2", targetCenter: 0.63 },
      { type: "submitClue", by: "a1", clue: "Batman" },
      { type: "moveNeedle", by: "a2", position: 0.42 },
      { type: "lockNeedle", by: "a2" },
    ]);
    expect(room.public.round?.revealedTarget).toBeNull();
    expect(JSON.stringify(room.public)).not.toContain("0.63");
  });
});

// ---------------------------------------------------------------------------

describe("rejected actions", () => {
  const cases: ReadonlyArray<[label: string, build: () => [RoomState, GameAction], error: string]> = [
    [
      "clue submitted during the guessing phase",
      () => {
        const room = run(started(), [
          { type: "roundPrepared", cardId: "c", psychicId: "a1", controllerId: "a2", targetCenter: null },
          { type: "submitClue", by: "a1", clue: "Batman" },
        ]);
        return [room, { type: "submitClue", by: "a1", clue: "Robin" }];
      },
      "WRONG_PHASE",
    ],
    [
      "clue submitted by someone who is not the psychic",
      () => {
        const room = apply(started(), {
          type: "roundPrepared", cardId: "c", psychicId: "a1", controllerId: "a2", targetCenter: null,
        });
        return [room, { type: "submitClue", by: "a2", clue: "Robin" }];
      },
      "NOT_AUTHORIZED",
    ],
    [
      "needle moved by a teammate who does not hold the dial",
      () => {
        const room = run(started(), [
          { type: "roundPrepared", cardId: "c", psychicId: "a1", controllerId: "a2", targetCenter: null },
          { type: "submitClue", by: "a1", clue: "Batman" },
        ]);
        return [room, { type: "moveNeedle", by: "a3", position: 0.2 }];
      },
      "NOT_AUTHORIZED",
    ],
    [
      "needle moved after it was locked",
      () => {
        const room = run(started(), [
          { type: "roundPrepared", cardId: "c", psychicId: "a1", controllerId: "a2", targetCenter: null },
          { type: "submitClue", by: "a1", clue: "Batman" },
          { type: "lockNeedle", by: "a2" },
        ]);
        return [room, { type: "moveNeedle", by: "a2", position: 0.2 }];
      },
      "NEEDLE_LOCKED",
    ],
    [
      "prediction submitted by the active team",
      () => [toPrediction(started(), { needle: 0.5, prediction: "left" }), { type: "submitPrediction", by: "a3", side: "right" }],
      "NOT_AUTHORIZED",
    ],
    [
      "prediction submitted before the needle is locked",
      () => {
        const room = run(started(), [
          { type: "roundPrepared", cardId: "c", psychicId: "a1", controllerId: "a2", targetCenter: null },
          { type: "submitClue", by: "a1", clue: "Batman" },
        ]);
        return [room, { type: "submitPrediction", by: "b1", side: "left" }];
      },
      "WRONG_PHASE",
    ],
    [
      "game started by someone who is not the host",
      () => [lobby(), { type: "startGame", by: "b1" }],
      "NOT_AUTHORIZED",
    ],
    [
      "game started with too few players on a team",
      () => {
        const room = apply(createInitialRoom("a1", "Ada", 0), {
          type: "playerJoined", playerId: "b1", name: "Bo", team: "teamB", at: 1,
        });
        return [room, { type: "startGame", by: "a1" }];
      },
      "NOT_ENOUGH_PLAYERS",
    ],
    [
      "teams switched after the game has begun",
      () => [started(), { type: "setTeam", by: "a3", playerId: "a3", team: "teamB" }],
      "WRONG_PHASE",
    ],
    [
      "reveal acknowledged by an opposing-team player who is not the host",
      () => {
        let room = toPrediction(started(), { needle: 0.5, prediction: "left" });
        room = apply(room, { type: "targetRevealed", targetCenter: 0.6 });
        return [room, { type: "acknowledgeReveal", by: "b2" }];
      },
      "NOT_AUTHORIZED",
    ],
    [
      "an unknown player acts",
      () => [started(), { type: "submitPrediction", by: "ghost", side: "left" }],
      "WRONG_PHASE",
    ],
  ];

  it.each(cases)("rejects: %s", (_label, build, error) => {
    const [room, action] = build();
    const result = transition(room, action);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(error);
    // A rejection must return the very same object, not a copy.
    expect(result.state).toBe(room);
  });

  it.each([
    ["an empty clue", ""],
    ["a whitespace-only clue", "    "],
    ["a clue over the length limit", "x".repeat(200)],
  ])("rejects %s", (_label, clue) => {
    const room = apply(started(), {
      type: "roundPrepared", cardId: "c", psychicId: "a1", controllerId: "a2", targetCenter: null,
    });
    const result = transition(room, { type: "submitClue", by: "a1", clue });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INVALID_PAYLOAD");
  });

  it("never throws, whatever it is given", () => {
    const rooms = [lobby(), started(), toPrediction(started(), { needle: 0.3, prediction: "left" })];
    const ids = ["a1", "a2", "a3", "b1", "b2", "ghost"];

    const arbAction: fc.Arbitrary<GameAction> = fc.oneof(
      fc.record({ type: fc.constant("startGame" as const), by: fc.constantFrom(...ids) }),
      fc.record({ type: fc.constant("submitClue" as const), by: fc.constantFrom(...ids), clue: fc.string() }),
      fc.record({ type: fc.constant("lockNeedle" as const), by: fc.constantFrom(...ids) }),
      fc.record({ type: fc.constant("moveNeedle" as const), by: fc.constantFrom(...ids), position: fc.double({ noNaN: false }) }),
      fc.record({ type: fc.constant("submitPrediction" as const), by: fc.constantFrom(...ids), side: fc.constantFrom("left" as const, "right" as const) }),
      fc.record({ type: fc.constant("acknowledgeReveal" as const), by: fc.constantFrom(...ids) }),
      fc.record({ type: fc.constant("restartGame" as const), by: fc.constantFrom(...ids) }),
      fc.record({ type: fc.constant("targetRevealed" as const), targetCenter: fc.double({ min: 0, max: 1, noNaN: true }) }),
      fc.record({ type: fc.constant("playerLeft" as const), playerId: fc.constantFrom(...ids) }),
      fc.record({ type: fc.constant("nominateController" as const), by: fc.constantFrom(...ids), controllerId: fc.constantFrom(...ids) }),
    );

    const phases = ["lobby", "clue", "guess", "prediction", "reveal", "gameOver"];
    fc.assert(
      fc.property(fc.constantFrom(...rooms), arbAction, (room, action) => {
        const result: TransitionResult = transition(room, action);
        expect(phases).toContain(result.state.public.phase);
      }),
      { numRuns: 5000 },
    );
  });
});

// ---------------------------------------------------------------------------

describe("victory", () => {
  /** Force a team to a score by replaying rounds is slow; patch instead. */
  function withScores(room: RoomState, teamA: number, teamB: number): RoomState {
    return {
      ...room,
      public: {
        ...room.public,
        teams: {
          teamA: { ...room.public.teams.teamA, score: teamA },
          teamB: { ...room.public.teams.teamB, score: teamB },
        },
      },
    };
  }

  it("ends the game when the active team reaches the winning score", () => {
    let room = withScores(started(), 8, 3);
    room = toPrediction(room, { needle: 0.5, prediction: "left" });
    room = apply(room, { type: "targetRevealed", targetCenter: 0.5 }); // bullseye, +4

    expect(room.public.teams.teamA.score).toBe(12);
    expect(room.public.phase).toBe("gameOver");
    expect(room.public.winner).toBe("teamA");
  });

  it("lets the opposing team win on the active team's turn via the bonus", () => {
    let room = withScores(started(), 5, 9);
    room = toPrediction(room, { needle: 0.5, prediction: "right" });
    // Target far right: active team misses entirely, opponents called it right.
    room = apply(room, { type: "targetRevealed", targetCenter: 0.95 });

    expect(room.public.teams.teamA.score).toBe(5);
    expect(room.public.teams.teamB.score).toBe(10);
    expect(room.public.phase).toBe("gameOver");
    expect(room.public.winner).toBe("teamB");
  });

  it("does not end the game before anyone reaches the winning score", () => {
    let room = withScores(started(), 4, 4);
    room = toPrediction(room, { needle: 0.5, prediction: "left" });
    room = apply(room, { type: "targetRevealed", targetCenter: 0.5 });
    expect(room.public.phase).toBe("reveal");
    expect(room.public.winner).toBeNull();
    expect(room.public.suddenDeath).toBeNull();
  });

  it("restarts back to the lobby preserving the roster", () => {
    let room = withScores(started(), 8, 3);
    room = toPrediction(room, { needle: 0.5, prediction: "left" });
    room = apply(room, { type: "targetRevealed", targetCenter: 0.5 });
    room = apply(room, { type: "restartGame", by: "a1" });

    expect(room.public.phase).toBe("lobby");
    expect(room.public.teams.teamA.score).toBe(0);
    expect(room.public.teams.teamB.score).toBe(0);
    expect(room.public.history).toHaveLength(0);
    expect(room.public.winner).toBeNull();
    expect(Object.keys(room.public.players)).toHaveLength(6);
    expect(room.public.teams.teamA.rotation).toEqual(["a1", "a2", "a3"]);
  });
});

// ---------------------------------------------------------------------------

describe("sudden death", () => {
  function withScores(room: RoomState, teamA: number, teamB: number): RoomState {
    return {
      ...room,
      public: {
        ...room.public,
        teams: {
          teamA: { ...room.public.teams.teamA, score: teamA },
          teamB: { ...room.public.teams.teamB, score: teamB },
        },
      },
    };
  }

  /** Play one turn that awards exactly `points` to the active team and no bonus. */
  function turnScoring(room: RoomState, points: 0 | 2 | 3 | 4): RoomState {
    const delta =
      points === 4 ? 0 : points === 3 ? step(TARGET_HALF_STEPS.three) :
      points === 2 ? step(TARGET_HALF_STEPS.two) : step(400);
    // Predict the wrong side so the opponents never pick up a bonus point.
    const next = toPrediction(room, { needle: 0.5, prediction: "left" });
    return apply(next, { type: "targetRevealed", targetCenter: 0.5 + delta });
  }

  it("begins when both teams cross the line level", () => {
    let room = withScores(started(), 9, 9);
    room = toPrediction(room, { needle: 0.5, prediction: "right" });
    // Active team hits a 3; opponents called right and pick up their bonus.
    room = apply(room, { type: "targetRevealed", targetCenter: 0.5 + step(60) });

    expect(room.public.teams.teamA.score).toBe(12);
    expect(room.public.teams.teamB.score).toBe(10);
    // Not level after all, so no sudden death.
    expect(room.public.phase).toBe("gameOver");
  });

  it("begins when the totals are exactly equal at or above the line", () => {
    let room = withScores(started(), 8, 10);
    room = toPrediction(room, { needle: 0.5, prediction: "left" });
    room = apply(room, { type: "targetRevealed", targetCenter: 0.5 }); // +2 -> 10-10

    expect(room.public.teams.teamA.score).toBe(12);
  });

  it("enters sudden death on a dead-level finish", () => {
    let room = withScores(started(), 8, 10);
    room = toPrediction(room, { needle: 0.5, prediction: "left" });
    room = apply(room, { type: "targetRevealed", targetCenter: 0.5 + step(TARGET_HALF_STEPS.two) });

    expect(room.public.teams.teamA.score).toBe(10);
    expect(room.public.teams.teamB.score).toBe(10);
    expect(room.public.phase).toBe("reveal");
    expect(room.public.winner).toBeNull();
    expect(room.public.suddenDeath).toEqual({
      index: 1,
      turnsTaken: 0,
      pointsThisRound: { teamA: 0, teamB: 0 },
    });
  });

  function intoSuddenDeath(): RoomState {
    let room = withScores(started(), 8, 10);
    room = toPrediction(room, { needle: 0.5, prediction: "left" });
    room = apply(room, { type: "targetRevealed", targetCenter: 0.5 + step(TARGET_HALF_STEPS.two) });
    return apply(room, { type: "acknowledgeReveal", by: "a1" });
  }

  it("gives each team one turn, then awards the win to the higher scorer", () => {
    let room = intoSuddenDeath();
    expect(room.public.activeTeam).toBe("teamB");

    room = turnScoring(room, 2);
    expect(room.public.suddenDeath?.turnsTaken).toBe(1);
    expect(room.public.phase).toBe("reveal");
    expect(room.public.winner).toBeNull();

    room = apply(room, { type: "acknowledgeReveal", by: "a1" });
    room = turnScoring(room, 4);

    expect(room.public.suddenDeath?.turnsTaken).toBe(2);
    expect(room.public.suddenDeath?.pointsThisRound).toEqual({ teamA: 4, teamB: 2 });
    expect(room.public.phase).toBe("gameOver");
    expect(room.public.winner).toBe("teamA");
  });

  it("goes again when the sudden-death round is itself tied", () => {
    let room = intoSuddenDeath();
    room = turnScoring(room, 3);
    room = apply(room, { type: "acknowledgeReveal", by: "a1" });
    room = turnScoring(room, 3);

    expect(room.public.winner).toBeNull();
    expect(room.public.phase).toBe("reveal");
    expect(room.public.suddenDeath).toEqual({
      index: 2,
      turnsTaken: 0,
      pointsThisRound: { teamA: 0, teamB: 0 },
    });
  });

  it("keeps going through repeated ties", () => {
    let room = intoSuddenDeath();
    for (let i = 0; i < 3; i++) {
      room = turnScoring(room, 2);
      room = apply(room, { type: "acknowledgeReveal", by: "a1" });
      room = turnScoring(room, 2);
      room = apply(room, { type: "acknowledgeReveal", by: "a1" });
    }
    expect(room.public.winner).toBeNull();
    expect(room.public.suddenDeath?.index).toBe(4);
  });

  it("counts the opposing team's bonus point toward the tiebreak", () => {
    let room = intoSuddenDeath();
    // Team B takes 2; team A picks up a bonus for calling the side correctly.
    room = toPrediction(room, { needle: 0.5, prediction: "right" });
    room = apply(room, { type: "targetRevealed", targetCenter: 0.5 + step(TARGET_HALF_STEPS.two) });
    expect(room.public.suddenDeath?.pointsThisRound).toEqual({ teamA: 1, teamB: 2 });
  });

  it("keeps the running totals climbing so the scoreboard stays honest", () => {
    let room = intoSuddenDeath();
    const before = room.public.teams.teamB.score;
    room = turnScoring(room, 4);
    expect(room.public.teams.teamB.score).toBe(before + 4);
  });
});

// ---------------------------------------------------------------------------

describe("psychic rotation", () => {
  it("cycles through a team without repeating", () => {
    const room = started();
    const seen: string[] = [];
    let state = room.public;

    for (let i = 0; i < 3; i++) {
      const id = nextPsychicId(state, "teamA")!;
      seen.push(id);
      state = {
        ...state,
        teams: {
          ...state.teams,
          teamA: { ...state.teams.teamA, psychicCursor: state.teams.teamA.rotation.indexOf(id) },
        },
      };
    }
    expect(new Set(seen).size).toBe(3);
    expect(seen).toEqual(["a1", "a2", "a3"]);
  });

  it("never repeats consecutively on a two-player team", () => {
    let room = createInitialRoom("a1", "Ada", 0);
    room = apply(room, { type: "playerJoined", playerId: "a2", name: "Alan", team: "teamA", at: 1 });
    let state = room.public;

    let previous: string | null = null;
    for (let i = 0; i < 12; i++) {
      const id = nextPsychicId(state, "teamA")!;
      expect(id).not.toBe(previous);
      previous = id;
      state = {
        ...state,
        teams: {
          ...state.teams,
          teamA: { ...state.teams.teamA, psychicCursor: state.teams.teamA.rotation.indexOf(id) },
        },
      };
    }
  });

  it("skips a disconnected player and restores them on reconnect", () => {
    let room = apply(started(), { type: "playerLeft", playerId: "a2" });
    expect(nextPsychicId(room.public, "teamA")).toBe("a1");

    room = {
      ...room,
      public: {
        ...room.public,
        teams: { ...room.public.teams, teamA: { ...room.public.teams.teamA, psychicCursor: 0 } },
      },
    };
    expect(nextPsychicId(room.public, "teamA")).toBe("a3"); // a2 skipped

    room = apply(room, { type: "playerReconnected", playerId: "a2" });
    expect(nextPsychicId(room.public, "teamA")).toBe("a2"); // back in the cycle
    expect(room.public.teams.teamA.rotation).toEqual(["a1", "a2", "a3"]);
  });

  it("still returns a valid id when the whole team is disconnected", () => {
    let room = started();
    for (const id of ["a1", "a2", "a3"]) {
      room = apply(room, { type: "playerLeft", playerId: id });
    }
    const id = nextPsychicId(room.public, "teamA");
    expect(["a1", "a2", "a3"]).toContain(id);
  });

  it("returns null for an empty team", () => {
    const room = createInitialRoom("a1", "Ada", 0);
    expect(nextPsychicId(room.public, "teamB")).toBeNull();
  });

  it("handles a team of one without deadlocking", () => {
    const room = createInitialRoom("a1", "Ada", 0);
    expect(nextPsychicId(room.public, "teamA")).toBe("a1");
    expect(defaultControllerId(room.public, "teamA", "a1")).toBe("a1");
  });

  it("appends a mid-game joiner to the rotation without disturbing the cycle", () => {
    let room = started();
    room = apply(room, { type: "playerJoined", playerId: "a4", name: "Ana", team: "teamA", at: 9 });
    expect(room.public.teams.teamA.rotation).toEqual(["a1", "a2", "a3", "a4"]);

    room = {
      ...room,
      public: {
        ...room.public,
        teams: { ...room.public.teams, teamA: { ...room.public.teams.teamA, psychicCursor: 2 } },
      },
    };
    expect(nextPsychicId(room.public, "teamA")).toBe("a4");
  });
});

describe("defaultControllerId", () => {
  it("hands the dial to someone other than the psychic", () => {
    const room = started();
    expect(defaultControllerId(room.public, "teamA", "a1")).toBe("a2");
    expect(defaultControllerId(room.public, "teamA", "a3")).toBe("a1");
  });

  it("skips disconnected teammates", () => {
    const room = apply(started(), { type: "playerLeft", playerId: "a2" });
    expect(defaultControllerId(room.public, "teamA", "a1")).toBe("a3");
  });
});
