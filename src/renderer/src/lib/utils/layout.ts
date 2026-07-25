/** Shared horizontal gutter for chat column surfaces. */
export const CHAT_GUTTER = 'px-4 sm:px-5'

/** Shared max width for chat column content (messages + composer). */
export const CHAT_COLUMN_MAX = 'max-w-[720px]'

/** Centered chat column — transcript and composer share this wrapper. */
export const CHAT_COLUMN = `mx-auto w-full ${CHAT_COLUMN_MAX}`

/** Subtle floating surface shared by docked composer. */
export const FLOATING_CHROME =
  'rounded-xl border border-border/50 bg-bg/70 backdrop-blur-sm motion-reduce:animate-none'

export const FLOATING_CHROME_SHADOW_TOP =
  'shadow-[0_4px_24px_-8px_rgb(0_0_0/0.4)] animate-chrome-drop-in'

export const FLOATING_CHROME_SHADOW_BOTTOM =
  'shadow-[0_8px_32px_-12px_rgb(0_0_0/0.45)] animate-chrome-rise-in'

/** App chrome dimensions — sidebar header row aligns with title bar height. */
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

/** Sidebar section label — quiet category headers. */
export const SIDEBAR_SECTION_LABEL =
  'm-0 px-2.5 text-[10px] font-medium uppercase tracking-[0.07em] text-secondary'

/** localStorage key for desktop sidebar collapse preference. */
export const SIDEBAR_COLLAPSED_KEY = 'vyotiq.sidebarCollapsed'

/** Gutter contract per composer placement variant. */
export const COMPOSER_VARIANT_GUTTER = {
  /** Empty state: parent provides CHAT_GUTTER; no extra gutter on composer root. */
  hero: '',
  /** Active chat: standard chat column gutter. */
  dock: CHAT_GUTTER
} as const
