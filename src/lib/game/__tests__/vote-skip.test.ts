import { describe, expect, it } from "vitest";

import { skipCarries, tallySkipVotes, votesToSkip } from "../vote-skip";

const votesFor = (cardId: string, ...playerIds: string[]) =>
  playerIds.map((playerId) => ({ playerId, cardId }));

describe("votesToSkip", () => {
  it("needs a strict majority, so a tie keeps the card", () => {
    expect(votesToSkip(1)).toBe(1);
    expect(votesToSkip(2)).toBe(2);
    expect(votesToSkip(3)).toBe(2);
    expect(votesToSkip(4)).toBe(3);
    expect(votesToSkip(5)).toBe(3);
    expect(votesToSkip(6)).toBe(4);
  });

  it("is never satisfied by half of an even room", () => {
    for (const players of [2, 4, 6, 8, 10]) {
      expect(skipCarries(players / 2, players)).toBe(false);
      expect(skipCarries(players / 2 + 1, players)).toBe(true);
    }
  });
});

describe("tallySkipVotes", () => {
  const room = ["ana", "ben", "cai"];

  it("carries once a majority of the room agrees", () => {
    expect(tallySkipVotes(room, votesFor("card-1", "ana"), "card-1")).toMatchObject({
      voterIds: ["ana"],
      connectedPlayers: 3,
      required: 2,
      carried: false,
    });

    expect(tallySkipVotes(room, votesFor("card-1", "ana", "ben"), "card-1")).toMatchObject({
      required: 2,
      carried: true,
    });
  });

  it("stops carrying when a voter withdraws", () => {
    const withdrawn = votesFor("card-1", "ana", "ben").filter((v) => v.playerId !== "ben");
    expect(tallySkipVotes(room, withdrawn, "card-1").carried).toBe(false);
  });

  it("ignores votes cast against a card that has already been replaced", () => {
    // Both of these were unanimous against card-1. A skip rewrites the card on
    // the same round, so counting them again would bin card-2 unread.
    const stale = votesFor("card-1", "ana", "ben", "cai");
    expect(tallySkipVotes(room, stale, "card-2")).toMatchObject({
      voterIds: [],
      carried: false,
    });
  });

  it("counts only the card in play when votes for several cards coexist", () => {
    const mixed = [...votesFor("card-1", "ana", "ben"), ...votesFor("card-2", "cai")];
    expect(tallySkipVotes(room, mixed, "card-2")).toMatchObject({
      voterIds: ["cai"],
      required: 2,
      carried: false,
    });
  });

  it("drops a departed player from both sides of the fraction", () => {
    const votes = votesFor("card-1", "ana", "cai");

    // Three in the room, two votes: already carried.
    expect(tallySkipVotes(room, votes, "card-1").carried).toBe(true);

    // Ana leaves. Her vote goes with her, and two players now need two votes,
    // so Cai's lone vote is no longer enough.
    expect(tallySkipVotes(["ben", "cai"], votes, "card-1")).toMatchObject({
      voterIds: ["cai"],
      connectedPlayers: 2,
      required: 2,
      carried: false,
    });
  });

  it("carries on a departure that leaves the remaining votes in the majority", () => {
    // Four players, two votes: one short. Ben leaves without having voted,
    // and the same two votes are now a majority of three.
    const votes = votesFor("card-1", "ana", "cai");
    const four = ["ana", "ben", "cai", "dee"];

    expect(tallySkipVotes(four, votes, "card-1").carried).toBe(false);
    expect(tallySkipVotes(["ana", "cai", "dee"], votes, "card-1").carried).toBe(true);
  });

  it("cannot carry in an empty room", () => {
    expect(tallySkipVotes([], votesFor("card-1", "ana"), "card-1")).toMatchObject({
      voterIds: [],
      connectedPlayers: 0,
      required: 1,
      carried: false,
    });
  });
});
