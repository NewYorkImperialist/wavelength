/**
 * Play a complete multiplayer game over HTTP against a real database.
 *
 * Four players in four cookie jars, exercising every route handler and every
 * guard. No browser: this is about the server being correct, not the UI.
 *
 *   ./scripts/dev-stack.sh      (postgres + postgrest + proxy + next)
 *   node scripts/e2e-api.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let failures = 0;
const ok = (label) => console.log(`  PASS  ${label}`);
const bad = (label, detail) => {
  failures++;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
};

function check(label, condition, detail) {
  if (condition) ok(label);
  else bad(label, detail);
}

/** One player: a cookie jar plus their id. */
function makePlayer(name) {
  return { name, cookies: new Map(), playerId: null, team: null };
}

async function call(player, path, { method = "GET", body } = {}) {
  const jar = [...player.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const response = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jar === "" ? {} : { Cookie: jar }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    player.cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }

  const text = await response.text();
  let json = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: json };
}

console.log("Playing a full game over HTTP\n");

// --- lobby ------------------------------------------------------------------
const host = makePlayer("Ada");
const created = await call(host, "/api/rooms", { method: "POST", body: { displayName: host.name } });
check("host creates a room", created.status === 201, JSON.stringify(created.body));
const { roomId, code } = created.body ?? {};
host.playerId = created.body?.playerId ?? null;
console.log(`        room ${code}`);

const others = [makePlayer("Alan"), makePlayer("Bo"), makePlayer("Bea")];
for (const player of others) {
  const joined = await call(player, "/api/rooms/join", {
    method: "POST",
    body: { code, displayName: player.name },
  });
  check(`${player.name} joins`, joined.status === 201, JSON.stringify(joined.body));
  player.playerId = joined.body?.playerId ?? null;
}

const badCode = await call(makePlayer("Nobody"), "/api/rooms/join", {
  method: "POST",
  body: { code: "ZZZZZZ", displayName: "Nobody" },
});
check("a wrong code is refused", badCode.status === 404, `got ${badCode.status}`);

const noName = await call(makePlayer("X"), "/api/rooms/join", {
  method: "POST",
  body: { code, displayName: "   " },
});
check("a blank name is refused", noName.status === 400, `got ${noName.status}`);

// --- starting ---------------------------------------------------------------
const notHost = await call(others[0], `/api/rooms/${roomId}/start`, { method: "POST" });
check("a non-host cannot start the game", notHost.status === 403, `got ${notHost.status}`);

const started = await call(host, `/api/rooms/${roomId}/start`, { method: "POST" });
check("the host starts the game", started.status === 201, JSON.stringify(started.body));

const restart = await call(host, `/api/rooms/${roomId}/start`, { method: "POST" });
check("starting twice is refused", restart.status === 409, `got ${restart.status}`);

const all = [host, ...others];

// --- a round ----------------------------------------------------------------
async function playRound(roundNumber) {
  for (const player of all) {
    const own = await call(player, `/api/rooms/${roomId}/state`);
    player.view = own.body;
    player.isPsychic = own.body.me.isPsychic;
  }

  const psychic = all.find((p) => p.isPsychic);
  const guessers = all.filter((p) => p !== psychic);
  const round = psychic.view.round;

  check(`round ${roundNumber}: exactly one psychic`, all.filter((p) => p.isPsychic).length === 1);

  // -- the secret --
  const secret = await call(psychic, `/api/rounds/${round.id}/target`);
  check(`round ${roundNumber}: psychic receives the target`,
    secret.status === 200 && typeof secret.body?.targetCenter === "number");
  const target = secret.body?.targetCenter;

  for (const player of guessers) {
    const denied = await call(player, `/api/rounds/${round.id}/target`);
    check(`round ${roundNumber}: ${player.name} is refused the target`,
      denied.status === 403, `got ${denied.status}`);
  }
  check(`round ${roundNumber}: the target is absent from public state`,
    !JSON.stringify(psychic.view).includes(String(target)));

  // -- clue --
  const notPsychicClue = await call(guessers[0], `/api/rounds/${round.id}/clue`,
    { method: "POST", body: { clue: "cheat" } });
  check(`round ${roundNumber}: only the psychic may give the clue`,
    notPsychicClue.status === 403, `got ${notPsychicClue.status}`);

  const early = await call(guessers[0], `/api/rounds/${round.id}/guess`,
    { method: "POST", body: { position: 0.5 } });
  check(`round ${roundNumber}: cannot guess before the clue`,
    early.status === 409, `got ${early.status}`);

  const clue = await call(psychic, `/api/rounds/${round.id}/clue`,
    { method: "POST", body: { clue: "Batman" } });
  check(`round ${roundNumber}: the psychic gives a clue`, clue.status === 200);

  const lateSkip = await call(guessers[0], `/api/rounds/${round.id}/skip-vote`,
    { method: "POST", body: { voting: true } });
  check(`round ${roundNumber}: cannot vote to skip once the clue is out`,
    lateSkip.status === 409, `got ${lateSkip.status}`);

  // -- everyone guesses for themselves --
  const psychicGuess = await call(psychic, `/api/rounds/${round.id}/guess`,
    { method: "POST", body: { position: target } });
  check(`round ${roundNumber}: the psychic cannot guess`,
    psychicGuess.status === 403, `got ${psychicGuess.status}`);

  // Deliberately spread out: a bullseye, a near miss, and a wild one.
  const positions = [target, Math.min(1, target + 0.08), 0.02];
  for (const [index, player] of guessers.entries()) {
    const guess = await call(player, `/api/rounds/${round.id}/guess`,
      { method: "POST", body: { position: positions[index] } });
    check(`round ${roundNumber}: ${player.name} locks in`, guess.status === 200,
      JSON.stringify(guess.body));
  }

  const again = await call(guessers[0], `/api/rounds/${round.id}/guess`,
    { method: "POST", body: { position: 0.9 } });
  check(`round ${roundNumber}: a guess cannot be changed`, again.status === 409, `got ${again.status}`);

  // -- the reveal happens once the last guess lands --
  const after = await call(guessers[0], `/api/rooms/${roomId}/state`);
  const revealedRound = after.body.round;
  check(`round ${roundNumber}: the round revealed automatically`,
    revealedRound.phase === "reveal", `phase ${revealedRound.phase}`);
  check(`round ${roundNumber}: the target is public after the reveal`,
    revealedRound.revealedTarget === target);

  // -- scoring --
  const steps = (n) => Math.round(n * 2000);
  const band = (n) => {
    const d = Math.abs(steps(target) - steps(n));
    return d <= 50 ? 4 : d <= 150 ? 3 : d <= 250 ? 2 : 0;
  };
  const expected = positions.map(band);

  for (const [index, player] of guessers.entries()) {
    const got = after.body.guesses.find((g) => g.playerId === player.playerId);
    check(`round ${roundNumber}: ${player.name} scored ${expected[index]}`,
      got?.points === expected[index], `got ${got?.points}`);
  }

  const avg = Math.round(expected.reduce((a, b) => a + b, 0) / expected.length);
  const psychicRow = after.body.players.find((p) => p.id === psychic.playerId);
  check(`round ${roundNumber}: the psychic scored the average (${avg})`,
    psychicRow?.score >= avg, `total ${psychicRow?.score}`);

  return { psychicId: psychic.playerId };
}

// --- vote-skip --------------------------------------------------------------
// Run before the first round is played, while the card is still unread. Four
// players, so a strict majority is three.
{
  const before = (await call(host, `/api/rooms/${roomId}/state`)).body;
  const round = before.round;
  const firstCard = round.card.id;
  const commitmentBefore = round.targetCommitment;

  check("a fresh round has no skip votes",
    before.skipVotes.voterIds.length === 0, JSON.stringify(before.skipVotes));
  check("three of four votes are needed to skip",
    before.skipVotes.required === 3, `required ${before.skipVotes.required}`);

  const one = await call(host, `/api/rounds/${round.id}/skip-vote`,
    { method: "POST", body: { voting: true } });
  check("a player votes to skip the card",
    one.status === 200 && one.body.votes === 1 && one.body.skipped === false,
    JSON.stringify(one.body));

  const twice = await call(host, `/api/rounds/${round.id}/skip-vote`,
    { method: "POST", body: { voting: true } });
  check("voting twice is the same vote, not two",
    twice.body?.votes === 1, JSON.stringify(twice.body));

  const withdrawn = await call(host, `/api/rounds/${round.id}/skip-vote`,
    { method: "POST", body: { voting: false } });
  check("a vote can be withdrawn",
    withdrawn.body?.votes === 0, JSON.stringify(withdrawn.body));

  const bare = await call(host, `/api/rounds/${round.id}/skip-vote`, { method: "POST" });
  check("a vote must say which way it goes", bare.status === 400, `got ${bare.status}`);

  // Three votes, the third of which should carry.
  const voters = all.slice(0, 3);
  const results = [];
  for (const voter of voters) {
    results.push(await call(voter, `/api/rounds/${round.id}/skip-vote`,
      { method: "POST", body: { voting: true } }));
  }

  check("the first two votes do not carry",
    results[0].body?.skipped === false && results[1].body?.skipped === false,
    JSON.stringify(results.map((r) => r.body)));
  check("the third vote carries the skip",
    results[2].body?.skipped === true, JSON.stringify(results[2].body));

  const after = (await call(host, `/api/rooms/${roomId}/state`)).body;
  check("the skip deals a different card",
    after.round.card.id !== firstCard, `${firstCard} -> ${after.round.card.id}`);
  check("the same player is still the Psychic",
    after.round.psychicPlayerId === round.psychicPlayerId);
  check("the round number does not advance on a skip",
    after.round.roundNumber === round.roundNumber,
    `${round.roundNumber} -> ${after.round.roundNumber}`);
  check("the round goes back to waiting for a clue",
    after.round.phase === "clue" && after.round.clue === null, after.round.phase);
  check("a new commitment is published with the new card",
    after.round.targetCommitment !== commitmentBefore);
  check("the replacement card starts with a clean tally",
    after.skipVotes.voterIds.length === 0, JSON.stringify(after.skipVotes));
  check("nobody scored for the skipped card",
    after.players.every((p) => p.score === 0), JSON.stringify(after.players));
}

const first = await playRound(1);

const advanced = await call(others[0], `/api/rooms/${roomId}/next-round`, { method: "POST" });
check("any player can advance the round", advanced.status === 201, JSON.stringify(advanced.body));

const second = await playRound(2);
check("the psychic rotates", second.psychicId !== first.psychicId);

// --- a departure can carry a skip that was one vote short -------------------
// Nobody is going to press anything to make this happen, so the leave route
// has to re-check the arithmetic itself.
{
  const advanced3 = await call(host, `/api/rooms/${roomId}/next-round`, { method: "POST" });
  check("a third round is dealt", advanced3.status === 201, JSON.stringify(advanced3.body));

  const before = (await call(host, `/api/rooms/${roomId}/state`)).body;
  const round = before.round;
  const cardBefore = round.card.id;

  // Someone who is neither the host nor the Psychic, so their departure does
  // not also trigger a handover and cloud the result.
  const leaver = all.find(
    (p) => p.playerId !== host.playerId && p.playerId !== round.psychicPlayerId,
  );
  const voters = all.filter((p) => p !== leaver).slice(0, 2);

  for (const voter of voters) {
    await call(voter, `/api/rounds/${round.id}/skip-vote`,
      { method: "POST", body: { voting: true } });
  }

  const short = (await call(host, `/api/rooms/${roomId}/state`)).body;
  check("two of four votes is one short",
    short.skipVotes.voterIds.length === 2 && short.skipVotes.required === 3,
    JSON.stringify(short.skipVotes));
  check("the card is untouched while the vote is short",
    short.round.card.id === cardBefore);

  const left = await call(leaver, `/api/rooms/${roomId}/leave`, { method: "POST" });
  check("a non-voter leaves the room", left.status === 200, JSON.stringify(left.body));

  const after = (await call(host, `/api/rooms/${roomId}/state`)).body;
  check("the departure carries the skip without anyone pressing again",
    after.round.card.id !== cardBefore, `still ${after.round.card.id}`);
  check("the Psychic is unchanged by a skip that a departure carried",
    after.round.psychicPlayerId === round.psychicPlayerId);
  check("three players now need two votes",
    after.skipVotes.required === 2, `required ${after.skipVotes.required}`);
}

// --- identity ---------------------------------------------------------------
const stranger = makePlayer("Stranger");
const noSession = await call(stranger, `/api/rooms/${roomId}/state`);
check("no cookie means no access", noSession.status === 401, `got ${noSession.status}`);

stranger.cookies.set(`wl_s_${roomId.slice(0, 8)}`, "not-a-real-token-at-all-0000000000000000000");
const forged = await call(stranger, `/api/rooms/${roomId}/state`);
check("a forged cookie is rejected", forged.status === 401, `got ${forged.status}`);

console.log(`\n${failures === 0 ? "All API assertions passed." : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
