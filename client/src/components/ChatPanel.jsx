import { useRef, useState } from 'react'
import { askQuestion } from '../api.js'

export default function ChatPanel({ docId }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const q = input.trim()
    // Ref guard: one request at a time, even on a fast double-click or Enter + click.
    if (!q || inFlight.current) return
    inFlight.current = true
    setWaiting(true)
    setError('')
    const history = messages
    setMessages([...history, { role: 'user', content: q }])
    setInput('')
    try {
      const answer = await askQuestion(docId, q, history)
      setMessages((m) => [...m, { role: 'assistant', content: answer }])
    } catch (err) {
      setError(err.message)
      // Drop the unanswered question so history stays user/assistant pairs.
      setMessages(history)
      setInput(q)
    } finally {
      inFlight.current = false
      setWaiting(false)
    }
  }

  return (
    <section className="card chat">
      <h3>Ask about this document</h3>
      {messages.map((m, i) => (
        <div key={i} className={`msg ${m.role}`}>
          <strong>{m.role === 'user' ? 'Q' : 'A'}:</strong> <span>{m.content}</span>
        </div>
      ))}
      {waiting && <p className="status">Thinking…</p>}
      {error && <p className="error">{error}</p>}
      <form className="ask" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Ask a question about this document…"
          value={input}
          disabled={waiting}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={waiting || !input.trim()}>
          Ask
        </button>
      </form>
    </section>
  )
}
