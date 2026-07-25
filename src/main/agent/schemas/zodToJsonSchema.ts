import { type ZodTypeAny } from 'zod'

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let s = schema
  for (;;) {
    const typeName = s._def.typeName as string
    if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
      s = s._def.innerType as ZodTypeAny
      continue
    }
    if (typeName === 'ZodDefault') {
      s = s._def.innerType as ZodTypeAny
      continue
    }
    if (typeName === 'ZodEffects') {
      s = s._def.schema as ZodTypeAny
      continue
    }
    break
  }
  return s
}

function isOptional(schema: ZodTypeAny): boolean {
  const typeName = schema._def.typeName as string
  return typeName === 'ZodOptional' || typeName === 'ZodDefault'
}

/** Minimal Zod → JSON Schema for tool / compaction definitions. */
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const s = unwrap(schema)
  const typeName = s._def.typeName as string
  const description = s._def.description as string | undefined

  const withDesc = (obj: Record<string, unknown>): Record<string, unknown> =>
    description ? { ...obj, description } : obj

  if (typeName === 'ZodString') {
    return withDesc({ type: 'string' })
  }
  if (typeName === 'ZodNumber') {
    return withDesc({ type: 'number' })
  }
  if (typeName === 'ZodBoolean') {
    return withDesc({ type: 'boolean' })
  }
  if (typeName === 'ZodArray') {
    return withDesc({
      type: 'array',
      items: zodToJsonSchema(s._def.type as ZodTypeAny)
    })
  }
  if (typeName === 'ZodObject') {
    const shape = (s._def.shape as () => Record<string, ZodTypeAny>)()
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, field] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(field)
      if (!isOptional(field)) required.push(key)
    }
    const out: Record<string, unknown> = {
      type: 'object',
      properties,
      additionalProperties: false
    }
    if (required.length) out.required = required
    return withDesc(out)
  }
  return {}
}
