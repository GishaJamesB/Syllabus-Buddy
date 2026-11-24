export function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-6 text-lg">
      {steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  )
}
