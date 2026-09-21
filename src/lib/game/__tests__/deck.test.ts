import { describe, expect, it } from "vitest";

import { drawCard, getCardById, parseDeck, SPECTRUM_DECK } from "../deck";

/** Deterministic stand-in for the injected RNG. */
function sequence(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("the built-in deck", () => {
  it("has enough cards for a long night", () => {
    expect(SPECTRUM_DECK.length).toBeGreaterThanOrEqual(100);
  });

  it("has unique ids", () => {
    const ids = new Set(SPECTRUM_DECK.map((c) => c.id));
    expect(ids.size).toBe(SPECTRUM_DECK.length);
  });

  it("has no duplicate spectrums, compared case-insensitively", () => {
    const pairs = SPECTRUM_DECK.map(
      (c) => `${c.left.toLowerCase()}|${c.right.toLowerCase()}`,
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("has no empty or untrimmed labels", () => {
    for (const card of SPECTRUM_DECK) {
      expect(card.left.trim()).toBe(card.left);
      expect(card.right.trim()).toBe(card.right);
      expect(card.left.length).toBeGreaterThan(0);
      expect(card.right.length).toBeGreaterThan(0);
    }
  });

  it("never pairs a concept with itself", () => {
    for (const card of SPECTRUM_DECK) {
      expect(card.left.toLowerCase()).not.toBe(card.right.toLowerCase());
    }
  });

  it("looks cards up by id", () => {
    const first = SPECTRUM_DECK[0]!;
    expect(getCardById(first.id)).toEqual(first);
    expect(getCardById("nope")).toBeUndefined();
  });
});

describe("drawCard", () => {
  it("never returns a card already used this game", () => {
    const used: string[] = [];
    const rng = sequence([0, 0.5, 0.99, 0.25, 0.75]);
    for (let i = 0; i < 40; i++) {
      const card = drawCard(SPECTRUM_DECK, used, rng);
      expect(used).not.toContain(card.id);
      used.push(card.id);
    }
  });

  it("is deterministic for a given rng", () => {
    const a = drawCard(SPECTRUM_DECK, [], sequence([0.42]));
    const b = drawCard(SPECTRUM_DECK, [], sequence([0.42]));
    expect(a).toEqual(b);
  });

  it("reshuffles rather than failing once the deck is exhausted", () => {
    const allIds = SPECTRUM_DECK.map((c) => c.id);
    const card = drawCard(SPECTRUM_DECK, allIds, sequence([0.5]));
    expect(allIds).toContain(card.id);
  });

  it("stays in range even if the rng returns exactly 1", () => {
    const card = drawCard(SPECTRUM_DECK, [], sequence([1]));
    expect(card).toBeDefined();
    expect(SPECTRUM_DECK).toContainEqual(card);
  });

  it("throws only on a genuinely empty deck", () => {
    expect(() => drawCard([], [], sequence([0]))).toThrow(/empty/i);
  });
});

describe("parseDeck", () => {
  it("accepts a bare array and an object with a cards key", () => {
    const cards = [{ left: "Cheap", right: "Expensive" }];
    expect(parseDeck(cards).cards).toHaveLength(1);
    expect(parseDeck({ cards }).cards).toHaveLength(1);
  });

  it("generates positional ids when they are omitted", () => {
    const { cards } = parseDeck([
      { left: "Cheap", right: "Expensive" },
      { left: "Quiet", right: "Loud" },
    ]);
    expect(cards.map((c) => c.id)).toEqual(["custom-001", "custom-002"]);
  });

  it("keeps supplied ids and trims labels", () => {
    const { cards } = parseDeck([{ id: " x1 ", left: "  Cheap ", right: "Expensive  " }]);
    expect(cards[0]).toEqual({ id: "x1", left: "Cheap", right: "Expensive" });
  });

  it("skips bad rows but keeps the good ones", () => {
    const { cards, errors } = parseDeck([
      { left: "Cheap", right: "Expensive" },
      { left: "", right: "Loud" },
      { left: "Quiet" },
      "nonsense",
      { left: "Soft", right: "Hard" },
    ]);
    expect(cards).toHaveLength(2);
    expect(errors).toHaveLength(3);
  });

  it("rejects duplicate ids and duplicate spectrums", () => {
    const { cards, errors } = parseDeck([
      { id: "a", left: "Cheap", right: "Expensive" },
      { id: "a", left: "Quiet", right: "Loud" },
      { id: "b", left: "CHEAP", right: "expensive" },
    ]);
    expect(cards).toHaveLength(1);
    expect(errors.join(" ")).toMatch(/duplicate id/i);
    expect(errors.join(" ")).toMatch(/duplicate spectrum/i);
  });

  it("reports a clear error for input that is not a deck at all", () => {
    expect(parseDeck(null).errors).toHaveLength(1);
    expect(parseDeck(42).cards).toHaveLength(0);
  });

  it("round-trips the built-in deck unchanged", () => {
    const { cards, errors } = parseDeck(SPECTRUM_DECK);
    expect(errors).toEqual([]);
    expect(cards).toEqual(SPECTRUM_DECK);
  });
});
