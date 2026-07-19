import { describe, expect, it } from "vitest";

import { structuralRules } from "../src/structural-rules.js";

describe("structuralRules", () => {
  it.each([
    [{ kind: "bool" } as const, ["required", "boolean"]],
    [{ kind: "int32" } as const, ["required", "integer"]],
    [{ kind: "timestamp" } as const, ["required", "integer"]],
    [{ kind: "float32" } as const, ["required", "numeric"]],
    [{ kind: "float64" } as const, ["required", "numeric"]],
    [{ kind: "string" } as const, ["required", "string"]],
    [{ kind: "bytes" } as const, ["required", "string"]],
    [{ kind: "array", item: { kind: "string" } } as const, ["required", "array"]],
    [{ kind: "record", recordIdentity: "types.skir::Address", recordType: "struct" } as const, ["required", "array"]],
    [{ kind: "record", recordIdentity: "types.skir::Status", recordType: "enum" } as const, ["required"]],
  ])("maps %o to safely representable Laravel rules", (type, expected) => {
    expect(structuralRules(type)).toEqual(expected);
  });

  it("does not narrow large integer unions", () => {
    expect(structuralRules({ kind: "int64" })).toEqual(["required"]);
    expect(structuralRules({ kind: "hash64" })).toEqual(["required"]);
  });

  it("uses nullable presence for optional fields", () => {
    expect(structuralRules({
      kind: "optional",
      inner: { kind: "int32" },
    })).toEqual(["nullable", "integer"]);
  });
});
