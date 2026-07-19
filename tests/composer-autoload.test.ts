import { describe, expect, it } from "vitest";

import {
  ComposerAutoloadConflictError,
  ensureComposerPsr4Mapping,
} from "../src/composer-autoload.js";

describe("Simple Data Objects Composer autoload facade", () => {
  it("adds a normalized mapping while preserving unrelated Composer content", () => {
    const source = `{
  "name": "example/project",
  "autoload": {"classmap": ["legacy/"]},
  "require": {}
}
`;
    const result = ensureComposerPsr4Mapping(source, "App\\Skir", "./generated\\skirout");

    expect(result).toMatchObject({
      changed: true,
      namespace: "App\\Skir\\",
      paths: "generated/skirout/",
    });
    expect(JSON.parse(result.source).autoload).toEqual({
      classmap: ["legacy/"],
      "psr-4": { "App\\Skir\\": "generated/skirout/" },
    });
  });

  it("re-exports core JSONC rejection and conflict contracts", () => {
    expect(() => ensureComposerPsr4Mapping(
      '{\n  // Composer itself rejects comments\n  "name": "example/project"\n}\n',
      "App\\Skir",
      "generated/skirout",
    )).toThrow(/invalid composer\.json/i);

    expect(() => ensureComposerPsr4Mapping(
      '{"autoload":{"psr-4":{"App\\\\Skir\\\\":"src/"}}}\n',
      "App\\Skir",
      "generated/skirout",
    )).toThrow(ComposerAutoloadConflictError);
  });
});
