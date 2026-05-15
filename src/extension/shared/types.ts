/**
 * Defines shared TypeScript contracts used by the extension scripts.
 */

export type EngineType = "api" | "local";

export type PlayerColor = "w" | "b";

export type MistakeType = "ideal" | "suboptimal";

export type MaybeMistakeType = MistakeType | false;

export interface PanelPosition {
  top: string;
  right?: string;
  left?: string;
}

export interface BotSettings {
  engineType: EngineType;
  depth: number;
  thinkingTime: number;
  autoPlay: boolean;
  autoPlayDelay: number;
  autoNewMatch: boolean;
  autoRematch: boolean;
  panelPos: PanelPosition;
  mistakeProbability: number;
}

export interface EngineAnalysis {
  move?: string;
  eval?: number;
  mate?: number | null;
  error?: string;
}

export interface MistakeResult {
  move: string;
  eval?: number;
  type: MistakeType;
}

export interface MistakeCache {
  fen: string;
  shouldTrigger: boolean;
  isWinning: boolean;
  processed: boolean;
  searching?: boolean;
  result: MistakeResult | null;
}

export interface AnalyzeMessage {
  action: "analyze";
  fen: string;
  depth: number;
  multiPv?: number;
}

export interface AnalyzeLocalMessage {
  action: "analyzeLocal";
  fen: string;
  depth: number;
  id: string;
  multiPv: number;
}

export interface AnalysisResultMessage {
  action: "analysisResult";
  id?: string;
  result: EngineAnalysis | EngineAnalysis[];
}

export interface StopAnalysisMessage {
  action: "stopAnalysis";
}

export interface StartMessage {
  action: "start";
}

export type RuntimeRequest =
  | AnalyzeMessage
  | AnalyzeLocalMessage
  | AnalysisResultMessage
  | StopAnalysisMessage
  | StartMessage;
