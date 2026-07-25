import { cn } from '@renderer/lib/ui/cn'
import type { ProviderId } from '@shared/ipc'
import {
  PROVIDER_BRAND_PATHS,
  resolveProviderBrandSlug,
  type ProviderBrandSlug
} from './providerBrandPaths'

export type ProviderLogoId = ProviderId | string

const SIZE = { sm: 14, md: 16, lg: 18 } as const

function BrandMark({
  slug,
  size,
  className
}: {
  slug: ProviderBrandSlug
  size: number
  className?: string
}) {
  const paths = PROVIDER_BRAND_PATHS[slug]
  const pathList: string[] = Array.isArray(paths) ? [...paths] : [paths]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden
      className={cn('shrink-0', className)}
    >
      {pathList.map((path) => (
        <path key={path.slice(0, 24)} d={path} />
      ))}
    </svg>
  )
}

function GenericIcon({
  size,
  className,
  letter
}: {
  size: number
  className?: string
  letter: string
}) {
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-sm bg-surface-2 font-medium text-fg',
        className
      )}
      style={{ width: size, height: size, fontSize: Math.max(8, size - 6) }}
      aria-hidden
    >
      {letter.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function ProviderLogo({
  id,
  subProvider,
  size = 'md',
  className
}: {
  id: ProviderLogoId
  subProvider?: string
  size?: keyof typeof SIZE
  className?: string
}) {
  const px = SIZE[size]
  const subSlug = subProvider ? resolveProviderBrandSlug(subProvider) : undefined
  const providerSlug = resolveProviderBrandSlug(String(id))
  const slug = subSlug ?? providerSlug

  if (slug) {
    return <BrandMark slug={slug} size={px} className={className} />
  }

  const fallbackKey = (subProvider ?? String(id)).toLowerCase()
  return <GenericIcon size={px} className={className} letter={fallbackKey.slice(0, 1)} />
}
