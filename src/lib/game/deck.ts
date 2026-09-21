/**
 * The spectrum deck.
 *
 * Original writing. The printed text of the commercial game is copyrighted and
 * is not reproduced here; these are written in the same register — two opposing
 * concepts that are concrete, arguable, and fun to place things along. A good
 * spectrum has no factual answer, only a defensible one.
 *
 * Data only: no game logic here, so the deck can be swapped or extended freely.
 */

export interface SpectrumCard {
  readonly id: string;
  readonly left: string;
  readonly right: string;
}

export const SPECTRUM_DECK: readonly SpectrumCard[] = [
  // Taste and opinion
  { id: "c001", left: "Underrated", right: "Overrated" },
  { id: "c002", left: "Forgettable", right: "Unforgettable" },
  { id: "c003", left: "Guilty pleasure", right: "Openly enjoyed" },
  { id: "c004", left: "Acquired taste", right: "Universally loved" },
  { id: "c005", left: "Style over substance", right: "Substance over style" },
  { id: "c006", left: "Cult classic", right: "Mainstream hit" },
  { id: "c007", left: "Ages badly", right: "Ages well" },
  { id: "c008", left: "Background noise", right: "Demands your attention" },

  // Physical properties
  { id: "c009", left: "Hot", right: "Cold" },
  { id: "c010", left: "Soft", right: "Hard" },
  { id: "c011", left: "Fragile", right: "Indestructible" },
  { id: "c012", left: "Lightweight", right: "Heavy" },
  { id: "c013", left: "Quiet", right: "Loud" },
  { id: "c014", left: "Smooth", right: "Rough" },
  { id: "c015", left: "Tiny", right: "Enormous" },
  { id: "c016", left: "Dull", right: "Sharp" },

  // Social norms
  { id: "c017", left: "Normal thing to own", right: "Weird thing to own" },
  { id: "c018", left: "Rude", right: "Polite" },
  { id: "c019", left: "Casual outfit", right: "Formal outfit" },
  { id: "c020", left: "Fine to do alone", right: "Strange to do alone" },
  { id: "c021", left: "Private matter", right: "Everyone's business" },
  { id: "c022", left: "Easy to forgive", right: "Unforgivable" },
  { id: "c023", left: "Modest", right: "Showing off" },
  { id: "c024", left: "Socially acceptable lie", right: "Serious betrayal" },

  // Effort and difficulty
  { id: "c025", left: "Effortless", right: "Exhausting" },
  { id: "c026", left: "Anyone can do it", right: "Takes real talent" },
  { id: "c027", left: "Temporary fix", right: "Permanent fix" },
  { id: "c028", left: "Chore", right: "Treat" },
  { id: "c029", left: "Beginner friendly", right: "Steep learning curve" },
  { id: "c030", left: "Quick to learn", right: "A lifetime to master" },

  // Risk and safety
  { id: "c031", left: "Harmless", right: "Dangerous" },
  { id: "c032", left: "Safe bet", right: "Wild gamble" },
  { id: "c033", left: "Mild inconvenience", right: "Total disaster" },
  { id: "c034", left: "Irrational fear", right: "Reasonable fear" },
  { id: "c035", left: "Worth the risk", right: "Never worth it" },

  // Food and drink
  { id: "c036", left: "Snack", right: "Proper meal" },
  { id: "c037", left: "Bland", right: "Intense flavour" },
  { id: "c038", left: "Comfort food", right: "Fine dining" },
  { id: "c039", left: "Better cold", right: "Better hot" },
  { id: "c040", left: "Healthy", right: "Terrible for you" },

  // Time
  { id: "c041", left: "Ancient", right: "Brand new" },
  { id: "c042", left: "A phase", right: "Here to stay" },
  { id: "c043", left: "Takes a second", right: "Takes all day" },
  { id: "c044", left: "Old-fashioned", right: "Ahead of its time" },
  { id: "c045", left: "Nostalgic", right: "Futuristic" },

  // Value and cost
  { id: "c046", left: "Cheap", right: "Expensive" },
  { id: "c047", left: "Waste of money", right: "Worth every penny" },
  { id: "c048", left: "Necessity", right: "Luxury" },
  { id: "c049", left: "Disposable", right: "Heirloom" },

  // People and character
  { id: "c050", left: "Villain", right: "Hero" },
  { id: "c051", left: "Follower", right: "Leader" },
  { id: "c052", left: "Book smart", right: "Street smart" },
  { id: "c053", left: "Introvert", right: "Extrovert" },
  { id: "c054", left: "Predictable", right: "Full of surprises" },
  { id: "c055", left: "Bad influence", right: "Role model" },

  // Miscellaneous
  { id: "c056", left: "Overthinking it", right: "Not thinking at all" },
  { id: "c057", left: "A want", right: "A need" },
  { id: "c058", left: "Boring but useful", right: "Useless but fun" },
  { id: "c059", left: "Clean", right: "Filthy" },
  { id: "c060", left: "A rumour", right: "Established fact" },
  { id: "c061", left: "Silly", right: "Deadly serious" },
  { id: "c062", left: "Cursed object", right: "Lucky charm" },
];

const CARDS_BY_ID: ReadonlyMap<string, SpectrumCard> = new Map(
  SPECTRUM_DECK.map((card) => [card.id, card]),
);

export function getCardById(id: string): SpectrumCard | undefined {
  return CARDS_BY_ID.get(id);
}

/**
 * Draw a card that has not been used this game.
 *
 * When the deck is exhausted it reshuffles — drawing from the full deck again
 * — rather than throwing, so a long game degrades gracefully instead of
 * ending for a reason that has nothing to do with the rules.
 *
 * Deterministic for a given `rng`, which is injected so the server can use a
 * CSPRNG and tests can pin the outcome.
 */
export function drawCard(
  deck: readonly SpectrumCard[],
  usedCardIds: readonly string[],
  rng: () => number,
): SpectrumCard {
  if (deck.length === 0) {
    throw new Error("drawCard: the deck is empty");
  }
  const used = new Set(usedCardIds);
  const available = deck.filter((card) => !used.has(card.id));
  const pool = available.length > 0 ? available : deck;

  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  const card = pool[index];
  // `noUncheckedIndexedAccess`: the clamp above guarantees this, but prove it.
  if (!card) throw new Error("drawCard: index out of range");
  return card;
}
