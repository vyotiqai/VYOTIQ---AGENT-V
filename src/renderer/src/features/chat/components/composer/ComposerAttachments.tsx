import { ImageChip } from '@renderer/lib/ui'

export function ComposerAttachments({
  images,
  imageError,
  running,
  onRemove
}: {
  images: string[]
  imageError: string | null
  running: boolean
  onRemove: (index: number) => void
}) {
  if (!images.length && !imageError) return null

  return (
    <div className="col-span-full flex flex-col gap-1.5">
      {images.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {images.map((url, i) => (
            <ImageChip
              key={`${i}-${url.slice(0, 24)}`}
              url={url}
              label={`Image ${i + 1}`}
              variant="compact"
              disabled={running}
              onRemove={() => onRemove(i)}
            />
          ))}
        </div>
      ) : null}
      {imageError ? (
        <p className="m-0 text-xs text-secondary" role="status">
          {imageError}
        </p>
      ) : null}
    </div>
  )
}
