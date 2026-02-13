/**
 * Unit tests for utils/helpers.ts
 * Tests minimatch pattern matching functionality
 *
 * NOTE: The current minimatch implementation has known limitations:
 * - Double star is converted to dot-star which does not properly handle path segment matching
 * - Pattern with double star in middle will not match with zero segments
 * - This is a simplified implementation for the project needs
 */

import { describe, it, expect } from "vitest";
import { minimatch } from "@/utils/helpers";

describe("utils/helpers - minimatch", () => {
  describe("basic patterns", () => {
    it("should match exact string", () => {
      expect(minimatch("/v1/messages", "/v1/messages")).toBe(true);
      expect(minimatch("/v1/messages", "/v1/users")).toBe(false);
    });

    it("should match single wildcard * for non-slash characters", () => {
      expect(minimatch("/v1/messages", "/v1/*")).toBe(true);
      expect(minimatch("/v1/users", "/v1/*")).toBe(true);
      // * does not match / (path separator)
      expect(minimatch("/v1/users/123", "/v1/*")).toBe(false);
      expect(minimatch("/v2/messages", "/v1/*")).toBe(false);
    });

    it("should match ** with leading / (matches anything after first /)", () => {
      expect(minimatch("/v1/messages", "/**")).toBe(true);
      expect(minimatch("/v1/users/123", "/**")).toBe(true);
      expect(minimatch("/a/b/c/d", "/**")).toBe(true);
      // ** requires leading / in this implementation
      expect(minimatch("messages", "/**")).toBe(false);
    });

    it("should match ? wildcard for exactly one non-slash character", () => {
      expect(minimatch("/v1/messages", "/v?/messages")).toBe(true);
      expect(minimatch("/v2/messages", "/v?/messages")).toBe(true);
      expect(minimatch("/v10/messages", "/v?/messages")).toBe(false);
      expect(minimatch("/v1/messages", "/v??/messages")).toBe(false);
    });
  });

  describe("complex patterns", () => {
    it("should match multiple single wildcards", () => {
      expect(minimatch("/v1/users/123", "/v1/*/*")).toBe(true);
      expect(minimatch("/v1/users/123/extra", "/v1/*/*")).toBe(false);
      expect(minimatch("/api/v1/messages", "/api/*/messages")).toBe(true);
    });

    it("should handle ** in middle of pattern", () => {
      // ** matches one or more path segments (implementation limitation: requires at least one /)
      expect(minimatch("/v1/users/123/profile", "/v1/**/profile")).toBe(true);
      expect(minimatch("/v1/a/b/c/profile", "/v1/**/profile")).toBe(true);
      // KNOWN LIMITATION: ** doesn't match zero segments
      expect(minimatch("/v1/profile", "/v1/**/profile")).toBe(false);
      expect(minimatch("/v1/messages", "/v1/**/profile")).toBe(false);
    });
  });

  describe("model mapping patterns (primary use case)", () => {
    it("should match model wildcard patterns", () => {
      expect(minimatch("claude-3-5-soneta-20241022", "claude-*")).toBe(true);
      expect(minimatch("claude-opus-4", "claude-*")).toBe(true);
      expect(minimatch("gpt-4", "claude-*")).toBe(false);
    });

    it("should match complex model patterns", () => {
      expect(minimatch("claude-3-5-soneta-20241022", "claude-3-*")).toBe(true);
      expect(minimatch("claude-3-opus-2024", "claude-3-*")).toBe(true);
      expect(minimatch("claude-4-5-soneta", "claude-3-*")).toBe(false);
    });

    it("should handle edge cases in model names", () => {
      // Model names without slashes work correctly with *
      expect(minimatch("gemini-2.0-flash", "gemini-*")).toBe(true);
      expect(minimatch("gemini-pro", "gemini-*")).toBe(true);
      expect(minimatch("gpt-4-turbo", "gpt-*-turbo")).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle empty strings", () => {
      expect(minimatch("", "")).toBe(true);
      // * matches zero or more non-slash characters
      expect(minimatch("", "*")).toBe(true);
      expect(minimatch("", "**")).toBe(true);
    });

    it("should handle special regex characters in pattern", () => {
      // Special regex chars should be escaped
      expect(minimatch("file.txt", "file.txt")).toBe(true);
      expect(minimatch("file+test", "file+test")).toBe(true);
      expect(minimatch("file(test)", "file(test)")).toBe(true);
    });
  });

  describe("route pattern matching (actual project use cases)", () => {
    it("should match API route patterns", () => {
      expect(minimatch("/v1/messages", "/v1/messages")).toBe(true);
      expect(minimatch("/v1/messages", "/v1/*")).toBe(true);
      expect(minimatch("/v1/users/abc123", "/v1/users/*")).toBe(true);
      expect(minimatch("/v1/users", "/v1/users/*")).toBe(false);
    });

    it("should match passthrough patterns", () => {
      expect(minimatch("/v1/users/abc123", "/v1/users/*")).toBe(true);
      expect(minimatch("/v1/organizations/xyz", "/v1/organizations/*")).toBe(true);
      // Pattern without wildcard requires exact match
      expect(minimatch("/v1/users", "/v1/users")).toBe(true);
      expect(minimatch("/v1/users/", "/v1/users")).toBe(false);
    });
  });
});
