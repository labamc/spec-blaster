"use client"

import { useEffect, useRef, useState } from "react"

const CANVAS_H = 340
const LANDMINE_WORDS = ["seamlessly", "real-time", "automatically", "zero latency", "scalable"]
const AMBIGUITY_WORDS = ["quickly", "efficiently", "relevant", "important", "better"]

export default function HomePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const [phase, setPhase] = useState("attract")
  const [score, setScore] = useState(0)
  const [started, setStarted] = useState(false)

  const G = useRef({
    playerX: 300, score: 0, kills: 0, bullets: [] as any[], words: [] as any[], particles: [] as any[],
    keys: new Set<string>(), lastBullet: 0, W: 600, running: false, lastWaveTime: 0,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext("2d")!

    canvas.width = container.offsetWidth
    canvas.height = CANVAS_H
    G.current.W = canvas.width
    G.current.playerX = canvas.width / 2

    const handleKeyDown = (e: KeyboardEvent) => {
      if ([" ", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault()
      G.current.keys.add(e.key)
    }
    const handleKeyUp = (e: KeyboardEvent) => G.current.keys.delete(e.key)

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    const loop = () => {
      if (!G.current.running) { rafRef.current = requestAnimationFrame(loop); return }

      const g = G.current, now = Date.now()

      if (g.keys.has("ArrowLeft") || g.keys.has("a")) g.playerX = Math.max(20, g.playerX - 5)
      if (g.keys.has("ArrowRight") || g.keys.has("d")) g.playerX = Math.min(g.W - 20, g.playerX + 5)
      if (g.keys.has(" ") && now - g.lastBullet > 220) {
        g.bullets.push({ x: g.playerX, y: CANVAS_H - 44 })
        g.lastBullet = now
      }

      g.bullets = g.bullets.filter((b: any) => (b.y -= 9) > 0)
      g.words = g.words.filter((w: any) => (w.y += 2) < CANVAS_H + 20)
      g.particles = g.particles.filter((p: any) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life -= 0.02; return p.life > 0
      })

      if (now - g.lastWaveTime > 2000) {
        const words = [...LANDMINE_WORDS, ...AMBIGUITY_WORDS]
        g.words.push({ x: Math.random() * g.W, y: -20, text: words[Math.floor(Math.random() * words.length)], type: Math.random() < 0.3 ? "bug" : "normal" })
        g.lastWaveTime = now
      }

      for (let i = g.bullets.length - 1; i >= 0; i--) {
        const b = g.bullets[i]
        for (let j = g.words.length - 1; j >= 0; j--) {
          const w = g.words[j]
          if (Math.abs(b.x - w.x) < 20 && Math.abs(b.y - w.y) < 20) {
            g.score += w.type === "bug" ? 75 : 10
            g.kills++
            g.words.splice(j, 1)
            g.bullets.splice(i, 1)
            for (let p = 0; p < 5; p++) g.particles.push({ x: w.x, y: w.y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6 - 2, life: 1, text: "✦" })
            break
          }
        }
      }

      ctx.fillStyle = "#14141a"
      ctx.fillRect(0, 0, canvas.width, CANVAS_H)
      ctx.fillStyle = "rgba(255,255,255,0.7)"
      ctx.font = "12px monospace"
      ctx.fillText(`SCORE ${g.score}`, 10, 20)
      ctx.fillText(`KILLS ${g.kills}`, 10, 35)

      g.words.forEach((w: any) => {
        ctx.fillStyle = w.type === "bug" ? "#fdba74" : "#94a3b8"
        ctx.font = "10px monospace"
        ctx.fillText(w.text, w.x - 20, w.y)
      })

      ctx.fillStyle = "#966bec"
      g.bullets.forEach((b: any) => ctx.fillRect(b.x - 1.5, b.y - 8, 3, 12))

      ctx.fillStyle = "#f8fafc"
      ctx.beginPath()
      ctx.moveTo(g.playerX, CANVAS_H - 26 - 16)
      ctx.lineTo(g.playerX - 10, CANVAS_H - 26 + 4)
      ctx.lineTo(g.playerX + 10, CANVAS_H - 26 + 4)
      ctx.closePath()
      ctx.fill()

      ctx.font = "10px monospace"
      g.particles.forEach((p: any) => {
        ctx.globalAlpha = p.life
        ctx.fillStyle = "#966bec"
        ctx.fillText(p.text, p.x, p.y)
      })
      ctx.globalAlpha = 1

      setScore(g.score)
      if (g.kills >= 20) {
        G.current.running = false
        setPhase("game_over")
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [])

  return (
    <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "1rem" }}>
      <div style={{ width: "100%", maxWidth: "800px" }}>
        <div style={{ marginBottom: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", color: "#966bec" }}>SPEC BLASTER</h1>
        </div>
        <div ref={containerRef} style={{ position: "relative", width: "100%", height: CANVAS_H, border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px", overflow: "hidden" }}>
          {!started && phase === "attract" && (
            <div style={{ position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(20,20,26,0.9)", cursor: "pointer", zIndex: 10 }} onClick={() => { setStarted(true); setPhase("playing"); G.current.running = true }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🦫</div>
                <p style={{ fontFamily: "monospace", color: "#966bec" }}>Click to start</p>
              </div>
            </div>
          )}
          {phase === "game_over" && (
            <div style={{ position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(20,20,26,0.95)", zIndex: 10 }}>
              <div style={{ textAlign: "center" }}>
                <p style={{ color: "#f87171", marginBottom: "1rem", fontWeight: "bold" }}>SPEC WINS</p>
                <p style={{ color: "rgba(255,255,255,0.6)" }}>Score: {score}</p>
              </div>
            </div>
          )}
          <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
        </div>
        <div style={{ marginTop: "1rem", fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", textAlign: "center" }}>← → move · space shoot</div>
      </div>
    </main>
  )
}