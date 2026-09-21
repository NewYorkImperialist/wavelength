/**
 * The Wavelength round as an explicit state machine.
 *
 * `transition` is a pure reducer over typed actions. It never throws and never
 * half-applies: a rejected action returns the *same* `RoomState` by reference
 * along with an error code.
 *
 * Randomness lives outside it. The reducer emits `Effect`s — the server
 * interprets `prepareRound` by drawing a card and generating a target with a
 * CSPRNG, then dispatches `roundPrepared`. That is what lets the server (for
 * authority) and the browser (for optimistic display) run this same function.
 */

import {
  MAX_CLUE_LENGTH,
  MIN_PLAYERS_FOR_COOP,
  MIN_PLAYERS_PER_TEAM_TO_START,
  WINNING_SCORE,
} from "./constants";
import { quantizePosition, type Position } from "./geometry";
import { scoreNeedle, scoreOpponentPrediction } from "./scoring";
import type {
  GameConfig,
  GameState,
  Player,
  PlayerId,
  PublicRoundState,
  RoomState,
  RoundResult,
  Side,
  SuddenDeathState,
  Team,
  TeamId,
} from "./types";

// ---------------------------------------------------------------------------
// Actions, effects, errors
// ---------------------------------------------------------------------------

export type GameAction =
  | { type: "playerJoined"; playerId: PlayerId; name: string; team: TeamId; at: number }
  | { type: "playerLeft"; playerId: PlayerId }
  | { type: "playerReconnected"; playerId: PlayerId }
  | { type: "setTeam"; by: PlayerId; playerId: PlayerId; team: TeamId }
  | { type: "startGame"; by: PlayerId }
  | {
      type: "roundPrepared";
      cardId: string;
      psychicId: PlayerId;
      controllerId: PlayerId;
      /** Null for every client but the psychic's. See "secret redaction". */
      targetCenter: Position | null;
    }
  | { type: "submitClue"; by: PlayerId; clue: string }
  | { type: "nominateController"; by: PlayerId; controllerId: PlayerId }
  | { type: "moveNeedle"; by: PlayerId; position: Position }
  | { type: "lockNeedle"; by: PlayerId }
  | { type: "submitPrediction"; by: PlayerId; side: Side }
  | { type: "targetRevealed"; targetCenter: Position }
  | { type: "acknowledgeReveal"; by: PlayerId }
  | { type: "restartGame"; by: PlayerId };

export type Effect =
  | { type: "prepareRound" }
  | { type: "revealTarget" }
  | { type: "persistResult"; result: RoundResult };

export type TransitionError =
  | "WRONG_PHASE"
  | "NOT_AUTHORIZED"
  | "UNKNOWN_PLAYER"
  | "INVALID_PAYLOAD"
  | "NEEDLE_LOCKED"
  | "NOT_ENOUGH_PLAYERS"
  | "GAME_OVER";

export type TransitionResult =
  | { ok: true; state: RoomState; effects: readonly Effect[] }
  | { ok: false; error: TransitionError; state: RoomState };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const OPPONENT: Readonly<Record<TeamId, TeamId>> = {
  teamA: "teamB",
  teamB: "teamA",
};

export const DEFAULT_CONFIG: GameConfig = {
  winningScore: WINNING_SCORE,
  minPlayersPerTeamToStart: MIN_PLAYERS_PER_TEAM_TO_START,
};

/** Rejection: same state, by reference, so callers can assert identity. */
function fail(state: RoomState, error: TransitionError): TransitionResult {
  return { ok: false, error, state };
}

function bump(state: GameState, patch: Partial<GameState>): GameState {
  return { ...state, ...patch, version: state.version + 1 };
}

function succeed(
  room: RoomState,
  next: GameState,
  effects: readonly Effect[] = [],
  secret: RoomState["secret"] = room.secret,
): TransitionResult {
  return { ok: true, state: { public: next, secret }, effects };
}

function connectedCount(state: GameState, team: TeamId): number {
  return state.teams[team].rotation.filter(
    (id) => state.players[id]?.connected === true,
  ).length;
}

/**
 * Co-op: everyone on one side, nobody to call left or right.
 *
 * Derived from the roster rather than stored as a mode flag, so a game cannot
 * end up in a state its player list contradicts.
 */
export function isCooperative(state: GameState): boolean {
  return connectedCount(state, OPPONENT[state.activeTeam]) === 0;
}

export function createInitialRoom(
  hostId: PlayerId,
  hostName: string,
  at: number,
): RoomState {
  const host: Player = {
    id: hostId,
    name: hostName,
    team: "teamA",
    connected: true,
    joinedAt: at,
  };
  const teamA: Team = {
    id: "teamA",
    name: "Team A",
    score: 0,
    rotation: [hostId],
    psychicCursor: -1,
  };
  const teamB: Team = {
    id: "teamB",
    name: "Team B",
    score: 0,
    rotation: [],
    psychicCursor: -1,
  };
  return {
    public: {
      version: 0,
      phase: "lobby",
      hostId,
      players: { [hostId]: host },
      teams: { teamA, teamB },
      activeTeam: "teamA",
      roundNumber: 0,
      round: null,
      suddenDeath: null,
      usedCardIds: [],
      history: [],
      winner: null,
      config: DEFAULT_CONFIG,
    },
    secret: null,
  };
}

// ---------------------------------------------------------------------------
// Psychic rotation
// ---------------------------------------------------------------------------

/**
 * The next psychic for a team: the next connected player after the cursor,
 * never repeating the previous psychic while another connected option exists.
 *
 * A team of one necessarily returns that same player every round. If everyone
 * on the team is disconnected the cursor still advances and a valid id comes
 * back, so a round can never deadlock waiting for a psychic.
 */
export function nextPsychicId(state: GameState, teamId: TeamId): PlayerId | null {
  const { rotation, psychicCursor } = state.teams[teamId];
  const size = rotation.length;
  if (size === 0) return null;

  for (let offset = 1; offset <= size; offset++) {
    const candidate = rotation[(psychicCursor + offset + size * size) % size];
    if (candidate !== undefined && state.players[candidate]?.connected === true) {
      return candidate;
    }
  }
  return rotation[(psychicCursor + 1 + size * size) % size] ?? null;
}

/**
 * Who holds the dial by default: the next connected teammate after the psychic.
 * Falls back to the psychic on a solo team, which the lobby's minimum-players
 * guard normally prevents but a mid-game disconnect can still produce.
 */
export function defaultControllerId(
  state: GameState,
  teamId: TeamId,
  psychicId: PlayerId,
): PlayerId {
  const { rotation } = state.teams[teamId];
  const size = rotation.length;
  if (size === 0) return psychicId;

  const start = rotation.indexOf(psychicId);
  for (let offset = 1; offset <= size; offset++) {
    const candidate = rotation[(start + offset + size * size) % size];
    if (
      candidate !== undefined &&
      candidate !== psychicId &&
      state.players[candidate]?.connected === true
    ) {
      return candidate;
    }
  }
  return psychicId;
}

// ---------------------------------------------------------------------------
// Reveal: scoring, victory, sudden death
// ---------------------------------------------------------------------------

function applyReveal(room: RoomState, targetCenter: Position): TransitionResult {
  const state = room.public;
  const round = state.round;
  if (state.phase !== "prediction" || round === null) {
    return fail(room, "WRONG_PHASE");
  }

  const activeTeam = state.activeTeam;
  const opposingTeam = OPPONENT[activeTeam];

  const activePoints = scoreNeedle(targetCenter, round.needlePosition);
  const opposingPoints = scoreOpponentPrediction(
    targetCenter,
    round.needlePosition,
    round.prediction,
  );

  const scores: Record<TeamId, number> = {
    teamA: state.teams.teamA.score,
    teamB: state.teams.teamB.score,
  };
  scores[activeTeam] += activePoints;
  scores[opposingTeam] += opposingPoints;

  const result: RoundResult = {
    roundNumber: round.roundNumber,
    activeTeam,
    psychicId: round.psychicId,
    cardId: round.cardId,
    clue: round.clue ?? "",
    targetCenter,
    needlePosition: round.needlePosition,
    prediction: round.prediction,
    activeTeamPoints: activePoints,
    opposingTeamPoints: opposingPoints,
    scoresAfter: scores,
  };

  const teams = {
    teamA: { ...state.teams.teamA, score: scores.teamA },
    teamB: { ...state.teams.teamB, score: scores.teamB },
  };

  let suddenDeath: SuddenDeathState | null = state.suddenDeath;
  let winner: TeamId | null = null;
  let phase: GameState["phase"] = "reveal";

  if (suddenDeath !== null) {
    // Already in sudden death: tally this turn against the tiebreak total.
    const pointsThisRound: Record<TeamId, number> = {
      teamA: suddenDeath.pointsThisRound.teamA,
      teamB: suddenDeath.pointsThisRound.teamB,
    };
    pointsThisRound[activeTeam] += activePoints;
    pointsThisRound[opposingTeam] += opposingPoints;
    const turnsTaken = (suddenDeath.turnsTaken + 1) as 0 | 1 | 2;

    if (turnsTaken < 2) {
      suddenDeath = { ...suddenDeath, turnsTaken, pointsThisRound };
    } else if (pointsThisRound.teamA !== pointsThisRound.teamB) {
      winner = pointsThisRound.teamA > pointsThisRound.teamB ? "teamA" : "teamB";
      phase = "gameOver";
      suddenDeath = { ...suddenDeath, turnsTaken, pointsThisRound };
    } else {
      // Still level. Go again.
      suddenDeath = {
        index: suddenDeath.index + 1,
        turnsTaken: 0,
        pointsThisRound: { teamA: 0, teamB: 0 },
      };
    }
  } else if (
    scores.teamA >= state.config.winningScore ||
    scores.teamB >= state.config.winningScore
  ) {
    // Both awards are already applied, so the opposing team can cross the line
    // — and win — on the active team's turn. No special case needed.
    if (scores.teamA !== scores.teamB) {
      winner = scores.teamA > scores.teamB ? "teamA" : "teamB";
      phase = "gameOver";
    } else {
      suddenDeath = {
        index: 1,
        turnsTaken: 0,
        pointsThisRound: { teamA: 0, teamB: 0 },
      };
    }
  }

  const revealedRound: PublicRoundState = {
    ...round,
    revealedTarget: targetCenter,
    result,
  };

  return succeed(
    room,
    bump(state, {
      phase,
      winner,
      teams,
      suddenDeath,
      round: revealedRound,
      history: [...state.history, result],
    }),
    [{ type: "persistResult", result }],
    { targetCenter },
  );
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

export function transition(
  room: RoomState,
  action: GameAction,
): TransitionResult {
  const state = room.public;

  switch (action.type) {
    // -- roster ------------------------------------------------------------
    case "playerJoined": {
      if (state.players[action.playerId] !== undefined) {
        return fail(room, "INVALID_PAYLOAD");
      }
      const player: Player = {
        id: action.playerId,
        name: action.name,
        team: action.team,
        connected: true,
        joinedAt: action.at,
      };
      const team = state.teams[action.team];
      return succeed(
        room,
        bump(state, {
          players: { ...state.players, [action.playerId]: player },
          teams: {
            ...state.teams,
            [action.team]: {
              ...team,
              rotation: [...team.rotation, action.playerId],
            },
          },
        }),
      );
    }

    case "playerLeft":
    case "playerReconnected": {
      const player = state.players[action.playerId];
      if (player === undefined) return fail(room, "UNKNOWN_PLAYER");
      // Rotation is append-only: a departing player keeps their slot so the
      // psychic cycle is undisturbed when they come back.
      return succeed(
        room,
        bump(state, {
          players: {
            ...state.players,
            [action.playerId]: {
              ...player,
              connected: action.type === "playerReconnected",
            },
          },
        }),
      );
    }

    case "setTeam": {
      if (state.phase !== "lobby") return fail(room, "WRONG_PHASE");
      const player = state.players[action.playerId];
      if (player === undefined) return fail(room, "UNKNOWN_PLAYER");
      if (action.by !== action.playerId && action.by !== state.hostId) {
        return fail(room, "NOT_AUTHORIZED");
      }
      if (player.team === action.team) return fail(room, "INVALID_PAYLOAD");

      const from = state.teams[player.team];
      const to = state.teams[action.team];
      return succeed(
        room,
        bump(state, {
          players: {
            ...state.players,
            [action.playerId]: { ...player, team: action.team },
          },
          teams: {
            ...state.teams,
            [player.team]: {
              ...from,
              rotation: from.rotation.filter((id) => id !== action.playerId),
            },
            [action.team]: {
              ...to,
              rotation: [...to.rotation, action.playerId],
            },
          },
        }),
      );
    }

    // -- starting ----------------------------------------------------------
    case "startGame": {
      if (state.phase !== "lobby") return fail(room, "WRONG_PHASE");
      if (action.by !== state.hostId) return fail(room, "NOT_AUTHORIZED");
      // Two playable shapes: two teams that can each field a Psychic and a
      // guesser, or everyone on one side playing co-op. A team of one is the
      // only arrangement that cannot work — that player would be Psychic and
      // sole guesser, moving the needle while looking at the target.
      const minimum = state.config.minPlayersPerTeamToStart;
      const a = connectedCount(state, "teamA");
      const b = connectedCount(state, "teamB");
      const versus = a >= minimum && b >= minimum;
      const coop =
        (a >= MIN_PLAYERS_FOR_COOP && b === 0) || (b >= MIN_PLAYERS_FOR_COOP && a === 0);
      if (!versus && !coop) return fail(room, "NOT_ENOUGH_PLAYERS");
      return succeed(
        room,
        bump(state, {
          phase: "clue",
          roundNumber: 1,
          round: null,
          // Co-op must start on the side that actually has players.
          activeTeam: b === 0 ? "teamA" : a === 0 ? "teamB" : state.activeTeam,
        }),
        [{ type: "prepareRound" }],
        null,
      );
    }

    case "roundPrepared": {
      if (state.phase !== "clue" || state.round !== null) {
        return fail(room, "WRONG_PHASE");
      }
      const team = state.teams[state.activeTeam];
      const cursor = team.rotation.indexOf(action.psychicId);
      if (cursor === -1) return fail(room, "INVALID_PAYLOAD");

      const round: PublicRoundState = {
        roundNumber: state.roundNumber,
        cardId: action.cardId,
        psychicId: action.psychicId,
        controllerId: action.controllerId,
        clue: null,
        needlePosition: 0.5,
        needleLocked: false,
        prediction: null,
        revealedTarget: null,
        result: null,
      };

      return succeed(
        room,
        bump(state, {
          round,
          usedCardIds: [...state.usedCardIds, action.cardId],
          teams: {
            ...state.teams,
            [state.activeTeam]: { ...team, psychicCursor: cursor },
          },
        }),
        [],
        // Secret redaction: the only branch where a secret enters. Everything
        // above is identical whether or not `targetCenter` was supplied, so
        // the public state is byte-identical on every client.
        action.targetCenter === null ? null : { targetCenter: action.targetCenter },
      );
    }

    // -- the round ---------------------------------------------------------
    case "submitClue": {
      const round = state.round;
      if (state.phase !== "clue" || round === null) return fail(room, "WRONG_PHASE");
      if (action.by !== round.psychicId) return fail(room, "NOT_AUTHORIZED");
      const clue = action.clue.trim();
      if (clue.length === 0 || clue.length > MAX_CLUE_LENGTH) {
        return fail(room, "INVALID_PAYLOAD");
      }
      return succeed(
        room,
        bump(state, { phase: "guess", round: { ...round, clue } }),
      );
    }

    case "nominateController": {
      const round = state.round;
      if (round?.needleLocked === true) return fail(room, "NEEDLE_LOCKED");
      if (state.phase !== "guess" || round === null) return fail(room, "WRONG_PHASE");
      const actor = state.players[action.by];
      if (actor === undefined) return fail(room, "UNKNOWN_PLAYER");
      if (actor.team !== state.activeTeam) return fail(room, "NOT_AUTHORIZED");
      const nominee = state.players[action.controllerId];
      if (nominee === undefined || nominee.team !== state.activeTeam) {
        return fail(room, "INVALID_PAYLOAD");
      }
      return succeed(
        room,
        bump(state, { round: { ...round, controllerId: action.controllerId } }),
      );
    }

    case "moveNeedle": {
      const round = state.round;
      // Check the lock before the phase: locking advances to "prediction", so
      // a phase-first check would mask the specific reason with WRONG_PHASE.
      if (round?.needleLocked === true) return fail(room, "NEEDLE_LOCKED");
      if (state.phase !== "guess" || round === null) return fail(room, "WRONG_PHASE");
      if (action.by !== round.controllerId) return fail(room, "NOT_AUTHORIZED");
      if (!Number.isFinite(action.position)) return fail(room, "INVALID_PAYLOAD");
      return succeed(
        room,
        bump(state, {
          round: { ...round, needlePosition: quantizePosition(action.position) },
        }),
      );
    }

    case "lockNeedle": {
      const round = state.round;
      if (round?.needleLocked === true) return fail(room, "NEEDLE_LOCKED");
      if (state.phase !== "guess" || round === null) return fail(room, "WRONG_PHASE");
      if (action.by !== round.controllerId) return fail(room, "NOT_AUTHORIZED");

      const locked = bump(state, {
        phase: "prediction",
        round: { ...round, needleLocked: true },
      });

      // With nobody to call left or right, waiting in `prediction` would hang
      // the round forever. Reveal immediately instead.
      return succeed(
        room,
        locked,
        isCooperative(state) ? [{ type: "revealTarget" }] : [],
      );
    }

    case "submitPrediction": {
      const round = state.round;
      if (state.phase !== "prediction" || round === null) {
        return fail(room, "WRONG_PHASE");
      }
      const actor = state.players[action.by];
      if (actor === undefined) return fail(room, "UNKNOWN_PLAYER");
      if (actor.team !== OPPONENT[state.activeTeam]) {
        return fail(room, "NOT_AUTHORIZED");
      }
      return succeed(
        room,
        bump(state, { round: { ...round, prediction: action.side } }),
        [{ type: "revealTarget" }],
      );
    }

    case "targetRevealed":
      return applyReveal(room, action.targetCenter);

    case "acknowledgeReveal": {
      if (state.phase !== "reveal") return fail(room, "WRONG_PHASE");
      const actor = state.players[action.by];
      if (actor === undefined) return fail(room, "UNKNOWN_PLAYER");
      if (action.by !== state.hostId && actor.team !== state.activeTeam) {
        return fail(room, "NOT_AUTHORIZED");
      }
      return succeed(
        room,
        bump(state, {
          phase: "clue",
          // Co-op keeps playing on the same side; only the Psychic rotates.
          activeTeam: isCooperative(state) ? state.activeTeam : OPPONENT[state.activeTeam],
          roundNumber: state.roundNumber + 1,
          round: null,
        }),
        [{ type: "prepareRound" }],
        null,
      );
    }

    case "restartGame": {
      if (state.phase !== "gameOver") return fail(room, "WRONG_PHASE");
      if (action.by !== state.hostId) return fail(room, "NOT_AUTHORIZED");
      return succeed(
        room,
        bump(state, {
          phase: "lobby",
          activeTeam: "teamA",
          roundNumber: 0,
          round: null,
          suddenDeath: null,
          usedCardIds: [],
          history: [],
          winner: null,
          teams: {
            teamA: { ...state.teams.teamA, score: 0, psychicCursor: -1 },
            teamB: { ...state.teams.teamB, score: 0, psychicCursor: -1 },
          },
        }),
        [],
        null,
      );
    }
  }
}
