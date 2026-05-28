"use client"

import { useEffect, useRef, useState } from "react"

// ── Constants ──────────────────────────────────────────────────────────────
const GW = 600
const GH = 420
const PLAYER_Y = GH - 50
const MAX_LIVES = 3
const WORDS_TO_BOSS = 15

const BUG_WORDS = ["seamlessly", "real-time", "automatically", "zero latency", "scalable", "robust", "synergy", "leverage"]
const STORY_WORDS = ["as a user", "I want to", "so that I", "acceptance criteria", "definition of done", "epic", "spike", "backlog"]
const POWERUP_WORDS = ["KNOWLEDGE", "FLAG", "ENGAGE", "TIMEBOX"]
const SDLC_PHASES = ["DISCOVER", "DEFINE", "DESIGN", "DELIVER"]

const BOSSES = [
  { name: "THE BACKLOG",    hp: 30,  color: "#f87171", shootInterval: 90 },
  { name: "SPRINT ZERO",   hp: 50,  color: "#fb923c", shootInterval: 70 },
  { name: "THE INTEGRATION", hp: 70, color: "#facc15", shootInterval: 55 },
  { name: "THE RELEASE",   hp: 100, color: "#4ade80", shootInterval: 40 },
]

const CAPY_DIALOG = [
  ["Nice refactor.", "The backlog is...\nlighter.", "Sprint Zero awaits."],
  ["Sprint velocity: max.", "The team is aligned.", "Watch for merge conflicts."],
  ["Green pipeline.", "Tests passing.", "One boss stands between\nyou and production."],
  ["SHIPPED.", "Capy is proud.", "Endless mode unlocked.\nSurvive forever."],
]

// ── Audio ──────────────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null
function getAudio() {
  if (!audioCtx) try { audioCtx = new AudioContext() } catch { return null }
  return audioCtx
}
function tone(freq: number, dur: number, vol = 0.25, type: OscillatorType = "square") {
  const ctx = getAudio(); if (!ctx) return
  try {
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = type; osc.frequency.value = freq
    gain.gain.setValueAtTime(vol, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    osc.start(); osc.stop(ctx.currentTime + dur)
  } catch {}
}
const sfx = {
  shoot:     () => tone(880, 0.07, 0.15),
  kill:      () => tone(1320, 0.09, 0.2),
  bossHit:   () => tone(440, 0.12, 0.25),
  bossDead:  () => { tone(523, 0.15, 0.35); setTimeout(() => tone(659, 0.15, 0.35), 130); setTimeout(() => tone(784, 0.3, 0.4), 270) },
  powerup:   () => { tone(600, 0.08, 0.3); setTimeout(() => tone(900, 0.08, 0.3), 90); setTimeout(() => tone(1200, 0.15, 0.3), 180) },
  hit:       () => tone(160, 0.4, 0.35, "sawtooth"),
}

// ── Types ──────────────────────────────────────────────────────────────────
interface Word     { x: number; y: number; text: string; type: "bug"|"story"|"powerup"; spd: number }
interface Bullet   { x: number; y: number; vx?: number; vy?: number; enemy?: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; glyph: string; col: string }
interface Boss     { x: number; y: number; hp: number; maxHp: number; name: string; color: string; dir: number; t: number; phase: number }
interface GState {
  px: number; lives: number; score: number; kills: number; level: number; endless: boolean
  words: Word[]; bullets: Bullet[]; particles: Particle[]; boss: Boss | null
  keys: Set<string>; lastShot: number; lastWord: number; wordsKilled: number; bossSpawned: boolean
  shield: boolean; shieldEnd: number; triple: boolean; tripleEnd: number; fast: boolean; fastEnd: number
  invuln: boolean; invulnEnd: number; W: number; running: boolean
}

function initState(W: number): GState {
  return {
    px: W / 2, lives: MAX_LIVES, score: 0, kills: 0, level: 1, endless: false,
    words: [], bullets: [], particles: [], boss: null,
    keys: new Set(), lastShot: 0, lastWord: 0, wordsKilled: 0, bossSpawned: false,
    shield: false, shieldEnd: 0, triple: false, tripleEnd: 0, fast: false, fastEnd: 0,
    invuln: false, invulnEnd: 0, W, running: false,
  }
}

// ── Component ──────────────────────────────────────────────────────────────
export default function HomePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const rafRef    = useRef(0)
  const G         = useRef<GState>(initState(GW))

  const [phase, setPhase]           = useState<"attract"|"playing"|"capy"|"over">("attract")
  const [score, setScore]           = useState(0)
  const [level, setLevel]           = useState(1)
  const [lives, setLives]           = useState(MAX_LIVES)
  const [capyLines, setCapyLines]   = useState<string[]>([])
  const [capyIdx, setCapyIdx]       = useState(0)
  const capyIdxRef                  = useRef(0)
  const capyLinesRef                = useRef<string[]>([])
  const phaseRef                    = useRef("attract")

  function startGame() {
    const g = G.current
    const W = g.W
    Object.assign(g, initState(W))
    g.running = true
    setScore(0); setLevel(1); setLives(MAX_LIVES)
    phaseRef.current = "playing"
    setPhase("playing")
  }

  function advanceCapy() {
    const next = capyIdxRef.current + 1
    if (next < capyLinesRef.current.length) {
      capyIdxRef.current = next
      setCapyIdx(next)
    } else {
      // proceed
      capyIdxRef.current = 0
      setCapyIdx(0)
      const g = G.current
      g.running = true
      g.bossSpawned = false
      g.wordsKilled = 0
      phaseRef.current = "playing"
      setPhase("playing")
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext("2d")!

    function resize() {
      const w = Math.min(wrap!.offsetWidth, 800)
      canvas!.width = w; canvas!.height = GH
      G.current.W = w
      if (!G.current.running) G.current.px = w / 2
    }
    resize()
    window.addEventListener("resize", resize)

    function onKey(e: KeyboardEvent) {
      if ([" ","ArrowLeft","ArrowRight"].includes(e.key)) e.preventDefault()
      if (e.type === "keydown") G.current.keys.add(e.key)
      else G.current.keys.delete(e.key)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup",   onKey)

    // touch: move & auto-fire
    canvas.addEventListener("touchmove", (e) => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      G.current.px = Math.max(20, Math.min(G.current.W - 20,
        (e.touches[0].clientX - r.left) * (canvas.width / r.width)))
    }, { passive: false })
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      G.current.px = Math.max(20, Math.min(G.current.W - 20,
        (e.touches[0].clientX - r.left) * (canvas.width / r.width)))
      G.current.keys.add(" ")
    }, { passive: false })
    canvas.addEventListener("touchend", () => G.current.keys.delete(" "), { passive: false })

    // ── main loop ────────────────────────────────────────────────────────
    function loop() {
      rafRef.current = requestAnimationFrame(loop)
      const g = G.current
      if (!g.running) return

      const now = Date.now()
      const spd = g.fast && now < g.fastEnd ? 8 : 5

      // expire powerups
      if (g.shield && now > g.shieldEnd) g.shield = false
      if (g.triple && now > g.tripleEnd) g.triple = false
      if (g.fast   && now > g.fastEnd)   g.fast   = false
      if (g.invuln && now > g.invulnEnd) g.invuln = false

      // move player
      if (g.keys.has("ArrowLeft") || g.keys.has("a")) g.px = Math.max(20, g.px - spd)
      if (g.keys.has("ArrowRight") || g.keys.has("d")) g.px = Math.min(g.W - 20, g.px + spd)

      // shoot
      if (g.keys.has(" ") && now - g.lastShot > 175) {
        g.bullets.push({ x: g.px, y: PLAYER_Y - 20 })
        if (g.triple) {
          g.bullets.push({ x: g.px - 16, y: PLAYER_Y - 14 })
          g.bullets.push({ x: g.px + 16, y: PLAYER_Y - 14 })
        }
        g.lastShot = now
        sfx.shoot()
      }

      // spawn words (not during boss fight unless endless)
      if (!g.boss || g.endless) {
        const interval = Math.max(380, 1600 - g.level * 180 - (g.endless ? Math.floor(g.score / 600) * 40 : 0))
        if (now - g.lastWord > interval) {
          g.lastWord = now
          const roll = Math.random()
          let type: Word["type"] = "story", text = ""
          if (roll < 0.14) { type = "bug";     text = BUG_WORDS[Math.floor(Math.random() * BUG_WORDS.length)] }
          else if (roll < 0.21) { type = "powerup"; text = POWERUP_WORDS[Math.floor(Math.random() * POWERUP_WORDS.length)] }
          else              { text = STORY_WORDS[Math.floor(Math.random() * STORY_WORDS.length)] }
          const spd2 = 1.3 + g.level * 0.25 + (g.endless ? Math.floor(g.score / 800) * 0.12 : 0)
          g.words.push({ x: 30 + Math.random() * (g.W - 60), y: -18, text, type, spd: spd2 })
        }
      }

      // spawn boss
      if (!g.boss && !g.bossSpawned && !g.endless && g.wordsKilled >= WORDS_TO_BOSS) {
        g.bossSpawned = true
        g.words = []
        const bd = BOSSES[g.level - 1]
        g.boss = { x: g.W / 2, y: 70, hp: bd.hp, maxHp: bd.hp, name: bd.name, color: bd.color, dir: 1, t: 0, phase: g.level }
      }

      // boss AI
      if (g.boss) {
        const b = g.boss
        b.x += b.dir * (1.4 + b.phase * 0.35)
        if (b.x > g.W - 50 || b.x < 50) b.dir *= -1
        b.t++
        const si = BOSSES[g.level - 1]?.shootInterval ?? 60
        if (b.t % si === 0) {
          if (b.phase === 1) {
            // straight down
            g.bullets.push({ x: b.x, y: b.y + 28, vy: 4, enemy: true })
          } else if (b.phase === 2) {
            // 3-wide spread
            for (const ox of [-22, 0, 22])
              g.bullets.push({ x: b.x + ox, y: b.y + 28, vy: 3.5, enemy: true })
          } else if (b.phase === 3) {
            // aimed at player
            const dx = g.px - b.x, dy = PLAYER_Y - b.y
            const dist = Math.sqrt(dx*dx + dy*dy)
            g.bullets.push({ x: b.x, y: b.y + 28, vx: (dx/dist)*5, vy: (dy/dist)*5, enemy: true })
          } else {
            // phase 4: aimed + flanking
            const dx = g.px - b.x, dy = PLAYER_Y - b.y
            const dist = Math.sqrt(dx*dx + dy*dy)
            g.bullets.push({ x: b.x, y: b.y + 28, vx: (dx/dist)*5.5, vy: (dy/dist)*5.5, enemy: true })
            g.bullets.push({ x: b.x - 30, y: b.y + 28, vy: 5, enemy: true })
            g.bullets.push({ x: b.x + 30, y: b.y + 28, vy: 5, enemy: true })
          }
        }
      }

      // move bullets
      g.bullets = g.bullets.filter(b => {
        b.y += b.vy ?? (b.enemy ? 4 : -9)
        if (b.vx) b.x += b.vx
        return b.enemy ? b.y < GH + 10 : b.y > -10
      })

      // move words — lose life if word escapes
      g.words = g.words.filter(w => {
        w.y += w.spd
        if (w.y > GH + 20) {
          if (w.type !== "powerup" && !g.invuln) {
            loseLife(g, now)
          }
          return false
        }
        return true
      })

      // particles
      g.particles = g.particles.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.14; p.life -= 0.025; return p.life > 0
      })

      // player bullets vs words
      outer:
      for (let i = g.bullets.length - 1; i >= 0; i--) {
        if (g.bullets[i].enemy) continue
        const b = g.bullets[i]
        for (let j = g.words.length - 1; j >= 0; j--) {
          const w = g.words[j]
          const hw = w.text.length * 5.5 + 8
          if (Math.abs(b.x - w.x) < hw && Math.abs(b.y - w.y) < 14) {
            g.score += w.type === "bug" ? 75 : w.type === "powerup" ? 0 : 10
            g.kills++; g.wordsKilled++
            if (w.type === "powerup") applyPowerup(g, w.text, now)
            const col = w.type === "bug" ? "#fdba74" : w.type === "powerup" ? "#4ade80" : "#7dd3fc"
            spawnParticles(g, w.x, w.y, col, w.type === "powerup" ? "★" : "✦", 7)
            sfx.kill()
            g.words.splice(j, 1)
            g.bullets.splice(i, 1)
            continue outer
          }
        }
      }

      // player bullets vs boss
      if (g.boss) {
        for (let i = g.bullets.length - 1; i >= 0; i--) {
          if (g.bullets[i].enemy) continue
          const b = g.bullets[i], bx = g.boss
          if (Math.abs(b.x - bx.x) < 50 && Math.abs(b.y - bx.y) < 28) {
            bx.hp--; g.score += 5
            g.bullets.splice(i, 1)
            sfx.bossHit()
            spawnParticles(g, bx.x + (Math.random()-0.5)*40, bx.y, bx.color, "✦", 4)
            if (bx.hp <= 0) {
              sfx.bossDead()
              g.score += 500
              spawnParticles(g, bx.x, bx.y, bx.color, "★", 20)
              g.boss = null
              g.running = false
              const lvl = g.level
              g.level++
              setLevel(g.level); setScore(g.score); setLives(g.lives)
              const lines = CAPY_DIALOG[lvl - 1] || ["You made it.", "Keep shipping."]
              capyLinesRef.current = lines
              capyIdxRef.current = 0
              setCapyLines(lines); setCapyIdx(0)
              phaseRef.current = "capy"
              setPhase("capy")
              break
            }
          }
        }
      }

      // enemy bullets vs player
      if (!g.invuln) {
        for (let i = g.bullets.length - 1; i >= 0; i--) {
          const b = g.bullets[i]
          if (!b.enemy) continue
          if (Math.abs(b.x - g.px) < (g.shield ? 22 : 14) && Math.abs(b.y - PLAYER_Y) < (g.shield ? 22 : 14)) {
            g.bullets.splice(i, 1)
            if (g.shield) { g.shield = false; sfx.powerup() }
            else loseLife(g, now)
          }
        }
      }

      setScore(g.score); setLives(g.lives)

      // ── draw ─────────────────────────────────────────────────────────
      draw(ctx, g, canvas.width, now)
    }

    function loseLife(g: GState, now: number) {
      g.lives--; setLives(g.lives); sfx.hit()
      g.invuln = true; g.invulnEnd = now + 1600
      if (g.lives <= 0) {
        g.running = false
        setScore(g.score); setLevel(g.level)
        phaseRef.current = "over"; setPhase("over")
      }
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener("resize",   resize)
      window.removeEventListener("keydown",  onKey)
      window.removeEventListener("keyup",    onKey)
    }
  }, [])

  return (
    <main style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"0.5rem", background:"#0d0d14" }}>
      <div style={{ width:"100%", maxWidth:"800px" }}>
        <div style={{ marginBottom:"0.5rem", textAlign:"center" }}>
          <h1 style={{ fontSize:"1.4rem", fontWeight:"bold", color:"#966bec", letterSpacing:"0.15em", fontFamily:"monospace", margin:0 }}>SPEC BLASTER</h1>
        </div>
        <div ref={wrapRef} style={{ position:"relative", width:"100%", borderRadius:"6px", overflow:"hidden", border:"1px solid rgba(255,255,255,0.08)" }}>

          {phase === "attract" && (
            <Overlay onClick={startGame}>
              <div style={{ background:"#1e1e24", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"6px", padding:"2rem 2.5rem", maxWidth:"380px" }}>
                <div style={{ fontSize:"2.75rem", marginBottom:"0.75rem" }}>🦫</div>
                <p style={{ color:"#966bec", fontSize:"1.1rem", fontWeight:600, marginBottom:"0.3rem", letterSpacing:"0.1em" }}>SPEC BLASTER</p>
                <p style={{ color:"#a09fa2", fontSize:"0.8rem", marginBottom:"1.5rem" }}>Shoot the vague specs. Survive the SDLC.</p>
                <div style={{ display:"flex", flexDirection:"column", gap:"0.4rem", marginBottom:"1.75rem", textAlign:"left" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"0.6rem", fontSize:"0.78rem", color:"#d8d7d8" }}>
                    <span style={{ width:8, height:8, borderRadius:"50%", background:"#fdba74", display:"inline-block", flexShrink:0 }} />
                    bugs — <span style={{ color:"#a09fa2" }}>vague language, +75pts</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:"0.6rem", fontSize:"0.78rem", color:"#d8d7d8" }}>
                    <span style={{ width:8, height:8, borderRadius:"50%", background:"#7dd3fc", display:"inline-block", flexShrink:0 }} />
                    stories — <span style={{ color:"#a09fa2" }}>user requirements, +10pts</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:"0.6rem", fontSize:"0.78rem", color:"#d8d7d8" }}>
                    <span style={{ width:8, height:8, borderRadius:"50%", background:"#4ade80", display:"inline-block", flexShrink:0 }} />
                    powerups — <span style={{ color:"#a09fa2" }}>KNOWLEDGE · FLAG · ENGAGE · TIMEBOX</span>
                  </div>
                </div>
                <div style={{ background:"#966bec", color:"#fff", borderRadius:"4px", padding:"0.5rem 1.25rem", fontSize:"0.85rem", fontWeight:500, display:"inline-block" }}>
                  Start game
                </div>
              </div>
            </Overlay>
          )}

          {phase === "capy" && (
            <Overlay onClick={advanceCapy}>
              <div style={{ maxWidth:"360px" }}>
                <div style={{ fontSize:"3rem", marginBottom:"1rem" }}>🦫</div>
                <div className="capy-glow" style={{ background:"#1e1e24", border:"1px solid rgba(150,107,236,0.3)", borderRadius:"6px", padding:"1.1rem 1.5rem", marginBottom:"1rem" }}>
                  <p style={{ color:"#f5f5f5", fontSize:"0.9rem", lineHeight:1.75, margin:0, whiteSpace:"pre-line" }}>
                    {capyLines[capyIdx]}
                  </p>
                </div>
                <p style={{ color:"#a09fa2", fontSize:"0.72rem", marginBottom:"0.5rem" }}>click to continue</p>
                {level <= 4 && BOSSES[level - 1] && (
                  <p style={{ color:"#966bec", fontSize:"0.72rem", fontWeight:500 }}>
                    Next: {BOSSES[level - 1].name}
                  </p>
                )}
                {level > 4 && (
                  <p style={{ color:"#4ade80", fontSize:"0.72rem", fontWeight:500 }}>ENDLESS MODE</p>
                )}
              </div>
            </Overlay>
          )}

          {phase === "over" && (
            <GameOver score={score} level={level} kills={G.current.kills} onRestart={startGame} />
          )}

          <canvas ref={canvasRef} height={GH} style={{ display:"block", width:"100%", height:GH }} />
        </div>
        <div style={{ marginTop:"0.4rem", display:"flex", justifyContent:"space-between", fontSize:"0.65rem", color:"#a09fa2", fontFamily:"monospace", padding:"0 2px" }}>
          <span style={{ color:"rgba(255,255,255,0.2)" }}>← → / A D move · SPACE shoot</span>
          <a href="/leaderboard" style={{ color:"#966bec", textDecoration:"none", opacity:0.6 }}>leaderboard →</a>
        </div>
      </div>
    </main>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function applyPowerup(g: GState, text: string, now: number) {
  sfx.powerup()
  if (text === "KNOWLEDGE") { g.words = []; g.score += 50 }
  else if (text === "FLAG")     { g.shield = true; g.shieldEnd = now + 6000 }
  else if (text === "ENGAGE")   { g.triple = true; g.tripleEnd = now + 8000 }
  else if (text === "TIMEBOX")  { g.fast   = true; g.fastEnd   = now + 5000 }
}

function spawnParticles(g: GState, x: number, y: number, col: string, glyph: string, n: number) {
  for (let i = 0; i < n; i++)
    g.particles.push({ x, y, vx: (Math.random()-0.5)*8, vy: (Math.random()-0.5)*7-2, life: 1, glyph, col })
}

function draw(ctx: CanvasRenderingContext2D, g: GState, cw: number, now: number) {
  // background
  ctx.fillStyle = "#0d0d14"
  ctx.fillRect(0, 0, cw, GH)

  // journey bar
  const jy = GH - 20, jx = 16, jw = cw - 32
  ctx.fillStyle = "rgba(255,255,255,0.06)"
  ctx.fillRect(jx, jy, jw, 8)
  const prog = g.endless ? 1 : Math.min(1, ((g.level - 1) + (g.boss ? (1 - g.boss.hp / g.boss.maxHp) * 0.85 : 0)) / 4)
  ctx.fillStyle = "#966bec"
  ctx.fillRect(jx, jy, jw * prog, 8)
  ctx.font = "8px monospace"; ctx.textAlign = "center"
  SDLC_PHASES.forEach((ph, i) => {
    const lx = jx + jw * (i / 4) + jw / 8
    ctx.fillStyle = i < g.level || g.endless ? "#966bec" : "rgba(255,255,255,0.18)"
    ctx.fillText(ph, lx, jy - 3)
  })

  // words
  ctx.font = "11px monospace"; ctx.textAlign = "center"
  g.words.forEach(w => {
    ctx.fillStyle = w.type === "bug" ? "#fdba74" : w.type === "powerup" ? "#4ade80" : "#7dd3fc"
    ctx.fillText(w.text, w.x, w.y)
  })

  // boss
  if (g.boss) {
    const b = g.boss
    const pulse = 0.55 + 0.45 * Math.sin(now / 180)
    ctx.save()
    ctx.shadowColor = b.color; ctx.shadowBlur = 18 * pulse
    ctx.fillStyle = b.color
    roundRect(ctx, b.x - 50, b.y - 28, 100, 56, 8)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = "#0d0d14"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center"
    ctx.fillText(b.name, b.x, b.y - 11)
    // hp bar
    const hpPct = b.hp / b.maxHp
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(b.x - 42, b.y + 4, 84, 7)
    ctx.fillStyle = hpPct > 0.5 ? "#4ade80" : hpPct > 0.25 ? "#facc15" : "#f87171"
    ctx.fillRect(b.x - 42, b.y + 4, 84 * hpPct, 7)
  }

  // bullets
  g.bullets.forEach(b => {
    if (!b.enemy) {
      ctx.fillStyle = g.triple ? "#4ade80" : "#966bec"
      ctx.fillRect(b.x - 2, b.y - 11, 4, 14)
    } else {
      ctx.fillStyle = "#f87171"
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill()
    }
  })

  // player ship
  const flash = g.invuln && Math.floor(now / 90) % 2 === 0
  if (!flash) {
    ctx.fillStyle = g.shield ? "#4ade80" : "#e2e8f0"
    ctx.beginPath()
    ctx.moveTo(g.px, PLAYER_Y - 18)
    ctx.lineTo(g.px - 13, PLAYER_Y + 7)
    ctx.lineTo(g.px + 13, PLAYER_Y + 7)
    ctx.closePath(); ctx.fill()
    if (g.shield) {
      ctx.strokeStyle = "rgba(74,222,128,0.55)"; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(g.px, PLAYER_Y - 5, 24, 0, Math.PI*2); ctx.stroke()
      ctx.lineWidth = 1
    }
  }

  // particles
  g.particles.forEach(p => {
    ctx.globalAlpha = p.life
    ctx.fillStyle = p.col; ctx.font = "11px monospace"; ctx.textAlign = "center"
    ctx.fillText(p.glyph, p.x, p.y)
  }); ctx.globalAlpha = 1

  // HUD top-left: score + level
  ctx.textAlign = "left"; ctx.font = "12px monospace"
  ctx.fillStyle = "#966bec"; ctx.fillText(g.score.toLocaleString(), 10, 20)
  ctx.fillStyle = "rgba(255,255,255,0.4)"
  ctx.fillText(g.endless ? "ENDLESS" : `LVL ${g.level}`, 10, 36)

  // HUD top-right: lives
  ctx.textAlign = "right"; ctx.fillStyle = "#f87171"
  ctx.fillText("♥".repeat(g.lives) + "♡".repeat(Math.max(0, MAX_LIVES - g.lives)), cw - 10, 20)

  // active powerup indicators
  let pwY = 36; ctx.font = "8px monospace"; ctx.textAlign = "right"
  if (g.shield) { ctx.fillStyle = "#4ade80"; ctx.fillText("SHIELD", cw - 10, pwY); pwY += 13 }
  if (g.triple) { ctx.fillStyle = "#4ade80"; ctx.fillText("ENGAGE", cw - 10, pwY); pwY += 13 }
  if (g.fast)   { ctx.fillStyle = "#4ade80"; ctx.fillText("TIMEBOX", cw - 10, pwY) }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y); ctx.arcTo(x+w, y, x+w, y+r, r)
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r)
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y+h, x, y+h-r, r)
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x+r, y, r)
  ctx.closePath()
}

// ── UI sub-components ──────────────────────────────────────────────────────

function Overlay({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(20,20,26,0.97)", cursor:"pointer", zIndex:10 }}>
      <div style={{ textAlign:"center", padding:"1.5rem" }}>{children}</div>
    </div>
  )
}

function GameOver({ score, level, kills, onRestart }: { score: number; level: number; kills: number; onRestart: () => void }) {
  const [handle, setHandle]       = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)

  async function submit() {
    if (!handle.trim() || submitting) return
    setSubmitting(true)
    try {
      await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: handle.trim().slice(0, 20), score, level, kills }),
      })
      setSubmitted(true)
    } catch { setSubmitted(true) }
    setSubmitting(false)
  }

  return (
    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(20,20,26,0.97)", zIndex:10 }}>
      <div style={{ background:"#1e1e24", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"6px", padding:"2rem", maxWidth:"340px", width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:"2.25rem", marginBottom:"0.6rem" }}>🦫</div>
        <p style={{ color:"#f87171", fontWeight:600, fontSize:"1rem", margin:"0 0 0.2rem" }}>SPEC WINS</p>
        <p style={{ color:"#a09fa2", fontSize:"0.72rem", margin:"0 0 1.25rem" }}>level {level} · {kills} specs destroyed</p>
        <p style={{ color:"#966bec", fontSize:"1.75rem", fontWeight:700, margin:"0 0 1.5rem", fontFamily:"monospace" }}>{score.toLocaleString()}</p>

        {!submitted ? (
          <>
            <input
              value={handle} onChange={e => setHandle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="your handle" maxLength={20}
              style={{ display:"block", margin:"0 auto 0.75rem", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"4px", color:"#f5f5f5", fontSize:"0.85rem", padding:"0.5rem 0.75rem", width:"200px", outline:"none", textAlign:"center" }}
            />
            <button onClick={submit} disabled={!handle.trim() || submitting}
              style={{ background:"#966bec", color:"#fff", border:"none", borderRadius:"4px", padding:"0.5rem 1.5rem", fontWeight:500, cursor:handle.trim() ? "pointer" : "default", opacity:handle.trim() ? 1 : 0.4, marginBottom:"1rem", fontSize:"0.85rem" }}>
              {submitting ? "saving..." : "Submit score"}
            </button>
          </>
        ) : (
          <p style={{ color:"#4ade80", fontSize:"0.85rem", margin:"0 0 1rem" }}>Score saved 🦫</p>
        )}

        <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:"1rem", display:"flex", gap:"0.75rem", justifyContent:"center" }}>
          <button onClick={onRestart}
            style={{ background:"transparent", border:"1px solid #4c4c51", borderRadius:"4px", padding:"0.4rem 1rem", color:"#d8d7d8", cursor:"pointer", fontSize:"0.8rem" }}>
            Play again
          </button>
          <a href="/leaderboard"
            style={{ border:"1px solid rgba(255,255,255,0.08)", borderRadius:"4px", padding:"0.4rem 1rem", color:"#a09fa2", textDecoration:"none", fontSize:"0.8rem" }}>
            Leaderboard
          </a>
        </div>
      </div>
    </div>
  )
}
