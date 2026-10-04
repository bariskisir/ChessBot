/** Catalogues bundled engines and the provenance of their reference ratings. */
export type EngineId = "lozza-2" | "lozza-5" | "stockfish-10" | "stockfish-19";
export interface EngineDefinition {
  id: EngineId; name: string; worker: string; identity: RegExp;
  elo: number; ratingNote: string; interruptible: boolean; verificationDepth: number;
}

export const ENGINES: readonly EngineDefinition[] = [
  { id: "lozza-2", name: "Lozza 2", worker: "lozza-worker.js?engine=lozza-2", identity: /^id name Lozza 2\.0(?:\s|$)/,
    elo: 2554, ratingNote: "CCRL Blitz reference: 2554. Browser strength depends on depth and available time.", interruptible: false, verificationDepth: 0 },
  { id: "lozza-5", name: "Lozza 5", worker: "lozza-worker.js?engine=lozza-5", identity: /^id name Lozza 5(?:\s|$)/,
    elo: 3071, ratingNote: "CCRL Blitz reference: 3071. Browser strength depends on depth and available time.", interruptible: false, verificationDepth: 0 },
  { id: "stockfish-10", name: "Stockfish 10", worker: "stockfish-10/stockfish.js", identity: /^id name Stockfish(?:\.js)? 10(?:\s|$)/,
    elo: 3447, ratingNote: "CCRL 40/15 native reference: 3447 (2024-11-16). The WASM build has no separate verified rating or Lite edition.", interruptible: true, verificationDepth: 15 },
  { id: "stockfish-19", name: "Stockfish 19 Lite", worker: "stockfish.js", identity: /^id name Stockfish 19(?:\s|$)/,
    elo: 3792, ratingNote: "Full Stockfish 19 CCRL Blitz reference: 3792. This Lite build uses a smaller network and has no separate verified rating.", interruptible: true, verificationDepth: 15 },
];

/** Keeps displayed evaluations and move-safety checks on one bundled Stockfish scale. */
export const EVALUATION_ENGINE = getEngine("stockfish-19");

/** Resolves persisted identifiers only to a bundled engine, defaulting to Lozza 2. */
export function getEngine(value: unknown): EngineDefinition {
  return ENGINES.find(
    /** Matches a fixed catalogue entry without accepting a worker URL from storage. */
    (engine) => engine.id === value) ?? ENGINES[0]!;
}
