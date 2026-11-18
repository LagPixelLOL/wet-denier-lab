/**
 * Wardrobe and scene sheets.
 */
import { COLORS, COLOR_ORDER } from "../catalog/colors";
import {
  CUFF_STYLES,
  CUFF_STYLE_ORDER,
  DENIER_OPTIONS,
  MATERIALS,
  MATERIAL_ORDER,
  PATTERNS,
  PATTERN_ORDER,
  SECRET_DECALS,
  SECRET_DECAL_ORDER,
  STOCKING_LENGTHS,
  STOCKING_LENGTH_ORDER,
} from "../catalog/garments";
import { PRESETS } from "../catalog/presets";
import { POSES, POSE_ORDER } from "../rig/poses";
import { BACKDROPS, BACKDROP_ORDER, SCENES, SCENE_ORDER } from "../stage/scenes";

const WARDROBE_TABS = [
  ["pose", "姿势"],
  ["preset", "套装"],
  ["style", "款式"],
  ["color", "颜色"],
  ["material", "材质"],
  ["pattern", "花纹"],
  ["fun", "彩蛋"],
];

const WET_COLOR_OPTIONS = [
  ["", "不变"],
  ["sakura", "变樱粉"],
  ["mist", "变雾蓝"],
  ["taro", "变香芋紫"],
  ["cherry", "变正红"],
];

export const THUMB_SIZE = {
  w: 180,
  h: 240,
};

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") {
      node.textContent = value;
    } else if (key === "class") {
      node.className = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
};

const chipGroup = (key, options, extraClass = "") =>
  el(
    "div",
    {
      class: "chips " + extraClass,
      "data-key": key,
    },
    options.map(([value, label, attrs = {}]) =>
      el("button", {
        "data-v": value,
        text: label,
        ...attrs,
      }),
    ),
  );

const labeledRow = (label, control) =>
  el(
    "div",
    {
      class: "row",
    },
    [
      el("span", {
        class: "label",
        text: label,
      }),
      control,
    ],
  );

function cardGrid(key, items) {
  const canvases = [];
  return {
    box: el(
      "div",
      {
        class: "cards",
        "data-key": key,
      },
      items.map(([value, label]) => {
        const canvas = el("canvas", {
          width: THUMB_SIZE.w,
          height: THUMB_SIZE.h,
          "aria-hidden": "true",
        });
        canvases.push(canvas);
        return el(
          "button",
          {
            class: "card",
            "data-v": value,
          },
          [
            canvas,
            el("span", {
              text: label,
            }),
          ],
        );
      }),
    ),
    canvases: canvases,
  };
}

const customColorSwatch = (label) =>
  el(
    "label",
    {
      class: "swatch custom",
      title: label,
      "aria-label": label,
    },
    [
      el("input", {
        type: "color",
        value: "#7fb9c9",
      }),
    ],
  );

export function buildWardrobeSheet(root, api) {
  root.textContent = "";
  const tabBar = el(
    "div",
    {
      class: "tabs",
      role: "tablist",
      "aria-label": "衣橱分类",
    },
    WARDROBE_TABS.map(([id, label], index) =>
      el("button", {
        role: "tab",
        "data-tab": id,
        "aria-selected": String(index === 0),
        text: label,
      }),
    ),
  );
  const materialHint = el("p", {
    class: "pane-hint",
  });
  const customColor = customColorSwatch("自选颜色");
  const colorChips = chipGroup(
    "color",
    COLOR_ORDER.map((colorKey) => [
      colorKey,
      "",
      {
        class: "swatch",
        style: "--c:" + COLORS[colorKey].dye,
        "aria-label": COLORS[colorKey].label,
        title: COLORS[colorKey].label,
      },
    ]),
    "swatches",
  );
  colorChips.append(customColor);
  const presetCards = cardGrid(
    "preset",
    PRESETS.map((preset, index) => [String(index), preset.name]),
  );
  const paneContent = {
    pose: [
      chipGroup(
        "pose",
        POSE_ORDER.map((poseKey) => [poseKey, POSES[poseKey].label]),
      ),
      el("p", {
        class: "pane-hint keys",
        text: "键盘数字键 1 到 7 也能换姿势。",
      }),
    ],
    preset: [presetCards.box],
    style: [
      labeledRow(
        "长度",
        chipGroup(
          "length",
          STOCKING_LENGTH_ORDER.map((lengthKey) => [lengthKey, STOCKING_LENGTHS[lengthKey].label]),
        ),
      ),
      labeledRow(
        "袜口",
        chipGroup(
          "cuff",
          CUFF_STYLE_ORDER.map((cuffKey) => [cuffKey, CUFF_STYLES[cuffKey].label]),
        ),
      ),
      labeledRow(
        "吊带",
        chipGroup("garter", [
          ["0", "不要"],
          ["1", "要（大腿袜）"],
        ]),
      ),
    ],
    color: [colorChips],
    material: [
      labeledRow(
        "材质",
        chipGroup(
          "material",
          MATERIAL_ORDER.map((materialKey) => [materialKey, MATERIALS[materialKey].label]),
        ),
      ),
      labeledRow(
        "厚度",
        chipGroup(
          "denier",
          DENIER_OPTIONS.map((denier) => [String(denier), denier + "D"]),
        ),
      ),
      materialHint,
    ],
    pattern: [
      chipGroup(
        "pattern",
        PATTERN_ORDER.map((patternKey) => [patternKey, PATTERNS[patternKey].label]),
      ),
    ],
    fun: [
      labeledRow(
        "显形",
        chipGroup(
          "secret",
          SECRET_DECAL_ORDER.map((secretKey) => [
            secretKey,
            secretKey === "none" ? "无" : "藏" + SECRET_DECALS[secretKey].label,
          ]),
        ),
      ),
      labeledRow("变色", chipGroup("wetColor", WET_COLOR_OPTIONS)),
      el("p", {
        class: "pane-hint",
        text: "平时看不出来，泼上水才显出来。选好以后往腿上泼水试试。",
      }),
    ],
  };
  const panes = el(
    "div",
    {
      class: "panes",
    },
    WARDROBE_TABS.map(([id], index) => {
      const pane = el(
        "div",
        {
          class: "pane",
          "data-pane": id,
          role: "tabpanel",
        },
        paneContent[id],
      );
      pane.hidden = index !== 0;
      return pane;
    }),
  );
  const targetSeg = el(
    "div",
    {
      class: "seg",
      "data-key": "target",
      role: "radiogroup",
      "aria-label": "穿在哪条腿上",
    },
    [
      ["-1", "双腿"],
      ["0", "左腿"],
      ["1", "右腿"],
    ].map(([value, label]) =>
      el("button", {
        "data-v": value,
        role: "radio",
        text: label,
      }),
    ),
  );
  const randomBtn = el("button", {
    id: "randomBtn",
    class: "pill",
    text: "随机一双",
  });
  const shareBtn = el("button", {
    id: "shareBtn",
    class: "pill",
    text: "复制链接",
    title: "把这一双连同姿势和场景生成一个链接",
  });
  const footer = el(
    "div",
    {
      class: "sheet-foot",
    },
    [
      targetSeg,
      el(
        "div",
        {
          class: "foot-actions",
        },
        [randomBtn, shareBtn],
      ),
    ],
  );
  root.append(tabBar, panes, footer);
  let currentTab = WARDROBE_TABS[0][0];
  function showTab(tab) {
    currentTab = tab;
    for (const tabBtn of tabBar.children) {
      tabBtn.setAttribute("aria-selected", String(tabBtn.dataset.tab === tab));
    }
    for (const pane of panes.children) {
      pane.hidden = pane.dataset.pane !== tab;
    }
    footer.classList.toggle("no-target", tab === "pose" || api.solo());
    const selected = tabBar.querySelector('[aria-selected="true"]');
    if (selected && selected.scrollIntoView) {
      selected.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
    if (api.tabShown) {
      api.tabShown(tab);
    }
  }
  tabBar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) {
      showTab(btn.dataset.tab);
    }
  });
  function sync() {
    const spec = api.spec();
    const current = {
      pose: api.poseName(),
      length: spec.length,
      cuff: spec.cuff,
      garter: spec.garter ? "1" : "0",
      color: spec.color,
      material: spec.material,
      denier: String(spec.denier),
      pattern: spec.pattern,
      secret: spec.secret,
      wetColor: spec.wetColor || "",
      target: String(api.solo() ? -1 : api.targetLeg()),
    };
    for (const group of root.querySelectorAll("[data-key]")) {
      const value = current[group.dataset.key];
      for (const btn of group.querySelectorAll("button")) {
        const isOn = value !== undefined && btn.dataset.v === value;
        btn.classList.toggle("on", isOn);
        if (btn.getAttribute("role") === "radio") {
          btn.setAttribute("aria-checked", String(isOn));
        }
      }
    }
    footer.classList.toggle("no-target", currentTab === "pose" || api.solo());
    customColor.classList.toggle("on", !COLORS[spec.color]);
    if (!COLORS[spec.color]) {
      customColor.style.setProperty("--c", spec.color);
    }
    const mat = MATERIALS[spec.material];
    materialHint.textContent = mat.label + "：" + mat.hint + (mat.minDenier ? "。这种料子不透，厚度不起作用。" : "。");
    panes.querySelector('[data-key="denier"]').classList.toggle("idle", mat.minDenier > 0);
    panes.querySelector('[data-key="garter"]').classList.toggle("idle", spec.length !== "thigh");
    panes.querySelector('[data-key="cuff"]').classList.toggle("idle", spec.length === "tights");
  }
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    const group = btn && btn.closest("[data-key]");
    if (!group) {
      if (btn === randomBtn) {
        api.random();
        sync();
      } else if (btn === shareBtn) {
        api.share();
      }
      return;
    }
    const key = group.dataset.key;
    const value = btn.dataset.v;
    if (key === "pose") {
      api.pose(value);
    } else if (key === "preset") {
      api.preset(Number(value));
    } else if (key === "target") {
      api.target(Number(value));
    } else if (key === "denier") {
      api.wear({
        denier: Number(value),
      });
    } else if (key === "garter") {
      api.wear(
        value === "1"
          ? {
              garter: true,
              length: "thigh",
            }
          : {
              garter: false,
            },
      );
    } else if (key === "wetColor") {
      api.wear({
        wetColor: value || null,
      });
    } else {
      api.wear({
        [key]: value,
      });
    }
    sync();
  });
  customColor.querySelector("input").addEventListener("input", (e) => {
    api.wear({
      color: e.target.value,
    });
    sync();
  });
  presetCards.box.addEventListener("pointerover", (e) => {
    const card = e.target.closest(".card");
    if (card && e.pointerType === "mouse" && api.preview) {
      api.preview(Number(card.dataset.v));
    }
  });
  presetCards.box.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && api.preview) {
      api.preview(null);
    }
  });
  sync();
  return {
    sync: sync,
    showTab: showTab,
    presetCanvases: presetCards.canvases,
    get tab() {
      return currentTab;
    },
  };
}

export function buildSceneSheet(root, api) {
  root.textContent = "";
  const sceneHint = el("p", {
    class: "pane-hint",
  });
  const sceneCards = cardGrid(
    "scene",
    SCENE_ORDER.map((sceneKey) => [sceneKey, SCENES[sceneKey].label]),
  );
  const canvasByScene = {};
  SCENE_ORDER.forEach((sceneKey, index) => {
    canvasByScene[sceneKey] = sceneCards.canvases[index];
  });
  const customBackdrop = customColorSwatch("自选底色");
  const backdropChips = chipGroup(
    "backdrop",
    BACKDROP_ORDER.map((backdropKey) => [
      backdropKey,
      "",
      {
        class: "swatch",
        style: "--c:" + BACKDROPS[backdropKey].bottom,
        "aria-label": BACKDROPS[backdropKey].label,
        title: BACKDROPS[backdropKey].label,
      },
    ]),
    "swatches",
  );
  backdropChips.append(customBackdrop);
  const backdropRow = labeledRow("底色", backdropChips);
  root.append(sceneCards.box, backdropRow, sceneHint);
  const sceneHints = {
    studio: "影棚：干净的纸背景，底色可以换，适合拍照。",
    bath: "浴室：「细雨」在这里是头顶的花洒，湿地砖会映出腿的倒影。",
    street: "夜雨街头：这里一直下着雨，霓虹的光勾在丝袜上，也映在路面上。",
    pool: "泳池边：太阳底下，水面的波光会晃到腿上。",
  };
  function sync() {
    const sceneName = api.sceneName();
    const backdropName = api.backdropName();
    for (const card of sceneCards.box.children) {
      card.classList.toggle("on", card.dataset.v === sceneName);
    }
    for (const btn of backdropChips.querySelectorAll("button")) {
      btn.classList.toggle("on", btn.dataset.v === backdropName);
    }
    customBackdrop.classList.toggle("on", !BACKDROPS[backdropName]);
    if (!BACKDROPS[backdropName]) {
      customBackdrop.style.setProperty("--c", backdropName);
    }
    backdropRow.hidden = sceneName !== "studio";
    sceneHint.textContent = sceneHints[sceneName] || "";
  }
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    const group = btn && btn.closest("[data-key]");
    if (group) {
      if (group.dataset.key === "scene") {
        api.scene(btn.dataset.v);
      } else {
        api.backdrop(btn.dataset.v);
      }
      sync();
    }
  });
  customBackdrop.querySelector("input").addEventListener("input", (e) => {
    api.backdrop(e.target.value);
    sync();
  });
  sync();
  return {
    sync: sync,
    canvases: canvasByScene,
  };
}
