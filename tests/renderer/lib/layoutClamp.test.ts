import { describe, expect, it } from 'vitest'
import { clampSidebarWidthPx } from '@renderer/lib/utils/layout'

describe('clampSidebarWidthPx', () => {
  it('respects absolute min/max on a wide viewport', () => {
    expect(clampSidebarWidthPx(100, 1600)).toBe(180)
    expect(clampSidebarWidthPx(500, 1600)).toBe(420)
    expect(clampSidebarWidthPx(220, 1600)).toBe(220)
  })

  it('shrinks with the viewport so a usable chat column remains', () => {
    // 500 viewport − 360 chat min = 140, but floor is SIDEBAR_WIDTH_MIN_PX (180)
    expect(clampSidebarWidthPx(420, 500)).toBe(180)
    // 700 − 360 = 340 → clamp max becomes 340
    expect(clampSidebarWidthPx(420, 700)).toBe(340)
  })
})
