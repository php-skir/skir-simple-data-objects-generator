import { type NormalizedType } from "@php-skir/generator-core";

export function structuralRules(
  type: NormalizedType,
  optional = type.kind === "optional",
): readonly string[] {
  const presence = optional ? "nullable" : "required";
  const inner = type.kind === "optional" ? type.inner : type;
  const shape = (() => {
    switch (inner.kind) {
      case "bool":
        return "boolean";
      case "int32":
      case "timestamp":
        return "integer";
      case "float32":
      case "float64":
        return "numeric";
      case "string":
      case "bytes":
        return "string";
      case "array":
        return "array";
      case "record":
        return inner.recordType === "struct" ? "array" : null;
      default:
        return null;
    }
  })();

  return shape === null ? [presence] : [presence, shape];
}
