import type { ZodTypeAny } from "zod";

/** The existing runner uses Zod 3 (no toJSON). Describe the actual supplied stage shape to the model. */
export function outputJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const d = schema._def;
  switch (d.typeName) {
    case "ZodObject": {
      const shape = d.shape() as Record<string, ZodTypeAny>;
      return { type: "object", properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, outputJsonSchema(v)])),
        required: Object.entries(shape).filter(([,v]) => !v.isOptional()).map(([k]) => k), additionalProperties: false };
    }
    case "ZodArray": return { type: "array", items: outputJsonSchema(d.type), ...(d.minLength ? {minItems:d.minLength.value} : {}), ...(d.maxLength ? {maxItems:d.maxLength.value} : {}) };
    case "ZodString": return { type: "string" };
    case "ZodNumber": return { type: d.checks.some((c: {kind:string}) => c.kind === "int") ? "integer" : "number" };
    case "ZodBoolean": return { type: "boolean" };
    case "ZodNull": return { type: "null" };
    case "ZodEnum": return { type: "string", enum: d.values };
    case "ZodLiteral": return { const: d.value };
    case "ZodOptional": case "ZodDefault": return outputJsonSchema(d.innerType);
    case "ZodNullable": return { anyOf: [outputJsonSchema(d.innerType), { type: "null" }] };
    case "ZodUnion": return { anyOf: d.options.map((v: ZodTypeAny) => outputJsonSchema(v)) };
    case "ZodEffects": return outputJsonSchema(d.schema);
    case "ZodRecord": return { type: "object", additionalProperties: outputJsonSchema(d.valueType) };
    default: return {};
  }
}
