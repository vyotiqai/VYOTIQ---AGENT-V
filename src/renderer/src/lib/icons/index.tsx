import type { Icon as PhosphorIcon, IconProps as PhosphorIconProps } from '@phosphor-icons/react'
import {
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  BrainIcon,
  BrowsersIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  CircleIcon,
  CopyIcon,
  CornersOutIcon,
  FileIcon,
  PlugsConnectedIcon,
  FileMagnifyingGlassIcon,
  FileTextIcon,
  FolderIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GearSixIcon,
  GitBranchIcon,
  GlobeIcon,
  HouseIcon,
  ImageIcon,
  ListChecksIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  MonitorIcon,
  PencilIcon,
  PaperPlaneRightIcon,
  PaperclipIcon,
  PlusIcon,
  RobotIcon,
  ScanIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  SpinnerIcon,
  StarIcon,
  StopIcon,
  StorefrontIcon,
  TerminalWindowIcon,
  TrashIcon,
  WarningIcon,
  WrenchIcon,
  XIcon
} from '@phosphor-icons/react'

export type IconProps = PhosphorIconProps & { size?: number }

const ICONS = {
  send: PaperPlaneRightIcon,
  branch: GitBranchIcon,
  refresh: ArrowsClockwiseIcon,
  arrowUp: ArrowUpIcon,
  stop: StopIcon,
  folder: FolderIcon,
  folderOpen: FolderOpenIcon,
  search: MagnifyingGlassIcon,
  fileSearch: FileMagnifyingGlassIcon,
  file: FileIcon,
  edit: PencilIcon,
  terminal: TerminalWindowIcon,
  chevron: CaretDownIcon,
  chevronRight: CaretRightIcon,
  close: XIcon,
  check: CheckIcon,
  warning: WarningIcon,
  menu: ListIcon,
  plus: PlusIcon,
  gear: GearSixIcon,
  copy: CopyIcon,
  monitor: MonitorIcon,
  sliders: SlidersHorizontalIcon,
  folderPlus: FolderPlusIcon,
  folderMinus: FolderMinusIcon,
  doc: FileTextIcon,
  sidebar: SidebarSimpleIcon,
  minimize: MinusIcon,
  maximize: CornersOutIcon,
  restore: BrowsersIcon,
  image: ImageIcon,
  memory: BrainIcon,
  trash: TrashIcon,
  paperclip: PaperclipIcon,
  circle: CircleIcon,
  loader: SpinnerIcon,
  bot: RobotIcon,
  sparkles: SparkleIcon,
  marketplace: StorefrontIcon,
  star: StarIcon,
  cpu: PlugsConnectedIcon,
  plug: WrenchIcon,
  globe: GlobeIcon,
  listTodo: ListChecksIcon,
  folderSearch: MagnifyingGlassIcon,
  scanSearch: ScanIcon,
  home: HouseIcon
} as const satisfies Record<string, PhosphorIcon>

export type IconName = keyof typeof ICONS

export function Icon({
  name,
  size = 24,
  weight = 'bold',
  className,
  ...props
}: IconProps & { name: IconName }) {
  const Cmp = ICONS[name]
  return (
    <Cmp
      size={size}
      weight={weight}
      aria-hidden="true"
      focusable="false"
      className={['inline-block shrink-0 align-middle', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
