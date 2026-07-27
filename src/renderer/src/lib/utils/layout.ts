/** Shared horizontal gutter for chat column surfaces. */
export const CHAT_GUTTER = 'px-4 sm:px-5'

/** Shared max width for chat column content (messages + composer). */
export const CHAT_COLUMN_MAX = 'max-w-[720px]'

/** Centered chat column — transcript and composer share this wrapper. */
export const CHAT_COLUMN = `mx-auto w-full ${CHAT_COLUMN_MAX}`

/**
 * Fade painted above the floating composer dock (`before:h-8`). Not part of
 * `offsetHeight`, so transcript bottom reserve must add it explicitly.
 */
export const COMPOSER_DOCK_FADE_PX = 32

/** Fallback dock reserve when measured height is not yet available (`8rem`). */
export const COMPOSER_DOCK_FALLBACK_PX = 128

/** Composer textarea auto-grow cap — keep in sync with `max-h-40` on the field. */
export const COMPOSER_TEXTAREA_MAX_PX = 160

/** Shared max width for settings content column. */
export const SETTINGS_COLUMN_MAX = 'max-w-[520px]'

/** Centered settings column. */
export const SETTINGS_COLUMN = `mx-auto w-full ${SETTINGS_COLUMN_MAX}`

/**
 * Vertical rhythm. Applied as padding on each row rather than flex gap so
 * spacing stays consistent across the transcript.
 */
export const TRANSCRIPT_ROW_GAP = 'pb-2'

/** Extra breathing room around tool activity and reasoning rows. */
export const TRANSCRIPT_WORK_ROW_GAP = 'pb-3'

/** Lead-in above a user prompt that opens a new turn. */
export const TRANSCRIPT_TURN_GAP = 'pt-6'

/** User prompt block surface. */
export const USER_PROMPT_SURFACE =
  'rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed tracking-[-0.006em] text-fg [overflow-wrap:anywhere]'

/** Quiet activity row — no fill, no border. */
export const ACTIVITY_ROW = 'text-xs tracking-[var(--vy-tracking)]'

/** One line of a disclosure list: label, detail, trailing meta. */
export const DISCLOSURE_ROW =
  'flex min-w-0 items-baseline gap-1.5 rounded-sm py-1.5 text-xs vy-transition hover:opacity-80'

/** Tool card chrome. */
export const TOOL_CARD_SURFACE = 'overflow-hidden rounded-lg border border-border'
export const TOOL_CARD_HEADER = 'px-3 py-2 text-xs'
/** Body content owns its own padding so a diff can run edge to edge. */
export const TOOL_CARD_BODY = 'overflow-hidden border-t border-border bg-surface'

/** Collapsed prominent tool body height before fade mask. */
export const TOOL_BODY_CLAMP_PX = 168

/** Standard inner padding for tool body content. */
export const TOOL_BODY_PAD = 'px-3 py-2'

/** Scrollable inner region inside a tool body. */
export const TOOL_BODY_INNER = 'px-3 py-1.5'

/** Subtle floating surface shared by docked composer. */
export const FLOATING_CHROME =
  'rounded-xl border border-border/50 bg-bg motion-reduce:animate-none'

export const FLOATING_CHROME_SHADOW_BOTTOM =
  'shadow-[0_8px_32px_-12px_rgb(0_0_0/0.45)] animate-chrome-rise-in'

/** App chrome dimensions — sidebar header row aligns with title bar height. */
export const SIDEBAR_WIDTH_PX = 220
export const SIDEBAR_COLLAPSED_WIDTH_PX = 44
/** Wider collapsed rail on macOS so the toggle clears traffic lights. */
export const SIDEBAR_COLLAPSED_WIDTH_DARWIN_PX = 72
export const TITLE_BAR_HEIGHT = 'h-9'
export const TITLE_BAR_HEIGHT_PX = 36
/**
 * Width class names must be complete static strings so Tailwind can emit them.
 * Template-interpolated `w-[${n}px]` is invisible to the scanner and never ships.
 */
export const SIDEBAR_WIDTH = 'w-[min(220px,92vw)]'
export const SIDEBAR_WIDTH_DESKTOP = 'w-[220px]'
export const SIDEBAR_WIDTH_COLLAPSED = 'w-[44px]'
export const SIDEBAR_WIDTH_COLLAPSED_DARWIN = 'w-[72px]'

/** Named container — children use `@sidebar/…` for width-aware density. */
export const SIDEBAR_CONTAINER = '@container/sidebar'

/** Sidebar section label — quiet category headers. */
export const SIDEBAR_SECTION_LABEL =
  'm-0 px-2.5 text-[10px] font-medium uppercase tracking-[0.07em] text-secondary'

/** localStorage key for desktop sidebar collapse preference. */
export const SIDEBAR_COLLAPSED_KEY = 'vyotiq.sidebarCollapsed'
