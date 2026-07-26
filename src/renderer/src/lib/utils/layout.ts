export const CHAT_GUTTER = 'px-4 sm:px-5'

export const CHAT_COLUMN_MAX = 'max-w-[720px]'

export const CHAT_COLUMN = `mx-auto w-full ${CHAT_COLUMN_MAX}`

/**
 * Vertical rhythm. Applied as padding on each row rather than flex gap so the
 * virtualizer (which measures offsetHeight and positions rows absolutely) and
 * the plain flow layout produce identical spacing.
 */
export const TRANSCRIPT_ROW_GAP = 'pb-2'

export const TRANSCRIPT_TURN_GAP = 'pt-6'

export const USER_PROMPT_SURFACE =
  'rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed tracking-[-0.006em] text-fg [overflow-wrap:anywhere]'

export const ACTIVITY_ROW = 'text-xs tracking-[var(--vy-tracking)]'

export const DISCLOSURE_ROW =
  'flex min-w-0 items-baseline gap-1.5 rounded-sm py-1 text-xs vy-transition hover:opacity-80'

export const TOOL_CARD_SURFACE = 'overflow-hidden rounded-lg border border-border'
export const TOOL_CARD_HEADER = 'px-3 py-2 text-xs'
/** Body content owns its own padding so a diff can run edge to edge. */
export const TOOL_CARD_BODY = 'overflow-hidden border-t border-border bg-surface'

export const FLOATING_CHROME =
  'rounded-xl border border-border/50 bg-bg motion-reduce:animate-none'

export const FLOATING_CHROME_SHADOW_BOTTOM =
  'shadow-[0_8px_32px_-12px_rgb(0_0_0/0.45)] animate-chrome-rise-in'

export const SIDEBAR_WIDTH_PX = 260
export const SIDEBAR_COLLAPSED_WIDTH_PX = 52
/** Wider collapsed rail on macOS so the toggle clears traffic lights. */
export const SIDEBAR_COLLAPSED_WIDTH_DARWIN_PX = 80
export const TITLE_BAR_HEIGHT = 'h-9'
export const TITLE_BAR_HEIGHT_PX = 36
export const SIDEBAR_WIDTH = `w-[min(${SIDEBAR_WIDTH_PX}px,88vw)]`
export const SIDEBAR_WIDTH_DESKTOP = `w-[${SIDEBAR_WIDTH_PX}px]`
export const SIDEBAR_WIDTH_COLLAPSED = `w-[${SIDEBAR_COLLAPSED_WIDTH_PX}px]`
export const SIDEBAR_WIDTH_COLLAPSED_DARWIN = `w-[${SIDEBAR_COLLAPSED_WIDTH_DARWIN_PX}px]`

export const SIDEBAR_SECTION_LABEL =
  'm-0 px-2.5 text-[10px] font-medium uppercase tracking-[0.07em] text-secondary'

export const SIDEBAR_COLLAPSED_KEY = 'vyotiq.sidebarCollapsed'

/** Gutter contract per composer placement variant. */
export const COMPOSER_VARIANT_GUTTER = {
  hero: '',
  dock: CHAT_GUTTER
} as const
