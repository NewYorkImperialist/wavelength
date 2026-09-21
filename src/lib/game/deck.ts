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

  // Media and culture
  { id: "c063", left: "Style you'd wear", right: "Costume" },
  { id: "c064", left: "A good sequel", right: "A cash grab" },
  { id: "c065", left: "Low budget", right: "Blockbuster" },
  { id: "c066", left: "Reads the book", right: "Waits for the film" },
  { id: "c067", left: "A song you skip", right: "A song you replay" },
  { id: "c068", left: "Fits in a tweet", right: "Needs an essay" },
  { id: "c069", left: "Aimed at kids", right: "Strictly for adults" },
  { id: "c070", left: "Slow burn", right: "Instant hook" },

  // Places and travel
  { id: "c071", left: "Tourist trap", right: "Hidden gem" },
  { id: "c072", left: "Somewhere you'd visit", right: "Somewhere you'd live" },
  { id: "c073", left: "Cramped", right: "Spacious" },
  { id: "c074", left: "Middle of nowhere", right: "City centre" },
  { id: "c075", left: "Relaxing holiday", right: "Gruelling expedition" },

  // Work and ambition
  { id: "c076", left: "A job", right: "A calling" },
  { id: "c077", left: "Thankless work", right: "All the glory" },
  { id: "c078", left: "Hobby", right: "Obsession" },
  { id: "c079", left: "Sensible career", right: "Wild gamble" },
  { id: "c080", left: "Works alone", right: "Needs a team" },
  { id: "c081", left: "Automatable", right: "Irreplaceably human" },

  // Emotion and mood
  { id: "c082", left: "Calming", right: "Stressful" },
  { id: "c083", left: "Mildly annoying", right: "Blindingly infuriating" },
  { id: "c084", left: "Cringe", right: "Genuinely cool" },
  { id: "c085", left: "Sad", right: "Joyful" },
  { id: "c086", left: "Embarrassing in private", right: "Embarrassing in public" },
  { id: "c087", left: "Cosy", right: "Bleak" },
  { id: "c088", left: "Underwhelming", right: "Lives up to the hype" },

  // Behaviour and habits
  { id: "c089", left: "A habit", right: "An addiction" },
  { id: "c090", left: "Easy to start", right: "Hard to quit" },
  { id: "c091", left: "Worth doing properly", right: "Just get it done" },
  { id: "c092", left: "Plans everything", right: "Total improviser" },
  { id: "c093", left: "Arrives early", right: "Always late" },
  { id: "c094", left: "Keeps everything", right: "Throws it all out" },

  // Objects and technology
  { id: "c095", left: "Overengineered", right: "Barely works" },
  { id: "c096", left: "Everyone owns one", right: "Almost nobody owns one" },
  { id: "c097", left: "Obsolete", right: "Cutting edge" },
  { id: "c098", left: "Ugly but works", right: "Beautiful but useless" },
  { id: "c099", left: "Repairable", right: "Throw it away" },
  { id: "c100", left: "A toy", right: "A serious tool" },

  // Nature and animals
  { id: "c101", left: "Cute animal", right: "Terrifying animal" },
  { id: "c102", left: "Good pet", right: "Terrible pet" },
  { id: "c103", left: "Common", right: "Rare" },
  { id: "c104", left: "Tame", right: "Wild" },
  { id: "c105", left: "Survives anything", right: "Dies immediately" },

  // Truth, belief, morality
  { id: "c106", left: "Superstition", right: "Science" },
  { id: "c107", left: "A white lie", right: "A real crime" },
  { id: "c108", left: "Selfish", right: "Selfless" },
  { id: "c109", left: "Morally grey", right: "Clearly wrong" },
  { id: "c110", left: "Nobody's fault", right: "Entirely your fault" },
  { id: "c111", left: "Deserved", right: "Unfair" },

  // Scale and consequence
  { id: "c112", left: "Trivial", right: "Life-changing" },
  { id: "c113", left: "Affects one person", right: "Affects everyone" },
  { id: "c114", left: "Easily undone", right: "Irreversible" },
  { id: "c115", left: "Local problem", right: "Global crisis" },

  // Games and competition
  { id: "c116", left: "Luck", right: "Skill" },
  { id: "c117", left: "Friendly game", right: "Friendship-ending game" },
  { id: "c118", left: "Fun to lose", right: "Only fun to win" },
  { id: "c119", left: "Simple rules", right: "Rulebook the size of a novel" },
  { id: "c120", left: "Spectator sport", right: "Only fun to play" },
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

// ---------------------------------------------------------------------------
// Custom decks
// ---------------------------------------------------------------------------

export interface DeckParseResult {
  readonly cards: readonly SpectrumCard[];
  /** Human-readable problems with the input. Empty when the deck is clean. */
  readonly errors: readonly string[];
}

/**
 * Validate a deck supplied as JSON, so a group can play with their own
 * spectrums (including ones transcribed from a physical game they own) without
 * that text living in this repository.
 *
 * Accepts either `[{ id, left, right }, ...]` or `{ cards: [...] }`. Ids are
 * generated positionally when absent. See `docs/deck-format.md`.
 *
 * Returns errors rather than throwing: a deck with a few bad rows should load
 * the good ones and tell you what it skipped.
 */
export function parseDeck(input: unknown): DeckParseResult {
  const errors: string[] = [];

  const raw: unknown = Array.isArray(input)
    ? input
    : typeof input === "object" && input !== null && "cards" in input
      ? (input as { cards: unknown }).cards
      : undefined;

  if (!Array.isArray(raw)) {
    return { cards: [], errors: ["Expected an array of cards, or { cards: [...] }."] };
  }

  const cards: SpectrumCard[] = [];
  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();

  raw.forEach((entry, index) => {
    const where = `card ${index + 1}`;
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${where}: not an object.`);
      return;
    }
    const { id, left, right } = entry as Record<string, unknown>;

    if (typeof left !== "string" || left.trim() === "") {
      errors.push(`${where}: "left" must be a non-empty string.`);
      return;
    }
    if (typeof right !== "string" || right.trim() === "") {
      errors.push(`${where}: "right" must be a non-empty string.`);
      return;
    }

    const cardId =
      typeof id === "string" && id.trim() !== ""
        ? id.trim()
        : `custom-${String(index + 1).padStart(3, "0")}`;

    if (seenIds.has(cardId)) {
      errors.push(`${where}: duplicate id "${cardId}".`);
      return;
    }
    const pair = `${left.trim().toLowerCase()}|${right.trim().toLowerCase()}`;
    if (seenPairs.has(pair)) {
      errors.push(`${where}: duplicate spectrum "${left.trim()} / ${right.trim()}".`);
      return;
    }

    seenIds.add(cardId);
    seenPairs.add(pair);
    cards.push({ id: cardId, left: left.trim(), right: right.trim() });
  });

  return { cards, errors };
}
