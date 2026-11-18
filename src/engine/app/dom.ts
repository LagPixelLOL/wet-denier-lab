/**
 * DOM helpers.
 */

export const $ = <E extends Element = HTMLElement>(sel: string): E | null => document.querySelector<E>(sel);
