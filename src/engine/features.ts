/**
 * Product switches: features that exist in the code but are turned off for now, to keep the product small.
 * Each one is listed under "Future work" in the spec. Turning one back on is a one-line change here.
 */
export interface Features {
  /** Days off per person or team (vacations). Holidays for everyone are always on. */
  personDaysOff: boolean;
  /** Saving plans as YAML files. JSON is the save format; YAML files can still be opened. */
  yamlExport: boolean;
  /**
   * Money at stake per item (`value`, `currency`): "€ at risk", the "postpone the lowest-value item" suggestion and
   * a ranking tie-break. While off, values are dropped at validation, so they can't influence anything.
   */
  itemValue: boolean;
  /** Undo and redo buttons in the top bar. While off, ⌘/Ctrl Z and ⇧⌘Z (Ctrl Y) still undo and redo. */
  undoButtons: boolean;
  /** The .ics calendar export in the Export menu (the code stays; the menu stays short). */
  exportIcs: boolean;
  /** The .svg vector image in the Export menu (PNG stays; the SVG renderer still draws the PNG). */
  exportSvg: boolean;
}

export const FEATURES: Readonly<Features> = {
  personDaysOff: false,
  yamlExport: false,
  itemValue: false,
  undoButtons: false,
  exportIcs: false,
  exportSvg: false,
};
