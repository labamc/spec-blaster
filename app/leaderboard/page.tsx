"use client"
import { useEffect, useState } from "react"

// Atono design tokens
const A = {
  bg:          "#14141a",
  raised:      "#1e1e24",
  border:      "rgba(255,255,255,0.07)",
  text:        "#f5f5f5",
  textSub:     "#d8d7d8",
  textMuted:   "#a09fa2",
  purple:      "#966bec",
  btnBorder:   "#4c4c51",
}

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
    <main style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"1rem", background:A.bg }}>
      <div style={{ width:"100%", maxWidth:"520px" }}>

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:"2rem" }}>
          <div style={{ fontSize:"2rem", marginBottom:"0.5rem" }}>🦫</div>
          <h1 style={{ fontSize:"1.25rem", fontWeight:600, color:A.purple, letterSpacing:"0.08em", marginBottom:"0.3rem" }}>Leaderboard</h1>
          <p style={{ color:A.textMuted, fontSize:"0.78rem" }}>Spec Blaster Hall of Fame</p>
        </div>

        {/* States */}
        {loading && (
          <p style={{ textAlign:"center", color:A.textMuted, fontSize:"0.85rem" }}>Loading...</p>
        )}

        {!loading && scores.length === 0 && (
          <div style={{ background:A.raised, border:`1px solid ${A.border}`, borderRadius:"6px", padding:"2.5rem", textAlign:"center" }}>
            <p style={{ color:A.textMuted, fontSize:"0.85rem", marginBottom:"1rem" }}>No scores yet. Be the first.</p>
            <a href="/" style={{ color:A.purple, textDecoration:"none", fontSize:"0.85rem" }}>Play →</a>
          </div>
        )}

        {!loading && scores.length > 0 && (
          <div style={{ background:A.raised, border:`1px solid ${A.border}`, borderRadius:"6px", overflow:"hidden" }}>
            {scores.map((s, i) => (
              <div key={s.id ?? i} style={{
                padding:"0.75rem 1rem",
                display:"flex", justifyContent:"space-between", alignItems:"center",
                borderBottom: i < scores.length - 1 ? `1px solid ${A.border}` : "none",
                background: i < 3 ? `rgba(${i===0?"251,146,60":i===1?"148,163,184":"180,83,9"},0.06)` : "transparent",
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
                  {/* rank dot */}
                  <span style={{ width:8, height:8, borderRadius:"50%", background: i < 3 ? MEDALS[i] : A.btnBorder, display:"inline-block", flexShrink:0 }} />
                  <div>
                    <p style={{ color: i < 3 ? MEDALS[i] : A.textSub, fontWeight: i < 3 ? 600 : 400, fontSize:"0.875rem", marginBottom:"0.1rem" }}>
                      {s.handle}
                    </p>
                    <p style={{ color:A.textMuted, fontSize:"0.7rem", fontFamily:"monospace" }}>
                      LVL {s.level} · {s.kills} kills
                    </p>
                  </div>
                </div>
                <p style={{ color:A.purple, fontWeight:600, fontSize:"1rem", fontFamily:"monospace" }}>
                  {(s.score ?? 0).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop:"1.5rem", textAlign:"center" }}>
          <a href="/" style={{ color:A.purple, textDecoration:"none", fontSize:"0.85rem", opacity:0.7 }}>← Play</a>
        </div>
      </div>
    </main>
  )
}
