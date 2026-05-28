"use client"

import { useEffect, useRef, useState } from "react"

// ── Constants ──────────────────────────────────────────────────────────────
const GW = 600
const GH = 420
const PLAYER_Y = GH - 50
const MAX_LIVES = 3
const WORDS_TO_BOSS = 18

const BUG_WORDS = [
  "seamlessly","real-time","automatically","zero latency","scalable","robust",
  "synergy","leverage","intuitive","paradigm shift","world-class","cutting-edge",
  "disruptive","innovative","game changer","best practice","dynamic","frictionless",
  "bleeding edge","next-gen","holistic","proactive","circle back","low-hanging fruit",
]
const STORY_WORDS = [
  "as a user","I want to","so that I","acceptance criteria","definition of done",
  "epic","spike","backlog","in progress","needs review","blocked","story points",
  "velocity","retrospective","stakeholder","deliverable","out of scope","nice to have",
  "P0","ASAP","fast follow","per the spec","per our conversation","to be defined",
]
const POWERUP_WORDS = ["KNOWLEDGE", "FLAG", "ENGAGE", "TIMEBOX"]
const SDLC_PHASES = ["DISCOVER", "DEFINE", "DESIGN", "DELIVER"]
const BG_CHARS = ["·","∅","→","←","⊗","△","□","◇","/","\\","{}","()","//","=>","??","##","@@"]

const CAPY_PLAY_COMMENTS = [
  "That one had scope creep.",
  "Definition of done:\nnot that.",
  "I'm tracking your velocity.",
  "Technical debt: cleared.",
  "Good catch.",
  "That word was blocking\nsomeone.",
  "Synergy... eliminated.",
  "The spec didn't survive\ncontact with reality.",
  "Nice. Keep going.",
  "I believe in you.",
  "Boss incoming.\nStay focused.",
  "Use KNOWLEDGE\nwhen it appears.",
  "Zigzag words track\nyour position.",
  "What's your\ndefinition of done?",
  "Scope creep\nis a moving target.",
]

// ── Upgrades ───────────────────────────────────────────────────────────────
interface UpgradeDef { id: string; name: string; desc: string; max: number; instant?: (g: GState) => void }
const UPGRADES: UpgradeDef[] = [
  { id: "fire_rate",    name: "QA Cadence",          desc: "Fire 15% faster. Stacks 4×.",              max: 4 },
  { id: "word_slow",    name: "Scope Freeze",         desc: "Words fall 15% slower. Stacks 3×.",        max: 3 },
  { id: "score_mul",    name: "Stakeholder Approval", desc: "+20% score per kill. Stacks 3×.",          max: 3 },
  { id: "triple",       name: "Triple Output",        desc: "Always fire 3 bullets.",                   max: 1 },
  { id: "spray",        name: "Spray & Pray",         desc: "Fire 5 bullets in a wide arc.",            max: 1 },
  { id: "piercing",     name: "Context Anchor",       desc: "Bullets pierce through words.",            max: 1 },
  { id: "shield_regen", name: "Auto Firewall",        desc: "Shield recharges every 25 seconds.",       max: 1 },
  { id: "code_review",  name: "Code Review",          desc: "Your bullets deal 2× damage to bosses.",   max: 1 },
  { id: "extra_life",   name: "Rollback",             desc: "Restore +1 life immediately.",             max: 3,
    instant: (g) => { g.lives = Math.min(g.lives + 1, MAX_LIVES + 2) } },
]

function pickUpgrades(current: Record<string, number>): UpgradeDef[] {
  const available = UPGRADES.filter(u => (current[u.id] ?? 0) < u.max)
  return [...available].sort(() => Math.random() - 0.5).slice(0, Math.min(3, available.length))
}

const BOSSES = [
  { name: "THE BACKLOG",      hp: 30,  color: "#f87171", shootInterval: 90 },
  { name: "SPRINT ZERO",      hp: 50,  color: "#fb923c", shootInterval: 70 },
  { name: "THE INTEGRATION",  hp: 70,  color: "#facc15", shootInterval: 55 },
  { name: "THE RELEASE",      hp: 100, color: "#4ade80", shootInterval: 40 },
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
  shoot:    () => tone(880, 0.07, 0.15),
  kill:     (combo = 1) => tone(1100 + combo * 60, 0.09, 0.18 + combo * 0.02),
  bossHit:  () => tone(440, 0.12, 0.25),
  bossDead: () => {
    tone(523, 0.15, 0.4); setTimeout(() => tone(659, 0.15, 0.4), 130)
    setTimeout(() => tone(784, 0.15, 0.4), 260); setTimeout(() => tone(1047, 0.4, 0.45), 390)
  },
  warning:  () => { tone(220, 0.25, 0.4, "sawtooth"); setTimeout(() => tone(180, 0.4, 0.4, "sawtooth"), 250) },
  powerup:  () => { tone(600, 0.08, 0.3); setTimeout(() => tone(900, 0.08, 0.3), 90); setTimeout(() => tone(1200, 0.15, 0.3), 180) },
  combo:    (n: number) => tone(800 + n * 80, 0.12, 0.3),
  hit:      () => tone(160, 0.4, 0.35, "sawtooth"),
}

// ── Types ──────────────────────────────────────────────────────────────────
type Behavior = "fall" | "charge" | "zigzag" | "sine"
interface Word      { x: number; y: number; text: string; type: "bug"|"story"|"powerup"; spd: number; beh: Behavior; ph: number; ox: number }
interface Bullet    { x: number; y: number; vx?: number; vy?: number; enemy?: boolean }
interface Particle  { x: number; y: number; vx: number; vy: number; life: number; glyph: string; col: string; rot?: number; rotV?: number; sz?: number }
interface BgGlyph   { x: number; y: number; vy: number; a: number; ch: string }
interface Boss      { x: number; y: number; hp: number; maxHp: number; name: string; color: string; dir: number; t: number; phase: number }
interface BossWarn  { name: string; color: string; t: number; letters: Array<{ ch: string; x: number; y: number; tx: number; ty: number }> }
interface GState {
  px: number; lives: number; score: number; kills: number; level: number; endless: boolean
  words: Word[]; bullets: Bullet[]; particles: Particle[]; bg: BgGlyph[]; boss: Boss | null
  keys: Set<string>; lastShot: number; lastWord: number; wordsKilled: number; bossSpawned: boolean
  shield: boolean; shieldEnd: number; triple: boolean; tripleEnd: number; fast: boolean; fastEnd: number
  invuln: boolean; invulnEnd: number; W: number; running: boolean
  upgrades: Record<string, number>; shieldRegenAt: number
  combo: number; lastKill: number; shake: number
  capyMsg: string; capyMsgEnd: number; nextCapyMsg: number
  bossWarn: BossWarn | null; mouseX: number
}

function initState(W: number): GState {
  return {
    px: W / 2, lives: MAX_LIVES, score: 0, kills: 0, level: 1, endless: false,
    words: [], bullets: [], particles: [], boss: null,
    bg: Array.from({ length: 22 }, () => ({
      x: Math.random() * W, y: Math.random() * GH,
      vy: 0.15 + Math.random() * 0.25,
      a: 0.04 + Math.random() * 0.06,
      ch: BG_CHARS[Math.floor(Math.random() * BG_CHARS.length)],
    })),
    keys: new Set(), lastShot: 0, lastWord: 0, wordsKilled: 0, bossSpawned: false,
    shield: false, shieldEnd: 0, triple: false, tripleEnd: 0, fast: false, fastEnd: 0,
    invuln: false, invulnEnd: 0, W, running: false,
    upgrades: {}, shieldRegenAt: 0,
    combo: 1, lastKill: 0, shake: 0,
    capyMsg: "", capyMsgEnd: 0, nextCapyMsg: 0,
    bossWarn: null, mouseX: -1,
  }
}

// ── Component ──────────────────────────────────────────────────────────────
export default function HomePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const rafRef    = useRef(0)
  const G         = useRef<GState>(initState(GW))

  const [phase, setPhase]           = useState<"attract"|"playing"|"capy"|"upgrade"|"over">("attract")
  const [score, setScore]           = useState(0)
  const [level, setLevel]           = useState(1)
  const [lives, setLives]           = useState(MAX_LIVES)
  const [capyLines, setCapyLines]   = useState<string[]>([])
  const [capyIdx, setCapyIdx]       = useState(0)
  const capyIdxRef                  = useRef(0)
  const capyLinesRef                = useRef<string[]>([])
  const phaseRef                    = useRef("attract")
  const pendingCapyRef              = useRef<string[]>([])
  const [upgradeOptions, setUpgradeOptions] = useState<UpgradeDef[]>([])

  function startGame() {
    const g = G.current
    const W = g.W
    Object.assign(g, initState(W))
    g.running = true
    setScore(0); setLevel(1); setLives(MAX_LIVES)
    phaseRef.current = "playing"
    setPhase("playing")
  }

  function onUpgradePick(id: string) {
    const g = G.current
    g.upgrades[id] = (g.upgrades[id] ?? 0) + 1
    const def = UPGRADES.find(u => u.id === id)
    if (def?.instant) def.instant(g)
    setLives(g.lives)
    const lines = pendingCapyRef.current
    capyLinesRef.current = lines; capyIdxRef.current = 0
    setCapyLines(lines); setCapyIdx(0)
    pendingCapyRef.current = []
    phaseRef.current = "capy"; setPhase("capy")
  }

  function advanceCapy() {
    const next = capyIdxRef.current + 1
    if (next < capyLinesRef.current.length) {
      capyIdxRef.current = next; setCapyIdx(next)
    } else {
      capyIdxRef.current = 0; setCapyIdx(0)
      const g = G.current
      g.running = true; g.bossSpawned = false; g.wordsKilled = 0
      phaseRef.current = "playing"; setPhase("playing")
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

    // Mouse controls
    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect()
      G.current.mouseX = (e.clientX - r.left) * (canvas.width / r.width)
    })
    canvas.addEventListener("mousedown", () => G.current.keys.add(" "))
    canvas.addEventListener("mouseup",   () => G.current.keys.delete(" "))
    canvas.addEventListener("mouseleave", () => G.current.keys.delete(" "))

    // Touch controls
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

      // shield regen upgrade
      if (g.upgrades.shield_regen) {
        if (g.shieldRegenAt === 0) g.shieldRegenAt = now + 25000
        if (!g.shield && now > g.shieldRegenAt) {
          g.shield = true; g.shieldEnd = now + 20000; g.shieldRegenAt = now + 25000
        }
      }

      // combo decay
      if (now - g.lastKill > 1300 && g.combo > 1) g.combo = 1

      // capy in-game comments
      if (g.nextCapyMsg === 0) g.nextCapyMsg = now + 22000 + Math.random() * 14000
      if (now > g.nextCapyMsg && !g.capyMsg && !g.bossWarn) {
        g.capyMsg = CAPY_PLAY_COMMENTS[Math.floor(Math.random() * CAPY_PLAY_COMMENTS.length)]
        g.capyMsgEnd = now + 4000
        g.nextCapyMsg = now + 20000 + Math.random() * 15000
      }
      if (g.capyMsg && now > g.capyMsgEnd) g.capyMsg = ""

      // mouse player tracking
      if (g.mouseX >= 0) {
        const dx = g.mouseX - g.px
        if (Math.abs(dx) > 4) g.px += Math.sign(dx) * Math.min(Math.abs(dx) * 0.12, 6)
      }

      // keyboard player movement
      if (g.keys.has("ArrowLeft") || g.keys.has("a")) g.px = Math.max(20, g.px - spd)
      if (g.keys.has("ArrowRight") || g.keys.has("d")) g.px = Math.min(g.W - 20, g.px + spd)

      // thruster particles when moving
      const moving = g.keys.has("ArrowLeft") || g.keys.has("a") || g.keys.has("ArrowRight") || g.keys.has("d")
        || (g.mouseX >= 0 && Math.abs(g.mouseX - g.px) > 8)
      if (moving && Math.random() < 0.45) {
        g.particles.push({
          x: g.px + (Math.random()-0.5)*10, y: PLAYER_Y + 6,
          vx: (Math.random()-0.5)*1.5, vy: 1.5 + Math.random()*2.5,
          life: 0.38, glyph: "·",
          col: Math.random() < 0.5 ? "#fb923c" : "#fde68a",
        })
      }

      // shoot
      const fireInterval = Math.max(75, 175 - (g.upgrades.fire_rate ?? 0) * 22)
      if (g.keys.has(" ") && now - g.lastShot > fireInterval) {
        if (g.upgrades.spray) {
          for (let a = -2; a <= 2; a++)
            g.bullets.push({ x: g.px + a * 10, y: PLAYER_Y - 20, vx: a * 0.8 })
        } else {
          g.bullets.push({ x: g.px, y: PLAYER_Y - 20 })
          if (g.triple || g.upgrades.triple) {
            g.bullets.push({ x: g.px - 16, y: PLAYER_Y - 14 })
            g.bullets.push({ x: g.px + 16, y: PLAYER_Y - 14 })
          }
        }
        g.lastShot = now; sfx.shoot()
      }

      // spawn words (not during boss warning)
      if (!g.bossWarn && ((!g.boss) || g.endless)) {
        const interval = Math.max(360, 1600 - g.level * 180 - (g.endless ? Math.floor(g.score / 600) * 40 : 0))
        if (now - g.lastWord > interval) {
          g.lastWord = now
          const roll = Math.random()
          let type: Word["type"] = "story", text = ""
          if (roll < 0.14)      { type = "bug";     text = BUG_WORDS[Math.floor(Math.random() * BUG_WORDS.length)] }
          else if (roll < 0.21) { type = "powerup"; text = POWERUP_WORDS[Math.floor(Math.random() * POWERUP_WORDS.length)] }
          else                  { text = STORY_WORDS[Math.floor(Math.random() * STORY_WORDS.length)] }
          const slowFactor = Math.pow(0.85, g.upgrades.word_slow ?? 0)
          const spd2 = (1.3 + g.level * 0.25 + (g.endless ? Math.floor(g.score / 800) * 0.12 : 0)) * slowFactor
          const br = Math.random()
          let beh: Behavior = "fall"
          if (type !== "powerup") {
            if      (g.level >= 4 && br < 0.20) beh = "sine"
            else if (g.level >= 3 && br < 0.35) beh = "zigzag"
            else if (g.level >= 2 && br < 0.45) beh = "charge"
          }
          const ox = 30 + Math.random() * (g.W - 60)
          g.words.push({ x: ox, y: -18, text, type, spd: spd2, beh, ph: Math.random() * Math.PI * 2, ox })
        }
      }

      // boss warning animation
      if (g.bossWarn) {
        const bw = g.bossWarn
        bw.t++
        // lerp letters toward target
        bw.letters.forEach(l => {
          l.x += (l.tx - l.x) * 0.14
          l.y += (l.ty - l.y) * 0.14
        })
        if (bw.t === 85) {
          // letters fully assembled — spawn actual boss
          const bd = BOSSES[g.level - 1]
          g.boss = { x: g.W/2, y: 70, hp: bd.hp, maxHp: bd.hp, name: bd.name, color: bd.color, dir: 1, t: 0, phase: g.level }
          g.bossWarn = null
          g.shake = 10
        }
      }

      // spawn boss warning (replaces direct spawn)
      if (!g.boss && !g.bossWarn && !g.bossSpawned && !g.endless && g.wordsKilled >= WORDS_TO_BOSS) {
        g.bossSpawned = true; g.words = []
        const bd = BOSSES[g.level - 1]
        const charW = 18
        const nameW = bd.name.length * charW
        const cx = g.W / 2, cy = GH / 2
        g.bossWarn = {
          name: bd.name, color: bd.color, t: 0,
          letters: bd.name.split("").map((ch, i) => ({
            ch,
            x: Math.random() * g.W,
            y: Math.random() < 0.5 ? -30 - Math.random()*60 : GH + 30 + Math.random()*60,
            tx: cx - nameW/2 + i * charW + charW/2,
            ty: cy,
          })),
        }
        g.shake = 8
        sfx.warning()
      }

      // boss AI
      if (g.boss) {
        const b = g.boss
        b.x += b.dir * (1.4 + b.phase * 0.35)
        if (b.x > g.W - 50 || b.x < 50) b.dir *= -1
        b.t++
        const si = BOSSES[Math.min(g.level - 1, BOSSES.length - 1)]?.shootInterval ?? 60
        if (b.t % si === 0) {
          if (b.phase === 1) {
            g.bullets.push({ x: b.x, y: b.y + 28, vy: 4, enemy: true })
          } else if (b.phase === 2) {
            for (const ox of [-22, 0, 22])
              g.bullets.push({ x: b.x + ox, y: b.y + 28, vy: 3.5, enemy: true })
          } else if (b.phase === 3) {
            const dx = g.px - b.x, dy = PLAYER_Y - b.y, dist = Math.sqrt(dx*dx+dy*dy)
            g.bullets.push({ x: b.x, y: b.y + 28, vx: (dx/dist)*5, vy: (dy/dist)*5, enemy: true })
          } else {
            const dx = g.px - b.x, dy = PLAYER_Y - b.y, dist = Math.sqrt(dx*dx+dy*dy)
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

      // move words (with behaviors)
      g.words = g.words.filter(w => {
        w.y += w.spd
        if (w.beh === "charge") {
          const dx = g.px - w.x
          w.x += Math.sign(dx) * Math.min(Math.abs(dx) * 0.04, 2.2)
        } else if (w.beh === "zigzag") {
          w.ph += 0.07; w.x += Math.sin(w.ph) * 2.8
          w.x = Math.max(30, Math.min(g.W - 30, w.x))
        } else if (w.beh === "sine") {
          w.ph += 0.035
          w.x = Math.max(30, Math.min(g.W - 30, w.ox + Math.sin(w.ph) * 95))
        }
        if (w.y > GH + 20) {
          if (w.type !== "powerup" && !g.invuln) loseLife(g, now)
          return false
        }
        return true
      })

      // background glyphs
      g.bg.forEach(b => {
        b.y += b.vy
        if (b.y > GH + 10) { b.y = -10; b.x = Math.random() * g.W }
      })

      // particles
      g.particles = g.particles.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.14; p.life -= 0.022
        if (p.rotV !== undefined) p.rot = (p.rot ?? 0) + p.rotV
        return p.life > 0
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
            const elapsed = now - g.lastKill
            g.combo = elapsed < 1300 ? g.combo + 1 : 1
            g.lastKill = now
            if (g.combo === 3 || g.combo === 5 || g.combo === 10) sfx.combo(g.combo)
            const base = w.type === "bug" ? 75 : w.type === "powerup" ? 0 : 10
            const mult = g.combo >= 3 ? 1 + (g.combo - 2) * 0.2 : 1
            const pts = Math.floor(base * Math.pow(1.2, g.upgrades.score_mul ?? 0) * mult)
            g.score += pts
            g.kills++; g.wordsKilled++
            if (w.type === "powerup") applyPowerup(g, w, now)
            spawnLetterExplosion(g, w, pts, g.combo)
            sfx.kill(g.combo)
            g.words.splice(j, 1)
            if (g.upgrades.piercing) { break } else { g.bullets.splice(i, 1); continue outer }
          }
        }
      }

      // player bullets vs boss
      if (g.boss) {
        for (let i = g.bullets.length - 1; i >= 0; i--) {
          if (g.bullets[i].enemy) continue
          const b = g.bullets[i], bx = g.boss
          if (Math.abs(b.x - bx.x) < 50 && Math.abs(b.y - bx.y) < 28) {
            const dmg = g.upgrades.code_review ? 2 : 1
            bx.hp -= dmg; g.score += 5
            g.bullets.splice(i, 1)
            sfx.bossHit()
            spawnParticles(g, bx.x + (Math.random()-0.5)*40, bx.y, bx.color, "✦", 4)
            if (bx.hp <= 0) {
              sfx.bossDead()
              g.score += 500; g.shake = 14
              spawnParticles(g, bx.x, bx.y, bx.color, "★", 30)
              bx.name.split("").forEach((ch, i2) => {
                g.particles.push({
                  x: bx.x + (i2 - bx.name.length/2) * 8, y: bx.y,
                  vx: (Math.random()-0.5)*12, vy: -3 - Math.random()*6,
                  life: 1.2, glyph: ch, col: bx.color,
                  rot: (Math.random()-0.5)*1.5, rotV: (Math.random()-0.5)*0.25,
                })
              })
              g.boss = null; g.running = false
              const lvl = g.level; g.level++
              setLevel(g.level); setScore(g.score); setLives(g.lives)
              pendingCapyRef.current = CAPY_DIALOG[lvl - 1] || ["You made it.", "Keep shipping."]
              setUpgradeOptions(pickUpgrades(g.upgrades))
              phaseRef.current = "upgrade"; setPhase("upgrade")
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
      draw(ctx, g, canvas.width, now)
    }

    function loseLife(g: GState, now: number) {
      g.lives--; g.shake = 7; setLives(g.lives); sfx.hit()
      g.invuln = true; g.invulnEnd = now + 1600
      for (let i = 0; i < 12; i++)
        g.particles.push({ x: g.px, y: PLAYER_Y, vx: (Math.random()-0.5)*10, vy: -2-Math.random()*5, life: 0.9, glyph: "×", col: "#f87171" })
      if (g.lives <= 0) {
        g.running = false
        setScore(g.score); setLevel(g.level)
        phaseRef.current = "over"; setPhase("over")
      }
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener("resize", resize)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup",   onKey)
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
                  {[["#fdba74","bugs","vague language · +75pts"],["#7dd3fc","stories","user requirements · +10pts"],["#4ade80","powerups","KNOWLEDGE · FLAG · ENGAGE · TIMEBOX"]].map(([col,label,desc]) => (
                    <div key={label} style={{ display:"flex", alignItems:"center", gap:"0.6rem", fontSize:"0.78rem", color:"#d8d7d8" }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:col, display:"inline-block", flexShrink:0 }} />
                      {label} — <span style={{ color:"#a09fa2" }}>{desc}</span>
                    </div>
                  ))}
                </div>
                <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.7rem", marginBottom:"1.25rem", fontFamily:"monospace" }}>
                  arrows / WASD move · SPACE or click shoot
                </p>
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
                  <p style={{ color:"#f5f5f5", fontSize:"0.9rem", lineHeight:1.75, margin:0, whiteSpace:"pre-line" }}>{capyLines[capyIdx]}</p>
                </div>
                <p style={{ color:"#a09fa2", fontSize:"0.72rem", marginBottom:"0.5rem" }}>click to continue</p>
                {level <= 4 && BOSSES[level - 1] && (
                  <p style={{ color:"#966bec", fontSize:"0.72rem", fontWeight:500 }}>Next: {BOSSES[level - 1].name}</p>
                )}
                {level > 4 && <p style={{ color:"#4ade80", fontSize:"0.72rem", fontWeight:500 }}>ENDLESS MODE</p>}
              </div>
            </Overlay>
          )}

          {phase === "upgrade" && <UpgradeScreen options={upgradeOptions} onPick={onUpgradePick} />}

          {phase === "over" && <GameOver score={score} level={level} kills={G.current.kills} onRestart={startGame} />}

          <canvas ref={canvasRef} height={GH} style={{ display:"block", width:"100%", height:GH, cursor:"crosshair" }} />
        </div>
        <div style={{ marginTop:"0.4rem", display:"flex", justifyContent:"space-between", fontSize:"0.65rem", padding:"0 2px" }}>
          <span style={{ color:"rgba(255,255,255,0.2)", fontFamily:"monospace" }}>← → / A D move · SPACE or click shoot · mouse aim</span>
          <a href="/leaderboard" style={{ color:"#966bec", textDecoration:"none", opacity:0.6, fontSize:"0.65rem" }}>leaderboard →</a>
        </div>
      </div>
    </main>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function applyPowerup(g: GState, word: Word, now: number) {
  sfx.powerup()
  const text = word.text
  if (text === "KNOWLEDGE") {
    g.words.forEach(w => spawnLetterExplosion(g, w, 0, 1))
    g.score += g.words.length * 8
    g.shake = 10
    g.words = []
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2
      g.particles.push({ x: g.W/2, y: GH/2, vx: Math.cos(a)*12, vy: Math.sin(a)*12, life: 0.8, glyph: "◇", col: "#4ade80" })
    }
  } else if (text === "FLAG")    { g.shield = true; g.shieldEnd = now + 6000 }
  else if (text === "ENGAGE")    { g.triple = true; g.tripleEnd = now + 8000 }
  else if (text === "TIMEBOX")   { g.fast   = true; g.fastEnd   = now + 5000 }
}

function spawnParticles(g: GState, x: number, y: number, col: string, glyph: string, n: number) {
  for (let i = 0; i < n; i++)
    g.particles.push({ x, y, vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*8-2, life: 1, glyph, col })
}

function spawnLetterExplosion(g: GState, word: Word, pts: number, combo: number) {
  const chars = word.text.split("")
  const col = word.type === "bug" ? "#fdba74" : word.type === "powerup" ? "#4ade80" : "#7dd3fc"
  const charW = 6.8, totalW = chars.length * charW

  chars.forEach((ch, i) => {
    const startX = word.x - totalW/2 + i*charW + charW/2
    const dx = startX - word.x
    g.particles.push({
      x: startX, y: word.y,
      vx: dx * 0.18 + (Math.random()-0.5)*4,
      vy: -1.5 - Math.random()*4.5,
      life: 1, glyph: ch, col,
      rot: (Math.random()-0.5)*1.2, rotV: (Math.random()-0.5)*0.2,
    })
  })

  for (let i = 0; i < 5; i++)
    g.particles.push({ x: word.x, y: word.y, vx: (Math.random()-0.5)*14, vy: (Math.random()-0.5)*10-4, life: 0.65, glyph: "✦", col })

  if (pts > 0) {
    const label = combo >= 3 ? `×${combo} +${pts}` : `+${pts}`
    const popCol = combo >= 5 ? "#facc15" : combo >= 3 ? "#fb923c" : col
    g.particles.push({
      x: word.x, y: word.y - 14, vx: 0, vy: -1.1,
      life: 1.1, glyph: label, col: popCol, sz: combo >= 3 ? 13 : 10,
    })
  }
}

function draw(ctx: CanvasRenderingContext2D, g: GState, cw: number, now: number) {
  // screen shake
  let shook = false
  if (g.shake > 0) {
    ctx.save(); shook = true
    const mag = g.shake * 1.1
    ctx.translate((Math.random()-0.5)*mag, (Math.random()-0.5)*mag)
    g.shake--
  }

  // background
  ctx.fillStyle = "#0d0d14"
  ctx.fillRect(0, 0, cw, GH)

  // ambient background glyphs
  ctx.font = "10px monospace"; ctx.textAlign = "center"
  g.bg.forEach(b => {
    ctx.globalAlpha = b.a
    ctx.fillStyle = "#966bec"
    ctx.fillText(b.ch, b.x, b.y)
  }); ctx.globalAlpha = 1

  // journey bar
  const jy = GH - 20, jx = 16, jw = cw - 32
  ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(jx, jy, jw, 8)
  const prog = g.endless ? 1 : Math.min(1, ((g.level - 1) + (g.boss ? (1 - g.boss.hp/g.boss.maxHp)*0.85 : 0)) / 4)
  ctx.fillStyle = "#966bec"; ctx.fillRect(jx, jy, jw * prog, 8)
  ctx.font = "8px monospace"; ctx.textAlign = "center"
  SDLC_PHASES.forEach((ph, i) => {
    const lx = jx + jw*(i/4) + jw/8
    ctx.fillStyle = i < g.level || g.endless ? "#966bec" : "rgba(255,255,255,0.18)"
    ctx.fillText(ph, lx, jy - 3)
  })

  // words
  g.words.forEach(w => {
    const col = w.type === "bug" ? "#fdba74" : w.type === "powerup" ? "#4ade80" : "#7dd3fc"
    const warnZone = w.y > GH - 80 && w.type !== "powerup"
    const wordCol = w.beh === "charge" && w.type !== "powerup" ? "#fca5a5" : col

    // powerup glow
    if (w.type === "powerup") {
      const pulse = 0.5 + 0.5 * Math.sin(now / 280)
      ctx.save()
      ctx.shadowColor = "#4ade80"
      ctx.shadowBlur = 10 * pulse
    }

    ctx.fillStyle = wordCol
    ctx.font = "11px monospace"; ctx.textAlign = "center"

    // behavior prefix
    let prefix = ""
    if (w.beh === "zigzag") prefix = "≈"
    else if (w.beh === "sine") prefix = "~"

    const displayText = prefix ? `${prefix}${w.text}` : w.text
    ctx.fillText(displayText, w.x, w.y)

    if (w.type === "powerup") ctx.restore()

    // warn flash for near-miss words
    if (warnZone) {
      const wAlpha = Math.min(0.7, (w.y - (GH - 80)) / 40) * (0.5 + 0.5 * Math.sin(now / 120))
      ctx.globalAlpha = wAlpha
      ctx.fillStyle = "#f87171"
      ctx.fillText("!", w.x + w.text.length * 5.8 + 10, w.y)
      ctx.globalAlpha = 1
    }

    // charger down-arrow
    if (w.beh === "charge" && w.type !== "powerup") {
      ctx.fillStyle = "#f87171"; ctx.font = "7px monospace"
      ctx.fillText("▼", w.x, w.y + 10)
    }
  })

  // boss
  if (g.boss) {
    const b = g.boss
    const hpPct = b.hp / b.maxHp
    const distress = hpPct < 0.25
    const pulse = distress
      ? 0.4 + 0.6 * Math.abs(Math.sin(now / 80))
      : 0.55 + 0.45 * Math.sin(now / 180)
    ctx.save()
    ctx.shadowColor = b.color; ctx.shadowBlur = (distress ? 30 : 20) * pulse
    ctx.fillStyle = b.color
    roundRect(ctx, b.x - 50, b.y - 28, 100, 56, 8); ctx.fill()
    ctx.restore()
    ctx.fillStyle = "#0d0d14"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center"
    ctx.fillText(b.name, b.x, b.y - 11)
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(b.x - 42, b.y + 4, 84, 7)
    ctx.fillStyle = hpPct > 0.5 ? "#4ade80" : hpPct > 0.25 ? "#facc15" : "#f87171"
    ctx.fillRect(b.x - 42, b.y + 4, 84 * hpPct, 7)
  }

  // boss warning animation
  if (g.bossWarn) {
    const bw = g.bossWarn
    const fadeIn  = Math.min(1, bw.t / 18)
    const fadeOut = bw.t > 65 ? Math.max(0, 1 - (bw.t - 65) / 20) : 1
    const alpha = fadeIn * fadeOut

    // colored overlay flash
    ctx.globalAlpha = alpha * 0.18
    ctx.fillStyle = bw.color
    ctx.fillRect(0, 0, cw, GH)
    ctx.globalAlpha = 1

    // border pulse
    ctx.globalAlpha = alpha * 0.6
    ctx.strokeStyle = bw.color
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, cw - 2, GH - 2)
    ctx.lineWidth = 1
    ctx.globalAlpha = 1

    // letters assembling
    ctx.font = "bold 26px monospace"; ctx.textAlign = "center"
    bw.letters.forEach((l, i) => {
      ctx.save()
      ctx.globalAlpha = alpha * Math.min(1, (bw.t - i * 2) / 20)
      ctx.shadowColor = bw.color; ctx.shadowBlur = 18
      ctx.fillStyle = bw.color
      ctx.fillText(l.ch, l.x, l.y)
      ctx.restore()
    })

    // "INCOMING" label below
    if (bw.t < 70) {
      ctx.globalAlpha = alpha * 0.65
      ctx.fillStyle = "#f5f5f5"; ctx.font = "8px monospace"
      ctx.fillText("⚠  BOSS INCOMING  ⚠", cw/2, GH/2 + 38)
      ctx.globalAlpha = 1
    }
  }

  // bullets with gradient trail
  g.bullets.forEach(b => {
    if (!b.enemy) {
      const bulletCol = g.upgrades.spray ? "#22d3ee" : (g.triple || g.upgrades.triple) ? "#4ade80" : "#966bec"
      try {
        const grad = ctx.createLinearGradient(b.x, b.y, b.x, b.y + 22)
        grad.addColorStop(0, bulletCol)
        grad.addColorStop(1, "rgba(0,0,0,0)")
        ctx.fillStyle = grad
      } catch {
        ctx.fillStyle = bulletCol
      }
      ctx.fillRect(b.x - 2, b.y - 11, 4, 22)
    } else {
      ctx.fillStyle = "#f87171"
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill()
    }
  })

  // player ship
  const flash = g.invuln && Math.floor(now/90) % 2 === 0
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
    ctx.globalAlpha = Math.max(0, p.life)
    ctx.fillStyle = p.col
    if (p.rot !== undefined) {
      const sz = p.sz ?? Math.max(7, 13 * p.life)
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot)
      ctx.font = `${sz}px monospace`; ctx.textAlign = "center"
      ctx.fillText(p.glyph, 0, 0); ctx.restore()
    } else {
      const sz = p.sz ?? 11
      ctx.font = `${sz}px monospace`; ctx.textAlign = "center"
      ctx.fillText(p.glyph, p.x, p.y)
    }
  }); ctx.globalAlpha = 1

  // combo display
  if (g.combo >= 3) {
    ctx.globalAlpha = Math.max(0, 1 - (now - g.lastKill) / 1200)
    const comboStr = g.combo >= 10 ? `${g.combo}× CHAIN!` : g.combo >= 5 ? `${g.combo}× CHAIN` : `${g.combo}× combo`
    const comboCol = g.combo >= 10 ? "#facc15" : g.combo >= 5 ? "#fb923c" : "#966bec"
    ctx.font = `bold ${Math.min(22, 14 + g.combo)}px monospace`
    ctx.textAlign = "center"; ctx.fillStyle = comboCol
    ctx.fillText(comboStr, cw/2, GH/2 - 30)
    ctx.globalAlpha = 1
  }

  // capy in-game comment
  if (g.capyMsg) {
    const elapsed = now - (g.capyMsgEnd - 4000)
    const remaining = g.capyMsgEnd - now
    const a = Math.min(1, Math.min(elapsed / 400, remaining / 600))
    if (a > 0) {
      const lines = g.capyMsg.split("\n")
      const bw = Math.max(130, Math.max(...lines.map(l => l.length)) * 7) + 24
      const bh = lines.length > 1 ? 42 : 28
      const bx = 10, by = GH - 48 - bh
      ctx.globalAlpha = a * 0.92
      ctx.fillStyle = "#1e1e24"
      roundRect(ctx, bx, by, bw, bh, 4); ctx.fill()
      ctx.strokeStyle = "rgba(150,107,236,0.5)"; ctx.lineWidth = 1
      roundRect(ctx, bx, by, bw, bh, 4); ctx.stroke()
      ctx.fillStyle = "#f5f5f5"; ctx.font = "9px monospace"; ctx.textAlign = "left"
      lines.forEach((ln, i) => ctx.fillText((i === 0 ? "🦫 " : "   ") + ln, bx + 8, by + 17 + i * 14))
      ctx.globalAlpha = 1
    }
  }

  // HUD: score + level
  ctx.textAlign = "left"; ctx.font = "12px monospace"
  ctx.fillStyle = "#966bec"; ctx.fillText(g.score.toLocaleString(), 10, 20)
  ctx.fillStyle = "rgba(255,255,255,0.4)"
  ctx.fillText(g.endless ? "ENDLESS" : `LVL ${g.level}`, 10, 36)

  // HUD: lives + active powerups (top right)
  ctx.textAlign = "right"; ctx.fillStyle = "#f87171"; ctx.font = "12px monospace"
  ctx.fillText("♥".repeat(g.lives) + "♡".repeat(Math.max(0, MAX_LIVES - g.lives)), cw - 10, 20)
  let pwY = 36; ctx.font = "8px monospace"; ctx.textAlign = "right"
  if (g.shield)                          { ctx.fillStyle = "#4ade80"; ctx.fillText("SHIELD", cw-10, pwY); pwY += 12 }
  if (g.triple || g.upgrades.triple)     { ctx.fillStyle = "#4ade80"; ctx.fillText("ENGAGE", cw-10, pwY); pwY += 12 }
  if (g.fast)                            { ctx.fillStyle = "#4ade80"; ctx.fillText("TIMEBOX", cw-10, pwY); pwY += 12 }

  // HUD: active permanent upgrades (bottom-right, above journey bar)
  const activeUpgrades = UPGRADES.filter(u => u.id !== "extra_life" && (g.upgrades[u.id] ?? 0) > 0)
  if (activeUpgrades.length > 0) {
    let uy = jy - 8
    ctx.textAlign = "right"; ctx.font = "7px monospace"
    activeUpgrades.slice().reverse().forEach(u => {
      const count = g.upgrades[u.id]
      ctx.fillStyle = "rgba(150,107,236,0.55)"
      ctx.fillText(count > 1 ? `${u.name} ×${count}` : u.name, cw - 12, uy)
      uy -= 10
    })
  }

  if (shook) ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.arcTo(x+w,y, x+w,y+r, r)
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w,y+h, x+w-r,y+h, r)
  ctx.lineTo(x+r, y+h); ctx.arcTo(x,y+h, x,y+h-r, r)
  ctx.lineTo(x, y+r); ctx.arcTo(x,y, x+r,y, r)
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

function UpgradeScreen({ options, onPick }: { options: UpgradeDef[]; onPick: (id: string) => void }) {
  return (
    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(20,20,26,0.97)", zIndex:10 }}>
      <div style={{ width:"100%", maxWidth:"580px", padding:"1.5rem" }}>
        <p style={{ textAlign:"center", color:"#a09fa2", fontSize:"0.72rem", fontFamily:"monospace", marginBottom:"1.25rem", letterSpacing:"0.12em" }}>CHOOSE UPGRADE</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"0.75rem" }}>
          {options.map(u => (
            <button key={u.id} onClick={() => onPick(u.id)}
              style={{ background:"#1e1e24", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"6px", padding:"1.25rem 1rem", textAlign:"left", cursor:"pointer", display:"block", width:"100%" }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(150,107,236,0.45)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)")}
            >
              <p style={{ color:"#966bec", fontWeight:600, fontSize:"0.875rem", marginBottom:"0.4rem" }}>{u.name}</p>
              <p style={{ color:"#a09fa2", fontSize:"0.75rem", lineHeight:1.55 }}>{u.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function GameOver({ score, level, kills, onRestart }: { score: number; level: number; kills: number; onRestart: () => void }) {
  const [handle, setHandle]         = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)

  async function submit() {
    if (!handle.trim() || submitting) return
    setSubmitting(true)
    try {
      await fetch("/api/leaderboard", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ handle: handle.trim().slice(0,20), score, level, kills }),
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
            <input value={handle} onChange={e => setHandle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="your handle" maxLength={20}
              style={{ display:"block", margin:"0 auto 0.75rem", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"4px", color:"#f5f5f5", fontSize:"0.85rem", padding:"0.5rem 0.75rem", width:"200px", outline:"none", textAlign:"center" }}
            />
            <button onClick={submit} disabled={!handle.trim() || submitting}
              style={{ background:"#966bec", color:"#fff", border:"none", borderRadius:"4px", padding:"0.5rem 1.5rem", fontWeight:500, cursor:handle.trim()?"pointer":"default", opacity:handle.trim()?1:0.4, marginBottom:"1rem", fontSize:"0.85rem" }}>
              {submitting ? "saving..." : "Submit score"}
            </button>
          </>
        ) : (
          <p style={{ color:"#4ade80", fontSize:"0.85rem", margin:"0 0 1rem" }}>Score saved 🦫</p>
        )}
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:"1rem", display:"flex", gap:"0.75rem", justifyContent:"center" }}>
          <button onClick={onRestart} style={{ background:"transparent", border:"1px solid #4c4c51", borderRadius:"4px", padding:"0.4rem 1rem", color:"#d8d7d8", cursor:"pointer", fontSize:"0.8rem" }}>Play again</button>
          <a href="/leaderboard" style={{ border:"1px solid rgba(255,255,255,0.08)", borderRadius:"4px", padding:"0.4rem 1rem", color:"#a09fa2", textDecoration:"none", fontSize:"0.8rem" }}>Leaderboard</a>
        </div>
      </div>
    </div>
  )
}
