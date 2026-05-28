"use client"
import { useEffect, useState } from "react"

const A = {
  bg:        "#14141a",
  raised:    "#1e1e24",
  border:    "rgba(255,255,255,0.07)",
  text:      "#f5f5f5",
  textSub:   "#d8d7d8",
  textMuted: "#a09fa2",
  purple:    "#966bec",
  btnBorder: "#4c4c51",
}

const MEDALS = ["#fdba74", "#cbd5e1", "#ea580c"]

function formatAge(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime()
  const s = ms / 1000, m = s / 60, h = m / 60, d = h / 24
  if (s < 90) return "just now"
  if (m < 60) return `${Math.floor(m)}m ago`
  if (h < 24) return `${Math.floor(h)}h ago`
  if (d < 30) return `${Math.floor(d)}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

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

  const topScore = scores[0]?.score ?? 0
  const totalRuns = scores.length

  return (
    <main style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"1rem", background:A.bg }}>
      <div style={{ width:"100%", maxWidth:"520px" }}>

        <div style={{ textAlign:"center", marginBottom:"1.75rem" }}>
          <div style={{ fontSize:"2rem", marginBottom:"0.5rem" }}>🦫</div>
          <h1 style={{ fontSize:"1.25rem", fontWeight:600, color:A.purple, letterSpacing:"0.08em", marginBottom:"0.3rem" }}>Leaderboard</h1>
          <p style={{ color:A.textMuted, fontSize:"0.78rem" }}>Spec Blaster Hall of Fame</p>
          {totalRuns > 0 && (
            <p style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.67rem", fontFamily:"monospace", marginTop:"0.4rem" }}>
              {totalRuns} run{totalRuns !== 1 ? "s" : ""} · top score {topScore.toLocaleString()}
            </p>
          )}
        </div>

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
            {scores.map((s, i) => {
              const barPct = topScore > 0 ? (s.score / topScore) * 100 : 0
              return (
                <div key={s.id ?? i} style={{
                  padding:"0.7rem 1rem",
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  borderBottom: i < scores.length - 1 ? `1px solid ${A.border}` : "none",
                  background: i < 3 ? `rgba(${i===0?"251,146,60":i===1?"148,163,184":"180,83,9"},0.05)` : "transparent",
                  position:"relative", overflow:"hidden",
                }}>
                  {/* subtle score bar bg */}
                  <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${barPct}%`, background:"rgba(150,107,236,0.04)", pointerEvents:"none" }} />
                  <div style={{ display:"flex", alignItems:"center", gap:"0.75rem", zIndex:1 }}>
                    <span style={{ width:8, height:8, borderRadius:"50%", background: i < 3 ? MEDALS[i] : A.btnBorder, display:"inline-block", flexShrink:0 }} />
                    <div>
                      <p style={{ color: i < 3 ? MEDALS[i] : A.textSub, fontWeight: i < 3 ? 600 : 400, fontSize:"0.875rem", marginBottom:"0.1rem" }}>
                        {s.handle}
                      </p>
                      <p style={{ color:A.textMuted, fontSize:"0.68rem", fontFamily:"monospace" }}>
                        LVL {s.level} · {s.kills} kills
                        {s.created_at && <span style={{ color:"rgba(255,255,255,0.18)", marginLeft:"0.5rem" }}>· {formatAge(s.created_at)}</span>}
                      </p>
                    </div>
                  </div>
                  <p style={{ color:A.purple, fontWeight:600, fontSize:"1rem", fontFamily:"monospace", zIndex:1 }}>
                    {(s.score ?? 0).toLocaleString()}
                  </p>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ marginTop:"1.5rem", display:"flex", justifyContent:"center", gap:"1.5rem", alignItems:"center" }}>
          <a href="/" style={{ color:A.purple, textDecoration:"none", fontSize:"0.85rem", opacity:0.7 }}>← Play</a>
          {!loading && scores.length > 0 && (
            <span style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.65rem", fontFamily:"monospace" }}>top {Math.min(50, scores.length)} scores</span>
          )}
        </div>
      </div>
    </main>
  )
}
