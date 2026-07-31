import type { PostgrestError } from "@supabase/supabase-js";

export const REQUIRED_SUPABASE_TABLES = ["members", "org_settings", "profiles"] as const;

export type RequiredSupabaseTable = (typeof REQUIRED_SUPABASE_TABLES)[number];

function normalizeTableName(name: string): string {
  return name.replace(/^public\./i, "").replace(/^auth\./i, "").trim();
}

export function getRequiredSupabaseTables(): RequiredSupabaseTable[] {
  return [...REQUIRED_SUPABASE_TABLES];
}

export function isMissingTableError(error?: Pick<PostgrestError, "message"> | null): boolean {
  const msg = error?.message ?? "";
  const lowered = msg.toLowerCase();
  return (lowered.includes("does not exist") || lowered.includes("schema cache") || lowered.includes("relation")) && !lowered.includes("jwt");
}

export function extractMissingTableNames(error?: Pick<PostgrestError, "message"> | null): string[] {
  const msg = error?.message ?? "";
  const relationMatch = msg.match(/relation\s+"([^"]+)"/i);
  if (relationMatch?.[1]) {
    const normalized = normalizeTableName(relationMatch[1]);
    if (REQUIRED_SUPABASE_TABLES.includes(normalized as RequiredSupabaseTable)) {
      return [normalized];
    }
  }

  const lowered = msg.toLowerCase();
  return REQUIRED_SUPABASE_TABLES.filter((table) => lowered.includes(table));
}

export function getDatabaseReadinessMessage(missingTables: string[]): string {
  if (!missingTables.length) {
    return "Supabase database is ready.";
  }

  const list = ` Missing tables: ${missingTables.join(", ")}.`;
  return `Database tables not found. Please run the setup SQL in Supabase → SQL Editor.${list}`;
}
