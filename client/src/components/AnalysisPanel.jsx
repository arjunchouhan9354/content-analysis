export default function AnalysisPanel({ fileName, analysis }) {
  const { summary, topics = [], people = [] } = analysis || {}
  return (
    <section className="card">
      <h2 className="file-name">{fileName}</h2>
      {summary && (
        <>
          <h3>Summary</h3>
          <p>{summary}</p>
        </>
      )}
      {topics.length > 0 && (
        <>
          <h3>Key topics</h3>
          <ul>{topics.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </>
      )}
      {people.length > 0 && (
        <>
          <h3>People</h3>
          <ul>{people.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </>
      )}
    </section>
  )
}
