import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 24, children, className, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={['inline-block shrink-0 align-middle', className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </svg>
  )
}

export function IconSend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </Svg>
  )
}

export function IconArrowUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </Svg>
  )
}

export function IconStop(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
    </Svg>
  )
}

export function IconFolder(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 8.5V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-6.5z" />
    </Svg>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16.5 16.5L20 20" />
    </Svg>
  )
}

export function IconFile(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3.5h6.5L17.5 8v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
      <path d="M13.5 3.5V8h4" />
    </Svg>
  )
}

export function IconEdit(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13 7l3 3" />
    </Svg>
  )
}

export function IconTerminal(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M7 10l3 2-3 2" />
      <path d="M12.5 14H17" />
    </Svg>
  )
}

export function IconChevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  )
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Svg>
  )
}

export function IconWarning(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4l9 16H3L12 4z" />
      <path d="M12 10v4" />
      <path d="M12 16.5h.01" />
    </Svg>
  )
}

export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

/** Settings cog — toothed gear with center bore (not a sunburst). */
export function IconGear(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  )
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8" y="8" width="11" height="11" rx="1.5" />
      <path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" />
    </Svg>
  )
}

export function IconMonitor(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
      <path d="M8 20h8M12 16.5V20" />
    </Svg>
  )
}

export function IconSliders(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8h10M18 8h2" />
      <path d="M4 16h2M10 16h10" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="8" cy="16" r="2" />
    </Svg>
  )
}

export function IconFolderPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 8.5V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-6.5z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </Svg>
  )
}

export function IconDoc(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3.5h6.5L17.5 8v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
      <path d="M13.5 3.5V8h4M9 12h6M9 16h4" />
    </Svg>
  )
}

/** Left sidebar / panel toggle — thin framed panel with rail. */
export function IconSidebar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M9 4.5v15" />
    </Svg>
  )
}

export function IconMinimize(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
    </Svg>
  )
}

export function IconMaximize(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="1" />
    </Svg>
  )
}

/** Restore / unmaximize — overlapping squares. */
export function IconRestore(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 8.5V6.5A1.5 1.5 0 0 1 9.5 5H17a1.5 1.5 0 0 1 1.5 1.5V14A1.5 1.5 0 0 1 17 15.5h-2" />
      <rect x="5" y="8.5" width="11" height="10.5" rx="1" />
    </Svg>
  )
}

export function IconImage(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M3.5 16l4.5-4.5L12 15l3-3 5.5 5.5" />
    </Svg>
  )
}

/** File-backed agent memory — stacked notes. */
export function IconMemory(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 5.5h12a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" />
      <path d="M9 9h6M9 12.5h6M9 16h4" />
    </Svg>
  )
}

/** Git branch — a trunk with one fork merging off it. */
export function IconBranch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="6" r="2" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="8" r="2" />
      <path d="M7 8v8M17 10v1a3 3 0 0 1-3 3h-4" />
    </Svg>
  )
}

export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </Svg>
  )
}

const ICONS = {
  send: IconSend,
  branch: IconBranch,
  refresh: IconRefresh,
  arrowUp: IconArrowUp,
  stop: IconStop,
  folder: IconFolder,
  search: IconSearch,
  file: IconFile,
  edit: IconEdit,
  terminal: IconTerminal,
  chevron: IconChevron,
  chevronRight: IconChevronRight,
  close: IconClose,
  check: IconCheck,
  warning: IconWarning,
  menu: IconMenu,
  plus: IconPlus,
  gear: IconGear,
  copy: IconCopy,
  monitor: IconMonitor,
  sliders: IconSliders,
  folderPlus: IconFolderPlus,
  doc: IconDoc,
  sidebar: IconSidebar,
  minimize: IconMinimize,
  maximize: IconMaximize,
  restore: IconRestore,
  image: IconImage,
  memory: IconMemory
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, ...props }: IconProps & { name: IconName }) {
  const Cmp = ICONS[name]
  return <Cmp {...props} />
}
