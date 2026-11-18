// Each function sends exactly one request. No retries — a retry could cost a second paid Claude call.

async function handle(res) {
  let body = {}
  try {
    body = await res.json()
  } catch {
    body = {}
  }
  if (!res.ok) throw new Error(body.error || 'Request failed')
  return body
}

export async function uploadDocument(file) {
  const form = new FormData()
  form.append('file', file)
  return handle(await fetch('/api/upload', { method: 'POST', body: form }))
}

export async function askQuestion(docId, question, history) {
  const body = await handle(
    await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId, question, history }),
    }),
  )
  return body.answer
}
