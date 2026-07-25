import { useState, type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction } from 'react'

export function useComposerDraft({
  draft,
  onDraftChange,
  images,
  setImages,
  setImageError,
  running,
  disabled,
  onSend
}: {
  draft?: string
  onDraftChange?: (draft: string) => void
  images: string[]
  setImages: Dispatch<SetStateAction<string[]>>
  setImageError: (error: string | null) => void
  running: boolean
  disabled?: boolean
  onSend: (text: string, images?: string[]) => boolean | void | Promise<boolean | void>
}) {
  const [internalText, setInternalText] = useState('')
  const isDraftControlled = draft !== undefined && onDraftChange !== undefined
  const text = isDraftControlled ? draft : internalText
  const setText = isDraftControlled ? onDraftChange : setInternalText

  const canSend = (Boolean(text.trim()) || images.length > 0) && !disabled && !running

  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    if ((!text.trim() && images.length === 0) || running || disabled) return
    const draftText = text
    const draftImages = images
    setText('')
    setImages([])
    setImageError(null)
    void Promise.resolve(onSend(draftText, draftImages.length ? draftImages : undefined)).then(
      (ok) => {
        if (ok === false) {
          setText(draftText)
          setImages(draftImages)
        }
      },
      () => {
        setText(draftText)
        setImages(draftImages)
      }
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return { text, setText, canSend, submit, onKeyDown }
}
