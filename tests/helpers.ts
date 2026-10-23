import type { RefContext } from "../src/lib/validation/types";

export function loadContextFromScratch(): RefContext {
  return {
    departments: new Map(),
    positions: new Map(),
    positionNames: new Map(),
    persons: new Map(),
    finOwners: new Map(),
    ssnOwners: new Map(),
    employments: new Map(),
    staffing: new Map(),
    invalidKeys: new Map(),
    seen: new Map(),
    staffingUsage: new Map(),
  };
}
