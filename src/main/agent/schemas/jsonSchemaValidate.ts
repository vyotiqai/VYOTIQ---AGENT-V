/**
 * Lightweight JSON Schema checks for MCP tool args.
 * Covers required keys and primitive/object/array `type` — enough to catch
 * model mistakes before they hit the MCP server. Not a full draft validator.
 */
export function validateAgainstJsonSchema(
  schema: Record<string, unknown> | undefined,
  value: unknown
): { ok: true } | { ok: false; error: string } {
  if (!schema || typeof schema !== 'object') return { ok: true }

  const type = schema.type
  if (type === 'object' || (type == null && schema.properties)) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Expected an object' }
    }
    const obj = value as Record<string, unknown>
    const required = Array.isArray(schema.required)
      ? (schema.required as unknown[]).filter((k): k is string => typeof k === 'string')
      : []
    for (const key of required) {
      if (obj[key] === undefined) {
        return { ok: false, error: `Missing required property: ${key}` }
      }
    }
    const properties = schema.properties
    const allowedKeys = new Set<string>()
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      for (const [key, propSchema] of Object.entries(
        properties as Record<string, Record<string, unknown>>
      )) {
        allowedKeys.add(key)
        if (obj[key] === undefined) continue
        const nested = validateAgainstJsonSchema(propSchema, obj[key])
        if (!nested.ok) return { ok: false, error: `${key}: ${nested.error}` }
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
          return { ok: false, error: `Unexpected property: ${key}` }
        }
      }
    }
    return { ok: true }
  }

  if (type === 'string') {
    if (typeof value !== 'string') return { ok: false, error: 'Expected a string' }
    return { ok: true }
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || (type === 'integer' && !Number.isInteger(value))) {
      return { ok: false, error: type === 'integer' ? 'Expected an integer' : 'Expected a number' }
    }
    return { ok: true }
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') return { ok: false, error: 'Expected a boolean' }
    return { ok: true }
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return { ok: false, error: 'Expected an array' }
    const items = schema.items
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      for (let i = 0; i < value.length; i++) {
        const nested = validateAgainstJsonSchema(items as Record<string, unknown>, value[i])
        if (!nested.ok) return { ok: false, error: `[${i}]: ${nested.error}` }
      }
    }
    return { ok: true }
  }

  return { ok: true }
}
