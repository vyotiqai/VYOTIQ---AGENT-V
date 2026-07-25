import { useState } from 'react'
import { MAX_ATTACHMENT_BYTES, type AttachedFile } from '@shared/ipc'

export const MAX_FILES = 5

/** Everything the picker offers beyond images; main decides what it can parse. */
export const ATTACHMENT_ACCEPT =
  'image/*,.pdf,.txt,.md,.mdx,.markdown,.json,.jsonc,.yaml,.yml,.toml,.ini,.csv,.tsv,.log,.sql,.html,.xml,.css,.scss,.js,.jsx,.mjs,.cjs,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cc,.cpp,.hpp,.cs,.php,.sh,.bash,.ps1,.patch,.diff,text/*'

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/**
 * Non-image attachments.
 *
 * The renderer only ships bytes; extraction (PDF text, encoding checks, caps)
 * happens in main so one implementation governs what reaches the model.
 */
export function useComposerFiles() {
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  const addFiles = async (picked: File[]): Promise<void> => {
    if (!picked.length) return
    const room = MAX_FILES - files.length
    if (room <= 0) {
      setFileError(`You can attach up to ${MAX_FILES} files.`)
      return
    }

    const problems: string[] = []
    const accepted: AttachedFile[] = []
    setExtracting(true)
    try {
      for (const file of picked.slice(0, room)) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          problems.push(
            `${file.name} is over ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB`
          )
          continue
        }
        try {
          const data = await readAsBase64(file)
          const res = await window.vyotiq.extractAttachment({
            name: file.name,
            mime: file.type || '',
            data
          })
          if (!res.ok) {
            problems.push(res.error)
            continue
          }
          accepted.push({
            type: 'file',
            name: res.data.name,
            mime: res.data.mime,
            text: res.data.text
          })
          if (res.data.truncated) problems.push(`${res.data.name} was truncated`)
        } catch {
          problems.push(`Could not read ${file.name}`)
        }
      }
    } finally {
      setExtracting(false)
    }

    if (picked.length > room) problems.push(`Only ${MAX_FILES} files allowed`)
    setFileError(problems.length ? problems.join(' · ') : null)
    if (accepted.length) setFiles((prev) => [...prev, ...accepted].slice(0, MAX_FILES))
  }

  const removeFile = (index: number): void => {
    setFiles((prev) => prev.filter((_, j) => j !== index))
    setFileError(null)
  }

  const clearFiles = (): void => {
    setFiles([])
    setFileError(null)
  }

  return { files, setFiles, fileError, setFileError, extracting, addFiles, removeFile, clearFiles }
}
