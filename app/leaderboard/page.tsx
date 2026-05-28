"use client"
import { useEffect, useState } from "react"

export default function Leaderboard() {
  const [scores, setScores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/leaderboard")
      .then(r => r.json())
      .then((data: any) => {
        const list = (data.scores || []).sort((a: any, b: any) => b.score - a.score).slice(0, 50)
        setScores(list)
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "1rem", background: "#14141a" }}>
      <div style={{ width: "100%", maxWidth: "600px" }}>
        <div style={{ marginBottom: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.875rem", fontWeight: "bold", color: "#966bec" }}>LEADERBOARD</h1>
          <p style={{ fontSize: "0.875rem", color: "rgba(255,255,255,0.5)" }}>Spec Blaster Hall of Fame</p>
        </div>

        {loading && <p style={{ textAlign: "center", color: "rgba(255,255,255,0.5)" }}>Loading...</p>}

        {!loading && scores.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem", color: "rgba(255,255,255,0.5)" }}>
            <p>No scores yet. Be the first!</p>
            <a href="/" style={{ color: "#966bec", textDecoration: "none" }}>Play →</a>
          </div>
        )}

        {!loading && scores.length > 0 && (
          <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: "4px", overflow: "hidden" }}>
            {scores.map((s, i) => (
              <div key={s.id} style={{ padding: "0.75rem 1rem", borderBottom: i < scores.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none", display: "flex", justifyContent: "space-between", background: i < 3 ? (i === 0 ? "rgba(251,146,60,0.1)" : i === 1 ? "rgba(148,163,184,0.1)" : "rgba(180,83,9,0.1)") : "transparent" }}>
                <div>
                  <p style={{ fontFamily: "monospace", color: i === 0 ? "#fdba74" : i === 1 ? "#cbd5e1" : i === 2 ? "#ea580c" : "#94a3b8", fontWeight: i < 3 ? "bold" : "normal" }}>#{i + 1} {s.handle}</p>
                  <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)" }}>L{s.level} · {s.kills} kills</p>
                </div>
                <p style={{ fontSize: "1.125rem", fontWeight: "bold", color: "#966bec" }}>{s.score.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: "2rem", textAlign: "center" }}>
          <a href="/" style={{ color: "#966bec", textDecoration: "none" }}>← Play Again</a>
        </div>
      </div>
    </main>
  )
}
