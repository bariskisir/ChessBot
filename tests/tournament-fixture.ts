/** Emulates native arena controls and hard navigation without using a live Chess.com session. */
import "./board-fixture";
interface Configuration { previousId: string | null; searchStarts: boolean; replaceButton: boolean; joinQueues: boolean }
const configuration: Configuration = { previousId: "100", searchStarts: false, replaceButton: true, joinQueues: true };
const clicks: number[] = [];
let cancelClicks = 0;

/** Keeps service calls identical to the HAR's public tournament protocol. */
async function siteRequest(method: "RegisterToTournament" | "NextGame", id: string): Promise<void> {
  await fetch(`/service/tournaments/chesscom.tournaments.v1.TournamentService/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tournamentId: `arena-${id}` }),
  });
}

/** Creates the end-game request button, including DOM replacement during failed attempts. */
function nextButton(row: HTMLElement): void {
  const button = document.createElement("button");
  button.className = "game-over-arena-button-button";
  button.textContent = "Next Arena Game";
  /** Either exposes the site's disabled queue indicator or replaces a failed request button. */
  button.onclick = () => {
    clicks.push(Date.now());
    if (configuration.searchStarts) {
      button.remove();
      const finding = document.createElement("button");
      finding.className = "game-over-arena-button-button game-over-arena-button-finding";
      finding.textContent = "Finding Next Game...";
      finding.disabled = true;
      /** Records an accidental cancellation of successful matchmaking. */
      finding.onclick = () => { cancelClicks++; };
      row.append(finding);
    } else if (configuration.replaceButton) { button.remove(); nextButton(row); }
  };
  row.append(button);
}

/** Resets arena results while preserving the extension's shadow host. */
function setup(update: Partial<Configuration> = {}): void {
  Object.assign(configuration, update);
  clicks.length = 0;
  cancelClicks = 0;
  for (const element of document.querySelectorAll(".fixture-action, .arena-footer-component")) element.remove();
  window.chessbotFixture.setFen("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
  const row = document.createElement("div");
  row.className = "fixture-action game-over-arena-button-component";
  if (configuration.previousId) {
    const link = document.createElement("a");
    link.href = `/play/arena/${configuration.previousId}`;
    link.textContent = "Tournament";
    row.append(link);
  }
  nextButton(row);
  document.body.append(row);
}

/** Shows the native lobby's positive queued state without an actionable Next Game. */
function queued(footer: HTMLElement): void {
  footer.replaceChildren();
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  /** Records an erroneous extension cancellation while leaving the controlled queue intact. */
  cancel.onclick = () => { cancelClicks++; };
  footer.append(cancel);
}

/** Mirrors Join's register-and-search sequence and an already-joined Next Game alternative. */
function lobby(): void {
  const id = location.pathname.split("/").at(-1)!;
  const footer = document.createElement("div"), join = document.createElement("button");
  footer.className = "arena-footer-component";
  join.textContent = "Join";
  /** Registers through the native control before queueing a game as the site does. */
  join.onclick = async () => {
    join.disabled = true;
    await siteRequest("RegisterToTournament", id);
    if (configuration.joinQueues) {
      await siteRequest("NextGame", id);
      queued(footer);
    } else {
      const next = document.createElement("button");
      next.textContent = "Next Game";
      /** Requests a game when joining did not itself create the queue. */
      next.onclick = async () => { await siteRequest("NextGame", id); queued(footer); };
      footer.replaceChildren(next);
    }
  };
  footer.append(join);
  document.body.append(footer);
}

/** Simulates a new assigned game in the current document or across a real navigation. */
function arrive(navigate = true): void {
  if (navigate) { location.assign("/game/200"); return; }
  history.replaceState(null, "", "/game/200");
  for (const element of document.querySelectorAll(".fixture-action, .arena-footer-component")) element.remove();
  window.chessbotFixture.setFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
}

declare global { interface Window { arenaFixture: { setup: typeof setup; arrive: typeof arrive; clicks: typeof clicks; cancelClicks: () => number } } }
window.arenaFixture = { setup, arrive, clicks,
  /** Exposes unintended cancel clicks to browser assertions. */
  cancelClicks: () => cancelClicks };
if (location.pathname.startsWith("/play/arena/")) {
  for (const element of document.querySelectorAll("wc-chess-board, #board-layout-player-bottom, #board-layout-player-top")) element.remove();
  lobby();
} else if (location.pathname === "/game/100") setup();
