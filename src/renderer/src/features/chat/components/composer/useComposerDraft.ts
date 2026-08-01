import {
  useCallback,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type SetStateAction
} from 'react'
import type {
  AttachedAudio,
  AttachedFile,
  AttachedNativeFile,
  ComposerSendExtras,
  SlashCommandDescriptor
} from '@shared/ipc'
import { parseSlashSubmit } from '@shared/slashCommands'
import { hasComposerContent } from './mentionModel'
import type { MentionMenuItem } from './mentionModel'

export function useComposerDraft({
  draft,
  onDraftChange,
  images,
  setImages,
  setImageError,
  files,
  setFiles,
  nativeFiles = [],
  setNativeFiles,
  audio = [],
  setAudio,
  setFileError,
  running,
  disabled,
  onSend,
  slashMenuOpen,
  slashActiveCommand,
  onSlashMove,
  onSlashDismiss,
  onSlashAccept,
  onSlashSubmit,
  findCommandByTrigger,
  mentionMenuOpen,
  mentionActiveItem,
  onMentionMove,
  onMentionDismiss,
  onMentionAccept,
  onMentionBack
}: {
  draft?: string
  onDraftChange?: (draft: string) => void
  images: string[]
  setImages: Dispatch<SetStateAction<string[]>>
  setImageError: (error: string | null) => void
  files: AttachedFile[]
  setFiles: Dispatch<SetStateAction<AttachedFile[]>>
  nativeFiles?: AttachedNativeFile[]
  setNativeFiles?: Dispatch<SetStateAction<AttachedNativeFile[]>>
  audio?: AttachedAudio[]
  setAudio?: Dispatch<SetStateAction<AttachedAudio[]>>
  setFileError: (error: string | null) => void
  running: boolean
  disabled?: boolean
  onSend: (
    text: string,
    images?: string[],
    files?: AttachedFile[],
    extras?: ComposerSendExtras
  ) => boolean | void | Promise<boolean | void>
  slashMenuOpen?: boolean
  slashActiveCommand?: SlashCommandDescriptor | null
  onSlashMove?: (delta: number) => void
  onSlashDismiss?: () => void
  onSlashAccept?: (command: SlashCommandDescriptor) => void
  /** When set, intercepts submit that starts with `/command`. Return true if handled. */
  onSlashSubmit?: (
    command: SlashCommandDescriptor,
    trailingText: string,
    images: string[],
    files: AttachedFile[]
  ) => boolean | void | Promise<boolean | void>
  findCommandByTrigger?: (trigger: string) => SlashCommandDescriptor | null
  mentionMenuOpen?: boolean
  mentionActiveItem?: MentionMenuItem | null
  onMentionMove?: (delta: number) => void
  onMentionDismiss?: () => void
  onMentionAccept?: (item: MentionMenuItem) => void
  onMentionBack?: () => boolean
}) {
  const [internalText, setInternalText] = useState('')
  const isDraftControlled = draft !== undefined && onDraftChange !== undefined
  const text = isDraftControlled ? draft : internalText
  const setText = isDraftControlled ? onDraftChange : setInternalText
  void running

  const hasAttachments =
    images.length > 0 || files.length > 0 || nativeFiles.length > 0 || audio.length > 0
  const canSend = (hasComposerContent(text) || hasAttachments) && !disabled

  const clearDraft = useCallback((): {
    draftText: string
    draftImages: string[]
    draftFiles: AttachedFile[]
    draftNative: AttachedNativeFile[]
    draftAudio: AttachedAudio[]
    restore: () => void
  } => {
    const draftText = text
    const draftImages = images
    const draftFiles = files
    const draftNative = nativeFiles
    const draftAudio = audio
    const restore = (): void => {
      setText(draftText)
      setImages(draftImages)
      setFiles(draftFiles)
      setNativeFiles?.(draftNative)
      setAudio?.(draftAudio)
    }
    setText('')
    setImages([])
    setImageError(null)
    setFiles([])
    setNativeFiles?.([])
    setAudio?.([])
    setFileError(null)
    return { draftText, draftImages, draftFiles, draftNative, draftAudio, restore }
  }, [
    text,
    images,
    files,
    nativeFiles,
    audio,
    setText,
    setImages,
    setImageError,
    setFiles,
    setNativeFiles,
    setAudio,
    setFileError
  ])

  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    if ((!hasComposerContent(text) && !hasAttachments) || disabled) return

    const parsed = parseSlashSubmit(text)
    if (parsed && onSlashSubmit && findCommandByTrigger) {
      const cmd = findCommandByTrigger(parsed.trigger)
      if (cmd) {
        const { draftImages, draftFiles, restore } = clearDraft()
        void Promise.resolve()
          .then(() => onSlashSubmit(cmd, parsed.trailingText, draftImages, draftFiles))
          .then((ok) => {
            if (ok === false) restore()
          }, restore)
        return
      }
      // Unknown slash → fall through as normal chat message
    }

    const { draftText, draftImages, draftFiles, draftNative, draftAudio, restore } = clearDraft()
    const extras: ComposerSendExtras | undefined =
      draftNative.length || draftAudio.length
        ? {
            ...(draftNative.length ? { nativeFiles: draftNative } : {}),
            ...(draftAudio.length ? { audio: draftAudio } : {})
          }
        : undefined
    void Promise.resolve()
      .then(() =>
        onSend(
          draftText,
          draftImages.length ? draftImages : undefined,
          draftFiles.length ? draftFiles : undefined,
          extras
        )
      )
      .then((ok) => {
        if (ok === false) restore()
      }, restore)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>): void => {
    if (slashMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        onSlashMove?.(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        onSlashMove?.(-1)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onSlashDismiss?.()
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        if (slashActiveCommand) {
          e.preventDefault()
          onSlashAccept?.(slashActiveCommand)
          return
        }
      }
    }
    if (mentionMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        onMentionMove?.(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        onMentionMove?.(-1)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (onMentionBack?.()) return
        onMentionDismiss?.()
        return
      }
      if (e.key === 'Backspace' && onMentionBack?.()) {
        e.preventDefault()
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        if (mentionActiveItem) {
          e.preventDefault()
          onMentionAccept?.(mentionActiveItem)
          return
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return { text, setText, canSend, submit, onKeyDown, clearDraft }
}
