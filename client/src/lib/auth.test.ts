import { describe, expect, it } from "vitest";
import { buildAuthEmailFromUsername, generateUsernameSuggestions, normalizeUsername, usernameToEmail, validateUsername } from "./auth";

describe("normalizeUsername", () => {
  it("normalizes usernames to lowercase and strips invalid characters", () => {
    // hyphens are stripped; underscores and dots remain
    expect(normalizeUsername("  My_User.01  ")).toBe("my_user.01");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeUsername("   ")).toBe("");
  });

  it("strips characters that are not letters, digits, underscore, or dot", () => {
    expect(normalizeUsername("hello-world!")).toBe("helloworld");
  });
});

describe("usernameToEmail / buildAuthEmailFromUsername", () => {
  it("builds a stable auth email in the @masjid.local domain", () => {
    expect(usernameToEmail("My_User")).toBe("my_user@masjid.local");
  });

  it("backward-compat alias buildAuthEmailFromUsername works the same way", () => {
    expect(buildAuthEmailFromUsername("Ahmed")).toBe("ahmed@masjid.local");
  });

  it("returns empty string for blank username", () => {
    expect(usernameToEmail("   ")).toBe("");
  });
});

describe("validateUsername", () => {
  it("rejects an empty username", () => {
    expect(validateUsername("")).not.toBeNull();
  });

  it("rejects usernames shorter than 3 characters", () => {
    expect(validateUsername("ab")).not.toBeNull();
  });

  it("rejects usernames longer than 30 characters", () => {
    expect(validateUsername("a".repeat(31))).not.toBeNull();
  });

  it("accepts valid usernames", () => {
    expect(validateUsername("ahmed_admin")).toBeNull();
    expect(validateUsername("user.123")).toBeNull();
  });

  it("rejects usernames with invalid characters", () => {
    expect(validateUsername("hello world")).not.toBeNull();
    expect(validateUsername("user@masjid")).not.toBeNull();
  });
});

describe("generateUsernameSuggestions", () => {
  it("keeps the original username first and adds readable alternatives", () => {
    expect(generateUsernameSuggestions("ahmed_admin", 4)).toEqual([
      "ahmed_admin",
      "ahmed_admin1",
      "ahmed_admin01",
      "ahmed_admin2026",
    ]);
  });

  it("returns an empty list for blank input", () => {
    expect(generateUsernameSuggestions("   ")).toEqual([]);
  });
});
