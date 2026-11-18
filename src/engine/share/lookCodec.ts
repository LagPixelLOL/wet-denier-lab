/**
 * Share links: #look=1~<pose>~<scene>~<backdrop>~<leg0>~<leg1>, each leg is
 * length.cuff.garter.material.denier.pattern.color.secret.wetColor (hex colors written as x + 6 hex digits).
 */
import { COLORS } from "../catalog/colors";
import { CUFF_STYLES, DENIER_OPTIONS, MATERIALS, PATTERNS, SECRET_DECALS, STOCKING_LENGTHS } from "../catalog/garments";
import { withLegDefaults } from "../catalog/presets";
import { POSES } from "../rig/poses";
import { BACKDROPS, SCENES } from "../stage/scenes";

const SITE_URL = "https://newtonquan-yusi.pages.dev/";

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

const PACKED_HEX_RE = /^x[0-9a-f]{6}$/i;

const packColor = (color) => (HEX_COLOR_RE.test(color) ? "x" + color.slice(1).toLowerCase() : color);

const unpackColor = (token, palette) =>
  PACKED_HEX_RE.test(token) ? "#" + token.slice(1).toLowerCase() : palette[token] ? token : null;

const packLegSpec = (spec) =>
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
  ].join(".");

function unpackLegSpec(packed) {
  const [length, cuff, garter, material, denier, pattern, color, secret, wetColor] = String(packed || "").split(".");
  const spec = {};
  if (STOCKING_LENGTHS[length]) {
    spec.length = length;
  }
  if (CUFF_STYLES[cuff]) {
    spec.cuff = cuff;
  }
  spec.garter = garter === "1";
  if (MATERIALS[material]) {
    spec.material = material;
  }
  if (DENIER_OPTIONS.includes(Number(denier))) {
    spec.denier = Number(denier);
  }
  if (PATTERNS[pattern]) {
    spec.pattern = pattern;
  }
  if (unpackColor(color || "", COLORS)) {
    spec.color = unpackColor(color, COLORS);
  }
  if (SECRET_DECALS[secret]) {
    spec.secret = secret;
  }
  spec.wetColor = wetColor && wetColor !== "-" ? unpackColor(wetColor, COLORS) : null;
  return withLegDefaults(spec);
}

function packLook(look) {
  return (
    "look=" +
    ["1", look.pose, look.scene, packColor(look.backdrop), packLegSpec(look.legs[0]), packLegSpec(look.legs[1])].join(
      "~",
    )
  );
}

export function unpackLook(hash) {
  const match = /(?:^|[#&])look=([^&]*)/.exec(String(hash || ""));
  if (!match) {
    return null;
  }
  let payload = match[1];
  try {
    payload = decodeURIComponent(payload);
  } catch {}
  const [version, pose, scene, backdrop, leftLeg, rightLeg] = payload.split("~");
  if (version !== "1") {
    return null;
  }
  const look = {
    legs: [unpackLegSpec(leftLeg), unpackLegSpec(rightLeg === undefined ? leftLeg : rightLeg)],
  };
  if (POSES[pose]) {
    look.pose = pose;
  }
  if (SCENES[scene]) {
    look.scene = scene;
  }
  if (unpackColor(backdrop || "", BACKDROPS)) {
    look.backdrop = unpackColor(backdrop, BACKDROPS);
  }
  return look;
}

export const lookUrl = (look) => SITE_URL + "#" + packLook(look);
