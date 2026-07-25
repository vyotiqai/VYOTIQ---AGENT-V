import { useState, type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction } from 'react'
import type { AttachedFile } from '@shared/ipc'

export function useComposerDraft({
  draft,
  onDraftChange,
  images,
  setImages,
  setImageError,
  files,
  setFiles,
  setFileError,
  running,
  disabled,
  onSend
}: {
  draft?: string
  onDraftChange?: (draft: string) => void
  images: string[]
  setImages: Dispatch<SetStateAction<string[]>>
  setImageError: (error: string | null) => void
  files: AttachedFile[]
  setFiles: Dispatch<SetStateAction<AttachedFile[]>>
  setFileError: (error: string | null) => void
  running: boolean
  disabled?: boolean
  onSend: (
    text: string,
    images?: string[],
    files?: AttachedFile[]
  ) => boolean | void | Promise<boolean | void>
}) {
  const [internalText, setInternalText] = useState('')
  const isDraftControlled = draft !== undefined && onDraftChange !== undefined
  const text = isDraftControlled ? draft : internalText
  const setText = isDraftControlled ? onDraftChange : setInternalText

  const hasAttachments = images.length > 0 || files.length > 0
  const canSend = (Boolean(text.trim()) || hasAttachments) && !disabled && !running

  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    if ((!text.trim() && !hasAttachments) || running || disabled) return
    const draftText = text
    const draftImages = images
    const draftFiles = files
    const restore = (): void => {
      setText(draftText)
      setImages(draftImages)
      setFiles(draftFiles)
    }
    setText('')
    setImages([])
    setImageError(null)
    setFiles([])
    setFileError(null)
    void Promise.resolve(
      onSend(
        draftText,
        draftImages.length ? draftImages : undefined,
        draftFiles.length ? draftFiles : undefined
      )
    ).then((ok) => {
      if (ok === false) restore()
    }, restore)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return { text, setText, canSend, submit, onKeyDown }
}
