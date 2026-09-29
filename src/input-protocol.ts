/** Defines the trusted-input messages shared by content scripts and the service worker. */
export interface InputPoint { x: number; y: number }
export type InputGesture = { kind: "click"; point: InputPoint } | { kind: "drag"; points: InputPoint[]; interval: number };
export type InputRequest = { target: "lichess-input"; action: "play"; id: string; gesture: InputGesture } |
  { target: "lichess-input"; action: "cancel"; id: string };
export type InputResponse = { ok: true } | { error: string };

/** Rejects malformed points before they reach Chrome's debugger API. */
function validPoint(value: unknown, width: number, height: number): value is InputPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<InputPoint>;
  return typeof point.x === "number" && typeof point.y === "number" && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
}

/** Validates untyped extension messages rather than trusting a TypeScript assertion. */
export function validGesture(value: unknown, width: number, height: number): value is InputGesture {
  if (!value || typeof value !== "object") return false;
  const gesture = value as Partial<InputGesture>;
  if (gesture.kind === "click") return validPoint(gesture.point, width, height);
  return gesture.kind === "drag" && Array.isArray(gesture.points) && gesture.points.length >= 2 && gesture.points.length <= 12 &&
    typeof gesture.interval === "number" && Number.isFinite(gesture.interval) && gesture.interval >= 0 && gesture.interval <= 50 &&
    gesture.points.every(
      /** Keeps every point within the sender's viewport. */
      (point) => validPoint(point, width, height));
}
