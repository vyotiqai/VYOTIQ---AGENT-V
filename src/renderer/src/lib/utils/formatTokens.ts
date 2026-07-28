/** Compact token counts for context meters (composer + sub-agent). */
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0))
  if (v >= 1_000_000) {
    const m = v / 1_000_000
    if (m >= 100) return `${Math.round(m)}M`
    if (m >= 10) return `${Math.round(m)}M`
    if (Number.isInteger(m)) return `${m}M`
    return `${m.toFixed(1).replace(/\.0$/, '')}M`
  }
  if (v >= 10_000) return `${Math.round(v / 1000)}k`
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(v)
}
