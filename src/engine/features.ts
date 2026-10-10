/**
 * Product switches: features that exist in the code but are turned off for now, to keep the product small.
 * Each one is listed under "Future work" in the spec. Turning one back on is a one-line change here.
 */
export interface Features {
  /** Days off per person or team (vacations). Holidays for everyone are always on. */
  personDaysOff: boolean;
  /** Saving plans as YAML files. JSON is the save format; YAML files can still be opened. */
  yamlExport: boolean;
}

export const FEATURES: Readonly<Features> = {
  personDaysOff: false,
  yamlExport: false,
};
