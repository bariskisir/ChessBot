/**
 * Hosts the Stockfish WASM worker inside a Chrome offscreen document.
 */
import type { AnalyzeLocalMessage, EngineAnalysis, RuntimeRequest } from "../shared/types";

interface ActiveRequestData {
  multiPvInfo: string[];
}

let stockfishWorker: Worker | null = null;
let lastLocalEval = "";
let activeRequestId: string | null = null;
let activeResolver: ((result: EngineAnalysis | EngineAnalysis[]) => void) | null = null;
let activeRejecter: ((error: Error) => void) | null = null;
let activeRequestData: ActiveRequestData = { multiPvInfo: [] };
let readyResolver: (() => void) | null = null;

/**
 * Rejects any active analysis and tells Stockfish to stop searching.
 */
function stopCurrentAnalysis(): void {
  stockfishWorker?.postMessage("stop");
  activeRejecter?.(new Error("Interrupted by new request or stop command"));
  cleanupRequest();
}

/**
 * Clears the current request bookkeeping.
 */
function cleanupRequest(): void {
  activeResolver = null;
  activeRejecter = null;
  activeRequestId = null;
  activeRequestData = { multiPvInfo: [] };
}

/**
 * Parses a Stockfish info line into a structured engine result.
 */
function parseInfoLine(line: string, fallbackMove: string): EngineAnalysis {
  const moveMatch = line.match(/ pv (\w+)/);
  const evalMatch = line.match(/cp (-?\d+)/);
  const mateMatch = line.match(/mate (-?\d+)/);
  const move = moveMatch?.[1] ?? fallbackMove;

  if (mateMatch?.[1]) {
    const mate = Number.parseInt(mateMatch[1], 10);
    return { move, eval: mate, mate };
  }

  if (evalMatch?.[1]) {
    return {
      move,
      eval: Number.parseInt(evalMatch[1], 10) / 100,
      mate: null,
    };
  }

  return { move, eval: 0, mate: null };
}

/**
 * Resolves the active request when Stockfish reports a best move.
 */
function resolveAnalysis(bestMove: string): void {
  if (!activeResolver) {
    return;
  }

  const lines = activeRequestData.multiPvInfo.length > 0 ? activeRequestData.multiPvInfo : [lastLocalEval];
  const results = lines.filter(Boolean).map((line) => parseInfoLine(line, bestMove));

  if (results.length > 1) {
    activeResolver(results);
  } else {
    activeResolver(results[0] ?? { move: bestMove, eval: 0, mate: null });
  }

  cleanupRequest();
}

/**
 * Records the latest principal variation line from Stockfish.
 */
function recordInfoLine(line: string): void {
  const multiPvMatch = line.match(/ multipv (\d+) /);
  const pvIndex = multiPvMatch?.[1] ? Number.parseInt(multiPvMatch[1], 10) : 1;
  activeRequestData.multiPvInfo[pvIndex - 1] = line;

  if (pvIndex === 1) {
    lastLocalEval = line;
  }
}

/**
 * Handles raw Stockfish worker messages.
 */
function handleWorkerMessage(event: MessageEvent<string>): void {
  const line = event.data;

  if (line.startsWith("bestmove")) {
    resolveAnalysis(line.split(" ")[1] ?? "");
    return;
  }

  if (line.startsWith("info") && line.includes(" score ") && line.includes(" pv ")) {
    recordInfoLine(line);
    return;
  }

  if (line === "readyok" && readyResolver) {
    readyResolver();
    readyResolver = null;
  }
}

/**
 * Handles Stockfish worker failures and rejects the active request.
 */
function handleWorkerError(error: ErrorEvent): void {
  activeRejecter?.(new Error(`Worker Error: ${error.message}`));
  cleanupRequest();
}

/**
 * Creates the Stockfish web worker on first use.
 */
function initWorker(): void {
  stockfishWorker = new Worker("stockfish.js");
  stockfishWorker.onmessage = handleWorkerMessage;
  stockfishWorker.onerror = handleWorkerError;
  stockfishWorker.postMessage("uci");
}

/**
 * Waits for Stockfish readiness with a short timeout fallback.
 */
function waitReady(): Promise<void> {
  return new Promise((resolve) => {
    if (!stockfishWorker) {
      resolve();
      return;
    }

    readyResolver = resolve;
    stockfishWorker.postMessage("isready");

    globalThis.setTimeout(() => {
      if (readyResolver) {
        readyResolver();
        readyResolver = null;
      }
    }, 2000);
  });
}

/**
 * Sends a UCI analysis request to Stockfish and resolves when bestmove arrives.
 */
async function analyzeWithStockfish(
  fen: string,
  depth: number,
  id: string,
  multiPv = 1,
): Promise<EngineAnalysis | EngineAnalysis[]> {
  stopCurrentAnalysis();

  return new Promise((resolve, reject) => {
    /** Starts the asynchronous Stockfish command sequence for the request. */
    const run = async (): Promise<void> => {
      try {
        if (!stockfishWorker) {
          initWorker();
        }

        activeRequestId = id;
        activeResolver = resolve;
        activeRejecter = reject;
        lastLocalEval = "";
        activeRequestData = { multiPvInfo: [] };

        await waitReady();
        stockfishWorker?.postMessage("ucinewgame");
        await waitReady();
        stockfishWorker?.postMessage(`setoption name MultiPV value ${multiPv}`);
        await waitReady();
        stockfishWorker?.postMessage(`position fen ${fen}`);
        stockfishWorker?.postMessage(`go depth ${depth}`);

        globalThis.setTimeout(() => {
          if (activeRequestId === id && activeRejecter) {
            activeRejecter(new Error("Analysis timeout (20s)"));
            cleanupRequest();
          }
        }, 20_000);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    void run();
  });
}

/**
 * Handles local-analysis messages from the background service worker.
 */
function handleAnalyzeLocal(request: AnalyzeLocalMessage): void {
  analyzeWithStockfish(request.fen, request.depth, request.id, request.multiPv)
    .then((result) => {
      void chrome.runtime.sendMessage({
        action: "analysisResult",
        result,
        id: request.id,
      });
    })
    .catch((error: Error) => {
      void chrome.runtime.sendMessage({
        action: "analysisResult",
        result: { error: error.message },
        id: request.id,
      });
    });
}

/**
 * Handles messages received inside the offscreen document.
 */
function handleRuntimeMessage(request: RuntimeRequest): void {
  if (request.action === "analyzeLocal") {
    handleAnalyzeLocal(request);
    return;
  }

  if (request.action === "stopAnalysis") {
    stopCurrentAnalysis();
  }
}

chrome.runtime.onMessage.addListener(handleRuntimeMessage);
