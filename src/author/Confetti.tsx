const COLORS = ['#c2410c', '#0f766e', '#6d28d9', '#ffd166']

export function Confetti() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 40 }, (_, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${(i * 97) % 100}%`,
            background: COLORS[i % COLORS.length],
            animationDelay: `${(i % 8) * 0.08}s`,
          }}
        />
      ))}
    </div>
  )
}
