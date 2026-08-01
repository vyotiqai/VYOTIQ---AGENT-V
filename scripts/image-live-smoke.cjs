/**
 * Live smoke: decrypt saved API keys via Electron safeStorage and call
 * generate + edit for each image-capable provider that has a key.
 *
 * Usage (from repo root):
 *   pnpm exec electron scripts/image-live-smoke.cjs --user-data-dir="%APPDATA%\\vyotiq"
 *
 * Writes under scripts/.smoke-out/ (gitignored via scripts cleanup).
 */
const { app, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

const PROVIDERS = [
  {
    id: 'openai',
    model: 'gpt-image-2',
    generateUrl: 'https://api.openai.com/v1/images/generations',
    editUrl: 'https://api.openai.com/v1/images/edits',
    body: (prompt, model) => ({
      model,
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'low',
      response_format: 'b64_json'
    })
  },
  {
    id: 'gemini',
    model: 'gemini-3.1-flash-image',
    generateUrl: null, // filled with key
    editUrl: null
  },
  {
    id: 'xai',
    model: 'grok-imagine-image',
    generateUrl: 'https://api.x.ai/v1/images/generations',
    editUrl: 'https://api.x.ai/v1/images/edits',
    body: (prompt, model) => ({
      model,
      prompt,
      n: 1,
      aspect_ratio: '1:1',
      resolution: '1k'
    })
  },
  {
    id: 'openrouter',
    model: 'bytedance-seed/seedream-4.5',
    generateUrl: 'https://openrouter.ai/api/v1/images',
    editUrl: 'https://openrouter.ai/api/v1/images',
    body: (prompt, model) => ({
      model,
      prompt,
      n: 1,
      resolution: '1K',
      aspect_ratio: '1:1'
    })
  }
]

function decryptKey(encrypted) {
  if (!encrypted || typeof encrypted !== 'string') return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption unavailable')
  }
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

function b64FromResponse(json) {
  // OpenAI / OpenRouter / xAI style
  const d0 = json?.data?.[0]
  if (d0?.b64_json) return { b64: d0.b64_json, mime: d0.media_type || 'image/png' }
  if (d0?.url) return { url: d0.url }
  // Gemini generateContent
  const parts = json?.candidates?.[0]?.content?.parts ?? []
  for (const p of parts) {
    const inline = p.inlineData || p.inline_data
    if (inline?.data) {
      return { b64: inline.data, mime: inline.mimeType || inline.mime_type || 'image/png' }
    }
  }
  return null
}

async function generateOpenAiCompat(apiKey, cfg, outDir) {
  const res = await fetch(cfg.generateUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(cfg.id === 'openrouter'
        ? { 'HTTP-Referer': 'https://vyotiq.com', 'X-Title': 'Vyotiq-smoke' }
        : {})
    },
    body: JSON.stringify(cfg.body('A simple red circle on white background, flat icon', cfg.model))
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, step: 'generate', status: res.status, body: text.slice(0, 500) }
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, step: 'generate', error: 'invalid JSON', body: text.slice(0, 200) }
  }
  const img = b64FromResponse(json)
  if (!img?.b64 && !img?.url) {
    return { ok: false, step: 'generate', error: 'no image bytes', body: text.slice(0, 300) }
  }
  let bytes
  if (img.b64) bytes = Buffer.from(img.b64, 'base64')
  else {
    const r = await fetch(img.url)
    bytes = Buffer.from(await r.arrayBuffer())
  }
  const genPath = path.join(outDir, `${cfg.id}-gen.png`)
  fs.writeFileSync(genPath, bytes)

  // Edit
  let editOk
  if (cfg.id === 'openai') {
    const form = new FormData()
    form.append('model', cfg.model)
    form.append('prompt', 'Change only the circle to blue; keep everything else the same.')
    form.append('response_format', 'b64_json')
    form.append('n', '1')
    form.append('quality', 'low')
    form.append('image[]', new Blob([bytes], { type: 'image/png' }), 'image.png')
    const eres = await fetch(cfg.editUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    })
    const etext = await eres.text()
    if (!eres.ok) {
      editOk = { ok: false, step: 'edit', status: eres.status, body: etext.slice(0, 500) }
    } else {
      const ej = JSON.parse(etext)
      const eimg = b64FromResponse(ej)
      if (!eimg?.b64) editOk = { ok: false, step: 'edit', error: 'no image bytes' }
      else {
        fs.writeFileSync(path.join(outDir, `${cfg.id}-edit.png`), Buffer.from(eimg.b64, 'base64'))
        editOk = { ok: true, step: 'edit', bytes: Buffer.from(eimg.b64, 'base64').length }
      }
    }
  } else if (cfg.id === 'xai' || cfg.id === 'openrouter') {
    const dataUri = `data:image/png;base64,${bytes.toString('base64')}`
    const editBody =
      cfg.id === 'xai'
        ? {
            model: cfg.model,
            prompt: 'Change only the circle to blue; keep everything else the same.',
            n: 1,
            image: { url: dataUri }
          }
        : {
            model: cfg.model,
            prompt: 'Change only the circle to blue; keep everything else the same.',
            n: 1,
            input_references: [{ image_url: { url: dataUri } }]
          }
    const eres = await fetch(cfg.editUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(cfg.id === 'openrouter'
          ? { 'HTTP-Referer': 'https://vyotiq.com', 'X-Title': 'Vyotiq-smoke' }
          : {})
      },
      body: JSON.stringify(editBody)
    })
    const etext = await eres.text()
    if (!eres.ok) {
      editOk = { ok: false, step: 'edit', status: eres.status, body: etext.slice(0, 500) }
    } else {
      const ej = JSON.parse(etext)
      const eimg = b64FromResponse(ej)
      if (!eimg?.b64 && !eimg?.url) editOk = { ok: false, step: 'edit', error: 'no image bytes' }
      else {
        let ebytes
        if (eimg.b64) ebytes = Buffer.from(eimg.b64, 'base64')
        else ebytes = Buffer.from(await (await fetch(eimg.url)).arrayBuffer())
        fs.writeFileSync(path.join(outDir, `${cfg.id}-edit.png`), ebytes)
        editOk = { ok: true, step: 'edit', bytes: ebytes.length }
      }
    }
  } else {
    editOk = { ok: false, step: 'edit', error: 'edit not implemented for provider in smoke' }
  }

  return {
    ok: editOk.ok,
    generate: { ok: true, path: genPath, bytes: bytes.length },
    edit: editOk
  }
}

async function generateGemini(apiKey, outDir) {
  const model = 'gemini-3.1-flash-image'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'A simple red circle on white background, flat icon' }]
        }
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '1:1', imageSize: '1K' }
      }
    })
  })
  const text = await res.text()
  if (!res.ok) return { ok: false, step: 'generate', status: res.status, body: text.slice(0, 500) }
  const json = JSON.parse(text)
  const img = b64FromResponse(json)
  if (!img?.b64) return { ok: false, step: 'generate', error: 'no image', body: text.slice(0, 300) }
  const bytes = Buffer.from(img.b64, 'base64')
  const genPath = path.join(outDir, 'gemini-gen.png')
  fs.writeFileSync(genPath, bytes)

  const eres = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Change only the circle to blue; keep everything else the same. Image 1 is the source.' },
            { inlineData: { mimeType: 'image/png', data: bytes.toString('base64') } }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '1:1', imageSize: '1K' }
      }
    })
  })
  const etext = await eres.text()
  if (!eres.ok) return { ok: false, generate: { ok: true }, edit: { ok: false, status: eres.status, body: etext.slice(0, 500) } }
  const ej = JSON.parse(etext)
  const eimg = b64FromResponse(ej)
  if (!eimg?.b64) return { ok: false, generate: { ok: true }, edit: { ok: false, error: 'no image' } }
  const ebytes = Buffer.from(eimg.b64, 'base64')
  fs.writeFileSync(path.join(outDir, 'gemini-edit.png'), ebytes)
  return {
    ok: true,
    generate: { ok: true, path: genPath, bytes: bytes.length },
    edit: { ok: true, bytes: ebytes.length }
  }
}

app.whenReady().then(async () => {
  const outDir = path.join(__dirname, '.smoke-out')
  fs.mkdirSync(outDir, { recursive: true })
  const secretsPath = path.join(app.getPath('userData'), 'secrets.json')
  console.log('userData:', app.getPath('userData'))
  console.log('secrets:', secretsPath, 'exists=', fs.existsSync(secretsPath))

  if (!fs.existsSync(secretsPath)) {
    console.error('No secrets.json — open Vyotiq Settings and save API keys first.')
    app.exit(2)
    return
  }

  const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'))
  const report = []

  for (const id of ['openai', 'gemini', 'xai', 'openrouter']) {
    if (!secrets[id]) {
      report.push({ id, skipped: true, reason: 'no saved key' })
      continue
    }
    let apiKey
    try {
      apiKey = decryptKey(secrets[id])
    } catch (err) {
      report.push({ id, ok: false, error: String(err) })
      continue
    }
    if (!apiKey?.trim()) {
      report.push({ id, skipped: true, reason: 'empty key after decrypt' })
      continue
    }

    console.log(`\n=== ${id} smoke ===`)
    try {
      let result
      if (id === 'gemini') result = await generateGemini(apiKey.trim(), outDir)
      else {
        const cfg = PROVIDERS.find((p) => p.id === id)
        result = await generateOpenAiCompat(apiKey.trim(), cfg, outDir)
      }
      report.push({ id, ...result })
      console.log(JSON.stringify(result, null, 2))
    } catch (err) {
      report.push({ id, ok: false, error: String(err?.stack || err) })
      console.error(err)
    }
  }

  const summaryPath = path.join(outDir, 'report.json')
  fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2))
  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify(report, null, 2))
  console.log('Wrote', summaryPath)

  const failed = report.filter((r) => !r.skipped && !r.ok)
  app.exit(failed.length > 0 ? 1 : 0)
})
