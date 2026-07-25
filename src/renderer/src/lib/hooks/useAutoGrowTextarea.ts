import { useEffect, type RefObject } from 'react'

const MAX_HEIGHT_PX = 240

export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden'
  }, [ref, value])
}
