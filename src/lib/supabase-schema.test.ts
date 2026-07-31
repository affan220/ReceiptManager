import { describe, expect, it } from "vitest";
import { extractMissingTableNames, getDatabaseReadinessMessage, getRequiredSupabaseTables } from "./supabase-schema";

describe("Supabase schema helpers", () => {
  it("exposes the tables used by the app", () => {
    expect(getRequiredSupabaseTables()).toEqual(["members", "org_settings", "profiles"]);
  });

  it("extracts missing table names from relation errors", () => {
    expect(extractMissingTableNames({ message: 'relation "members" does not exist' })).toEqual(["members"]);
  });

  it("builds a readiness message for missing tables", () => {
    const message = getDatabaseReadinessMessage(["members", "org_settings"]);
    expect(message).toContain("members");
    expect(message).toContain("org_settings");
    expect(message).toContain("Supabase");
    expect(message).toContain("SQL Editor");
  });

  it("returns a neutral readiness message when nothing is missing", () => {
    expect(getDatabaseReadinessMessage([])).toContain("ready");
  });
});
