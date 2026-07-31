/**
 * Auth helper utilities for username-based local authentication.
 *
 * Users interact with a plain username + password UI.
 * Credentials are stored directly in IndexedDB.
 */

/** Username rules:
 *  - Trim leading/trailing spaces
 *  - Lowercase only
 *  - Allowed characters: letters (a-z), digits (0-9), underscore (_), dot (.)
 *  - Everything else is stripped
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9._]/g, "");
}

/** Convert a normalized username to the internal fake email address. */
export function usernameToEmail(username: string): string {
  const normalized = normalizeUsername(username);
  return normalized ? `${normalized}@masjid.local` : "";
}

/** Alias kept for backward-compat with any import that used the old name. */
export const buildAuthEmailFromUsername = usernameToEmail;

/** Validate a raw (not yet normalized) username string.
 *  Returns an error message string, or null if the username is valid.
 */
export function validateUsername(username: string): string | null {
  const raw = username.trim();
  if (!raw) return "Username is required.";
  if (raw.length < 3) return "Username must be at least 3 characters.";
  if (raw.length > 30) return "Username must be 30 characters or fewer.";
  if (!/^[a-z0-9._]+$/i.test(raw))
    return "Username may only contain letters, numbers, underscore (_), or dot (.).";
  return null;
}
