/**
 * Share links: #look=1~<pose>~<scene>~<backdrop>~<leg0>~<leg1>[~<view>], each leg is
 * length.cuff.garter.material.denier.pattern.color.secret.wetColor[.toe] (hex colors written as x + 6 hex
 * digits; toe is 0 for a toe without reinforcement and is left out otherwise).
 * The optional view is the camera as yaw,pitch,dist,targetX,targetY,targetZ.
 */
import { COLORS } from "../catalog/colors";
import { CUFF_STYLES, DENIER_OPTIONS, MATERIALS, PATTERNS, SECRET_DECALS, STOCKING_LENGTHS } from "../catalog/garments";
import type { CuffStyleKey, MaterialKey, PatternKey, SecretDecalKey, StockingLengthKey } from "../catalog/garments";
import { withLegDefaults } from "../catalog/presets";
import type { LegSpec } from "../catalog/presets";
import { POSES } from "../rig/poses";
import { BACKDROPS, SCENES } from "../stage/scenes";

/** Orbit camera: angles in radians, distance and target in scene units. */
export interface CameraView {
  yaw: number;
  pitch: number;
  dist: number;
  target: readonly [number, number, number];
}

/** Everything a share link encodes. */
export interface Look {
  pose: string;
  scene: string;
  /** Backdrop key or custom "#rrggbb". */
  backdrop: string;
  /** [left, right] */
  legs: readonly LegSpec[];
  view?: CameraView;
}

/** A decoded share link; keys that failed validation are omitted. */
export interface SharedLook {
  pose?: string;
  scene?: string;
  backdrop?: string;
  legs: [LegSpec, LegSpec];
  view?: CameraView;
}

/** Truthiness lookup by arbitrary string key. */
type Lookup = Readonly<Record<string, unknown>>;

/** Own-key lookup, so names like "constructor" or "toString" from a link are not mistaken for entries. */
const has = (table: Lookup, key: string | undefined): key is string => key !== undefined && Object.hasOwn(table, key);

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

const PACKED_HEX_RE = /^x[0-9a-f]{6}$/i;

const packColor = (color: string): string => (HEX_COLOR_RE.test(color) ? "x" + color.slice(1).toLowerCase() : color);

const unpackColor = (token: string, palette: Lookup): string | null =>
  PACKED_HEX_RE.test(token) ? "#" + token.slice(1).toLowerCase() : has(palette, token) ? token : null;

const packLegSpec = (spec: LegSpec): string =>
  [
    spec.length,
    spec.cuff,
    spec.garter ? 1 : 0,
    spec.material,
    spec.denier,
    spec.pattern,
    packColor(spec.color),
    spec.secret,
    spec.wetColor ? packColor(spec.wetColor) : "-",
    ...(spec.toe ? [] : [0]),
  ].join(".");

function unpackLegSpec(packed: string | undefined): LegSpec {
  const [length, cuff, garter, material, denier, pattern, color, secret, wetColor, toe] = String(packed || "").split(
    ".",
  );
  const spec: Partial<LegSpec> = {};
  if (has(STOCKING_LENGTHS, length)) {
    spec.length = length as StockingLengthKey;
  }
  if (has(CUFF_STYLES, cuff)) {
    spec.cuff = cuff as CuffStyleKey;
  }
  spec.garter = garter === "1";
  spec.toe = toe !== "0";
  if (has(MATERIALS, material)) {
    spec.material = material as MaterialKey;
  }
  if (DENIER_OPTIONS.includes(Number(denier))) {
    spec.denier = Number(denier);
  }
  if (has(PATTERNS, pattern)) {
    spec.pattern = pattern as PatternKey;
  }
  if (unpackColor(color || "", COLORS)) {
    spec.color = unpackColor(color, COLORS)!;
  }
  if (has(SECRET_DECALS, secret)) {
    spec.secret = secret as SecretDecalKey;
  }
  spec.wetColor = wetColor && wetColor !== "-" ? unpackColor(wetColor, COLORS) : null;
  return withLegDefaults(spec);
}

/** Rounds to 3 decimals and prints without trailing zeros ("-0" becomes "0"). */
const packNumber = (value: number): string => String(Math.round(value * 1000) / 1000 || 0);

/** The yaw is wrapped to [-pi, pi) so links stay short however far the camera was spun. */
const packView = (view: CameraView): string =>
  [view.yaw - Math.PI * 2 * Math.floor((view.yaw + Math.PI) / (Math.PI * 2)), view.pitch, view.dist, ...view.target]
    .map(packNumber)
    .join(",");

function unpackView(packed: string | undefined): CameraView | undefined {
  const parts = String(packed || "").split(",");
  const values = parts.map((part) => (part.trim() === "" ? NaN : Number(part)));
  if (values.length !== 6 || !values.every(Number.isFinite)) {
    return undefined;
  }
  const [yaw, pitch, dist, x, y, z] = values;
  return { yaw, pitch, dist, target: [x, y, z] };
}

function packLook(look: Look): string {
  const fields = [
    "1",
    look.pose,
    look.scene,
    packColor(look.backdrop),
    packLegSpec(look.legs[0]),
    packLegSpec(look.legs[1]),
  ];
  if (look.view) {
    fields.push(packView(look.view));
  }
  return "look=" + fields.join("~");
}

/** Parses a "#look=..." hash; returns null when absent or of an unknown version. */
export function unpackLook(hash: string | null | undefined): SharedLook | null {
  const match = /(?:^|[#&])look=([^&]*)/.exec(String(hash || ""));
  if (!match) {
    return null;
  }
  let payload = match[1];
  try {
    payload = decodeURIComponent(payload);
  } catch {}
  const [version, pose, scene, backdrop, leftLeg, rightLeg, view] = payload.split("~");
  if (version !== "1") {
    return null;
  }
  const look: SharedLook = {
    legs: [unpackLegSpec(leftLeg), unpackLegSpec(rightLeg === undefined ? leftLeg : rightLeg)],
  };
  if (has(POSES, pose)) {
    look.pose = pose;
  }
  if (has(SCENES, scene)) {
    look.scene = scene;
  }
  if (unpackColor(backdrop || "", BACKDROPS)) {
    look.backdrop = unpackColor(backdrop, BACKDROPS)!;
  }
  const camera = unpackView(view);
  if (camera) {
    look.view = camera;
  }
  return look;
}

/** Share link for `look` on the page at `pageUrl`; any existing hash is replaced. */
export const lookUrl = (look: Look, pageUrl: string): string => pageUrl.split("#")[0] + "#" + packLook(look);
