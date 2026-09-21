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

// --- teams ------------------------------------------------------------------
// Joining seats everyone on one side so small groups can play co-op straight
// away. This suite exercises the full two-team rules, so split first.
const notHostSplit = await call(others[0], `/api/rooms/${roomId}/team`, {
  method: "POST",
  body: { split: true },
});
check("a non-host cannot split the teams", notHostSplit.status === 403, `got ${notHostSplit.status}`);

const split = await call(host, `/api/rooms/${roomId}/team`, { method: "POST", body: { split: true } });
check("the host splits into two teams", split.status === 200, JSON.stringify(split.body));

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
  const view = await call(host, `/api/rooms/${roomId}/state`);
  const state = view.body;
  const round = state.round;
  if (round === null) return bad("a round exists", "state.round was null");

  for (const player of all) {
    const own = await call(player, `/api/rooms/${roomId}/state`);
    player.team = own.body.me.team;
    player.isPsychic = own.body.me.isPsychic;
  }

  const psychic = all.find((p) => p.isPsychic);
  const activeTeam = round.activeTeam;
  const teammate = all.find((p) => p.team === activeTeam && p !== psychic);
  const opponent = all.find((p) => p.team !== activeTeam);

  check(`round ${roundNumber}: exactly one psychic`, all.filter((p) => p.isPsychic).length === 1);
  check(`round ${roundNumber}: psychic is on the active team`, psychic?.team === activeTeam);

  // -- the secret --
  const secret = await call(psychic, `/api/rounds/${round.id}/target`);
  check(`round ${roundNumber}: psychic receives the target`, secret.status === 200 && typeof secret.body?.targetCenter === "number");
  const target = secret.body?.targetCenter;

  for (const player of all.filter((p) => !p.isPsychic)) {
    const denied = await call(player, `/api/rounds/${round.id}/target`);
    check(`round ${roundNumber}: ${player.name} is refused the target`, denied.status === 403, `got ${denied.status}`);
  }

  const publicJson = JSON.stringify(state);
  check(`round ${roundNumber}: the target is absent from public state`, !publicJson.includes(String(target)));

  // -- out-of-phase attempts --
  const earlyPredict = await call(opponent, `/api/rounds/${round.id}/prediction`, { method: "POST", body: { side: "left" } });
  check(`round ${roundNumber}: cannot predict before the guess`, earlyPredict.status === 409, `got ${earlyPredict.status}`);
  check(`round ${roundNumber}: the refusal leaks nothing`, !JSON.stringify(earlyPredict.body).includes(String(target)));

  const notPsychicClue = await call(teammate, `/api/rounds/${round.id}/clue`, { method: "POST", body: { clue: "cheat" } });
  check(`round ${roundNumber}: only the psychic may give the clue`, notPsychicClue.status === 403, `got ${notPsychicClue.status}`);

  // -- clue --
  const empty = await call(psychic, `/api/rounds/${round.id}/clue`, { method: "POST", body: { clue: "   " } });
  check(`round ${roundNumber}: an empty clue is refused`, empty.status === 400, `got ${empty.status}`);

  const clue = await call(psychic, `/api/rounds/${round.id}/clue`, { method: "POST", body: { clue: "Batman" } });
  check(`round ${roundNumber}: the psychic gives a clue`, clue.status === 200, JSON.stringify(clue.body));

  const twice = await call(psychic, `/api/rounds/${round.id}/clue`, { method: "POST", body: { clue: "Robin" } });
  check(`round ${roundNumber}: the clue cannot be changed`, twice.status === 409, `got ${twice.status}`);

  // -- needle --
  const psychicDial = await call(psychic, `/api/rounds/${round.id}/needle`, { method: "POST", body: { action: "claim" } });
  check(`round ${roundNumber}: the psychic cannot take the dial`, psychicDial.status === 403, `got ${psychicDial.status}`);

  const oppDial = await call(opponent, `/api/rounds/${round.id}/needle`, { method: "POST", body: { action: "claim" } });
  check(`round ${roundNumber}: the other team cannot take the dial`, oppDial.status === 403, `got ${oppDial.status}`);

  await call(teammate, `/api/rounds/${round.id}/needle`, { method: "POST", body: { action: "claim" } });
  const locked = await call(teammate, `/api/rounds/${round.id}/needle`, { method: "POST", body: { action: "lock", position: 0.5 } });
  check(`round ${roundNumber}: the guess locks`, locked.status === 200, JSON.stringify(locked.body));

  const relock = await call(teammate, `/api/rounds/${round.id}/needle`, { method: "POST", body: { action: "lock", position: 0.9 } });
  check(`round ${roundNumber}: the guess cannot be moved after locking`, relock.status === 409, `got ${relock.status}`);

  // -- prediction and reveal --
  const ownTeamPredict = await call(teammate, `/api/rounds/${round.id}/prediction`, { method: "POST", body: { side: "left" } });
  check(`round ${roundNumber}: the guessing team cannot call left/right`, ownTeamPredict.status === 403, `got ${ownTeamPredict.status}`);

  const side = target < 0.5 ? "left" : "right";
  const revealed = await call(opponent, `/api/rounds/${round.id}/prediction`, { method: "POST", body: { side } });
  check(`round ${roundNumber}: the call reveals the round`, revealed.status === 200, JSON.stringify(revealed.body));
  check(`round ${roundNumber}: the revealed target matches the secret`, revealed.body?.targetCenter === target,
    `${revealed.body?.targetCenter} vs ${target}`);

  // Scoring must match the engine, computed independently here.
  const steps = (n) => Math.round(n * 2000);
  const distance = Math.abs(steps(target) - steps(0.5));
  const expectedActive = distance <= 25 ? 4 : distance <= 75 ? 3 : distance <= 125 ? 2 : 0;
  const expectedBonus = expectedActive === 4 ? 0 : distance === 0 ? 0 : 1;
  check(`round ${roundNumber}: active team scored ${expectedActive}`, revealed.body?.activePoints === expectedActive,
    `got ${revealed.body?.activePoints}`);
  check(`round ${roundNumber}: opponents scored ${expectedBonus}`, revealed.body?.opponentPoints === expectedBonus,
    `got ${revealed.body?.opponentPoints}`);

  const double = await call(opponent, `/api/rounds/${round.id}/prediction`, { method: "POST", body: { side } });
  check(`round ${roundNumber}: the call cannot be made twice`, double.status === 409, `got ${double.status}`);

  // -- everyone can now see the target --
  const after = await call(opponent, `/api/rooms/${roomId}/state`);
  check(`round ${roundNumber}: the target is public after the reveal`, after.body?.round?.revealedTarget === target);

  return { activeTeam, psychicId: psychic.playerId, winner: after.body?.game?.winner ?? null };
}

const first = await playRound(1);

const advanced = await call(others[0], `/api/rooms/${roomId}/next-round`, { method: "POST" });
check("any player can advance the round", advanced.status === 201, JSON.stringify(advanced.body));

const advanceAgain = await call(host, `/api/rooms/${roomId}/next-round`, { method: "POST" });
check("advancing twice is refused", advanceAgain.status === 409, `got ${advanceAgain.status}`);

const second = await playRound(2);
check("the active team alternates", second && first && second.activeTeam !== first.activeTeam,
  `${first?.activeTeam} then ${second?.activeTeam}`);

await call(host, `/api/rooms/${roomId}/next-round`, { method: "POST" });
const third = await playRound(3);
check("the psychic rotates within a team", third && first && third.psychicId !== first.psychicId,
  "same player was psychic twice for one team");

// --- teams are fixed once play begins ---------------------------------------
const lateSwitch = await call(others[0], `/api/rooms/${roomId}/team`, { method: "POST", body: { team: "a" } });
check("teams cannot be switched mid-game", lateSwitch.status === 409, `got ${lateSwitch.status}`);

// --- identity ---------------------------------------------------------------
const stranger = makePlayer("Stranger");
const noSession = await call(stranger, `/api/rooms/${roomId}/state`);
check("no cookie means no access", noSession.status === 401, `got ${noSession.status}`);

stranger.cookies.set(`wl_s_${roomId.slice(0, 8)}`, "not-a-real-token-at-all-0000000000000000000");
const forged = await call(stranger, `/api/rooms/${roomId}/state`);
check("a forged cookie is rejected", forged.status === 401, `got ${forged.status}`);

console.log(`\n${failures === 0 ? "All API assertions passed." : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
