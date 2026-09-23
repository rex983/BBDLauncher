// Canonical list of offices and departments. Every route or component that
// validates or renders these values should import from here — otherwise
// adding a new office means updating N inline copies and missing one is a
// silent bug.
export const OFFICES = ["Harbor", "Marion", "BST", "RnD"] as const;
export const DEPARTMENTS = ["SALES TEAM", "BST", "RnD"] as const;

export const VALID_OFFICES: ReadonlySet<string> = new Set(OFFICES);
export const VALID_DEPARTMENTS: ReadonlySet<string> = new Set(DEPARTMENTS);
