'use client'

import { useEffect } from 'react'
import AdminPage from './page_admin_surgical_fix'

const MAX_SOURCE_BYTES = 30 * 1024 * 1024
const TARGET_DATA_BYTES = 1_200_000

function dataUrlBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return Number.MAX_SAFE_INTEGER
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4)
}

async function readAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read image file.'))
    reader.readAsDataURL(file)
  })
}

async function loadImage(src: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image file.'))
    img.src = src
  })
}

async function prepareManagedImage(file: File, maxDimension: number) {
  if (!file.type.startsWith('image/')) throw new Error('Please upload an image file.')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Image file is too large. Keep it under 30 MB.')

  const source = await readAsDataUrl(file)
  const img = await loadImage(source)

  let scale = Math.min(1, maxDimension / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height))
  let quality = 0.84
  let best = ''

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale))
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not prepare image for upload.')
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    best = canvas.toDataURL('image/webp', quality)
    if (dataUrlBytes(best) <= TARGET_DATA_BYTES) break
    if (quality > 0.58) quality -= 0.08
    else scale *= 0.82
  }

  if (!best || dataUrlBytes(best) > TARGET_DATA_BYTES) {
    throw new Error('Could not reduce this image enough for managed Dock storage. Try a smaller image.')
  }

  const response = await fetch(best)
  const blob = await response.blob()
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'dock-image'
  return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() })
}

export default function AdminPageWithManagedUploadGuard() {
  useEffect(() => {
    let replaying = false

    const onChangeCapture = async (event: Event) => {
      if (replaying) return
      const input = event.target
      if (!(input instanceof HTMLInputElement) || input.type !== 'file') return
      const file = input.files?.[0]
      if (!file || !file.type.startsWith('image/')) return

      // Take ownership before the legacy handler sees the raw file. The legacy
      // component then receives a normalized WebP already below the server's
      // managed-asset byte ceiling.
      event.preventDefault()
      event.stopImmediatePropagation()

      try {
        const labelText = String(input.closest('label')?.textContent || '').toLowerCase()
        const maxDimension = labelText.includes('background') ? 1400 : 512
        const prepared = await prepareManagedImage(file, maxDimension)
        const transfer = new DataTransfer()
        transfer.items.add(prepared)
        input.files = transfer.files
        replaying = true
        input.dispatchEvent(new Event('change', { bubbles: true }))
      } catch (error: any) {
        input.value = ''
        window.alert(error?.message || 'Image upload failed.')
      } finally {
        replaying = false
      }
    }

    document.addEventListener('change', onChangeCapture, true)
    return () => document.removeEventListener('change', onChangeCapture, true)
  }, [])

  return <AdminPage />
}
