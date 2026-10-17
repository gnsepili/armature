import type { JsonSchema } from "./types.ts";

/**
 * Builds a small value that satisfies a JSON Schema. Used by the smoke heuristic to
 * produce tool arguments and structured outputs without a real model.
 */
export function synthesize(
  schema: JsonSchema | undefined,
  root: JsonSchema = schema ?? {},
  depth = 0,
): unknown {
  if (!schema || depth > 8) return null;
  if (schema.$ref) return synthesize(resolveRef(schema.$ref, root), root, depth + 1);
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants && variants.length > 0) {
    const nonNull = variants.find((v) => v.type !== "null") ?? variants[0];
    return synthesize(nonNull, root, depth + 1);
  }
  if (schema.allOf && schema.allOf.length > 0) {
    return Object.assign({}, ...schema.allOf.map((s) => synthesize(s, root, depth + 1) as object));
  }
  const type = Array.isArray(schema.type) ? (schema.type.find((t) => t !== "null") ?? "null") : schema.type;
  switch (type) {
    case "string":
      return schema.format === "date" ? "2026-01-01" : "example";
    case "integer":
      return typeof schema.minimum === "number" ? Math.ceil(schema.minimum) : 1;
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 1;
    case "boolean":
      return true;
    case "array":
      return [synthesize(schema.items, root, depth + 1)];
    case "null":
      return null;
    default: {
      if (type !== "object" && !schema.properties) return "example";
      const out: Record<string, unknown> = {};
      const props = schema.properties ?? {};
      const required = new Set(schema.required ?? Object.keys(props));
      for (const [key, value] of Object.entries(props)) {
        if (required.has(key)) out[key] = synthesize(value, root, depth + 1);
      }
      return out;
    }
  }
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    if (node && typeof node === "object") node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node as JsonSchema | undefined;
}
