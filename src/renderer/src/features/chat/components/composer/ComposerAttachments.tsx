import type { AttachedFile } from '@shared/ipc'
import { FileChip, ImageChip } from '@renderer/lib/ui'

export function ComposerAttachments({
  images,
  imageError,
  files = [],
  fileError = null,
  extracting = false,
  attachLocked,
  onRemove,
  onRemoveFile
}: {
  images: string[]
  imageError: string | null
  files?: AttachedFile[]
  fileError?: string | null
  extracting?: boolean
  attachLocked: boolean
  onRemove: (index: number) => void
  onRemoveFile?: (index: number) => void
}) {
  const notice = [imageError, fileError].filter(Boolean).join(' · ')
  if (!images.length && !files.length && !notice && !extracting) return null

  return (
    <div className="col-span-full flex flex-col gap-1.5">
      {images.length || files.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {images.map((url, i) => (
            <ImageChip
              key={`${i}-${url.slice(0, 24)}`}
              url={url}
              label={`Image ${i + 1}`}
              variant="compact"
              disabled={attachLocked}
              onRemove={() => onRemove(i)}
            />
          ))}
          {files.map((file, i) => (
            <FileChip
              key={`${i}-${file.name}`}
              name={file.name}
              chars={file.text.length}
              disabled={attachLocked}
              onRemove={onRemoveFile ? () => onRemoveFile(i) : undefined}
            />
          ))}
        </div>
      ) : null}
      {extracting ? (
        <p className="m-0 text-xs text-secondary" role="status">
          Reading attachment…
        </p>
      ) : null}
      {notice ? (
        <p className="m-0 text-xs text-danger" role="alert">
          {notice}
        </p>
      ) : null}
    </div>
  )
}
