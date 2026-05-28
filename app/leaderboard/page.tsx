"use client"
import { useEffect, useState } from "react"

const MEDALS = ["#fdba74", "#cbd5e1", "#ea580c"]

export default function Leaderboard() {
  const [scores, setScores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/leaderboard")
      .then(r => r.json())
      .then((d: any) => setScores((d.scores ?? []).sort((a: any, b: any) => b.score - a.score)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <main style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"1rem", background:"#0d0d14" }}>
      <div style={{ width:"100%", maxWidth:"560px" }}>
        <div style={{ textAlign:"center", marginBottom:"2rem" }}>
          <div style={{ fontSize:"2rem", marginBottom:"0.4rem" }}>🦫</div>
          <h1 style={{ fontSize:"1.5rem", fontWeight:"bold", color:"#a78bfa", fontFamily:"monospace", letterSpacing:"0.12em", margin:0 }}>LEADERBOARD</h1>
          <p style={{ color:"rgba(255,255,255,0.3)", fontFamily:"monospace", fontSize:"0.75rem", marginTop:"0.3rem" }}>Spec Blaster Hall of Fame</p>
        </div>

        {loading && <p style={{ textAlign:"center", color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>loading...</p>}

        {!loading && scores.length === 0 && (
          <div style={{ textAlign:"center", padding:"2.5rem", color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>
            <p style={{ marginBottom:"1rem" }}>No scores yet. Be the first!</p>
            <a href="/" style={{ color:"#a78bfa", textDecoration:"none" }}>Play →</a>
          </div>
        )}

        {!loading && scores.length > 0 && (
          <div style={{ border:"1px solid rgba(255,255,255,0.07)", borderRadius:"6px", overflow:"hidden" }}>
            {scores.map((s, i) => (
              <div key={s.id ?? i} style={{
                padding:"0.7rem 1rem", display:"flex", justifyContent:"space-between", alignItems:"center",
                borderBottom: i < scores.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                background: i < 3 ? `rgba(${i===0?"251,146,60":i===1?"148,163,184":"180,83,9"},0.08)` : "transparent",
              }}>
                <div>
                  <p style={{ fontFamily:"monospace", color: i < 3 ? MEDALS[i] : "#94a3b8", fontWeight: i < 3 ? "bold" : "normal", margin:0 }}>
                    #{i+1} {s.handle}
                  </p>
                  <p style={{ fontSize:"0.7rem", color:"rgba(255,255,255,0.3)", margin:"0.15rem 0 0", fontFamily:"monospace" }}>
                    LVL {s.level} · {s.kills} kills
                  </p>
                </div>
                <p style={{ fontSize:"1.1rem", fontWeight:"bold", color:"#a78bfa", fontFamily:"monospace", margin:0 }}>
                  {(s.score ?? 0).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop:"2rem", textAlign:"center" }}>
          <a href="/" style={{ color:"#a78bfa", textDecoration:"none", fontFamily:"monospace", fontSize:"0.85rem" }}>← Play</a>
        </div>
      </div>
    </main>
  )
}
