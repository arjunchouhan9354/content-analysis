import { useRef, useState } from 'react'
import { uploadDocument } from '../api.js'

export default function UploadForm({ onUploaded, onError, busy, setBusy }) {
  const [file, setFile] = useState(null)
  const inFlight = useRef(false)

  async function handleSubmit(e) {
    e.preventDefault()
    // Ref guard: blocks a fast double-click before the disabled state re-renders.
    if (!file || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    onError('')
    try {
      onUploaded(await uploadDocument(file))
    } catch (err) {
      onError(err.message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <form className="card upload" onSubmit={handleSubmit}>
      <input
        type="file"
        accept=".pdf,.docx,.txt"
        disabled={busy}
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />
      <button type="submit" disabled={busy || !file}>
        {busy ? 'Analysing…' : 'Upload'}
      </button>
      <p className="hint">PDF, DOCX or TXT, up to 10 MB.</p>
      {busy && <p className="status">Analysing document… this can take a little while.</p>}
    </form>
  )
}
