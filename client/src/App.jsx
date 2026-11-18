import { useState } from 'react'
import UploadForm from './components/UploadForm.jsx'
import AnalysisPanel from './components/AnalysisPanel.jsx'
import ChatPanel from './components/ChatPanel.jsx'

// Claude is only ever called from the Upload and Ask handlers — nothing runs on page load.
export default function App() {
  const [doc, setDoc] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <main className="app">
      <h1>Content Analysis</h1>
      <UploadForm onUploaded={setDoc} onError={setError} busy={busy} setBusy={setBusy} />
      {error && <p className="error">{error}</p>}
      {doc && !busy && (
        <>
          <AnalysisPanel fileName={doc.fileName} analysis={doc.analysis} />
          <ChatPanel key={doc.docId} docId={doc.docId} />
        </>
      )}
    </main>
  )
}
