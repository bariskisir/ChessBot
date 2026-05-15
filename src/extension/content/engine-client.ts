/**
 * Sends positions to remote or local chess engines and normalizes their responses.
 */
import type { BotSettings, EngineAnalysis } from "../shared/types";

/**
 * Requests analysis from the public chess-api.com endpoint.
 */
async function askRemoteEngine(fen: string, depth: number): Promise<EngineAnalysis> {
  const response = await fetch("https://chess-api.com/v1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fen, depth }),
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return (await response.json()) as EngineAnalysis;
}

/**
 * Flips local engine scores so they are consistently reported from White's perspective.
 */
function normalizeLocalPerspective(fen: string, response: EngineAnalysis | EngineAnalysis[]): EngineAnalysis | EngineAnalysis[] {
  const turn = fen.split(" ")[1] ?? "w";

  if (turn !== "b") {
    return response;
  }

  const normalize = (analysis: EngineAnalysis): EngineAnalysis => ({
    ...analysis,
    ...(analysis.eval === undefined ? {} : { eval: -analysis.eval }),
    ...(analysis.mate === null || analysis.mate === undefined ? {} : { mate: -analysis.mate }),
  });

  return Array.isArray(response) ? response.map(normalize) : normalize(response);
}

/**
 * Requests analysis from the local Stockfish offscreen document.
 */
export async function askLocalStockfish(
  fen: string,
  depth: number,
  multiPv = 1,
): Promise<EngineAnalysis | EngineAnalysis[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "analyze",
        fen,
        depth,
        multiPv,
      },
      (response: EngineAnalysis | EngineAnalysis[] | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response) {
          reject(new Error("Empty engine response"));
          return;
        }

        if (!Array.isArray(response) && response.error) {
          reject(new Error(response.error));
          return;
        }

        resolve(normalizeLocalPerspective(fen, response));
      },
    );
  });
}

/**
 * Requests the best move from the selected engine.
 */
export async function analyzePosition(fen: string, settings: BotSettings): Promise<EngineAnalysis> {
  if (settings.engineType === "api") {
    return askRemoteEngine(fen, settings.depth);
  }

  const result = await askLocalStockfish(fen, settings.depth);
  return Array.isArray(result) ? (result[0] ?? { error: "No move found" }) : result;
}

/**
 * Sends a stop command to the background script and local Stockfish host.
 */
export function stopAnalysis(): void {
  chrome.runtime.sendMessage({ action: "stopAnalysis" });
}
