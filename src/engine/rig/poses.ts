/**
 * The pose catalog.
 */

export const POSES = {
  single: {
    label: "单腿",
    solo: true,
    legs: [
      {
        x: 0,
      },
      {
        x: 0.092,
        yaw: 6,
      },
    ],
  },
  together: {
    label: "并立",
    legs: [
      {
        x: 0.089,
        yaw: 7,
        roll: -1.2,
      },
      {
        x: 0.089,
        yaw: 4,
        roll: -1,
        pitch: -1.5,
        knee: 3,
      },
    ],
  },
  step: {
    label: "一前一后",
    legs: [
      {
        x: 0.084,
        z: 0.012,
        yaw: 15,
        roll: -4.2,
        pitch: -8,
        knee: 6,
      },
      {
        x: 0.092,
        z: -0.012,
        yaw: 8,
        roll: -0.5,
        pitch: 2.5,
      },
    ],
  },
  crossed: {
    label: "交叉",
    legs: [
      {
        x: 0.1,
        yaw: 12,
        roll: -16,
        pitch: -15,
        knee: 12,
      },
      {
        x: 0.1,
        yaw: 5,
        roll: -6,
        pitch: 3,
      },
    ],
  },
  tiptoe: {
    label: "踮脚",
    legs: [
      {
        x: 0.09,
        yaw: 7,
        roll: -1,
        heel: 38,
      },
      {
        x: 0.09,
        yaw: 5,
        roll: -1,
        pitch: -2,
        knee: 5,
        heel: 33,
      },
    ],
  },
  point: {
    label: "足尖点地",
    legs: [
      {
        x: 0.087,
        yaw: 13,
        roll: -4,
        pitch: -17,
        ankle: 34,
        toe: -24,
        reach: true,
      },
      {
        x: 0.092,
        yaw: 8,
      },
    ],
  },
  pigeon: {
    label: "内八",
    legs: [
      {
        x: 0.094,
        yaw: -20,
        roll: 4.5,
        pitch: -9,
        knee: 15,
      },
      {
        x: 0.095,
        yaw: -17,
        roll: 4.2,
        pitch: -7.5,
        knee: 12,
      },
    ],
  },
};

export const POSE_ORDER = ["single", "together", "step", "crossed", "tiptoe", "point", "pigeon"];

export const DEFAULT_POSE = "step";
