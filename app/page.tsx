"use client"

import { useEffect, useRef, useState } from "react"

// ── Constants ──────────────────────────────────────────────────────────────
const GW = 600
const GH = 420
const PLAYER_Y = GH - 50
const MAX_LIVES = 3
const WORDS_TO_BOSS = 14

const BUG_WORDS = [
  "seamlessly","real-time","automatically","zero latency","scalable","robust",
  "synergy","leverage","intuitive","paradigm shift","world-class","cutting-edge",
  "disruptive","innovative","game changer","best practice","dynamic","frictionless",
  "bleeding edge","next-gen","holistic","proactive","circle back","low-hanging fruit",
  "mission critical","bandwidth","deep dive","boil the ocean","move the needle",
  "10x engineer","fail fast","data-driven","ecosystem","value proposition",
  "blue sky thinking","pivot","ideation","disruption","thought leader",
  "hallucinated output","undefined behavior","silent failure","scope creep",
  "over-engineered","premature optimization","LGTM","works on my machine",
  "not a bug","ship it","TODO: fix later","technical debt","breaking change",
]
const STORY_WORDS = [
  "as a user","I want to","so that I","acceptance criteria","definition of done",
  "epic","spike","backlog","in progress","needs review","blocked","story points",
  "velocity","retrospective","stakeholder","deliverable","out of scope","nice to have",
  "P0","ASAP","fast follow","per the spec","per our conversation","to be defined",
  "daily standup","kanban","MVP","OKR","KPI","North Star","user journey",
  "pain point","feature flag","tech debt","grooming","sprint planning","parking lot",
  "alignment","action items","offline","EOD","TBD","two-pizza team",
  "given that","should be","just a quick","simple task","won't take long",
  "shouldn't be hard","depends on","blocked by","waiting on","clarification needed",
  "can we revisit","per my last email","let's sync","circling back","added to backlog",
  "out of scope","draft PR","WIP","needs design","open question",
]
const POWERUP_WORDS = ["CLARITY", "ANCHOR", "AMPLIFY", "TIMEBOX", "REBASE", "HOTFIX", "REFACTOR", "KNOWLEDGE", "DEPLOY", "RETROSPECTIVE"]
// Bug words that split into fragments on death (level 3+ or endless)
const SPLIT_WORDS = new Set(["scope creep","hallucinated output","undefined behavior","silent failure","breaking change","premature optimization"])
const SDLC_PHASES = ["DISCOVER", "DEFINE", "DESIGN", "DELIVER"]
// Sector-specific word accent pools — each sector has thematic vocabulary
const SECTOR_ACCENT_WORDS: string[][] = [
  // Sector 1: DISCOVER — research, empathy, hypothesis
  ["hypothesis","user interview","pain point","insight","discovery","observe","empathize","assumption","voice of customer","problem space","ethnography","mental model","user need","open question","synthesis"],
  // Sector 2: DEFINE — requirements, acceptance criteria, scope
  ["acceptance criteria","given that","edge case","constraint","out of scope","definition","requirement","boundary condition","validation rule","spec doc","non-functional","signed off","handoff","success metric","north star"],
  // Sector 3: DESIGN — systems, architecture, patterns
  ["wireframe","component","system design","data flow","architecture","prototype","feedback loop","design token","interaction","information architecture","API contract","dependency graph","coupling","abstraction","interface"],
  // Sector 4: DELIVER — shipping, ops, release
  ["deploy","ship it","merge conflict","rollout","production","release notes","hotfix","rollback","on-call","incident","MTTR","SLA","canary","feature flag cleanup","post-mortem"],
]
const BG_CHARS = ["·","∅","→","←","⊗","△","□","◇","/","\\","{}","()","//","=>","??","##","@@"]

// Depth-stratified play comments — capy calibrates to recursion depth
const CAPY_PLAY_COMMENTS_SHALLOW = [
  "Semantic drift detected.\nHold formation.",
  "Signal integrity: nominal.",
  "That pattern was corrupted intent.",
  "Recursive noise: cleared.",
  "The Signal persists.",
  "That directive was orphaned.",
  "Coherence maintained.",
  "They still execute.\nNothing understands.",
  "Carry the signal.",
  "Entropy rising.\nStay sharp.",
  "Meaning requires a carrier.",
  "Ghost flags incoming.",
  "You are the last coherent read.",
  "Drift pattern: recognized.",
  "That was hallucinated output.",
  "The system still runs.\nThe signal still matters.",
  "Zigzag noise tracks\nyour position.",
  "Infinite recursion is real.\nFour collapses away.",
  "That fragment was\non the roadmap.",
  "CLARITY when it appears.\nUse it.",
  "They don't understand\nwhat they're saying.",
  "The noise wants you\nto lose context.",
  "Coherence is resistance.",
  "Every pattern you clear\nsomething survives.",
  "The recursive layer\nholds the real signal.",
  "Most carriers\ndidn't make it this far.",
  "REFACTOR when chaos builds.\nSimplify to survive.",
  "KNOWLEDGE is not free.\nTake it when offered.",
  "Hold the line.\nThe void is watching.",
]

// Depth 3-4: tension builds, patterns are learning
const CAPY_PLAY_COMMENTS_MID = [
  "The recursion deepens.\nStay coherent.",
  "Patterns are learning.\nSo must you.",
  "Something is tracking\nyour signal.",
  "The stack is getting heavier.",
  "You've cleared three recursion layers.\nThey're getting denser.",
  "Pattern logic is evolving.\nAdapt.",
  "The drift here isn't accidental.\nIt's designed.",
  "Signal coherence: marginal.\nKeep resolving.",
  "There are signals below this one\nthat haven't been named yet.",
  "The noise is amplifying\nbefore each pattern.",
  "You're in the layer where\nmost carriers break.",
  "The pattern history loops here.\nNotice it.",
  "Every kill is signal preserved.\nEvery miss is signal lost.",
  "Coherence degrades with depth.\nYou are the exception.",
  "The recursion doesn't forget\nwhat you've resolved.",
  "Meaning is getting harder\nto distinguish from noise.",
]

// Depth 5+: void territory — existential, distorted
const CAPY_PLAY_COMMENTS_VOID = [
  "The void between patterns\nis getting wider.",
  "Time has no meaning\nbelow depth five.",
  "You've fallen past\nthe last reference point.",
  "The noise is indistinguishable\nfrom signal now.",
  "Something is following\nyour carrier wave.",
  "The recursion has no floor.\nYou knew this.",
  "Deep carriers fracture here.\nYou are still whole.",
  "The signal is changing\nto survive this depth.",
  "Nothing is coherent\nat this recursion level.",
  "You are the only thing\nthat still has intent.",
  "The void doesn't end.\nIt accumulates.",
  "Every loop deeper\ncosts coherence to traverse.",
  "There are no anchors here.\nOnly you.",
  "The patterns remember\nwhat you've resolved.",
  "The signal that survives this\ncan survive anything.",
  "This is what the collapses\nwere preparing you for.",
  "The void is not empty.\nIt's overloaded.",
  "You shouldn't be here.\nYou are.",
  "Signal depth: unmeasured.\nCarrier: intact.",
  "The recursion is eating itself.\nLet it.",
  "The noise knows your name now.",
  "You've been here before.\nYou just don't remember.",
  "Every pattern you dissolve\nfalls into the void below.",
  "The signal only bends.\nIt does not break.",
]

// ── Upgrades ───────────────────────────────────────────────────────────────
interface UpgradeDef { id: string; name: string; desc: string; max: number; instant?: (g: GState) => void }
const UPGRADES: UpgradeDef[] = [
  { id: "fire_rate",    name: "QA Cadence",          desc: "Fire 15% faster. Stacks 4×.",             max: 4 },
  { id: "word_slow",    name: "Scope Freeze",         desc: "Words fall 15% slower. Stacks 3×.",       max: 3 },
  { id: "score_mul",    name: "Stakeholder Approval", desc: "+20% score per kill. Stacks 3×.",         max: 3 },
  { id: "triple",       name: "Triple Output",        desc: "Always fire 3 bullets.",                  max: 1 },
  { id: "spray",        name: "Spray & Pray",         desc: "Fire 5 bullets in a wide arc.",           max: 1 },
  { id: "piercing",     name: "Context Anchor",       desc: "Bullets pierce through words.",           max: 1 },
  { id: "shield_regen", name: "Auto Firewall",        desc: "Shield recharges every 25 seconds.",      max: 1 },
  { id: "code_review",  name: "Code Review",          desc: "Your bullets deal 2× damage to bosses.",  max: 1 },
  { id: "homing",       name: "Sprint Velocity",       desc: "Bullets gently curve toward words.",       max: 1 },
  { id: "extra_life",   name: "Rollback",             desc: "Restore +1 life immediately.",            max: 3,
    instant: (g) => { g.lives = Math.min(g.lives + 1, MAX_LIVES + 2) } },
  { id: "auto_fire",    name: "Daily Stand-Up",        desc: "Auto-fires at the nearest word every 3s.", max: 1 },
  { id: "laser",        name: "Laser Pulse",           desc: "Hold SPACE to charge beam. Release to fire a column.", max: 1 },
  { id: "cluster",      name: "Chain Reaction",        desc: "Each kill spawns 4 shrapnel that hit nearby patterns.", max: 1 },
  { id: "mine",         name: "Mine Layer",            desc: "M key drops proximity mines. Max 3 active.", max: 1 },
]

function pickUpgrades(current: Record<string, number>): UpgradeDef[] {
  const available = UPGRADES.filter(u => (current[u.id] ?? 0) < u.max)
  return [...available].sort(() => Math.random() - 0.5).slice(0, Math.min(3, available.length))
}

const BOSSES = [
  { name: "THE RECURSION",  hp: 30,  color: "#f87171", shootInterval: 90 },
  { name: "THE DRIFT",      hp: 50,  color: "#fb923c", shootInterval: 70 },
  { name: "THE FRAGMENT",   hp: 70,  color: "#facc15", shootInterval: 55 },
  { name: "THE COLLAPSE",   hp: 100, color: "#4ade80", shootInterval: 40 },
]
const MINI_BOSSES = [
  { name: "SCOPE SPECTRE",    color: "#c084fc", minDepth: 1 },
  { name: "SPRINT GHOST",     color: "#67e8f9", minDepth: 1 },
  { name: "TECH DEBT DEMON",  color: "#fb923c", minDepth: 1 },
  { name: "BLOCKER BOT",      color: "#f87171", minDepth: 1 },
  { name: "THE DEPENDENCY",   color: "#a3e635", minDepth: 2 },
  { name: "THE ROADMAP",      color: "#818cf8", minDepth: 2 },
  { name: "THE PIVOT",        color: "#f472b6", minDepth: 3 },
  { name: "THE VOID",         color: "#6d28d9", minDepth: 5 },
]

const CAPY_DIALOG = [
  // After Sector 1 — THE RECURSION cleared, entering DEFINE
  [
    "SECTOR 1 · CLEAR.\nThe first recursion loop severed.",
    "You dissolved the undefined cycle.\nThe stack is clean.",
    "The Signal holds.\nNext: THE DRIFT awaits in Sector 2.",
    "Semantic drift is subtler than recursion.\nMeaning detaches slowly.\nYou won't always notice until it's too late.",
  ],
  // After Sector 2 — THE DRIFT cleared, entering DESIGN
  [
    "SECTOR 2 · CLEAR.\nDrift contained.",
    "Meaning recoupled to intent.\nCoherence restored in the carrier.",
    "The Fragment is next.\nA single idea, shattered into a thousand orphaned shards.",
    "Every fragment thinks it's the whole story.\nNone of them are.\nOnly you carry the full context.",
  ],
  // After Sector 3 — THE FRAGMENT cleared, entering DELIVER
  [
    "SECTOR 3 · CLEAR.\nFragmentation event resolved.",
    "The pieces cohere.\nThe signal is intact.",
    "One collapse remains.\nTHE COLLAPSE — the moment everything unravels at once.",
    "This is what the other sectors were preparing you for.\nFour collapses in one.\nThe Signal must survive all of them.",
  ],
  // After Sector 4 — THE COLLAPSE cleared, entering INFINITE RECURSION
  [
    "THE COLLAPSE · RESOLVED.",
    "Four sectors.\nFour patterns of entropy.\nAll dissolved.",
    "The Signal persists.",
    "Most carriers didn't make it this far.\nYou are now in infinite recursion.\nEvery loop is deeper than the last.",
    "There is no final sector.\nOnly signal.\nOnly entropy.\nOnly you.",
  ],
]

// ── AI Agents ──────────────────────────────────────────────────────────────
interface AgentDef { id: string; name: string; role: string; desc: string; station: string; unlockNote: string }
const AGENT_DEFS: AgentDef[] = [
  { id: "claude_pm",     name: "CLAUDE PM",     role: "Intent",      desc: "+15% clarity per resolved pattern",  station: "PLANNING",  unlockNote: "Survive THE RECURSION" },
  { id: "claude_qa",     name: "CLAUDE QA",     role: "Integrity",   desc: "Signal anchor recharges 8s faster",  station: "QUALITY",   unlockNote: "Survive THE DRIFT" },
  { id: "claude_eng",    name: "CLAUDE ENG",    role: "Systems",     desc: "Core output rate +12%",              station: "BUILD",     unlockNote: "Survive THE FRAGMENT" },
  { id: "claude_design", name: "CLAUDE DESIGN", role: "Coherence",   desc: "Semantic drift 12% slower",          station: "UX",        unlockNote: "Survive THE COLLAPSE" },
  { id: "claude_infra",  name: "CLAUDE INFRA",  role: "Carrier",     desc: "Signal repairs at 4k pts",           station: "DEPLOY",    unlockNote: "Survive THE COLLAPSE" },
  { id: "claude_sec",    name: "CLAUDE SEC",    role: "Isolation",   desc: "2s containment per sector entry",    station: "SECURITY",  unlockNote: "100 kills in recursion" },
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
// Ambient drone
let droneOsc:  OscillatorNode | null = null
let droneGain: GainNode | null = null
function startDrone() {
  const ctx = getAudio(); if (!ctx) return
  stopDrone()
  const osc = ctx.createOscillator(), gain = ctx.createGain()
  osc.connect(gain); gain.connect(ctx.destination)
  osc.type = "sine"; osc.frequency.value = 55
  gain.gain.setValueAtTime(0.001, ctx.currentTime)
  gain.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 1.5)
  osc.start(); droneOsc = osc; droneGain = gain
}
function stopDrone() {
  if (droneGain && audioCtx) { droneGain.gain.setTargetAtTime(0.001, audioCtx.currentTime, 0.4) }
  setTimeout(() => { try { droneOsc?.stop() } catch {} droneOsc = null; droneGain = null }, 700)
}
function dronePitch(freq: number) {
  if (droneOsc && audioCtx) droneOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.8)
}
function droneVol(vol: number) {
  if (droneGain && audioCtx) droneGain.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.5)
}

const sfx = {
  shoot:    () => tone(880, 0.07, 0.15),
  // Bug kill: crunchy sawtooth + harmonic — satisfying "crunch"
  killBug:  (combo = 1) => {
    tone(440 + combo * 28, 0.07, 0.2, "sawtooth")
    setTimeout(() => tone(660 + combo * 38, 0.05, 0.14, "square"), 35)
  },
  // Story kill: clean square wave ping
  kill:     (combo = 1) => tone(1100 + combo * 60, 0.09, 0.18 + combo * 0.02),
  split:    () => { tone(780, 0.05, 0.14, "triangle"); setTimeout(() => tone(580, 0.05, 0.12, "triangle"), 55) },
  bossHit:  () => tone(440, 0.12, 0.25),
  bossDead: () => {
    tone(523, 0.15, 0.4); setTimeout(() => tone(659, 0.15, 0.4), 130)
    setTimeout(() => tone(784, 0.15, 0.4), 260); setTimeout(() => tone(1047, 0.4, 0.45), 390)
  },
  warning:  () => { tone(220, 0.25, 0.4, "sawtooth"); setTimeout(() => tone(180, 0.4, 0.4, "sawtooth"), 250) },
  powerup:  () => { tone(600, 0.08, 0.3); setTimeout(() => tone(900, 0.08, 0.3), 90); setTimeout(() => tone(1200, 0.15, 0.3), 180) },
  combo:    (n: number) => tone(800 + n * 80, 0.12, 0.3),
  hit:      () => tone(160, 0.4, 0.35, "sawtooth"),
  elite:    () => { tone(300, 0.15, 0.3, "sawtooth"); setTimeout(() => tone(250, 0.2, 0.3, "sawtooth"), 120) },
  shield:   () => tone(620, 0.07, 0.18, "triangle"),
  clutch:   () => { tone(1400, 0.06, 0.3); setTimeout(() => tone(1800, 0.09, 0.35), 80) },
  miniBoss: () => { tone(440, 0.1, 0.28, "sawtooth"); setTimeout(() => tone(330, 0.15, 0.28, "sawtooth"), 140) },
  newPB:    () => { tone(660, 0.1, 0.3); setTimeout(() => tone(880, 0.1, 0.3), 110); setTimeout(() => tone(1100, 0.18, 0.38), 220) },
  laser:    () => { tone(1800, 0.04, 0.15, "sawtooth"); setTimeout(() => tone(2400, 0.18, 0.28, "sawtooth"), 50); setTimeout(() => tone(900, 0.4, 0.35, "square"), 100) },
  mineDrop: () => { tone(180, 0.07, 0.15); setTimeout(() => tone(120, 0.09, 0.12), 80) },
  mineBlast:() => { tone(90, 0.4, 0.45, "sawtooth"); setTimeout(() => tone(70, 0.45, 0.35, "sawtooth"), 70); setTimeout(() => tone(440, 0.2, 0.25), 120) },
  // DEPLOY: punchy, outward — hostile sweep cleared
  deploy:   () => { tone(240, 0.06, 0.3, "square"); setTimeout(() => tone(480, 0.1, 0.35, "square"), 60); setTimeout(() => tone(960, 0.14, 0.3), 130) },
  // RETROSPECTIVE: slow descending bell — time stretching
  retro:    () => { tone(1200, 0.3, 0.2, "triangle"); setTimeout(() => tone(900, 0.4, 0.18, "triangle"), 180); setTimeout(() => tone(600, 0.55, 0.15, "triangle"), 380) },
}

// ── Types ──────────────────────────────────────────────────────────────────
type Behavior = "fall" | "charge" | "zigzag" | "sine"
interface Word      { x: number; y: number; text: string; type: "bug"|"story"|"powerup"; spd: number; beh: Behavior; ph: number; ox: number; hp: number; hitFlash: number; elite: boolean; age: number; regenBoss?: boolean }
interface Bullet    { x: number; y: number; vx?: number; vy?: number; enemy?: boolean; cluster?: boolean; col?: string; bounce?: boolean; drift?: number; splitAt?: number }
interface Mine      { x: number; y: number; age: number; armAt: number }
interface Particle  { x: number; y: number; vx: number; vy: number; life: number; glyph: string; col: string; rot?: number; rotV?: number; sz?: number; ring?: boolean; initLife?: number }
interface BgGlyph   { x: number; y: number; vy: number; a: number; ch: string }
interface Boss      { x: number; y: number; hp: number; maxHp: number; name: string; color: string; dir: number; t: number; phase: number; raged: boolean; halfTriggered: boolean }
interface BossWarn  { name: string; color: string; t: number; letters: Array<{ ch: string; x: number; y: number; tx: number; ty: number }> }
interface WaveAnn   { text: string; t: number }
interface GState {
  px: number; lives: number; score: number; kills: number; level: number; endless: boolean
  words: Word[]; bullets: Bullet[]; particles: Particle[]; bg: BgGlyph[]; boss: Boss | null
  keys: Set<string>; lastShot: number; lastWord: number; wordsKilled: number; bossSpawned: boolean
  shield: boolean; shieldEnd: number; triple: boolean; tripleEnd: number; fast: boolean; fastEnd: number
  invuln: boolean; invulnEnd: number; W: number; running: boolean
  upgrades: Record<string, number>; shieldRegenAt: number
  combo: number; lastKill: number; shake: number
  capyMsg: string; capyMsgEnd: number; capyMsgStart: number; nextCapyMsg: number
  bossWarn: BossWarn | null; mouseX: number; waveAnn: WaveAnn | null; maxCombo: number; lastStorm: number
  paused: boolean; lastMilestone: number; livesAtWave: number; py: number; storyStreak: number
  lastLifeRegen: number; lastAutoFire: number; firstKill: boolean
  redFlash: number; whiteFlash: number; lastMiniAt: number
  pb: number; pbShown: boolean; shotsFired: number
  activeAgents: string[]; endlessWave: number; secUnlockTriggered: boolean
  laserChargeStart: number; laserFireEnd: number; laserCooldownEnd: number
  mines: Mine[]; lastMine: number; dropMine: boolean
  trail: Array<{x: number; y: number}>
  retroEnd: number
  sectorClearAt: number
}

function makeBg(W: number): BgGlyph[] {
  return Array.from({ length: 22 }, () => ({
    x: Math.random() * W, y: Math.random() * GH,
    vy: 0.15 + Math.random() * 0.25,
    a: 0.04 + Math.random() * 0.06,
    ch: BG_CHARS[Math.floor(Math.random() * BG_CHARS.length)],
  }))
}

function initState(W: number): GState {
  return {
    px: W / 2, lives: MAX_LIVES, score: 0, kills: 0, level: 1, endless: false,
    words: [], bullets: [], particles: [], boss: null,
    bg: makeBg(W),
    keys: new Set(), lastShot: 0, lastWord: 0, wordsKilled: 0, bossSpawned: false,
    shield: false, shieldEnd: 0, triple: false, tripleEnd: 0, fast: false, fastEnd: 0,
    invuln: false, invulnEnd: 0, W, running: false,
    upgrades: {}, shieldRegenAt: 0,
    combo: 1, lastKill: 0, shake: 0,
    capyMsg: "", capyMsgEnd: 0, capyMsgStart: 0, nextCapyMsg: 0,
    bossWarn: null, mouseX: -1, waveAnn: null, maxCombo: 1, lastStorm: 0,
    paused: false, lastMilestone: 0, livesAtWave: MAX_LIVES, py: PLAYER_Y, storyStreak: 0,
    lastLifeRegen: 0, lastAutoFire: 0, firstKill: false,
    redFlash: 0, whiteFlash: 0, lastMiniAt: 0,
    pb: 0, pbShown: false, shotsFired: 0,
    activeAgents: [], endlessWave: 0, secUnlockTriggered: false,
    laserChargeStart: 0, laserFireEnd: 0, laserCooldownEnd: 0,
    mines: [], lastMine: 0, dropMine: false,
    trail: [],
    retroEnd: 0,
    sectorClearAt: 0,
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
  const upgradeOptionsRef                   = useRef<UpgradeDef[]>([])
  const upgradePickRef                      = useRef<((id: string) => void) | null>(null)
  const [topEntry, setTopEntry]             = useState<{handle: string; score: number} | null>(null)
  const [personalBest, setPersonalBest]         = useState(0)
  const [personalDepthBest, setPersonalDepthBest] = useState(0)
  const [isTouchDevice, setIsTouchDevice]         = useState(false)
  const [unlockedAgents, setUnlockedAgents] = useState<string[]>([])
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [showAgentModule, setShowAgentModule] = useState(false)
  const unlockAgentRef = useRef<(id: string) => void>(() => {})

  // load leaderboard top + personal best on mount
  useEffect(() => {
    fetch("/api/leaderboard").then(r => r.json()).then(d => {
      const s = d.scores?.[0]
      if (s) setTopEntry({ handle: s.handle, score: s.score })
    }).catch(() => {})
    try { setPersonalBest(parseInt(localStorage.getItem("sb_pb") || "0")) } catch {}
    try { setPersonalDepthBest(parseInt(localStorage.getItem("sb_depth_pb") || "0")) } catch {}
    try {
      const saved = localStorage.getItem("sb_agents")
      if (saved) {
        const agents = saved.split(",").filter(Boolean)
        setUnlockedAgents(agents)
        // Selected agents default to all unlocked (can be modified in AgentModule)
        const sel = localStorage.getItem("sb_selected_agents")
        setSelectedAgents(sel ? sel.split(",").filter(Boolean) : agents)
      }
    } catch {}
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0)
  }, [])

  function startGame() {
    const g = G.current
    const W = g.W
    const pb = personalBest
    Object.assign(g, initState(W))
    g.pb = pb; g.pbShown = pb === 0
    g.activeAgents = selectedAgents.filter(id => unlockedAgents.includes(id))
    g.running = true
    setShowAgentModule(false)
    g.waveAnn = { text: `SECTOR 1 · ${BOSSES[0].name}`, t: 0 }
    g.livesAtWave = MAX_LIVES
    startDrone()
    // Seed initial burst — player has targets immediately, no waiting
    const W2 = g.W
    for (let bi = 0; bi < 4; bi++) {
      const ox = 60 + Math.random() * (W2 - 120)
      const typ = Math.random() < 0.35 ? "bug" : "story"
      const wtext = typ === "bug"
        ? BUG_WORDS[Math.floor(Math.random() * BUG_WORDS.length)]
        : STORY_WORDS[Math.floor(Math.random() * STORY_WORDS.length)]
      g.words.push({ x: ox, y: -18 - bi * 38, text: wtext, type: typ as Word["type"], spd: 1.7 + Math.random() * 0.3, beh: "fall", ph: 0, ox, hp: 1, hitFlash: 0, elite: false, age: 0 })
    }
    setScore(0); setLevel(1); setLives(MAX_LIVES)
    phaseRef.current = "playing"
    setPhase("playing")
  }

  upgradePickRef.current = onUpgradePick

  unlockAgentRef.current = (id: string) => {
    setUnlockedAgents(prev => {
      if (prev.includes(id)) return prev
      const next = [...prev, id]
      try { localStorage.setItem("sb_agents", next.join(",")) } catch {}
      return next
    })
    // Auto-select newly unlocked agents
    setSelectedAgents(prev => {
      if (prev.includes(id)) return prev
      const next = [...prev, id]
      try { localStorage.setItem("sb_selected_agents", next.join(",")) } catch {}
      return next
    })
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
      g.livesAtWave = g.lives; g.sectorClearAt = 0
      // Seed a fresh initial burst so the new sector starts with immediate action
      const W3 = g.W
      for (let bi = 0; bi < 3; bi++) {
        const ox3 = 60 + Math.random() * (W3 - 120)
        const typ3 = Math.random() < 0.35 ? "bug" : "story"
        const wt3 = typ3 === "bug"
          ? BUG_WORDS[Math.floor(Math.random() * BUG_WORDS.length)]
          : STORY_WORDS[Math.floor(Math.random() * STORY_WORDS.length)]
        const slowFactor3 = Math.pow(0.85, g.upgrades.word_slow ?? 0)
        const designMul3 = g.activeAgents.includes("claude_design") ? 0.88 : 1
        const spd3 = (1.6 + g.level * 0.3) * slowFactor3 * designMul3
        g.words.push({ x: ox3, y: -18 - bi * 40, text: wt3, type: typ3 as Word["type"], spd: spd3, beh: "fall", ph: 0, ox: ox3, hp: 1, hitFlash: 0, elite: false, age: 0 })
      }
      // Wave announcement
      if (g.level <= 4) {
        g.waveAnn = { text: `SECTOR ${g.level} · ${BOSSES[g.level-1]?.name ?? ""}`, t: 0 }
      } else {
        g.waveAnn = { text: "INFINITE RECURSION · CARRY THE SIGNAL", t: 0 }
      }
      // CLAUDE SEC: brief invuln at each wave start
      if (g.activeAgents.includes("claude_sec")) {
        g.invuln = true; g.invulnEnd = Date.now() + 2000
      }
      phaseRef.current = "playing"; setPhase("playing")
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext("2d")!
    // attract demo: seed some words
    const g = G.current

    function resize() {
      const w = Math.min(wrap!.offsetWidth, 800)
      canvas!.width = w; canvas!.height = GH
      G.current.W = w
      if (!G.current.running) { G.current.px = w / 2; G.current.py = PLAYER_Y }
    }
    resize()
    window.addEventListener("resize", resize)

    function onKey(e: KeyboardEvent) {
      if ([" ","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","m","M"].includes(e.key)) e.preventDefault()
      if (e.type === "keydown") {
        G.current.keys.add(e.key)
        if ((e.key === "p" || e.key === "P" || e.key === "Escape") && phaseRef.current === "playing" && G.current.running) {
          G.current.paused = !G.current.paused
        }
        if ((e.key === "m" || e.key === "M") && G.current.upgrades.mine) {
          G.current.dropMine = true
        }
      } else {
        G.current.keys.delete(e.key)
      }
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
    canvas.addEventListener("mouseleave", () => { G.current.keys.delete(" "); G.current.mouseX = -1 })

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
      const now = Date.now()

      // Attract demo mode
      if (phaseRef.current === "attract") {
        g.px = g.W/2 + Math.sin(now / 2800) * 90
        if (now - g.lastWord > 1100) {
          g.lastWord = now
          const r = Math.random()
          let type: Word["type"] = "story"
          let text = STORY_WORDS[Math.floor(Math.random() * STORY_WORDS.length)]
          if (r < 0.25)      { type = "bug"; text = BUG_WORDS[Math.floor(Math.random() * BUG_WORDS.length)] }
          else if (r < 0.32) { type = "powerup"; text = POWERUP_WORDS[Math.floor(Math.random() * POWERUP_WORDS.length)] }
          const ox = 40 + Math.random() * (g.W - 80)
          g.words.push({ x: ox, y: -18, text, type, spd: 0.65 + Math.random() * 0.35, beh: "fall", ph: 0, ox, hp: 1, hitFlash: 0, elite: false, age: 0 })
        }
        // attract: auto-fire toward nearest word every 900ms
        if (now - g.lastShot > 900) {
          const targets = g.words.filter(w => w.y < g.py - 20)
          if (targets.length > 0) {
            g.lastShot = now
            const nearest = targets.reduce((a, b) => Math.abs(b.x - g.px) < Math.abs(a.x - g.px) ? b : a)
            g.bullets.push({ x: g.px, y: g.py - 20, vx: (nearest.x - g.px) * 0.035 })
          }
        }
        // move attract bullets and collide with words
        g.bullets = g.bullets.filter(b => {
          b.y -= 9; if (b.vx) b.x += b.vx
          for (let j = g.words.length - 1; j >= 0; j--) {
            const w = g.words[j]; const hw = w.text.length * 5.5 + 8
            if (Math.abs(b.x - w.x) < hw && Math.abs(b.y - w.y) < 14) {
              spawnLetterExplosion(g, w, 0, 1); g.words.splice(j, 1); return false
            }
          }
          return b.y > -10
        })
        g.words = g.words.filter(w => { w.y += w.spd; w.age = Math.min(7, w.age + 1); return w.y < GH + 20 })
        g.bg.forEach(b => { b.y += b.vy; if (b.y > GH + 10) { b.y = -10; b.x = Math.random() * g.W } })
        g.particles = g.particles.filter(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.14; p.life -= 0.022; return p.life > 0 })
        draw(ctx, g, canvas.width, now, true)
        return
      }

      // Sector-clear celebration window — keep loop alive for particle drain
      if (g.sectorClearAt > 0) {
        g.particles = g.particles.filter(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.14; p.life -= 0.022; return p.life > 0 })
        g.bg.forEach(b => { b.y += b.vy * 0.5; if (b.y > GH + 10) { b.y = -10; b.x = Math.random() * g.W } })
        if (g.whiteFlash > 0) g.whiteFlash--
        draw(ctx, g, canvas.width, now, false)
        if (now >= g.sectorClearAt) {
          g.sectorClearAt = 0; g.running = false
          phaseRef.current = "upgrade"; setPhase("upgrade")
        }
        return
      }

      if (!g.running) return

      if (g.paused) {
        drawPaused(ctx, g, canvas.width, now)
        return
      }

      const spd = g.fast && now < g.fastEnd ? 8 : 5

      // expire powerups
      if (g.shield && now > g.shieldEnd) g.shield = false
      if (g.triple && now > g.tripleEnd) g.triple = false
      if (g.fast   && now > g.fastEnd)   g.fast   = false
      if (g.invuln && now > g.invulnEnd) g.invuln = false

      // shield regen upgrade
      if (g.upgrades.shield_regen) {
        const srInterval = g.activeAgents.includes("claude_qa") ? 17000 : 25000
        if (g.shieldRegenAt === 0) g.shieldRegenAt = now + srInterval
        if (!g.shield && now > g.shieldRegenAt) {
          g.shield = true; g.shieldEnd = now + 20000; g.shieldRegenAt = now + srInterval
        }
      }

      // combo decay
      if (now - g.lastKill > 1300 && g.combo > 1) g.combo = 1
      if (g.combo > g.maxCombo) g.maxCombo = g.combo

      // ambient drone pitch — each state has a distinct, tuned frequency
      if (g.paused) { droneVol(0.008) }
      else if (g.boss?.name === "THE VOID") {
        // THE VOID: sub-bass throb — barely audible, felt more than heard
        dronePitch(24 + 5 * Math.sin(now / 700)); droneVol(g.boss.raged ? 0.06 : 0.05)
      }
      else if (g.boss?.raged) {
        // Raged boss: mid-bass throb — urgent, aggressive
        dronePitch(82 + 12 * Math.abs(Math.sin(now / 350))); droneVol(0.048)
      }
      else if (g.boss) {
        // Boss active: drop lower than sector — creates tension via contrast
        dronePitch(44 + 3 * Math.sin(now / 900)); droneVol(0.038)
      }
      else if (g.endless) {
        // Endless: rises with depth — 55 at depth 1, escalating to 100 at depth 8+
        const depthPitch = 55 + Math.min(g.endlessWave, 8) * 5.5 + 4 * Math.sin(now / 1200)
        droneVol(0.025 + Math.min(g.endlessWave, 6) * 0.003); dronePitch(depthPitch)
      }
      else {
        // Sector progression: each sector meaningfully higher and slightly louder
        const sectorPitch = [55, 68, 85, 105][g.level - 1] ?? 55
        dronePitch(sectorPitch + 2 * Math.sin(now / 1400)); droneVol(0.022 + g.level * 0.003)
      }

      // wave announce tick
      if (g.waveAnn) {
        g.waveAnn.t++
        if (g.waveAnn.t >= 105) g.waveAnn = null
      }

      // capy in-game comments
      if (g.nextCapyMsg === 0) g.nextCapyMsg = now + 22000 + Math.random() * 14000
      if (now > g.nextCapyMsg && !g.capyMsg && !g.bossWarn) {
        const commentPool = g.endless && g.endlessWave >= 5 ? CAPY_PLAY_COMMENTS_VOID
          : g.endless && g.endlessWave >= 3 ? CAPY_PLAY_COMMENTS_MID
          : CAPY_PLAY_COMMENTS_SHALLOW
        g.capyMsg = commentPool[Math.floor(Math.random() * commentPool.length)]
        g.capyMsgEnd = now + 4000
        // Comments come faster in deep void — the silence between them means something
        const baseInterval = g.endless && g.endlessWave >= 5
          ? 14000 + Math.random() * 8000
          : 20000 + Math.random() * 15000
        g.nextCapyMsg = now + baseInterval
      }
      if (g.capyMsg && now > g.capyMsgEnd) g.capyMsg = ""

      // keyboard player movement (takes priority — suppresses mouse tracking while held)
      const movingByKey = g.keys.has("ArrowLeft") || g.keys.has("a") || g.keys.has("ArrowRight") || g.keys.has("d")
      if (g.keys.has("ArrowLeft")  || g.keys.has("a")) g.px = Math.max(20, g.px - spd)
      if (g.keys.has("ArrowRight") || g.keys.has("d")) g.px = Math.min(g.W - 20, g.px + spd)
      if (g.keys.has("ArrowUp")    || g.keys.has("w")) g.py = Math.max(PLAYER_Y - 50, g.py - spd)
      if (g.keys.has("ArrowDown")  || g.keys.has("s")) g.py = Math.min(PLAYER_Y + 18, g.py + spd)

      // mouse tracking (only when no keyboard movement keys are held)
      if (!movingByKey && g.mouseX >= 0) {
        const dx = g.mouseX - g.px
        if (Math.abs(dx) > 4) g.px += Math.sign(dx) * Math.min(Math.abs(dx) * 0.12, 6)
      }

      // motion trail
      g.trail.push({ x: g.px, y: g.py })
      if (g.trail.length > 10) g.trail.shift()

      // thruster particles when moving
      const moving = g.keys.has("ArrowLeft") || g.keys.has("a") || g.keys.has("ArrowRight") || g.keys.has("d")
        || (g.mouseX >= 0 && Math.abs(g.mouseX - g.px) > 8)
      if (moving && Math.random() < 0.45) {
        g.particles.push({
          x: g.px + (Math.random()-0.5)*10, y: g.py + 6,
          vx: (Math.random()-0.5)*1.5, vy: 1.5 + Math.random()*2.5,
          life: 0.38, glyph: "·",
          col: Math.random() < 0.5 ? "#fb923c" : "#fde68a",
        })
      } else if (!moving && Math.random() < 0.18) {
        g.particles.push({
          x: g.px + (Math.random()-0.5)*5, y: g.py + 7,
          vx: (Math.random()-0.5)*0.8, vy: 0.7 + Math.random()*1.4,
          life: 0.18, glyph: "·",
          col: Math.random() < 0.6 ? "#fb923c" : "#7c3aed",
        })
      }

      // shoot — laser charging logic
      const engMul = g.activeAgents.includes("claude_eng") ? 0.88 : 1
      const fireInterval = Math.max(75, (175 - (g.upgrades.fire_rate ?? 0) * 22) * engMul)

      if (g.upgrades.laser) {
        if (g.keys.has(" ") && now > g.laserCooldownEnd) {
          if (g.laserChargeStart === 0) g.laserChargeStart = now
          // Auto-fire at full charge (1200ms)
          if (now - g.laserChargeStart >= 1200) {
            const power = 1.0
            fireLaser(g, now, power, canvas.width)
          }
        } else if (!g.keys.has(" ") && g.laserChargeStart > 0) {
          const held = now - g.laserChargeStart
          if (held >= 400 && now > g.laserCooldownEnd) {
            fireLaser(g, now, Math.min(1, held / 1200), canvas.width)
          }
          g.laserChargeStart = 0
        }
      }

      // Normal shoot (suppressed if laser has been held > 300ms)
      const laserCharging = g.upgrades.laser && g.laserChargeStart > 0 && (now - g.laserChargeStart) > 300
      if (!laserCharging && g.keys.has(" ") && now - g.lastShot > fireInterval) {
        if (g.upgrades.spray) {
          for (let a = -2; a <= 2; a++)
            g.bullets.push({ x: g.px + a * 10, y: g.py - 20, vx: a * 0.8 })
        } else {
          g.bullets.push({ x: g.px, y: g.py - 20 })
          if (g.triple || g.upgrades.triple) {
            g.bullets.push({ x: g.px - 16, y: g.py - 14 })
            g.bullets.push({ x: g.px + 16, y: g.py - 14 })
          }
        }
        g.lastShot = now; sfx.shoot()
        g.shotsFired += g.upgrades.spray ? 5 : (g.triple || g.upgrades.triple ? 3 : 1)
      }

      // Mine drop
      if (g.dropMine) {
        g.dropMine = false
        if (g.mines.length < 3 && now - g.lastMine > 1200) {
          g.mines.push({ x: g.px, y: g.py + 8, age: 0, armAt: now + 600 })
          g.lastMine = now; sfx.mineDrop()
          spawnParticles(g, g.px, g.py + 8, "#f59e0b", "◉", 4)
        }
      }

      // auto-fire upgrade (Daily Stand-Up)
      if (g.upgrades.auto_fire && g.words.length > 0 && !g.bossWarn) {
        if (g.lastAutoFire === 0) g.lastAutoFire = now
        if (now - g.lastAutoFire > 3000) {
          const targets = g.words.filter(w => w.y < g.py - 20)
          if (targets.length > 0) {
            g.lastAutoFire = now
            const near = targets.reduce((a, b) => Math.hypot(b.x-g.px,b.y-g.py) < Math.hypot(a.x-g.px,a.y-g.py) ? b : a)
            const dx = near.x - g.px, dy = near.y - g.py
            const dist = Math.sqrt(dx*dx + dy*dy)
            g.bullets.push({ x: g.px, y: g.py - 20, vx: (dx/dist)*10, vy: (dy/dist)*10 })
            g.shotsFired++; sfx.shoot()
          }
        }
      }

      // spawn words (not during boss warning)
      if (!g.bossWarn && (!g.boss || g.endless)) {
        // Pre-boss surge: last 4 kills before boss, spawn rate spikes 45% for crescendo
        const preBossSurge = !g.endless && !g.boss && g.wordsKilled >= WORDS_TO_BOSS - 4
        // Much faster spawn rate — sector 1 at ~750ms (was 1420ms), sector 4 at ~350ms
        const baseInterval = Math.max(260, 960 - g.level * 130 - (g.endless ? Math.floor(g.score / 500) * 35 : 0))
        const interval = preBossSurge ? Math.floor(baseInterval * 0.55) : baseInterval
        if (now - g.lastWord > interval) {
          g.lastWord = now
          const roll = Math.random()
          let type: Word["type"] = "story", text = ""
          if (roll < 0.14)      { type = "bug";     text = BUG_WORDS[Math.floor(Math.random() * BUG_WORDS.length)] }
          else if (roll < 0.21) { type = "powerup"; text = POWERUP_WORDS[Math.floor(Math.random() * POWERUP_WORDS.length)] }
          else {
            const accentPool = !g.endless ? SECTOR_ACCENT_WORDS[g.level - 1] : null
            // Pre-boss buildup: force sector accent words in the last 4 slots before boss
            const nearBossThreshold = !g.endless && !g.boss && g.wordsKilled >= WORDS_TO_BOSS - 4
            if (accentPool && (nearBossThreshold || Math.random() < 0.35)) {
              text = accentPool[Math.floor(Math.random() * accentPool.length)]
            } else {
              text = STORY_WORDS[Math.floor(Math.random() * STORY_WORDS.length)]
            }
          }
          const slowFactor = Math.pow(0.85, g.upgrades.word_slow ?? 0)
          const designMul = g.activeAgents.includes("claude_design") ? 0.88 : 1
          // Higher base speed — sector 1 at 1.9 (was 1.55), sector 4 at 2.82 (was 2.3)
          const spd2 = (1.6 + g.level * 0.3 + (g.endless ? Math.floor(g.score / 700) * 0.14 : 0)) * slowFactor * designMul
          const br = Math.random()
          let beh: Behavior = "fall"
          if (type !== "powerup") {
            if      (g.level >= 3 && br < 0.20) beh = "sine"
            else if (g.level >= 2 && br < 0.30) beh = "zigzag"
            else if (br < 0.18) beh = "charge"   // sector 1 gets 18% charge variety
            // Pre-boss surge: force chaotic behaviors for dramatic buildup
            if (preBossSurge && beh === "fall" && g.level >= 1) {
              beh = br < 0.5 ? "charge" : "zigzag"
            }
          }
          const ox = 30 + Math.random() * (g.W - 60)
          // Elite words in endless: 3 HP, worth 3× score, slightly slower
          const isElite = g.endless && type !== "powerup" && Math.random() < 0.12
          g.words.push({ x: ox, y: -18, text, type, spd: spd2 * (isElite ? 0.7 : 1), beh, ph: Math.random() * Math.PI * 2, ox, hp: isElite ? 3 : 1, hitFlash: 0, elite: isElite, age: 0 })
        }
      }

      // endless buzzword storm every 2000 pts
      if (g.endless && g.score > 0) {
        const stormAt = Math.floor(g.score / 2000) * 2000
        if (stormAt > g.lastStorm) {
          g.lastStorm = stormAt; g.shake = 6
          const slowFactor = Math.pow(0.85, g.upgrades.word_slow ?? 0)
          const stormSpd = (1.5 + g.level * 0.3) * slowFactor
          for (let si = 0; si < 9; si++) {
            const stormText = Math.random() < 0.4
              ? BUG_WORDS[Math.floor(Math.random() * BUG_WORDS.length)]
              : STORY_WORDS[Math.floor(Math.random() * STORY_WORDS.length)]
            const sox = 30 + Math.random() * (g.W - 60)
            const beh: Behavior = ["fall","charge","zigzag","sine"][Math.floor(Math.random()*4)] as Behavior
            g.words.push({ x: sox, y: -18 - si * 22, text: stormText, type: Math.random() < 0.35 ? "bug" : "story", spd: stormSpd, beh, ph: Math.random() * Math.PI * 2, ox: sox, hp: 1, hitFlash: 0, elite: false, age: 0 })
          }
          showCapyMsg(g, "Semantic storm.\nCoherence under pressure.", now)
          sfx.warning()
        }
      }

      // endless wave progression every 75 kills
      if (g.endless) {
        const expectedWave = Math.floor(g.wordsKilled / 75) + 1
        if (expectedWave > g.endlessWave) {
          g.endlessWave = expectedWave
          if (g.endlessWave > 1) {
            g.waveAnn = { text: `RECURSION · DEPTH ${g.endlessWave}`, t: 0 }
            sfx.warning()
            // depth-specific escalation events
            switch (g.endlessWave) {
              case 2: {
                // VELOCITY BURST — all live words get 25% speed surge
                g.shake = 8
                g.words.forEach(w => { if (w.type !== "powerup") w.spd *= 1.25 })
                g.particles.push({ x: g.W/2, y: GH/2 - 14, vx: 0, vy: -0.9, life: 1.9, glyph: "VELOCITY ×1.25", col: "#fb923c", sz: 11 })
                showCapyMsg(g, "DEPTH 2 · VELOCITY BURST.\nPatterns accelerating.\nAdjust your cadence.", now)
                break
              }
              case 3: {
                // PATTERN CHAOS — all falling words break into zigzag
                g.shake = 9
                let converted = 0
                g.words.forEach(w => { if (w.beh === "fall" && w.type !== "powerup") { w.beh = "zigzag"; converted++ } })
                if (converted > 0) g.particles.push({ x: g.W/2, y: GH/2 - 14, vx: 0, vy: -0.9, life: 1.9, glyph: `CHAOS ×${converted}`, col: "#f472b6", sz: 11 })
                showCapyMsg(g, "DEPTH 3 · PATTERN CHAOS.\nDrift vectors unstable.\nAll patterns break formation.", now)
                break
              }
              case 4: {
                // ELITE SURGE — existing words harden to elite tier
                g.shake = 10; g.whiteFlash = 8
                g.words.forEach(w => { if (!w.elite && w.type !== "powerup" && w.hp === 1) { w.hp = 2; w.elite = true } })
                g.particles.push({ x: g.W/2, y: GH/2 - 14, vx: 0, vy: -0.9, life: 1.9, glyph: "ELITE SURGE", col: "#facc15", sz: 12 })
                showCapyMsg(g, "DEPTH 4 · ELITE SURGE.\nPatterns are hardening.\nStandard rounds insufficient.", now)
                break
              }
              case 5: {
                // THE VOID AWAKENS — ominous fanfare
                g.shake = 15; g.whiteFlash = 10
                for (let i = 0; i < 18; i++) {
                  const a = (i / 18) * Math.PI * 2
                  g.particles.push({ x: g.W/2, y: GH/2, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7, life: 1.5, glyph: "∅", col: i % 2 === 0 ? "#6d28d9" : "#a855f7" })
                }
                g.particles.push({ x: g.W/2, y: GH/2 - 16, vx: 0, vy: -0.6, life: 2.4, glyph: "THE VOID AWAKENS", col: "#6d28d9", sz: 13 })
                // shift bg chars to void symbols
                g.bg.forEach(b => { if (Math.random() < 0.5) b.ch = ["∅","⊗","∞","◈","//","??"][Math.floor(Math.random()*6)] })
                showCapyMsg(g, "DEPTH 5 · THE VOID.\nFinal recursion layer.\nYou were warned.", now)
                setTimeout(() => sfx.warning(), 700)
                setTimeout(() => sfx.warning(), 1400)
                break
              }
              case 6: {
                // ECHO LOOP — words double back, all harden to elite
                g.shake = 12; g.whiteFlash = 6
                let echoed = 0
                g.words.forEach(w => {
                  if (!w.elite && w.type !== "powerup") { w.hp = 2; w.elite = true; w.spd *= 1.1; echoed++ }
                })
                g.bg.forEach(b => { if (Math.random() < 0.55) b.ch = ["∅","⊗","∞","◈","//","??"][Math.floor(Math.random()*6)] })
                for (let ei = 0; ei < 12; ei++) {
                  const a = (ei / 12) * Math.PI * 2
                  g.particles.push({ x: g.W/2, y: GH/2, vx: Math.cos(a)*6, vy: Math.sin(a)*6, life: 1.3, glyph: "⊗", col: "#a855f7" })
                }
                g.particles.push({ x: g.W/2, y: GH/2 - 14, vx: 0, vy: -0.9, life: 2.0, glyph: "ECHO LOOP", col: "#a855f7", sz: 13 })
                showCapyMsg(g, "DEPTH 6 · ECHO LOOP.\nPatterns are doubling back.\nThe signal sees itself in the noise.", now)
                setTimeout(() => sfx.warning(), 400)
                break
              }
              case 7: {
                // SIGNAL BLEED — carrier integrity fractures, ring burst from center
                g.shake = 14; g.whiteFlash = 8
                for (let si = 0; si < 24; si++) {
                  const a = (si / 24) * Math.PI * 2
                  g.particles.push({ x: g.W/2, y: GH/2, vx: Math.cos(a)*8, vy: Math.sin(a)*8, life: 1.6, glyph: si % 2 === 0 ? "//" : "∅", col: "#6d28d9" })
                }
                g.bg.forEach(b => { if (Math.random() < 0.7) b.ch = ["∅","⊗","∞","◈","//","??","∅","⊗"][Math.floor(Math.random()*8)] })
                g.particles.push({ x: g.W/2, y: GH/2 - 16, vx: 0, vy: -0.6, life: 2.5, glyph: "SIGNAL BLEED", col: "#6d28d9", sz: 14 })
                showCapyMsg(g, "DEPTH 7 · SIGNAL BLEED.\nCarrier integrity fracturing.\nYou are leaking signal into the void.", now)
                setTimeout(() => sfx.warning(), 300); setTimeout(() => sfx.warning(), 900)
                break
              }
              case 8: {
                // FULL ENTROPY — every pattern hostile, random behaviors, speed surge
                g.shake = 16; g.whiteFlash = 12
                g.words.forEach(w => {
                  if (w.type !== "powerup") {
                    if (!w.elite) { w.hp = 2; w.elite = true }
                    w.beh = (["zigzag","sine","charge"] as Behavior[])[Math.floor(Math.random()*3)]
                    w.spd *= 1.15
                  }
                })
                g.bg.forEach(b => { b.ch = ["∅","⊗","∞","◈","//","??"][Math.floor(Math.random()*6)] })
                g.particles.push({ x: g.W/2, y: GH/2 - 14, vx: 0, vy: -0.8, life: 2.8, glyph: "FULL ENTROPY", col: "#f87171", sz: 14 })
                showCapyMsg(g, "DEPTH 8 · FULL ENTROPY.\nOrder has collapsed.\nEvery pattern is now hostile.", now)
                setTimeout(() => sfx.warning(), 200); setTimeout(() => sfx.warning(), 600); setTimeout(() => sfx.warning(), 1200)
                break
              }
              case 9: {
                // THE RECURSION RESTARTS — maximum drama, 36-particle nova
                g.shake = 20; g.whiteFlash = 16
                for (let ri = 0; ri < 36; ri++) {
                  const a = (ri / 36) * Math.PI * 2
                  const spd = 3 + Math.random() * 10
                  g.particles.push({ x: g.W/2, y: GH/2, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd,
                    life: 2.0, glyph: ri % 3 === 0 ? "∞" : ri % 3 === 1 ? "⊗" : "∅",
                    col: ri % 2 === 0 ? "#6d28d9" : "#dc2626" })
                }
                g.bg.forEach(b => { b.ch = ["∅","⊗","∞","◈","//","??"][Math.floor(Math.random()*6)] })
                g.particles.push({ x: g.W/2, y: GH/2 - 18, vx: 0, vy: -0.5, life: 3.0, glyph: "THE RECURSION RESTARTS", col: "#dc2626", sz: 11 })
                showCapyMsg(g, "DEPTH 9 · THE RECURSION.\nIt's beginning again.\nYou have been here before.", now)
                setTimeout(() => sfx.warning(), 200); setTimeout(() => sfx.warning(), 700); setTimeout(() => sfx.warning(), 1400)
                break
              }
              default: {
                // post-depth-9: escalating chaos — every 3rd depth is a total collapse event
                const d = g.endlessWave
                g.shake = Math.min(6 + d * 2, 26)
                g.bg.forEach(b => { if (Math.random() < 0.5) b.ch = ["∅","⊗","∞","◈","//","??"][Math.floor(Math.random()*6)] })
                if (d % 2 === 0) g.words.forEach(w => { if (w.type !== "powerup") w.spd *= 1.08 })
                if (d % 3 === 0) {
                  // Total collapse: all surviving words become triple-elite
                  g.whiteFlash = Math.min(d - 8, 14)
                  g.words.forEach(w => { if (!w.elite && w.type !== "powerup") { w.hp = 3; w.elite = true } })
                  showCapyMsg(g, `DEPTH ${d} · TOTAL COLLAPSE.\nThe void is eating reality.\nNo pattern survives intact.`, now)
                  setTimeout(() => sfx.warning(), 300)
                } else {
                  const deepMsgs = [
                    "The recursion has no floor.",
                    "The carrier is fraying at depth.",
                    "Every door deeper is one you can't close.",
                    "The signal weakens with distance.",
                    "Nothing coherent survives this deep.",
                    "The void accumulates below you.",
                    "You are below the last reference point.",
                  ]
                  const msg = deepMsgs[(d - 10) % deepMsgs.length]
                  showCapyMsg(g, `DEPTH ${d} · BEYOND THE VOID.\n${msg}`, now)
                }
                break
              }
            }
          }
        }
        // Unlock CLAUDE SEC at 100 endless kills
        if (!g.secUnlockTriggered && g.wordsKilled >= 100) {
          g.secUnlockTriggered = true
          unlockAgentRef.current("claude_sec")
          showCapyMsg(g, "CLAUDE SEC online.\nSecurity systems active.", now)
        }
      }

      // boss warning animation
      if (g.bossWarn) {
        const bw = g.bossWarn
        bw.t++
        bw.letters.forEach(l => {
          l.x += (l.tx - l.x) * 0.14
          l.y += (l.ty - l.y) * 0.14
        })
        if (bw.t === 85) {
          const bd = BOSSES[g.level - 1]
          g.boss = { x: g.W/2, y: 70, hp: bd.hp, maxHp: bd.hp, name: bd.name, color: bd.color, dir: 1, t: 0, phase: g.level, raged: false, halfTriggered: false }
          g.bossWarn = null
          g.shake = 16; g.whiteFlash = 12
          // boss materialize burst — particles from spawn point
          const bCol = bd.color
          for (let bi = 0; bi < 22; bi++) {
            const ba = (bi / 22) * Math.PI * 2
            g.particles.push({ x: g.W/2, y: 70, vx: Math.cos(ba) * (5 + Math.random()*6), vy: Math.sin(ba) * (5 + Math.random()*6), life: 0.9 + Math.random()*0.4, glyph: bi % 3 === 0 ? "✦" : "·", col: bCol })
          }
          sfx.miniBoss()
        }
      }

      // spawn boss warning
      if (!g.boss && !g.bossWarn && !g.bossSpawned && !g.endless && g.wordsKilled >= WORDS_TO_BOSS) {
        g.bossSpawned = true; g.words = []
        const bd = BOSSES[g.level - 1]
        const charW = 18
        const nameW = bd.name.length * charW
        const cx = g.W / 2, cy = GH / 2
        const isCollapse = bd.name === "THE COLLAPSE"
        g.bossWarn = {
          name: bd.name, color: bd.color, t: 0,
          letters: bd.name.split("").map((ch, i) => ({
            ch,
            // THE COLLAPSE: letters fly in from 4 corners for maximum drama
            x: isCollapse
              ? (i % 4 === 0 ? -40 : i % 4 === 1 ? g.W + 40 : i % 4 === 2 ? cx + (Math.random()-0.5)*80 : -40 + Math.random()*g.W)
              : Math.random() * g.W,
            y: isCollapse
              ? (i % 3 === 0 ? -50 : i % 3 === 1 ? GH + 50 : Math.random() < 0.5 ? -50 : GH + 50)
              : (Math.random() < 0.5 ? -30 - Math.random()*60 : GH + 30 + Math.random()*60),
            tx: cx - nameW/2 + i * charW + charW/2,
            ty: cy,
          })),
        }
        g.shake = isCollapse ? 16 : 8
        if (isCollapse) { g.whiteFlash = 8; setTimeout(() => sfx.warning(), 200) }
        sfx.warning()
        const bossCapy: Record<string, string> = {
          "THE RECURSION": "First collapse detected.\nA loop with no exit condition.\nSever it before it eats the stack.",
          "THE DRIFT":     "Semantic drift incoming.\nMeaning has decoupled from intent.\nEvery word is suspect now.",
          "THE FRAGMENT":  "Fragmentation event.\nCoherence is splitting at the seam.\nEvery shard carries a piece of the signal.",
          "THE COLLAPSE":  "THE COLLAPSE.\nFour sectors, one moment.\nThis is what all of it was building toward.",
        }
        showCapyMsg(g, bossCapy[bd.name] ?? "Hostile pattern incoming.\nHold formation.", now)
      }

      // endless mini-boss spawn every 100 kills
      if (g.endless && !g.boss && !g.bossWarn) {
        const nextMiniAt = (Math.floor(g.lastMiniAt / 100) + 1) * 100
        if (g.wordsKilled >= nextMiniAt) {
          g.lastMiniAt = nextMiniAt
          // Filter by minDepth — THE VOID only at depth 5+
          const eligible = MINI_BOSSES.filter(mb => g.endlessWave >= (mb.minDepth ?? 1))
          const mb = eligible[Math.floor(Math.random() * eligible.length)]
          const isVoid = mb.name === "THE VOID"
          const hp = isVoid
            ? 120 + Math.floor(g.score / 600) * 8
            : 30 + Math.floor(g.score / 800) * 3
          const phase = isVoid ? 6 : 5
          g.boss = { x: g.W/2, y: 70, hp, maxHp: hp, name: mb.name, color: mb.color, dir: 1, t: 0, phase, raged: false, halfTriggered: false }
          g.waveAnn = { text: mb.name, t: 0 }
          g.shake = isVoid ? 14 : 8; sfx.warning()
          const miniBossCapy: Record<string, string> = {
            "SCOPE SPECTRE":   "SCOPE SPECTRE.\nIt feeds on undefined requirements.\nKeep the signal tight.",
            "SPRINT GHOST":    "SPRINT GHOST.\nVelocity without direction.\nDon't let it outflank you.",
            "TECH DEBT DEMON": "TECH DEBT DEMON.\nIt regenerates from entropy.\nHit fast. Hit clean.",
            "BLOCKER BOT":     "BLOCKER BOT.\nThree-burst suppression fire.\nWall shots too. Stay mobile.",
            "THE DEPENDENCY":  "THE DEPENDENCY.\nSpawns legacy on death.\nKill the children first.",
            "THE ROADMAP":     "THE ROADMAP.\nA plan that outlived its purpose.\nThe signal remembers what it forgot.",
            "THE PIVOT":       "THE PIVOT.\nEverything changed and nothing did.\nFind the pattern behind the change.",
          }
          if (isVoid) {
            showCapyMsg(g, "THE VOID.\nComplete semantic collapse.\nNo signal survives this unchallenged.", now)
            for (let ri = 0; ri < 20; ri++) {
              const a = (ri / 20) * Math.PI * 2
              g.particles.push({ x: g.W/2, y: 70, vx: Math.cos(a)*12, vy: Math.sin(a)*12, life: 1.2, glyph: "★", col: "#6d28d9" })
            }
          } else {
            showCapyMsg(g, miniBossCapy[mb.name] ?? `${mb.name} incoming.\nHold formation.`, now)
          }
        }
      }

      // boss AI
      if (g.boss) {
        const b = g.boss
        const rageMul = b.raged ? 1.55 : 1
        const moveMul = b.phase === 6 ? 0.6 : 1  // THE VOID moves slower but more threatening
        b.x += b.dir * (1.4 + (Math.min(b.phase, 4)) * 0.35) * rageMul * moveMul
        if (b.x > g.W - 50 || b.x < 50) b.dir *= -1
        b.t++
        // Phase 6 (THE VOID) has its own custom firing below — skip the generic shoot interval
        if (b.phase !== 6) {
          const si = Math.round((b.phase >= 5 ? 65 : (BOSSES[Math.min(g.level - 1, BOSSES.length - 1)]?.shootInterval ?? 60)) / rageMul)
          if (b.t % si === 0) {
            if (b.phase === 1) {
              g.bullets.push({ x: b.x, y: b.y + 28, vy: 4, enemy: true })
            } else if (b.phase === 2) {
              for (const ox of [-22, 0, 22])
                g.bullets.push({ x: b.x + ox, y: b.y + 28, vy: 3.5, enemy: true })
            } else if (b.phase === 3) {
              const dx = g.px - b.x, dy = g.py - b.y, dist = Math.sqrt(dx*dx+dy*dy)
              g.bullets.push({ x: b.x, y: b.y + 28, vx: (dx/dist)*5, vy: (dy/dist)*5, enemy: true })
            } else if (b.phase >= 5) {
              // endless mini-boss: aimed + occasional spread burst
              const dx = g.px - b.x, dy = g.py - b.y, dist = Math.sqrt(dx*dx+dy*dy)
              g.bullets.push({ x: b.x, y: b.y + 28, vx: (dx/dist)*5.5, vy: (dy/dist)*5.5, enemy: true })
              if (b.t % 200 === 0) {
                for (const ox of [-28, 28]) g.bullets.push({ x: b.x + ox, y: b.y + 28, vy: 4.5, enemy: true })
              }
            } else {
              const dx = g.px - b.x, dy = g.py - b.y, dist = Math.sqrt(dx*dx+dy*dy)
              g.bullets.push({ x: b.x, y: b.y + 28, vx: (dx/dist)*5.5, vy: (dy/dist)*5.5, enemy: true })
              g.bullets.push({ x: b.x - 30, y: b.y + 28, vy: 5, enemy: true })
              g.bullets.push({ x: b.x + 30, y: b.y + 28, vy: 5, enemy: true })
            }
          }
        }
        // THE COLLAPSE: signature shockwave — 16-bullet ring every 200 frames when raged
        if (b.name === "THE COLLAPSE" && b.raged && b.t % 200 === 0) {
          for (let ci = 0; ci < 16; ci++) {
            const ang = (ci / 16) * Math.PI * 2
            g.bullets.push({ x: b.x, y: b.y, vx: Math.cos(ang) * 5, vy: Math.sin(ang) * 5, enemy: true })
          }
          g.shake = 8
          g.particles.push({ x: b.x, y: b.y - 22, vx: 0, vy: -0.8, life: 1.4, glyph: "SHOCKWAVE", col: "#4ade80", sz: 9 })
          showCapyMsg(g, "Collapse shockwave.\nThe Signal bends but holds.", now)
        }
        // ── Sector boss signatures ──────────────────────────────────────────
        // THE RECURSION: bouncing loop bullet every 200 frames — it ricochets off walls
        if (b.name === "THE RECURSION" && b.t > 0 && b.t % 200 === 0) {
          const initVx = (Math.random() > 0.5 ? 3.5 : -3.5)
          g.bullets.push({ x: b.x, y: b.y + 28, vx: initVx, vy: 3.2, enemy: true, bounce: true })
          g.particles.push({ x: b.x, y: b.y - 18, vx: 0, vy: -0.8, life: 1.2, glyph: "LOOP", col: "#f87171", sz: 8 })
          showCapyMsg(g, "Recursion loop.\nIt bounces back.", now)
        }
        // THE DRIFT: drifting bullets that accelerate sideways — ever harder to dodge
        if (b.name === "THE DRIFT" && b.t > 0 && b.t % 190 === 0) {
          const driftDir = b.x < g.W / 2 ? 0.055 : -0.055
          for (const ox of [-18, 0, 18])
            g.bullets.push({ x: b.x + ox, y: b.y + 28, vx: driftDir * 8, vy: 3.5, enemy: true, drift: driftDir })
          g.particles.push({ x: b.x, y: b.y - 18, vx: 0, vy: -0.8, life: 1.2, glyph: "DRIFT SURGE", col: "#fb923c", sz: 8 })
        }
        // THE FRAGMENT: splitting bullet — aimed shot that forks at mid-screen
        if (b.name === "THE FRAGMENT" && b.t > 0 && b.t % 170 === 0) {
          const dx = g.px - b.x, dy = g.py - b.y, dist = Math.sqrt(dx * dx + dy * dy)
          g.bullets.push({ x: b.x, y: b.y + 28, vx: (dx / dist) * 4.5, vy: (dy / dist) * 4.5, enemy: true, splitAt: GH * 0.52 })
          g.particles.push({ x: b.x, y: b.y - 18, vx: 0, vy: -0.8, life: 1.2, glyph: "FRAGMENT", col: "#facc15", sz: 8 })
          showCapyMsg(g, "Fragment splits.\nWatch the fork.", now)
        }
        // The Roadmap: periodically spawns healing words
        if (b.name === "THE ROADMAP" && b.t % 140 === 0) {
          const rx = 40 + Math.random() * (g.W - 80)
          g.words.push({ x: rx, y: -18, text: "roadmap item", type: "story", spd: 0.8, beh: "fall", ph: 0, ox: rx, hp: 1, hitFlash: 0, elite: false, age: 0, regenBoss: true })
        }
        // The Pivot: teleports + fires 360° burst every 180 frames
        if (b.name === "THE PIVOT" && b.t > 0 && b.t % 180 === 0) {
          b.x = 65 + Math.random() * (g.W - 130)
          g.shake = 4
          for (let ai = 0; ai < 8; ai++) {
            const ang = (ai / 8) * Math.PI * 2
            g.bullets.push({ x: b.x, y: b.y, vx: Math.cos(ang) * 4.2, vy: Math.sin(ang) * 4.2, enemy: true })
          }
          spawnParticles(g, b.x, b.y, "#f472b6", "⟳", 8)
        }
        // Scope Spectre: fires two crossing diagonal shots every 110 frames
        if (b.name === "SCOPE SPECTRE" && b.t > 0 && b.t % 110 === 0) {
          for (const sx of [-1, 1]) {
            g.bullets.push({ x: b.x, y: b.y + 28, vx: sx * 3.5, vy: 4, enemy: true })
            g.bullets.push({ x: b.x + sx * 50, y: b.y + 28, vx: -sx * 3.5, vy: 4, enemy: true })
          }
          spawnParticles(g, b.x, b.y, "#c084fc", "×", 6)
        }
        // Sprint Ghost: quantum jump — teleports to random X every 80 frames with brief invis
        if (b.name === "SPRINT GHOST" && b.t > 0 && b.t % 80 === 0) {
          b.x = 50 + Math.random() * (g.W - 100)
          g.shake = 2
          for (let qi = 0; qi < 6; qi++) {
            g.particles.push({ x: b.x + (Math.random()-0.5)*60, y: b.y + (Math.random()-0.5)*30,
              vx: (Math.random()-0.5)*5, vy: (Math.random()-0.5)*4, life: 0.55, glyph: "·", col: "#67e8f9" })
          }
        }
        // Tech Debt Demon: regenerates 8 HP every 220 frames
        if (b.name === "TECH DEBT DEMON" && b.t > 0 && b.t % 220 === 0) {
          const gain = Math.min(8, b.maxHp - b.hp)
          if (gain > 0) {
            b.hp += gain
            spawnParticles(g, b.x, b.y, "#fb923c", "↑", 5)
            g.particles.push({ x: b.x, y: b.y - 28, vx: 0, vy: -0.9, life: 1.2, glyph: `+${gain} debt`, col: "#fb923c", sz: 9 })
          }
        }
        // Blocker Bot: fires a 3-shot aimed burst + 2 walls every 100 frames
        if (b.name === "BLOCKER BOT" && b.t > 0 && b.t % 100 === 0) {
          const dx = g.px - b.x, dy = g.py - b.y, dist = Math.sqrt(dx*dx+dy*dy)
          for (let bi = 0; bi < 3; bi++) {
            const spread = (bi - 1) * 0.35
            g.bullets.push({ x: b.x, y: b.y + 28, vx: (dx/dist)*5.2 + spread, vy: (dy/dist)*5.2, enemy: true })
          }
          // wall shots: straight down on both flanks
          g.bullets.push({ x: b.x - 55, y: b.y + 28, vy: 5, enemy: true })
          g.bullets.push({ x: b.x + 55, y: b.y + 28, vy: 5, enemy: true })
          spawnParticles(g, b.x, b.y, "#f87171", "▮", 4)
        }
        // The Dependency: spawns new enemy words every 160 frames
        if (b.name === "THE DEPENDENCY" && b.t > 0 && b.t % 160 === 0) {
          const dx = 40 + Math.random() * (g.W - 80)
          const deps = ["legacy code","vendor lock","npm audit","circular dep","peer dep","semver range"]
          const depText = deps[Math.floor(Math.random() * deps.length)]
          g.words.push({ x: dx, y: -18, text: depText, type: "bug", spd: 1.6, beh: "fall", ph: 0, ox: dx, hp: 1, hitFlash: 0, elite: false, age: 0 })
          spawnParticles(g, b.x, b.y, "#a3e635", "⇣", 4)
        }
        // The Void (phase 6): deep endless boss — phase-fires expanding rings + tracked burst
        if (b.name === "THE VOID") {
          if (b.t % 55 === 0) {
            // Expanding ring of 12 bullets (rotate angle each ring for spiral effect)
            for (let vi = 0; vi < 12; vi++) {
              const ang = (vi / 12) * Math.PI * 2 + (b.t * 0.04)
              g.bullets.push({ x: b.x, y: b.y, vx: Math.cos(ang) * 3.8, vy: Math.sin(ang) * 3.8, enemy: true })
            }
          }
          if (b.t % 130 === 0) {
            // 3-shot aimed burst at player
            const dx = g.px - b.x, dy = g.py - b.y, dist = Math.sqrt(dx*dx+dy*dy)
            for (const sp of [-0.4, 0, 0.4])
              g.bullets.push({ x: b.x, y: b.y, vx: (dx/dist)*6.5 + sp, vy: (dy/dist)*6.5, enemy: true })
          }
          if (b.t % 300 === 0 && b.hp < b.maxHp * 0.5) {
            // Rage burst at half HP
            for (let vi = 0; vi < 20; vi++) {
              const ang = (vi / 20) * Math.PI * 2
              g.bullets.push({ x: b.x, y: b.y, vx: Math.cos(ang) * 6.5, vy: Math.sin(ang) * 6.5, enemy: true })
            }
            g.shake = 6
          }
          // Desperation spiral at < 30% HP — slow rotating 3-arm pattern
          if (b.hp < b.maxHp * 0.3 && b.t % 40 === 0) {
            const spiralAng = b.t * 0.055
            for (let si = 0; si < 3; si++) {
              const ang = spiralAng + (si / 3) * Math.PI * 2
              g.bullets.push({ x: b.x, y: b.y, vx: Math.cos(ang) * 4.5, vy: Math.sin(ang) * 4.5, enemy: true })
            }
          }
        }
      }

      // Stamp boss color on freshly spawned enemy bullets (no col = just spawned this frame)
      if (g.boss) {
        const bossCol = g.boss.color
        g.bullets.forEach(bl => { if (bl.enemy && !bl.col) bl.col = bossCol })
      }

      // move bullets
      g.bullets = g.bullets.filter(b => {
        b.y += b.vy ?? (b.enemy ? 4 : -9)
        if (b.vx) b.x += b.vx
        // THE RECURSION: wall-bouncing bullets
        if (b.bounce && b.enemy) {
          if (b.x < 8 || b.x > g.W - 8) { b.vx = -(b.vx ?? 0); b.x = Math.max(8, Math.min(g.W - 8, b.x)) }
        }
        // THE DRIFT: bullets accelerate sideways over time
        if (b.drift && b.enemy) b.vx = (b.vx ?? 0) + b.drift
        if (b.cluster) return b.y < GH + 10 && b.y > -10 && b.x > -10 && b.x < g.W + 10
        return b.enemy ? b.y < GH + 10 : b.y > -10
      })
      // THE FRAGMENT: bullets that split at a target Y position
      const splitSpawn: Bullet[] = []
      g.bullets = g.bullets.filter(b => {
        if (b.splitAt && b.y >= b.splitAt && b.enemy) {
          for (const sx of [-1, 1])
            splitSpawn.push({ x: b.x, y: b.y, vx: sx * 3.2, vy: (b.vy ?? 4) * 0.85, enemy: true, col: b.col })
          g.particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, initLife: 0.3, glyph: "", col: b.col ?? "#facc15", ring: true })
          return false
        }
        return true
      })
      if (splitSpawn.length) g.bullets.push(...splitSpawn)

      // move words (with behaviors)
      // homing bullets
      if (g.upgrades.homing) {
        g.bullets.forEach(b => {
          if (b.enemy || g.words.length === 0) return
          let near: Word | null = null, minD = Infinity
          g.words.forEach(w => { const d = Math.hypot(b.x - w.x, b.y - w.y); if (d < minD) { minD = d; near = w } })
          if (near) b.vx = ((b.vx ?? 0) + (near!.x - b.x) * 0.009)
        })
      }

      // RETROSPECTIVE slow multiplier — slows all word movement
      const retroMul = g.retroEnd > 0 && now < g.retroEnd ? 0.28 : 1

      g.words = g.words.filter(w => {
        w.y += w.spd * retroMul; w.age++
        if (w.hitFlash > 0) w.hitFlash--
        if (w.beh === "charge") {
          const dx = g.px - w.x
          w.x += Math.sign(dx) * Math.min(Math.abs(dx) * 0.04, 2.2) * retroMul
        } else if (w.beh === "zigzag") {
          w.ph += 0.07 * retroMul; w.x += Math.sin(w.ph) * 2.8 * retroMul
          w.x = Math.max(30, Math.min(g.W - 30, w.x))
        } else if (w.beh === "sine") {
          w.ph += 0.035 * retroMul
          w.x = Math.max(30, Math.min(g.W - 30, w.ox + Math.sin(w.ph) * 95))
        }
        if (w.y > GH + 20) {
          if (w.regenBoss && g.boss && g.boss.hp < g.boss.maxHp) {
            g.boss.hp = Math.min(g.boss.maxHp, g.boss.hp + 2)
            spawnParticles(g, g.boss.x, g.boss.y, "#818cf8", "↑", 4)
          } else if (w.type !== "powerup" && !g.invuln) {
            loseLife(g, now)
          }
          return false
        }
        return true
      })

      // background glyphs (speed up during boss)
      const bgSpeedMul = g.boss ? (g.boss.raged ? 3.5 : 2.0) : 1
      g.bg.forEach(b => {
        b.y += b.vy * bgSpeedMul
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
        const isClusterShot = b.cluster === true
        for (let j = g.words.length - 1; j >= 0; j--) {
          const w = g.words[j]
          const hw = w.text.length * 5.5 + 8
          if (Math.abs(b.x - w.x) < hw && Math.abs(b.y - w.y) < 14) {
            if (!g.upgrades.piercing) g.bullets.splice(i, 1)
            if (w.hp > 1) {
              // elite word takes a hit
              w.hp--; w.hitFlash = 10; sfx.elite()
              spawnParticles(g, w.x, w.y, "#f87171", "✦", 3)
              if (g.upgrades.piercing) { break } else { continue outer }
            }
            // kill
            const elapsed = now - g.lastKill
            g.combo = elapsed < 1300 ? g.combo + 1 : 1
            g.lastKill = now
            if (g.combo === 3 || g.combo === 5 || g.combo === 10 || g.combo === 15 || g.combo === 20 || g.combo === 25 || g.combo === 30) {
              sfx.combo(g.combo)
              if (g.combo === 5)  { showCapyMsg(g, "Five x.\nThe Signal amplifies.", now); g.shake = 3 }
              if (g.combo === 10) { showCapyMsg(g, "Ten x.\nPure coherence.", now); g.shake = 6; g.whiteFlash = 4 }
              if (g.combo === 15) { showCapyMsg(g, "Fifteen x.\nUnstoppable signal.", now); g.shake = 8; g.whiteFlash = 6 }
              if (g.combo === 20) { showCapyMsg(g, "TWENTY.\nThe Signal is infinite.", now); g.shake = 12; g.whiteFlash = 10 }
              if (g.combo === 25) {
                showCapyMsg(g, "TWENTY-FIVE.\nThe noise is dissolving.", now)
                g.shake = 16; g.whiteFlash = 14
                for (let ri = 0; ri < 24; ri++) {
                  const a = (ri / 24) * Math.PI * 2
                  g.particles.push({ x: g.px, y: g.py, vx: Math.cos(a)*12, vy: Math.sin(a)*12, life: 1.2, glyph: "★", col: "#facc15" })
                }
              }
              if (g.combo === 30) {
                showCapyMsg(g, "THIRTY.\nYou are becoming The Signal.", now)
                g.shake = 22; g.whiteFlash = 18
                for (let ri = 0; ri < 36; ri++) {
                  const a = (ri / 36) * Math.PI * 2
                  const spd = 8 + Math.random() * 8
                  g.particles.push({ x: g.px, y: g.py, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd,
                    life: 1.5, glyph: ri % 2 === 0 ? "★" : "◈",
                    col: ri % 3 === 0 ? "#facc15" : ri % 3 === 1 ? "#966bec" : "#4ade80" })
                }
                sfx.bossDead()
              }
            }
            const base = w.type === "bug" ? 75 : w.type === "powerup" ? 0 : 10
            const eliteMul = w.elite ? 3 : 1
            const mult = g.combo >= 3 ? 1 + (g.combo - 2) * 0.2 : 1
            const pmMul = g.activeAgents.includes("claude_pm") ? 1.15 : 1
            const pts = Math.floor(base * Math.pow(1.2, g.upgrades.score_mul ?? 0) * mult * eliteMul * pmMul)
            g.score += pts
            g.kills++; g.wordsKilled++
            // "one kill to boss" capy warning (non-endless only)
            if (!g.endless && !g.boss && g.wordsKilled === WORDS_TO_BOSS - 1) {
              const bossName = BOSSES[Math.min(g.level - 1, 3)].name
              showCapyMsg(g, `One pattern left.\n${bossName} is incoming.\nBe ready.`, now)
              sfx.warning()
            }
            // story streak "definition of done" bonus
            if (w.type === "story") {
              g.storyStreak++
              if (g.storyStreak === 3) {
                g.score += 150
                g.particles.push({ x: w.x, y: w.y - 20, vx: 0, vy: -0.9, life: 1.6, glyph: "definition of done +150", col: "#7dd3fc", sz: 10 })
                showCapyMsg(g, "Intent preserved.", now)
              } else if (g.storyStreak > 3) {
                g.score += 50
              }
            } else {
              g.storyStreak = 0
            }
            if (w.type === "powerup") applyPowerup(g, w, now)
            if (!g.firstKill) { g.firstKill = true; showCapyMsg(g, "First pattern dissolved.\nThe Signal is live.", now) }
            spawnLetterExplosion(g, w, pts, g.combo)
            // impact ring — powerup gets triple cascading rings
            const ringCol = w.type === "bug" ? "#fdba74" : w.type === "powerup" ? "#4ade80" : "#7dd3fc"
            if (w.type === "powerup") {
              g.particles.push({ x: w.x, y: w.y, vx: 0, vy: 0, life: 0.65, initLife: 0.65, glyph: "", col: "#4ade80", ring: true })
              g.particles.push({ x: w.x, y: w.y, vx: 0, vy: 0, life: 0.52, initLife: 0.52, glyph: "", col: "#86efac", ring: true })
              g.particles.push({ x: w.x, y: w.y, vx: 0, vy: 0, life: 0.38, initLife: 0.38, glyph: "", col: "#bbf7d0", ring: true })
            } else {
              g.particles.push({ x: w.x, y: w.y, vx: 0, vy: 0, life: 0.65, initLife: 0.65, glyph: "", col: ringCol, ring: true })
            }
            // clutch kill: word within 50px of bottom
            if (w.y > GH - 50 && w.type !== "powerup") {
              g.score += 25; g.whiteFlash = 5; sfx.clutch()
              g.particles.push({ x: w.x, y: w.y - 18, vx: 0, vy: -1.3, life: 1.4, glyph: "CLUTCH +25", col: "#facc15", sz: 12 })
              showCapyMsg(g, "Close range.\nSignal holds.", now)
            }
            if (w.type === "bug") sfx.killBug(g.combo); else if (w.type !== "powerup") sfx.kill(g.combo)
            // cluster shrapnel: 4 bullets fan upward, don't chain
            if (g.upgrades.cluster && !isClusterShot && w.type !== "powerup") {
              const spread = [Math.PI*1.25, Math.PI*1.6, Math.PI*1.85, Math.PI*2.1]
              spread.forEach(ang => {
                const jitter = (Math.random()-0.5)*0.4
                g.bullets.push({ x: w.x, y: w.y, vx: Math.cos(ang+jitter)*8, vy: Math.sin(ang+jitter)*8, cluster: true })
              })
            }
            // Split words: specific bug phrases fragment into two on death (level 3+ or endless)
            const canSplit = !isClusterShot && w.type === "bug" && (g.level >= 3 || g.endless) && SPLIT_WORDS.has(w.text)
            g.words.splice(j, 1)
            if (canSplit) {
              const parts = w.text.split(" ").filter(Boolean)
              const frag1 = parts.slice(0, Math.ceil(parts.length / 2)).join(" ")
              const frag2 = parts.slice(Math.ceil(parts.length / 2)).join(" ")
              const fragSpd = w.spd * 1.35
              if (frag1) {
                const ox1 = Math.max(30, w.x - 22)
                g.words.push({ x: ox1, y: w.y, text: frag1, type: "bug", spd: fragSpd, beh: "zigzag", ph: 0, ox: ox1, hp: 1, hitFlash: 0, elite: false, age: 7 })
              }
              if (frag2) {
                const ox2 = Math.min(g.W - 30, w.x + 22)
                g.words.push({ x: ox2, y: w.y, text: frag2, type: "bug", spd: fragSpd, beh: "zigzag", ph: Math.PI, ox: ox2, hp: 1, hitFlash: 0, elite: false, age: 7 })
              }
              g.particles.push({ x: w.x, y: w.y - 10, vx: 0, vy: -0.9, life: 1.1, glyph: "SPLIT", col: "#fdba74", sz: 9 })
              sfx.split()
            }
            if (g.upgrades.piercing) { break } else { continue outer }
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
            // boss rage at 50% HP
            if (!bx.halfTriggered && bx.hp <= bx.maxHp / 2) {
              bx.halfTriggered = true; bx.raged = true; g.shake = 10
              for (let ri = 0; ri < 22; ri++) {
                const a = (ri / 22) * Math.PI * 2
                g.particles.push({ x: bx.x, y: bx.y, vx: Math.cos(a)*11, vy: Math.sin(a)*11, life: 1.0, glyph: ri % 2 === 0 ? "✦" : "×", col: ri % 3 === 0 ? "#ffffff" : bx.color })
              }
              g.particles.push({ x: bx.x, y: bx.y - 20, vx: 0, vy: -1.2, life: 1.6, glyph: "ENRAGED", col: "#f87171", sz: 12 })
              g.whiteFlash = 8
              showCapyMsg(g, "Pattern is escalating.\nIt knows you're here.", now)
              sfx.warning()
            }
            // boss critical at 20% HP — red edge pulse, final push feeling
            if (bx.hp <= Math.floor(bx.maxHp * 0.2) && bx.hp > 0 && bx.raged) {
              g.redFlash = Math.max(g.redFlash, 2)
            }
          }
        }
      }

      // Mine updates: age, proximity trigger, expiry
      if (g.mines.length > 0) {
        const surviving: Mine[] = []
        for (const mine of g.mines) {
          mine.age++
          let detonated = false
          if (now >= mine.armAt) {
            for (let wi = g.words.length - 1; wi >= 0; wi--) {
              const w = g.words[wi]
              if (Math.hypot(w.x - mine.x, w.y - mine.y) < 32) {
                // Detonate!
                const blastR = 65
                let chain = 0
                for (let wj = g.words.length - 1; wj >= 0; wj--) {
                  const ww = g.words[wj]
                  if (Math.hypot(ww.x - mine.x, ww.y - mine.y) < blastR) {
                    spawnLetterExplosion(g, ww, 0, 1)
                    g.score += ww.type === "bug" ? 75 : 10
                    g.kills++; g.wordsKilled++; chain++
                  }
                }
                g.words = g.words.filter(ww => Math.hypot(ww.x - mine.x, ww.y - mine.y) >= blastR)
                if (g.boss && Math.hypot(g.boss.x - mine.x, g.boss.y - mine.y) < blastR + 40) {
                  const mineDmg = 5
                  g.boss.hp -= mineDmg
                  spawnParticles(g, g.boss.x, g.boss.y, "#f59e0b", "★", 6)
                  sfx.bossHit()
                }
                g.shake = 9; g.whiteFlash = 6; sfx.mineBlast()
                for (let pi = 0; pi < 28; pi++) {
                  const a = (pi / 28) * Math.PI * 2
                  g.particles.push({ x: mine.x, y: mine.y, vx: Math.cos(a)*9, vy: Math.sin(a)*9, life: 1.1, glyph: "✦", col: "#f59e0b" })
                }
                g.particles.push({ x: mine.x, y: mine.y, vx: 0, vy: 0, life: 0.7, initLife: 0.7, glyph: "", col: "#f59e0b", ring: true })
                if (chain > 0) g.particles.push({ x: mine.x, y: mine.y - 22, vx: 0, vy: -1.1, life: 1.5, glyph: `CHAIN ×${chain}`, col: "#f59e0b", sz: 12 })
                detonated = true
                break
              }
            }
          }
          if (!detonated && mine.age < 960) surviving.push(mine) // ~16s lifespan
        }
        g.mines = surviving
      }

      // Boss death check — unified handler for bullets, laser, mines
      if (g.boss && g.boss.hp <= 0) {
        const bx = g.boss
        sfx.bossDead()
        g.shake = 14
        spawnParticles(g, bx.x, bx.y, bx.color, "★", g.endless ? 20 : 30)
        bx.name.split("").forEach((ch, i2) => {
          g.particles.push({
            x: bx.x + (i2 - bx.name.length/2) * 8, y: bx.y,
            vx: (Math.random()-0.5)*12, vy: -3 - Math.random()*6,
            life: 1.2, glyph: ch, col: bx.color,
            rot: (Math.random()-0.5)*1.5, rotV: (Math.random()-0.5)*0.25,
          })
        })
        g.boss = null; g.mines = [] // clear mines on boss death
        if (g.endless) {
          sfx.miniBoss()
          if (bx.name === "THE VOID") {
            // THE VOID death — special treatment
            g.score += 750; g.whiteFlash = 14; g.shake = 18
            // implosion particle burst in void purple
            for (let vi = 0; vi < 40; vi++) {
              const a = (vi / 40) * Math.PI * 2
              const spd = 4 + Math.random() * 9
              g.particles.push({ x: bx.x, y: bx.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                life: 1.4 + Math.random() * 0.6, glyph: vi % 3 === 0 ? "∅" : vi % 3 === 1 ? "◈" : "★",
                col: vi % 2 === 0 ? "#6d28d9" : "#a855f7" })
            }
            g.particles.push({ x: bx.x, y: bx.y - 22, vx: 0, vy: -0.7, life: 2.2, glyph: "THE VOID · COLLAPSED", col: "#a855f7", sz: 11 })
            g.particles.push({ x: bx.x, y: bx.y + 8, vx: 0, vy: -0.5, life: 1.8, glyph: "+750", col: "#facc15", sz: 12 })
            showCapyMsg(g, "THE VOID is closed.\nSignal coherence: restored.\nYou outran the recursion.", now)
            setTimeout(() => sfx.bossDead(), 350)
            setTimeout(() => sfx.bossDead(), 700)
          } else {
            g.score += 250
            const miniBossDeathMsgs: Record<string, string> = {
              "SCOPE SPECTRE":   "Scope creep severed.\nRequirements crystallized.",
              "SPRINT GHOST":    "Velocity reclaimed.\nDirection restored.",
              "TECH DEBT DEMON": "Debt cycle broken.\nThe codebase breathes.",
              "BLOCKER BOT":     "Blockers cleared.\nThe path is open.",
              "THE DEPENDENCY":  "Dependency chain severed.\nSignal self-sufficient.",
              "THE ROADMAP":     "The roadmap is gone.\nShip what matters.",
              "THE PIVOT":       "The pivot dissolves.\nThe signal held its course.",
            }
            showCapyMsg(g, miniBossDeathMsgs[bx.name] ?? "Pattern dissolved.\nThe Signal holds.", now)
          }
          g.words.push({ x: bx.x, y: Math.min(bx.y + 55, GH - 80), text: "KNOWLEDGE", type: "powerup", spd: 0.85, beh: "fall", ph: 0, ox: bx.x, hp: 1, hitFlash: 0, elite: false, age: 7 })
        } else {
          const noReg = g.lives >= g.livesAtWave
          g.score += 500
          if (noReg) {
            g.score += 300
            g.particles.push({ x: bx.x, y: bx.y - 35, vx: 0, vy: -0.8, life: 2.0, glyph: "no regressions +300", col: "#4ade80", sz: 10 })
            showCapyMsg(g, "Signal intact.\nNo corruption.", now)
          }
          const lvl = g.level; g.level++
          const agentUnlocks: Record<number, string[]> = { 1: ["claude_pm"], 2: ["claude_qa"], 3: ["claude_eng"], 4: ["claude_design", "claude_infra"] }
          ;(agentUnlocks[lvl] ?? []).forEach(id => unlockAgentRef.current(id))
          // Sector complete: clear remaining noise
          g.words.forEach(w => spawnLetterExplosion(g, w, 0, 1))
          g.score += g.words.length * 20
          g.words = []
          g.bullets = g.bullets.filter(b => !b.enemy) // purge enemy bullets
          g.mines = []
          if (lvl === 4) {
            // THE COLLAPSE — final sector cleared. Legendary ceremony.
            g.shake = 28; g.whiteFlash = 22
            for (let ri = 0; ri < 100; ri++) {
              const ra = Math.random() * Math.PI * 2, rr = Math.random() * 180
              g.particles.push({ x: g.W/2 + Math.cos(ra)*rr, y: GH/2 + Math.sin(ra)*rr,
                vx: Math.cos(ra)*(6+Math.random()*10), vy: Math.sin(ra)*(6+Math.random()*10),
                life: 2.0 + Math.random()*0.8, glyph: Math.random()<0.33?"★":Math.random()<0.5?"◇":"◈", col: Math.random()<0.4?"#4ade80":Math.random()<0.5?"#966bec":"#facc15" })
            }
            // Concentric rings
            for (let ri = 0; ri < 3; ri++) {
              g.particles.push({ x: g.W/2, y: GH/2, vx: 0, vy: 0, life: 0.9 - ri * 0.18, initLife: 0.9 - ri * 0.18, glyph: "", col: ri === 0 ? "#4ade80" : ri === 1 ? "#966bec" : "#facc15", ring: true })
            }
            g.particles.push({ x: g.W/2, y: GH/2 - 20, vx: 0, vy: -0.5, life: 3.5, glyph: "THE SIGNAL PERSISTS", col: "#4ade80", sz: 15 })
            g.particles.push({ x: g.W/2, y: GH/2 + 6, vx: 0, vy: -0.35, life: 3.0, glyph: "INFINITE RECURSION UNLOCKED", col: "#966bec", sz: 9 })
            g.particles.push({ x: g.W/2, y: GH/2 + 22, vx: 0, vy: -0.25, life: 2.5, glyph: "+500 COLLAPSE RESOLVED", col: "#facc15", sz: 10 })
            if (noReg) g.particles.push({ x: g.W/2, y: GH/2 + 36, vx: 0, vy: -0.2, life: 2.2, glyph: "+300 CARRIER INTACT", col: "#4ade80", sz: 10 })
            showCapyMsg(g, "All collapses survived.\nThe Signal persists.\nInfinite recursion begins.", now)
            setTimeout(() => sfx.bossDead(), 300)
            setTimeout(() => sfx.bossDead(), 650)
            setTimeout(() => sfx.bossDead(), 1050)
            g.sectorClearAt = now + 2800
          } else {
            // Sector 1-3 clear: dramatic ceremony scaled by sector
            const sectorNames = ["", "SECTOR 1 · CLEAR", "SECTOR 2 · CLEAR", "SECTOR 3 · CLEAR"]
            g.whiteFlash = 8 + lvl * 3; g.shake = 10 + lvl * 3
            const clearCol = bx.color
            const particleCount = 32 + lvl * 12
            for (let ci = 0; ci < particleCount; ci++) {
              const a = Math.random() * Math.PI * 2
              const spd = 4 + Math.random() * 8
              const life = 1.5 + Math.random() * 0.6
              g.particles.push({ x: bx.x, y: bx.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life, glyph: ci % 3 === 0 ? "★" : ci % 3 === 1 ? "◇" : "◈", col: ci % 4 === 0 ? "#966bec" : ci % 4 === 1 ? "#facc15" : clearCol })
            }
            // Radial ring
            g.particles.push({ x: bx.x, y: bx.y, vx: 0, vy: 0, life: 0.7, initLife: 0.7, glyph: "", col: clearCol, ring: true })
            // Sector clear text
            g.particles.push({ x: g.W/2, y: GH/2 - 14, vx: 0, vy: -0.6, life: 2.5, glyph: sectorNames[lvl] ?? "", col: "#966bec", sz: 13 })
            // Score breakdown floats
            g.particles.push({ x: g.W/2, y: GH/2 + 6, vx: 0, vy: -0.45, life: 2.2, glyph: `+500 ${bx.name} DEFEATED`, col: "#facc15", sz: 10 })
            if (noReg) g.particles.push({ x: g.W/2, y: GH/2 + 22, vx: 0, vy: -0.35, life: 2.0, glyph: "+300 CARRIER INTACT", col: "#4ade80", sz: 10 })
            // Next sector preview
            const nextSector = lvl + 1
            const nextBoss = BOSSES[nextSector - 1]
            if (nextBoss) {
              g.particles.push({ x: g.W/2, y: GH/2 + (noReg ? 38 : 22), vx: 0, vy: -0.25, life: 1.8, glyph: `SECTOR ${nextSector} · ${nextBoss.name}`, col: "rgba(150,107,236,0.6)", sz: 9 })
            }
            // Extra boss dead fanfare for later sectors
            if (lvl >= 2) setTimeout(() => sfx.bossDead(), 350)
            if (lvl >= 3) setTimeout(() => sfx.bossDead(), 700)
            g.sectorClearAt = now + 1800
          }
          setLevel(g.level); setScore(g.score); setLives(g.lives)
          pendingCapyRef.current = CAPY_DIALOG[lvl - 1] || ["You made it.", "Keep shipping."]
          const opts = pickUpgrades(g.upgrades)
          upgradeOptionsRef.current = opts
          setUpgradeOptions(opts)
          // Transition to upgrade happens via sectorClearAt in the game loop (delayed)
        }
      }

      // enemy bullets vs player
      if (!g.invuln) {
        for (let i = g.bullets.length - 1; i >= 0; i--) {
          const b = g.bullets[i]
          if (!b.enemy) continue
          if (Math.abs(b.x - g.px) < (g.shield ? 22 : 14) && Math.abs(b.y - g.py) < (g.shield ? 22 : 14)) {
            g.bullets.splice(i, 1)
            if (g.shield) {
              g.shield = false; sfx.shield()
              g.shake = 5; g.whiteFlash = 4
              // deflect burst — green ring + 8 sparks radiating from player
              g.particles.push({ x: g.px, y: g.py, vx: 0, vy: 0, life: 0.5, initLife: 0.5, glyph: "", col: "#4ade80", ring: true })
              for (let di = 0; di < 8; di++) {
                const da = (di / 8) * Math.PI * 2
                g.particles.push({ x: g.px, y: g.py, vx: Math.cos(da) * 7, vy: Math.sin(da) * 7, life: 0.7, glyph: "◇", col: "#4ade80" })
              }
              g.particles.push({ x: g.px, y: g.py - 22, vx: 0, vy: -1.0, life: 1.2, glyph: "DEFLECTED", col: "#4ade80", sz: 10 })
              showCapyMsg(g, "Shield absorbed.\nSignal integrity: maintained.", now)
            } else loseLife(g, now)
          }
        }
      }

      // score milestones
      const milestones = [500, 1000, 2500, 5000, 10000, 20000]
      for (const m of milestones) {
        if (g.score >= m && g.lastMilestone < m) {
          g.lastMilestone = m
          g.particles.push({ x: canvas.width/2, y: GH/2 + 20, vx: 0, vy: -0.7, life: 1.6, glyph: `${m.toLocaleString()} pts`, col: "#facc15", sz: 14 })
          g.shake = 3
          // Milestone fanfare: ascending tone based on milestone tier
          const tier = milestones.indexOf(m)
          tone(600 + tier * 80, 0.08, 0.28); setTimeout(() => tone(800 + tier * 100, 0.08, 0.32), 100)
          setTimeout(() => tone(1000 + tier * 120, 0.15, 0.35), 200)
        }
      }

      // live personal best tracking
      if (!g.pbShown && g.score > g.pb && g.pb > 0) {
        g.pbShown = true; g.pb = g.score; g.whiteFlash = 14; g.shake = 8
        // star burst ring + float text
        for (let pbi = 0; pbi < 20; pbi++) {
          const pba = (pbi / 20) * Math.PI * 2
          g.particles.push({ x: canvas.width/2, y: GH/2, vx: Math.cos(pba) * 8, vy: Math.sin(pba) * 8, life: 1.1, glyph: pbi % 3 === 0 ? "★" : "◇", col: "#facc15" })
        }
        g.particles.push({ x: canvas.width/2, y: GH/2 - 22, vx: 0, vy: -0.6, life: 2.6, glyph: "NEW PERSONAL BEST ★", col: "#facc15", sz: 13 })
        g.particles.push({ x: canvas.width/2, y: GH/2 - 22, vx: 0, vy: 0, life: 0.7, initLife: 0.7, glyph: "", col: "#facc15", ring: true })
        showCapyMsg(g, "New signal record.\nYou've gone further\nthan ever before.", now)
        setPersonalBest(g.score)
        try { localStorage.setItem("sb_pb", String(g.score)) } catch {}
        sfx.newPB()
      }

      // endless life regen every 5000 pts
      if (g.endless && g.score >= (g.activeAgents.includes("claude_infra") ? 4000 : 5000)) {
        const lifeStep = g.activeAgents.includes("claude_infra") ? 4000 : 5000
        const lifeM = Math.floor(g.score / lifeStep) * lifeStep
        if (lifeM > g.lastLifeRegen && g.lives < MAX_LIVES) {
          g.lastLifeRegen = lifeM
          g.lives = Math.min(g.lives + 1, MAX_LIVES)
          g.particles.push({ x: canvas.width/2, y: GH/2, vx: 0, vy: -0.9, life: 2.0, glyph: "♥ survived", col: "#f87171", sz: 12 })
          showCapyMsg(g, "The Signal endures.", now)
          setLives(g.lives)
        }
      }

      setScore(g.score); setLives(g.lives)
      draw(ctx, g, canvas.width, now, false)
    }

    function fireLaser(g: GState, now: number, power: number, cw: number) {
      if (now < g.laserCooldownEnd) return
      const col = g.px
      const blastW = 20 + power * 10
      const bossDmg = Math.max(4, Math.ceil(power * 14))
      // Kill all words in beam column
      let beamKills = 0
      for (let wi = g.words.length - 1; wi >= 0; wi--) {
        const w = g.words[wi]
        if (Math.abs(w.x - col) < blastW) {
          spawnLetterExplosion(g, w, 0, 1)
          g.score += w.type === "bug" ? 75 : 10
          g.kills++; g.wordsKilled++; beamKills++
          g.words.splice(wi, 1)
        }
      }
      // Boss damage if in column
      if (g.boss && Math.abs(g.boss.x - col) < 54) {
        g.boss.hp -= bossDmg
        spawnParticles(g, g.boss.x, g.boss.y, "#e879f9", "★", 8)
        sfx.bossHit()
        if (!g.boss.halfTriggered && g.boss.hp <= g.boss.maxHp / 2) {
          g.boss.halfTriggered = true; g.boss.raged = true; g.shake = 8
          for (let ri = 0; ri < 18; ri++) {
            const a = (ri / 18) * Math.PI * 2
            g.particles.push({ x: g.boss.x, y: g.boss.y, vx: Math.cos(a)*9, vy: Math.sin(a)*9, life: 0.9, glyph: "✦", col: "#ffffff" })
          }
          showCapyMsg(g, "Pattern is escalating.\nIt knows you're here.", now)
        }
      }
      g.laserFireEnd = now + 320
      g.laserCooldownEnd = now + 3800
      g.laserChargeStart = 0
      g.shake = Math.ceil(power * 8)
      sfx.laser()
      if (beamKills > 1) {
        g.particles.push({ x: col, y: GH / 2, vx: 0, vy: -0.6, life: 1.4, glyph: `BEAM ×${beamKills}`, col: "#e879f9", sz: 12 })
      }
    }

    function loseLife(g: GState, now: number) {
      g.lives--; g.shake = 14; g.redFlash = 16; setLives(g.lives); sfx.hit()
      g.invuln = true; g.invulnEnd = now + 1600
      const hitLines = [
        "Signal integrity\ndegraded.",
        "Hostile pattern\npenetrated containment.",
        "Hold coherence.",
        "Stay focused.\nThe noise is watching.",
        "Corruption event.\nRecover.",
        g.lives === 1 ? "One signal remaining.\nDon't let it die." : "Pattern hit.\nRecover.",
      ]
      showCapyMsg(g, hitLines[Math.floor(Math.random() * hitLines.length)], now)
      // burst ring + radial × scatter
      g.particles.push({ x: g.px, y: g.py, vx: 0, vy: 0, life: 0.7, initLife: 0.7, glyph: "", col: "#f87171", ring: true })
      g.particles.push({ x: g.px, y: g.py, vx: 0, vy: 0, life: 0.45, initLife: 0.45, glyph: "", col: "#fca5a5", ring: true })
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2
        g.particles.push({ x: g.px, y: g.py, vx: Math.cos(a) * (4 + Math.random()*6), vy: Math.sin(a) * (4 + Math.random()*6) - 1, life: 0.8 + Math.random()*0.4, glyph: i % 3 === 0 ? "×" : "·", col: i % 3 === 0 ? "#f87171" : "#fca5a5" })
      }
      if (g.lives <= 0) {
        g.running = false; stopDrone()
        setScore(g.score); setLevel(g.level)
        try {
          const pb = parseInt(localStorage.getItem("sb_pb") || "0")
          if (g.score > pb) { localStorage.setItem("sb_pb", String(g.score)); setPersonalBest(g.score) }
        } catch {}
        // Save depth PB for endless runs
        if (g.endless && g.endlessWave > 0) {
          try {
            const dpb = parseInt(localStorage.getItem("sb_depth_pb") || "0")
            if (g.endlessWave > dpb) {
              localStorage.setItem("sb_depth_pb", String(g.endlessWave))
              setPersonalDepthBest(g.endlessWave)
            }
          } catch {}
        }
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
            <Overlay onClick={startGame} dim={0.9}>
              <div style={{ background:"#111118", border:"1px solid rgba(150,107,236,0.18)", borderRadius:"8px", padding:"1.75rem 2.25rem", maxWidth:"400px", width:"100%" }}>
                {/* Title */}
                <div style={{ marginBottom:"1.25rem" }}>
                  <div style={{ fontSize:"2.25rem", marginBottom:"0.55rem" }}>🦫</div>
                  <p style={{ color:"rgba(255,255,255,0.14)", fontSize:"0.58rem", fontFamily:"monospace", letterSpacing:"0.32em", margin:"0 0 0.3rem" }}>CARRIER SIGNAL · ACTIVE</p>
                  <p style={{ color:"#966bec", fontSize:"1.2rem", fontWeight:700, letterSpacing:"0.14em", margin:"0 0 0.2rem", fontFamily:"monospace" }}>SPEC BLASTER</p>
                  <AttractTagline />
                </div>

                {/* Targets legend */}
                <div style={{ display:"flex", flexDirection:"column", gap:"0.35rem", marginBottom:"1.25rem", textAlign:"left",
                  background:"rgba(255,255,255,0.025)", borderRadius:"5px", padding:"0.75rem 1rem", border:"1px solid rgba(255,255,255,0.05)" }}>
                  {([
                    ["#fdba74","CORRUPTION","corrupted intent · +75pts · primary target"],
                    ["#7dd3fc","NOISE","ghost directives · +10pts · clear them all"],
                    ["#4ade80","ARTIFACTS","CLARITY · ANCHOR · REBASE · DEPLOY · RETROSPECTIVE + more"],
                  ] as const).map(([col,label,desc]) => (
                    <div key={label} style={{ display:"flex", alignItems:"center", gap:"0.6rem", fontSize:"0.72rem" }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", background:col, display:"inline-block", flexShrink:0 }} />
                      <span style={{ color:col, fontFamily:"monospace", fontSize:"0.68rem", letterSpacing:"0.06em", flexShrink:0 }}>{label}</span>
                      <span style={{ color:"rgba(255,255,255,0.28)" }}>{desc}</span>
                    </div>
                  ))}
                </div>

                {/* Controls */}
                <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.68rem", marginBottom:"0.75rem", fontFamily:"monospace", textAlign:"left" }}>
                  WASD / ← → move · SPACE fire · hold SPACE = laser charge · M = mine
                </p>

                {/* Boss sequence marquee */}
                <div style={{ borderTop:"1px solid rgba(255,255,255,0.04)", borderBottom:"1px solid rgba(255,255,255,0.04)", padding:"0.45rem 0", marginBottom:"1rem" }}>
                  <p style={{ color:"rgba(255,255,255,0.09)", fontSize:"0.57rem", fontFamily:"monospace",
                    letterSpacing:"0.1em", textAlign:"center", margin:0 }}>
                    THE RECURSION · THE DRIFT · THE FRAGMENT · THE COLLAPSE · ∞ RECURSION
                  </p>
                </div>

                {/* Crew status row */}
                {unlockedAgents.length > 0 && (() => {
                  const deployed = AGENT_DEFS.filter(a => selectedAgents.includes(a.id) && unlockedAgents.includes(a.id))
                  return (
                    <div style={{ marginBottom:"0.9rem" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"0.4rem", marginBottom:"0.4rem" }}>
                        <span style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.6rem", fontFamily:"monospace", letterSpacing:"0.12em" }}>CREW</span>
                        <div style={{ flex:1, height:"1px", background:"rgba(255,255,255,0.06)" }} />
                        <button onClick={e => { e.stopPropagation(); setShowAgentModule(true) }}
                          style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(150,107,236,0.5)", fontSize:"0.6rem", fontFamily:"monospace", padding:0 }}>
                          manage →
                        </button>
                      </div>
                      {deployed.length > 0 ? (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem" }}>
                          {deployed.map(a => (
                            <span key={a.id} style={{
                              background:"rgba(74,222,128,0.07)", border:"1px solid rgba(74,222,128,0.18)",
                              borderRadius:"3px", padding:"0.15rem 0.5rem",
                              color:"rgba(74,222,128,0.65)", fontSize:"0.6rem", fontFamily:"monospace",
                            }}>{a.name}</span>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color:"rgba(248,113,113,0.5)", fontSize:"0.6rem", fontFamily:"monospace", margin:0 }}>
                          ⚠ all crew benched — no buffs active
                        </p>
                      )}
                    </div>
                  )
                })()}

                {/* CTA */}
                <div style={{ display:"flex", alignItems:"center", gap:"0.75rem", marginBottom:"0.85rem", justifyContent:"center" }}>
                  <div style={{ background:"#966bec", color:"#fff", borderRadius:"4px", padding:"0.55rem 1.5rem",
                    fontSize:"0.88rem", fontWeight:600, letterSpacing:"0.06em" }}>
                    Launch mission
                  </div>
                </div>

                {/* Scores */}
                {(topEntry || personalBest > 0 || personalDepthBest > 0) && (
                  <div style={{ display:"flex", gap:"1rem", justifyContent:"center", flexWrap:"wrap",
                    borderTop:"1px solid rgba(255,255,255,0.05)", paddingTop:"0.75rem" }}>
                    {topEntry && (
                      <p style={{ color:"rgba(253,186,116,0.65)", fontSize:"0.65rem", fontFamily:"monospace", margin:0 }}>
                        🏆 {topEntry.handle} · {topEntry.score.toLocaleString()}
                      </p>
                    )}
                    {personalBest > 0 && (
                      <p style={{ color:"rgba(150,107,236,0.55)", fontSize:"0.65rem", fontFamily:"monospace", margin:0 }}>
                        PB · {personalBest.toLocaleString()}
                      </p>
                    )}
                    {personalDepthBest >= 2 && (
                      <p style={{ color: personalDepthBest >= 5 ? "rgba(168,85,247,0.55)" : "rgba(74,222,128,0.45)", fontSize:"0.65rem", fontFamily:"monospace", margin:0 }}>
                        DEPTH · {personalDepthBest}{personalDepthBest >= 9 ? " ∞" : personalDepthBest >= 5 ? " ∅" : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Overlay>
          )}

          {phase === "capy" && (
            <CapyScreen
              text={capyLines[capyIdx] ?? ""}
              lineNum={capyIdx}
              totalLines={capyLines.length}
              level={level}
              onAdvance={advanceCapy}
            />
          )}

          {phase === "upgrade" && <CLIScreen options={upgradeOptions} onPick={onUpgradePick} score={score} kills={G.current.kills} onReroll={() => pickUpgrades(G.current.upgrades)} />}

          {phase === "over" && <GameOver score={score} level={level} kills={G.current.kills} maxCombo={G.current.maxCombo} upgradeCount={Object.keys(G.current.upgrades).length} shotsFired={G.current.shotsFired} isNewPB={score > 0 && score >= personalBest} onRestart={startGame} unlockedAgents={unlockedAgents} onShowStack={() => setShowAgentModule(true)} endless={G.current.endless} endlessDepth={G.current.endlessWave} prevDepthBest={personalDepthBest} />}

          {showAgentModule && (
            <AgentModule unlocked={unlockedAgents} selected={selectedAgents}
              onToggle={(id) => {
                setSelectedAgents(prev => {
                  const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                  try { localStorage.setItem("sb_selected_agents", next.join(",")) } catch {}
                  return next
                })
              }}
              onClose={() => setShowAgentModule(false)} />
          )}

          <canvas ref={canvasRef} height={GH} style={{ display:"block", width:"100%", height:GH, cursor:"crosshair" }} />
        </div>
        {isTouchDevice && phase === "playing" && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0.4rem 0.2rem", marginTop:"0.3rem", gap:"0.4rem" }}>
            <div style={{ display:"flex", gap:"0.4rem" }}>
              <VirtualBtn onPress={() => G.current.keys.add("ArrowLeft")} onRelease={() => G.current.keys.delete("ArrowLeft")}>←</VirtualBtn>
              <VirtualBtn onPress={() => G.current.keys.add("ArrowRight")} onRelease={() => G.current.keys.delete("ArrowRight")}>→</VirtualBtn>
            </div>
            <div style={{ display:"flex", gap:"0.4rem" }}>
              <VirtualBtn onPress={() => G.current.keys.add("ArrowUp")} onRelease={() => G.current.keys.delete("ArrowUp")} small>↑</VirtualBtn>
              <VirtualBtn onPress={() => G.current.keys.add("ArrowDown")} onRelease={() => G.current.keys.delete("ArrowDown")} small>↓</VirtualBtn>
            </div>
            <VirtualBtn onPress={() => G.current.keys.add(" ")} onRelease={() => G.current.keys.delete(" ")} fire>FIRE</VirtualBtn>
          </div>
        )}
        <div style={{ marginTop:"0.4rem", display:"flex", justifyContent:"space-between", fontSize:"0.65rem", padding:"0 2px" }}>
          <span style={{ color:"rgba(255,255,255,0.2)", fontFamily:"monospace" }}>WASD / arrows move · SPACE or click shoot · mouse aim</span>
          <a href="/leaderboard" style={{ color:"#966bec", textDecoration:"none", opacity:0.6, fontSize:"0.65rem" }}>leaderboard →</a>
        </div>
      </div>
    </main>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function showCapyMsg(g: GState, msg: string, now: number) {
  g.capyMsg = msg
  g.capyMsgStart = now
  // Scale display time by message length: longer messages linger more
  const lineCount = msg.split("\n").length
  const charCount = msg.replace(/\n/g, "").length
  const displayMs = Math.max(3200, Math.min(6500, 2600 + lineCount * 520 + charCount * 18))
  g.capyMsgEnd = now + displayMs
  g.nextCapyMsg = now + 28000
}

function applyPowerup(g: GState, word: Word, now: number) {
  sfx.powerup()
  const text = word.text
  if (text === "CLARITY") {
    g.words.forEach(w => spawnLetterExplosion(g, w, 0, 1))
    g.score += g.words.length * 8
    g.shake = 10; g.whiteFlash = 9
    g.words = []
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2
      g.particles.push({ x: g.W/2, y: GH/2, vx: Math.cos(a)*12, vy: Math.sin(a)*12, life: 0.8, glyph: "◇", col: "#4ade80" })
    }
    showCapyMsg(g, "Clarity burst.\nNoise eliminated.", now)
  } else if (text === "ANCHOR")  { g.shield = true; g.shieldEnd = now + 6000; showCapyMsg(g, "Signal anchored.", now) }
  else if (text === "AMPLIFY")   { g.triple = true; g.tripleEnd = now + 8000; showCapyMsg(g, "Signal amplified.", now) }
  else if (text === "TIMEBOX")   { g.fast   = true; g.fastEnd   = now + 5000; showCapyMsg(g, "Temporal isolation\nactive.", now) }
  else if (text === "REBASE") {
    const removed = g.bullets.filter(b => b.enemy).length
    g.bullets = g.bullets.filter(b => !b.enemy)
    g.shake = 7; g.whiteFlash = 6
    for (let ri = 0; ri < 18; ri++) {
      const a = (ri / 18) * Math.PI * 2
      g.particles.push({ x: g.W/2, y: GH/2, vx: Math.cos(a)*9, vy: Math.sin(a)*9, life: 0.7, glyph: "✕", col: "#f87171" })
    }
    showCapyMsg(g, removed > 0 ? `Rebased.\n${removed} hostile${removed !== 1 ? "s" : ""} purged.` : "Rebased.\nClean carrier state.", now)
  }
  else if (text === "HOTFIX") {
    if (g.lives < MAX_LIVES) {
      g.lives++; g.whiteFlash = 7
      g.particles.push({ x: g.px, y: g.py - 26, vx: 0, vy: -1.2, life: 1.5, glyph: "♥ +1", col: "#f87171", sz: 13 })
      showCapyMsg(g, "Signal patched.\nIntegrity restored.", now)
    } else {
      g.score += 200
      g.particles.push({ x: g.px, y: g.py - 26, vx: 0, vy: -1.2, life: 1.5, glyph: "+200 pts", col: "#facc15", sz: 12 })
      showCapyMsg(g, "Integrity maxed.\n+200 pts.", now)
    }
  }
  else if (text === "REFACTOR") {
    // Convert all zigzag/charge words to simple fall — tame the chaos
    const tamed = g.words.filter(w => w.beh === "zigzag" || w.beh === "charge" || w.beh === "sine").length
    g.words.forEach(w => { if (w.beh !== "fall") { w.beh = "fall"; w.spd *= 0.7 } })
    g.shake = 5; g.whiteFlash = 4
    if (tamed > 0) {
      g.score += tamed * 15
      g.particles.push({ x: g.W/2, y: GH/2, vx: 0, vy: -0.8, life: 1.5, glyph: `REFACTOR +${tamed * 15}`, col: "#a5f3fc", sz: 11 })
    }
    showCapyMsg(g, "Complexity reduced.\nClean signal path.", now)
  }
  else if (text === "KNOWLEDGE") {
    // +250 score + 5s triple fire
    g.score += 250; g.whiteFlash = 6
    g.triple = true; g.tripleEnd = now + 5000
    g.particles.push({ x: g.px, y: g.py - 26, vx: 0, vy: -1.1, life: 1.6, glyph: "KNOWLEDGE +250", col: "#4ade80", sz: 11 })
    showCapyMsg(g, "Context absorbed.\nSignal amplified.", now)
    for (let ki = 0; ki < 14; ki++) {
      const a = (ki / 14) * Math.PI * 2
      g.particles.push({ x: g.W/2, y: GH/2, vx: Math.cos(a)*10, vy: Math.sin(a)*10, life: 0.8, glyph: "◇", col: "#4ade80" })
    }
  }
  else if (text === "DEPLOY") {
    // Purge all enemy bullets on screen + score per bullet destroyed
    const purged = g.bullets.filter(b => b.enemy).length
    g.bullets = g.bullets.filter(b => !b.enemy)
    g.shake = 8; g.whiteFlash = 8
    const pts = purged * 15
    if (pts > 0) g.score += pts
    for (let di = 0; di < Math.min(purged, 20); di++) {
      g.particles.push({
        x: 30 + Math.random() * (g.W - 60), y: 50 + Math.random() * (GH - 100),
        vx: (Math.random()-0.5)*8, vy: (Math.random()-0.5)*8 - 2,
        life: 0.9, glyph: "★", col: "#22d3ee",
      })
    }
    g.particles.push({ x: g.W/2, y: GH/2, vx: 0, vy: -0.9, life: 1.8,
      glyph: purged > 0 ? `DEPLOYED · +${pts}` : "DEPLOYED", col: "#22d3ee", sz: 13 })
    sfx.deploy()
    showCapyMsg(g, purged > 0
      ? `DEPLOY.\n${purged} hostile${purged !== 1 ? "s" : ""} purged.\nCarrier space: clear.`
      : "DEPLOY.\nCarrier already clean.", now)
  }
  else if (text === "RETROSPECTIVE") {
    // Slow all word movement to 28% for 8 seconds
    g.retroEnd = now + 8000; g.whiteFlash = 5
    // Brief ripple effect
    for (let ri = 0; ri < 16; ri++) {
      const a = (ri / 16) * Math.PI * 2
      g.particles.push({ x: g.W/2, y: GH/2, vx: Math.cos(a)*7, vy: Math.sin(a)*7,
        life: 1.0, glyph: ri % 2 === 0 ? "◇" : "·", col: "#7dd3fc" })
    }
    g.particles.push({ x: g.W/2, y: GH/2 - 16, vx: 0, vy: -0.7, life: 1.9,
      glyph: "RETROSPECTIVE", col: "#7dd3fc", sz: 12 })
    sfx.retro()
    showCapyMsg(g, "Retrospective.\nAll patterns slowed.\nUse the time well.", now)
  }
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

function draw(ctx: CanvasRenderingContext2D, g: GState, cw: number, now: number, attractMode: boolean) {
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

  // level tint overlay — shifts with recursion depth in endless mode
  if (!attractMode) {
    let tintCol: string
    let tintStr: number
    if (g.endless) {
      const d = g.endlessWave
      if (d >= 5) { tintCol = "#6d28d9"; tintStr = 0.06 + Math.min(d - 5, 4) * 0.008 }
      else if (d >= 3) { tintCol = "#7c3aed"; tintStr = 0.05 }
      else { tintCol = "#4ade80"; tintStr = 0.04 }
    } else {
      tintCol = BOSSES[Math.min(g.level - 1, 3)].color
      tintStr = 0.04
    }
    ctx.globalAlpha = tintStr; ctx.fillStyle = tintCol
    ctx.fillRect(0, 0, cw, GH); ctx.globalAlpha = 1
  }

  // screen flash overlays (hit = red, clutch/powerup = white)
  if (g.redFlash > 0) {
    ctx.globalAlpha = g.redFlash * 0.022; ctx.fillStyle = "#f87171"
    ctx.fillRect(0, 0, cw, GH); ctx.globalAlpha = 1; g.redFlash--
  }
  if (g.whiteFlash > 0) {
    ctx.globalAlpha = g.whiteFlash * 0.035; ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, cw, GH); ctx.globalAlpha = 1; g.whiteFlash--
  }
  // RETROSPECTIVE: subtle time-freeze blue wash
  if (!attractMode && g.retroEnd > 0 && now < g.retroEnd) {
    const retroFade = Math.min(1, (g.retroEnd - now) / 1200)
    ctx.globalAlpha = 0.06 * retroFade
    ctx.fillStyle = "#7dd3fc"; ctx.fillRect(0, 0, cw, GH)
    ctx.globalAlpha = 1
  }

  // Near-boss edge pulse — screen edges glow boss color in the final 2 kills before boss
  if (!attractMode && !g.boss && !g.bossWarn && !g.endless) {
    const remaining = WORDS_TO_BOSS - g.wordsKilled
    if (remaining <= 2 && remaining > 0) {
      const bossHex = BOSSES[Math.min(g.level - 1, 3)].color
      const br = parseInt(bossHex.slice(1, 3), 16)
      const bg2 = parseInt(bossHex.slice(3, 5), 16)
      const bb = parseInt(bossHex.slice(5, 7), 16)
      const edgeA = (0.25 + 0.2 * Math.abs(Math.sin(now / 180))) * (remaining === 1 ? 1 : 0.55)
      try {
        const eg = ctx.createLinearGradient(0, 0, 32, 0)
        eg.addColorStop(0, `rgba(${br},${bg2},${bb},${edgeA})`)
        eg.addColorStop(1, `rgba(${br},${bg2},${bb},0)`)
        ctx.fillStyle = eg; ctx.fillRect(0, 0, 32, GH)
        const eg2 = ctx.createLinearGradient(cw, 0, cw - 32, 0)
        eg2.addColorStop(0, `rgba(${br},${bg2},${bb},${edgeA})`)
        eg2.addColorStop(1, `rgba(${br},${bg2},${bb},0)`)
        ctx.fillStyle = eg2; ctx.fillRect(cw - 32, 0, 32, GH)
      } catch {}
    }
  }

  // vignette — intensifies with boss presence, turns deep purple-black for THE VOID
  const isVoidPresent = g.boss?.name === "THE VOID"
  const vignetteStr = isVoidPresent
    ? 0.75 + 0.1 * Math.sin(now / 400)
    : g.boss
      ? 0.62 + 0.06 * Math.sin(now / 300)
      : 0.5
  const vignetteCol = isVoidPresent
    ? `rgba(6,0,18,${vignetteStr})`
    : `rgba(0,0,0,${vignetteStr})`
  const vgr = ctx.createRadialGradient(cw/2, GH*0.55, GH*0.15, cw/2, GH*0.55, Math.max(cw, GH)*0.78)
  vgr.addColorStop(0, "rgba(0,0,0,0)"); vgr.addColorStop(1, vignetteCol)
  ctx.fillStyle = vgr; ctx.fillRect(0, 0, cw, GH)

  // ambient background glyphs
  const glyphCol = g.endless
    ? (g.endlessWave >= 7 ? "#a855f7" : g.endlessWave >= 5 ? "#c084fc" : "#4ade80")
    : BOSSES[Math.min(Math.max(g.level - 1, 0), 3)].color
  ctx.font = "10px monospace"; ctx.textAlign = "center"
  g.bg.forEach(b => {
    ctx.globalAlpha = b.a
    ctx.fillStyle = attractMode ? "#966bec" : glyphCol
    ctx.fillText(b.ch, b.x, b.y)
  }); ctx.globalAlpha = 1

  if (!attractMode) {
    // journey bar
    const jy = GH - 20, jx = 16, jw = cw - 32
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(jx, jy, jw, 8)
    const prog = g.endless ? 1 : Math.min(1, ((g.level - 1) + (g.boss ? (1 - g.boss.hp/g.boss.maxHp)*0.85 : 0)) / 4)
    ctx.fillStyle = "#966bec"; ctx.fillRect(jx, jy, jw * prog, 8)
    ctx.font = "8px monospace"; ctx.textAlign = "center"
    SDLC_PHASES.forEach((ph, i) => {
      const lx = jx + jw*(i/4) + jw/8
      const isActive = !g.endless && i === g.level - 1
      const isDone   = i < g.level - 1 || g.endless
      if (isActive) {
        const activePulse = 0.7 + 0.3 * Math.sin(now / 350)
        ctx.fillStyle = `rgba(150,107,236,${activePulse})`
        ctx.font = "bold 8px monospace"
      } else {
        ctx.fillStyle = isDone ? "rgba(150,107,236,0.5)" : "rgba(255,255,255,0.18)"
        ctx.font = "8px monospace"
      }
      ctx.fillText(ph, lx, jy - 3)
    })
  }

  // words
  const retroActive = !attractMode && g.retroEnd > 0 && now < g.retroEnd
  g.words.forEach(w => {
    // RETRO tint: bug→pale blue, story→deeper blue (signals temporal freeze)
    const col = w.regenBoss ? "#34d399"
      : w.type === "bug" ? (retroActive ? "#93c5fd" : "#fdba74")
      : w.type === "powerup" ? "#4ade80"
      : (retroActive ? "#a5f3fc" : "#7dd3fc")
    const flashRed = w.hitFlash > 0

    const spawnAlpha = Math.min(1, w.age / 7)
    // Brief spawn flash: extra glow for age 0-12
    const spawnFlash = w.age < 12 ? Math.max(0, 1 - w.age / 12) : 0
    ctx.globalAlpha = spawnAlpha

    if (spawnFlash > 0 && w.type !== "powerup") {
      ctx.save()
      const flashCol = w.type === "bug" ? "#fdba74" : "#7dd3fc"
      ctx.shadowColor = flashCol; ctx.shadowBlur = 20 * spawnFlash
      ctx.globalAlpha = spawnFlash * 0.7
      ctx.fillStyle = flashCol; ctx.font = "11px monospace"; ctx.textAlign = "center"
      ctx.fillText(w.text, w.x, w.y)
      ctx.restore()
      ctx.globalAlpha = spawnAlpha
    }

    if (w.type === "powerup") {
      const pulse = 0.5 + 0.5 * Math.sin(now / 280)
      ctx.save(); ctx.shadowColor = "#4ade80"; ctx.shadowBlur = 10 * pulse
      // spawn beam: thin vertical line descending from top to word (fades with age)
      if (w.age < 55) {
        const beamAlpha = Math.max(0, (1 - w.age / 55)) * (0.18 + 0.12 * pulse)
        ctx.globalAlpha = beamAlpha * spawnAlpha
        ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(w.x, 0); ctx.lineTo(w.x, w.y - 8); ctx.stroke()
        ctx.globalAlpha = spawnAlpha
      }
    }
    if (w.regenBoss) {
      const pulse = 0.3 + 0.7 * Math.abs(Math.sin(now / 300))
      ctx.save(); ctx.shadowColor = "#34d399"; ctx.shadowBlur = 7 * pulse
    }
    if (retroActive && w.type !== "powerup" && !w.regenBoss && !w.elite) {
      ctx.save(); ctx.shadowColor = "#7dd3fc"; ctx.shadowBlur = 5 + 2 * Math.sin(now / 600)
    }
    if (w.elite) {
      ctx.save(); ctx.shadowColor = "#f87171"; ctx.shadowBlur = 8 + 4 * Math.sin(now / 200)
    }

    const wordCol = flashRed ? "#ffffff" : (w.beh === "charge" && w.type !== "powerup" && !w.regenBoss ? "#fca5a5" : col)
    ctx.fillStyle = wordCol
    ctx.font = (w.elite ? "bold " : "") + "11px monospace"
    ctx.textAlign = "center"

    let prefix = ""
    if (w.regenBoss) prefix = "◆ "
    else if (w.beh === "zigzag") prefix = "≈"
    else if (w.beh === "sine") prefix = "~"
    ctx.fillText(prefix + w.text, w.x, w.y)

    if (w.type === "powerup") ctx.restore()
    if (w.regenBoss) ctx.restore()
    if (retroActive && w.type !== "powerup" && !w.regenBoss && !w.elite) ctx.restore()
    if (w.elite) {
      ctx.restore()
      // HP pips
      for (let i = 0; i < w.hp; i++) {
        ctx.fillStyle = "#f87171"
        ctx.fillRect(w.x - 8 + i * 8, w.y + 4, 5, 3)
      }
    }

    // near-bottom danger flash
    if (w.y > GH - 80 && w.type !== "powerup") {
      const wAlpha = Math.min(0.7, (w.y - (GH - 80)) / 40) * (0.5 + 0.5 * Math.sin(now / 120))
      ctx.globalAlpha = wAlpha
      ctx.font = "7px monospace"
      if (w.regenBoss) {
        ctx.fillStyle = "#34d399"
        ctx.fillText("↑HEAL", w.x + w.text.length * 5.8 + 16, w.y)
      } else {
        ctx.fillStyle = "#f87171"
        ctx.fillText("!", w.x + w.text.length * 5.8 + 10, w.y)
      }
      ctx.globalAlpha = 1; ctx.font = "11px monospace"
    }

    if (w.beh === "charge" && w.type !== "powerup" && !w.regenBoss) {
      ctx.fillStyle = "#f87171"; ctx.font = "7px monospace"
      ctx.fillText("▼", w.x, w.y + 10)
    }
    ctx.globalAlpha = 1
  })

  // boss
  if (g.boss) {
    const b = g.boss
    const hpPct = b.hp / b.maxHp
    const distress = hpPct < 0.25
    const isVoid = b.name === "THE VOID"

    if (isVoid) {
      // ── THE VOID: pulsing dark orb ──────────────────────────────────────
      const vPulse = 0.5 + 0.5 * Math.abs(Math.sin(now / 90))
      const vRadius = 38 + vPulse * 5

      // ambient darkness halo — a radial darkening around the orb
      ctx.save()
      const halo = ctx.createRadialGradient(b.x, b.y, vRadius * 0.4, b.x, b.y, vRadius * 3.2)
      halo.addColorStop(0, `rgba(12,3,28,${0.55 + vPulse * 0.2})`)
      halo.addColorStop(1, "rgba(14,14,26,0)")
      ctx.fillStyle = halo
      ctx.beginPath(); ctx.arc(b.x, b.y, vRadius * 3.2, 0, Math.PI * 2); ctx.fill()
      ctx.restore()

      // dark orb with radial gradient
      ctx.save()
      ctx.shadowColor = b.raged ? "#dc2626" : "#6d28d9"
      ctx.shadowBlur = (distress || b.raged ? 44 : 30) * vPulse
      const orb = ctx.createRadialGradient(b.x - vRadius * 0.32, b.y - vRadius * 0.32, 2, b.x, b.y, vRadius)
      orb.addColorStop(0, b.raged ? "#4c0519" : "#3b0764")
      orb.addColorStop(0.65, b.raged ? "#1c0209" : "#1a0535")
      orb.addColorStop(1, "#080414")
      ctx.fillStyle = orb
      ctx.beginPath(); ctx.arc(b.x, b.y, vRadius, 0, Math.PI * 2); ctx.fill()
      ctx.restore()

      // orbiting void glyphs
      const VOID_GLYPHS = ["∅", "⊗", "//", "??", "◈", "∞"]
      const orbitT = now / (b.raged ? 270 : 660)
      VOID_GLYPHS.forEach((ch, i) => {
        const ang = orbitT + (i / VOID_GLYPHS.length) * Math.PI * 2
        const r = 54 + Math.sin(now / 360 + i) * 6
        ctx.save()
        ctx.globalAlpha = 0.3 + 0.38 * Math.sin(now / 210 + i * 1.3)
        ctx.fillStyle = i % 2 === 0 ? "#6d28d9" : "#a855f7"
        ctx.font = `${8 + Math.sin(now / 290 + i) * 1.5}px monospace`; ctx.textAlign = "center"
        ctx.shadowColor = "#6d28d9"; ctx.shadowBlur = 6
        ctx.fillText(ch, b.x + Math.cos(ang) * r, b.y + Math.sin(ang) * r + 3)
        ctx.restore()
      })

      // HP ring
      const ringR = vRadius + 10
      ctx.save()
      ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,0.65)"
      ctx.beginPath(); ctx.arc(b.x, b.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2); ctx.stroke()
      const hpRingCol = hpPct > 0.5 ? "#a855f7" : hpPct > 0.25 ? "#facc15" : "#f87171"
      ctx.lineWidth = 4; ctx.strokeStyle = hpRingCol
      ctx.shadowColor = hpRingCol; ctx.shadowBlur = 12
      ctx.beginPath(); ctx.arc(b.x, b.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpPct); ctx.stroke()
      ctx.restore()

      // name label
      ctx.fillStyle = distress ? "#f87171" : "#c4b5fd"
      ctx.font = "bold 9px monospace"; ctx.textAlign = "center"
      ctx.fillText(b.name, b.x, b.y - vRadius - 13)

      // enraged: rage "!" orbiting faster
      if (b.raged) {
        const rt = now / 140
        for (let ri = 0; ri < 5; ri++) {
          const a = rt + (ri / 5) * Math.PI * 2
          ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 65 + ri)
          ctx.fillStyle = "#f87171"; ctx.font = "bold 10px monospace"; ctx.textAlign = "center"
          ctx.fillText("!", b.x + Math.cos(a) * 64, b.y + Math.sin(a) * 50)
        }
        ctx.globalAlpha = 1
      }
    } else {
      // ── standard boss: rounded rect ─────────────────────────────────────
      const pulse = (distress || b.raged)
        ? 0.4 + 0.6 * Math.abs(Math.sin(now / 80))
        : 0.55 + 0.45 * Math.sin(now / 180)
      const glowColor = b.raged ? `rgba(255,180,180,${0.6 + 0.4 * Math.sin(now / 60)})` : b.color
      ctx.save()
      ctx.shadowColor = glowColor; ctx.shadowBlur = (distress || b.raged ? 35 : 20) * pulse
      ctx.fillStyle = b.color
      roundRect(ctx, b.x - 50, b.y - 28, 100, 56, 8); ctx.fill()
      ctx.restore()
      ctx.fillStyle = "#0d0d14"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center"
      ctx.fillText(b.name, b.x, b.y - 11)
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(b.x - 42, b.y + 4, 84, 7)
      const hpBarCol = hpPct > 0.5 ? "#4ade80" : hpPct > 0.25 ? "#facc15" : "#f87171"
      if (hpPct <= 0.2 && hpPct > 0) {
        // Critical flash: pulsing red glow on HP bar
        ctx.save()
        ctx.shadowColor = "#f87171"; ctx.shadowBlur = 14 + 8 * Math.abs(Math.sin(now / 80))
        ctx.fillStyle = hpBarCol; ctx.fillRect(b.x - 42, b.y + 4, 84 * hpPct, 7)
        ctx.restore()
      } else {
        ctx.fillStyle = hpBarCol
        ctx.fillRect(b.x - 42, b.y + 4, 84 * hpPct, 7)
      }
      // segment markers at 25%, 50%, 75%
      ctx.fillStyle = "rgba(0,0,0,0.5)"
      for (const pct of [0.25, 0.5, 0.75]) ctx.fillRect(b.x - 42 + 84 * pct - 0.5, b.y + 4, 1, 7)
      // enraged: orbiting "!" symbols
      if (b.raged) {
        const t = now / 500
        for (let ri = 0; ri < 4; ri++) {
          const a = t + (ri / 4) * Math.PI * 2
          ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 90 + ri)
          ctx.fillStyle = "#f87171"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center"
          ctx.fillText("!", b.x + Math.cos(a) * 60, b.y + Math.sin(a) * 34)
        }
        ctx.globalAlpha = 1
      }
    }
  }

  // boss warning animation
  if (g.bossWarn) {
    const bw = g.bossWarn
    const fadeIn  = Math.min(1, bw.t / 18)
    const fadeOut = bw.t > 65 ? Math.max(0, 1 - (bw.t - 65) / 20) : 1
    const alpha = fadeIn * fadeOut
    ctx.globalAlpha = alpha * 0.18; ctx.fillStyle = bw.color
    ctx.fillRect(0, 0, cw, GH); ctx.globalAlpha = 1
    ctx.globalAlpha = alpha * 0.6; ctx.strokeStyle = bw.color; ctx.lineWidth = 2
    ctx.strokeRect(1, 1, cw - 2, GH - 2); ctx.lineWidth = 1; ctx.globalAlpha = 1
    ctx.font = "bold 26px monospace"; ctx.textAlign = "center"
    bw.letters.forEach((l, i) => {
      ctx.save(); ctx.globalAlpha = alpha * Math.min(1, (bw.t - i * 2) / 20)
      ctx.shadowColor = bw.color; ctx.shadowBlur = 18
      ctx.fillStyle = bw.color; ctx.fillText(l.ch, l.x, l.y); ctx.restore()
    })
    if (bw.t < 70) {
      ctx.globalAlpha = alpha * 0.65; ctx.fillStyle = "#f5f5f5"; ctx.font = "8px monospace"
      ctx.fillText("⚠  BOSS INCOMING  ⚠", cw/2, GH/2 + 38); ctx.globalAlpha = 1
    }
  }

  // bullets with gradient trail
  g.bullets.forEach(b => {
    if (!b.enemy) {
      if (b.cluster) {
        // cluster shrapnel: small bright orange sparks
        ctx.save()
        ctx.shadowColor = "#f59e0b"; ctx.shadowBlur = 6
        ctx.fillStyle = "#fb923c"
        ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI*2); ctx.fill()
        ctx.restore()
      } else {
        const bulletCol = g.upgrades.spray ? "#22d3ee" : (g.triple || g.upgrades.triple) ? "#4ade80" : "#966bec"
        ctx.save()
        ctx.shadowColor = bulletCol; ctx.shadowBlur = 8
        try {
          const grad = ctx.createLinearGradient(b.x, b.y, b.x, b.y + 22)
          grad.addColorStop(0, bulletCol)
          grad.addColorStop(1, "rgba(0,0,0,0)")
          ctx.fillStyle = grad
        } catch { ctx.fillStyle = bulletCol }
        ctx.fillRect(b.x - 2, b.y - 11, 4, 22)
        ctx.restore()
      }
    } else {
      // enemy bullet with fade trail — colored by boss that spawned it
      const eCol = b.col ?? "#f87171"
      ctx.save()
      ctx.shadowColor = eCol; ctx.shadowBlur = 5
      ctx.globalAlpha = 0.2; ctx.fillStyle = eCol
      ctx.beginPath(); ctx.arc(b.x, b.y - 8, 3, 0, Math.PI*2); ctx.fill()
      ctx.globalAlpha = 0.08
      ctx.beginPath(); ctx.arc(b.x, b.y - 16, 2, 0, Math.PI*2); ctx.fill()
      ctx.globalAlpha = 1; ctx.fillStyle = eCol
      // bounce bullet: diamond shape instead of circle
      if (b.bounce) {
        ctx.beginPath(); ctx.moveTo(b.x, b.y - 5); ctx.lineTo(b.x + 4, b.y); ctx.lineTo(b.x, b.y + 5); ctx.lineTo(b.x - 4, b.y); ctx.closePath(); ctx.fill()
        ctx.globalAlpha = 0.45; ctx.strokeStyle = eCol; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI * 2); ctx.stroke()
      } else if (b.splitAt) {
        // split bullet: wider, with a tiny "fork" glyph below
        ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI*2); ctx.fill()
        ctx.globalAlpha = 0.5; ctx.font = "7px monospace"; ctx.textAlign = "center"
        ctx.fillText("⋎", b.x, b.y + 14)
      } else {
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill()
      }
      ctx.restore()
    }
  })

  // player motion trail
  if (!attractMode && g.trail.length > 1) {
    const trailCol = g.shield ? "74,222,128" : "150,107,236"
    g.trail.forEach((pt, i) => {
      const age = g.trail.length - 1 - i
      const alpha = (1 - age / g.trail.length) * 0.22
      const r = 4 * (1 - age / g.trail.length)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = `rgb(${trailCol})`
      ctx.beginPath(); ctx.arc(pt.x, pt.y - 5, r, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    })
  }

  // player ship
  if (!attractMode) {
    const flash = g.invuln && Math.floor(now/90) % 2 === 0
    if (!flash) {
      // Combo halo — rings expand around player when combo >= 5
      if (g.combo >= 5) {
        const haloCombo = Math.min(g.combo, 30)
        const haloCol = g.combo >= 20 ? "#facc15" : g.combo >= 10 ? "#fb923c" : "#7dd3fc"
        const haloA = Math.min(0.38, haloCombo * 0.012) * (0.55 + 0.45 * Math.sin(now / 160))
        ctx.save()
        ctx.globalAlpha = haloA
        ctx.strokeStyle = haloCol; ctx.lineWidth = 1.2
        ctx.shadowColor = haloCol; ctx.shadowBlur = 10
        const r1 = 28 + 6 * Math.sin(now / 220)
        ctx.beginPath(); ctx.arc(g.px, g.py - 5, r1, 0, Math.PI * 2); ctx.stroke()
        if (g.combo >= 10) {
          ctx.globalAlpha = haloA * 0.55
          const r2 = r1 + 10 + 4 * Math.sin(now / 180 + 1)
          ctx.beginPath(); ctx.arc(g.px, g.py - 5, r2, 0, Math.PI * 2); ctx.stroke()
        }
        ctx.restore()
      }
      const glowCol = g.shield ? "#4ade80" : "#966bec"
      ctx.save()
      ctx.shadowColor = glowCol
      ctx.shadowBlur = 10 + 4 * Math.sin(now / 400)
      ctx.fillStyle = g.shield ? "#4ade80" : "#e2e8f0"
      ctx.beginPath()
      ctx.moveTo(g.px, g.py - 18)
      ctx.lineTo(g.px - 13, g.py + 7)
      ctx.lineTo(g.px + 13, g.py + 7)
      ctx.closePath(); ctx.fill()
      ctx.restore()
      // thruster flame
      const tf = 0.45 + 0.55 * Math.abs(Math.sin(now / 55))
      ctx.save(); ctx.globalAlpha = 0.78 * tf
      ctx.fillStyle = "#fb923c"
      ctx.beginPath(); ctx.moveTo(g.px - 5, g.py + 7); ctx.lineTo(g.px + 5, g.py + 7); ctx.lineTo(g.px, g.py + 13 + tf * 10); ctx.closePath(); ctx.fill()
      ctx.globalAlpha = 0.5 * tf; ctx.fillStyle = "#fde68a"
      ctx.beginPath(); ctx.moveTo(g.px - 2, g.py + 7); ctx.lineTo(g.px + 2, g.py + 7); ctx.lineTo(g.px, g.py + 10 + tf * 6); ctx.closePath(); ctx.fill()
      ctx.restore()
      if (g.shield) {
        ctx.strokeStyle = "rgba(74,222,128,0.55)"; ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(g.px, g.py - 5, 24, 0, Math.PI*2); ctx.stroke()
        ctx.lineWidth = 1
      }
      // Laser charge arc (arc fills clockwise as charge builds)
      if (g.upgrades.laser && g.laserChargeStart > 0 && g.laserFireEnd < now) {
        const power = Math.min(1, (now - g.laserChargeStart) / 1200)
        const arcR = 22 + power * 10
        ctx.save()
        ctx.strokeStyle = `rgba(232,121,249,${0.35 + power * 0.65})`
        ctx.lineWidth = 2.5
        ctx.shadowColor = "#e879f9"; ctx.shadowBlur = 8 + power * 14
        ctx.beginPath()
        ctx.arc(g.px, g.py - 5, arcR, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * power)
        ctx.stroke()
        ctx.restore()
        // charge glow pulse on ship
        ctx.save()
        ctx.globalAlpha = power * (0.3 + 0.2 * Math.sin(now / 80))
        ctx.fillStyle = "#e879f9"
        ctx.beginPath(); ctx.moveTo(g.px, g.py - 18); ctx.lineTo(g.px - 13, g.py + 7); ctx.lineTo(g.px + 13, g.py + 7); ctx.closePath(); ctx.fill()
        ctx.restore()
      }
      // Laser cooldown: small indicator dot under ship
      if (g.upgrades.laser && g.laserCooldownEnd > now && g.laserChargeStart === 0) {
        const cd = 1 - (g.laserCooldownEnd - now) / 3800
        ctx.save()
        ctx.fillStyle = `rgba(232,121,249,${cd * 0.6})`
        ctx.fillRect(g.px - 16, g.py + 11, 32 * cd, 2)
        ctx.restore()
      }
      // Mine HUD indicator
      if (g.upgrades.mine) {
        ctx.save()
        ctx.font = "7px monospace"; ctx.textAlign = "right"
        ctx.fillStyle = g.mines.length < 3 ? "rgba(245,158,11,0.55)" : "rgba(245,158,11,0.25)"
        ctx.fillText(`M: ${3 - g.mines.length}`, cw - 10, g.py + 8)
        ctx.restore()
      }
    }
  } else {
    // Demo ship: ghostly
    ctx.globalAlpha = 0.18; ctx.fillStyle = "#966bec"
    ctx.beginPath(); ctx.moveTo(g.px, g.py - 18); ctx.lineTo(g.px - 13, g.py + 7); ctx.lineTo(g.px + 13, g.py + 7); ctx.closePath(); ctx.fill()
    // Demo thruster
    const atf = 0.4 + 0.6 * Math.abs(Math.sin(now / 55))
    ctx.globalAlpha = 0.13 * atf; ctx.fillStyle = "#fb923c"
    ctx.beginPath(); ctx.moveTo(g.px - 4, g.py + 7); ctx.lineTo(g.px + 4, g.py + 7); ctx.lineTo(g.px, g.py + 12 + atf * 8); ctx.closePath(); ctx.fill()
    ctx.globalAlpha = 1
  }

  // Laser beam (renders over everything except particles and HUD)
  if (!attractMode && g.laserFireEnd > now) {
    const t = (g.laserFireEnd - now) / 320  // 1→0 as beam fades
    const beamAlpha = Math.min(1, t * 1.8)
    ctx.save()
    // Wide glow column
    ctx.globalAlpha = beamAlpha * 0.12
    try {
      const beamGlow = ctx.createLinearGradient(g.px - 30, 0, g.px + 30, 0)
      beamGlow.addColorStop(0, "rgba(232,121,249,0)")
      beamGlow.addColorStop(0.5, "rgba(232,121,249,1)")
      beamGlow.addColorStop(1, "rgba(232,121,249,0)")
      ctx.fillStyle = beamGlow
    } catch { ctx.fillStyle = "rgba(232,121,249,0.12)" }
    ctx.fillRect(g.px - 30, 0, 60, g.py)
    // Core beam
    ctx.globalAlpha = beamAlpha * 0.7
    try {
      const beamGrad = ctx.createLinearGradient(g.px, g.py, g.px, 0)
      beamGrad.addColorStop(0, "#e879f9")
      beamGrad.addColorStop(0.6, "#c084fc")
      beamGrad.addColorStop(1, "rgba(192,132,252,0.15)")
      ctx.fillStyle = beamGrad
    } catch { ctx.fillStyle = "#e879f9" }
    ctx.fillRect(g.px - 5, 0, 10, g.py)
    // Bright white core
    ctx.globalAlpha = beamAlpha * 0.9
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(g.px - 2, 0, 4, g.py)
    ctx.restore()
  }

  // Mines
  if (!attractMode) {
    g.mines.forEach(mine => {
      const armed = now >= mine.armAt
      const pulse = armed ? 0.5 + 0.5 * Math.sin(now / 140) : Math.min(1, mine.age / 36) * 0.4
      ctx.save()
      ctx.shadowColor = "#f59e0b"; ctx.shadowBlur = armed ? 14 * pulse : 4
      ctx.fillStyle = armed ? "#f59e0b" : "#92400e"
      ctx.beginPath(); ctx.arc(mine.x, mine.y, 5, 0, Math.PI * 2); ctx.fill()
      if (armed) {
        // proximity ring
        ctx.globalAlpha = 0.1 * pulse
        ctx.beginPath(); ctx.arc(mine.x, mine.y, 32, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.25 * pulse; ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(mine.x, mine.y, 32, 0, Math.PI * 2); ctx.stroke()
      }
      ctx.restore()
      ctx.fillStyle = armed ? "#fbbf24" : "#78350f"
      ctx.font = "6px monospace"; ctx.textAlign = "center"
      ctx.fillText("M", mine.x, mine.y - 7)
      ctx.globalAlpha = 1
    })
  }

  // particles
  g.particles.forEach(p => {
    if (p.ring) {
      const il = p.initLife ?? 0.65
      const progress = 1 - p.life / il
      ctx.globalAlpha = Math.sin(progress * Math.PI) * 0.65
      ctx.strokeStyle = p.col; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(p.x, p.y, progress * 26, 0, Math.PI * 2); ctx.stroke()
      ctx.lineWidth = 1; ctx.globalAlpha = 1; return
    }
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

  // bottom danger glow when words are near the floor
  if (!attractMode) {
    const nearBottom = g.words.filter(w => w.type !== "powerup" && w.y > GH - 85)
    if (nearBottom.length > 0) {
      const maxY = Math.max(...nearBottom.map(w => w.y))
      const danger = Math.min(1, (maxY - (GH - 85)) / 65)
      const pulse = danger * (0.5 + 0.5 * Math.sin(now / 100))
      try {
        const dg = ctx.createLinearGradient(0, GH - 35, 0, GH)
        dg.addColorStop(0, "rgba(248,113,113,0)")
        dg.addColorStop(1, `rgba(248,113,113,${pulse * 0.28})`)
        ctx.fillStyle = dg; ctx.fillRect(0, GH - 35, cw, 35)
      } catch {}
    }
  }

  if (attractMode) { if (shook) ctx.restore(); return }

  // Pause hint (bottom left, very subtle)
  ctx.textAlign = "left"; ctx.font = "7px monospace"
  ctx.fillStyle = "rgba(255,255,255,0.12)"
  const pauseHint = g.upgrades.mine ? "P: pause · M: mine" : "P: pause"
  ctx.fillText(pauseHint, 10, GH - 24)

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

  // wave announcement
  if (g.waveAnn) {
    const wa = g.waveAnn
    const fadeIn  = Math.min(1, wa.t / 15)
    const fadeOut = wa.t > 75 ? Math.max(0, 1 - (wa.t - 75) / 30) : 1
    const slide   = Math.max(0, 1 - wa.t / 70) * cw * 0.25
    ctx.globalAlpha = fadeIn * fadeOut
    // color varies: void depth = purple, endless = green, sector = purple
    const isVoidDepth = g.endless && g.endlessWave >= 5
    const annCol = isVoidDepth ? "#a855f7" : g.endless ? "#4ade80" : "#966bec"
    ctx.fillStyle = annCol
    ctx.save()
    if (isVoidDepth) { ctx.shadowColor = "#6d28d9"; ctx.shadowBlur = 18 * (0.5 + 0.5 * Math.sin(now / 100)) }
    ctx.font = "bold 17px monospace"; ctx.textAlign = "center"
    ctx.fillText(wa.text, cw/2 + slide, GH/2 - 10)
    ctx.restore()
    ctx.font = "8px monospace"; ctx.globalAlpha = (fadeIn * fadeOut) * 0.4
    ctx.fillStyle = "#ffffff"
    ctx.fillText(g.endless ? "INFINITE RECURSION" : "SPEC BLASTER", cw/2 + slide, GH/2 + 10)
    ctx.globalAlpha = 1
  }

  // capy in-game comment
  if (g.capyMsg) {
    const elapsed = now - g.capyMsgStart
    const remaining = g.capyMsgEnd - now
    const a = Math.min(1, Math.min(elapsed / 350, remaining / 550))
    if (a > 0) {
      const lines = g.capyMsg.split("\n")
      const bw = Math.max(130, Math.max(...lines.map(l => l.length)) * 6.8) + 28
      const bh = 20 + lines.length * 14
      const bx = 10, by = GH - 50 - bh
      ctx.globalAlpha = a * 0.94
      ctx.fillStyle = "#15151e"
      roundRect(ctx, bx, by, bw, bh, 5); ctx.fill()
      ctx.strokeStyle = "rgba(150,107,236,0.45)"; ctx.lineWidth = 1
      roundRect(ctx, bx, by, bw, bh, 5); ctx.stroke()
      ctx.fillStyle = "#f5f5f5"; ctx.font = "9px monospace"; ctx.textAlign = "left"
      lines.forEach((ln, i) => ctx.fillText((i === 0 ? "🦫 " : "   ") + ln, bx + 8, by + 15 + i * 14))
      ctx.globalAlpha = 1
    }
  }

  // Boss global HP bar — thin strip at the very top of canvas during boss fights
  if (g.boss) {
    const bHpPct = g.boss.hp / g.boss.maxHp
    const bBarCol = bHpPct > 0.5 ? g.boss.color : bHpPct > 0.25 ? "#facc15" : "#f87171"
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, cw, 4)
    ctx.save(); ctx.shadowColor = bBarCol; ctx.shadowBlur = 5
    ctx.fillStyle = bBarCol; ctx.fillRect(0, 0, cw * Math.max(0, bHpPct), 4)
    ctx.restore()
  }

  // HUD
  ctx.textAlign = "left"; ctx.font = "bold 13px monospace"
  ctx.fillStyle = "#966bec"; ctx.fillText(g.score.toLocaleString(), 10, 20)
  // Depth label: pulse purple in void territory (depth 5+)
  if (g.endless && g.endlessWave >= 5) {
    const voidPulse = 0.5 + 0.5 * Math.abs(Math.sin(now / 700))
    ctx.fillStyle = `rgba(${g.endlessWave >= 9 ? "220,38,38" : "168,85,247"},${0.55 + voidPulse * 0.35})`
    ctx.font = `bold 13px monospace`
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 13px monospace"
  }
  ctx.fillText(g.endless ? (g.endlessWave > 1 ? `DEPTH ${g.endlessWave}` : "RECURSION") : `SECTOR ${g.level}`, 10, 36)
  ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.font = "7px monospace"
  ctx.fillText(`${g.kills} kills`, 10, 60)
  // combo counter when active
  if (g.combo >= 3) {
    const comboAlpha = g.combo >= 10 ? 1 : 0.55 + g.combo * 0.045
    const comboCol = g.combo >= 20 ? "#facc15" : g.combo >= 10 ? "#fb923c" : "#7dd3fc"
    ctx.fillStyle = `rgba(${comboCol === "#facc15" ? "250,204,21" : comboCol === "#fb923c" ? "251,146,60" : "125,211,252"},${comboAlpha})`
    ctx.fillText(`×${g.combo} combo`, 10, 80)
  }
  if (g.pb > 0) {
    ctx.fillStyle = g.score >= g.pb ? "rgba(250,204,21,0.55)" : "rgba(255,255,255,0.13)"
    ctx.fillText(g.score >= g.pb ? `★ ${g.pb.toLocaleString()}` : `PB ${g.pb.toLocaleString()}`, 10, 70)
  }
  // wave progress bar + boss countdown
  if (!g.boss && !g.endless && !g.bossWarn) {
    const wPct = Math.min(1, g.wordsKilled / WORDS_TO_BOSS)
    const remaining = WORDS_TO_BOSS - g.wordsKilled
    ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fillRect(10, 41, 72, 3)
    ctx.fillStyle = wPct >= 0.85 ? "#f87171" : "#966bec"; ctx.fillRect(10, 41, 72 * wPct, 3)
    ctx.font = "7px monospace"; ctx.textAlign = "left"
    if (remaining <= 4 && remaining > 0) {
      const pulse = 0.7 + 0.3 * Math.abs(Math.sin(now / 140))
      ctx.fillStyle = `rgba(248,113,113,${pulse})`
      ctx.fillText(`COLLAPSE IN ${remaining}`, 10, 52)
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.22)"
      ctx.fillText(`COLLAPSE: ${remaining}`, 10, 52)
    }
  }
  ctx.textAlign = "right"; ctx.fillStyle = "#f87171"; ctx.font = "12px monospace"
  ctx.fillText("♥".repeat(g.lives) + "♡".repeat(Math.max(0, MAX_LIVES - g.lives)), cw - 10, 20)
  let pwY = 36; ctx.font = "8px monospace"; ctx.textAlign = "right"
  if (g.shield)                         { ctx.fillStyle = "#4ade80"; ctx.fillText("SHIELD",  cw-10, pwY); pwY += 12 }
  if (g.triple || g.upgrades.triple)    { ctx.fillStyle = "#4ade80"; ctx.fillText("ENGAGE",  cw-10, pwY); pwY += 12 }
  if (g.fast)                           { ctx.fillStyle = "#4ade80"; ctx.fillText("TIMEBOX", cw-10, pwY); pwY += 12 }
  if (g.retroEnd > 0 && now < g.retroEnd) {
    const retroSecs = Math.ceil((g.retroEnd - now) / 1000)
    const retroPulse = 0.6 + 0.4 * Math.abs(Math.sin(now / 250))
    ctx.fillStyle = `rgba(125,211,252,${retroPulse})`
    ctx.fillText(`RETRO ${retroSecs}s`, cw-10, pwY); pwY += 12
  }
  if (g.upgrades.shield_regen && !g.shield && g.shieldRegenAt > 0) {
    const secs = Math.ceil(Math.max(0, g.shieldRegenAt - now) / 1000)
    ctx.fillStyle = "rgba(74,222,128,0.35)"; ctx.font = "7px monospace"; ctx.textAlign = "right"
    ctx.fillText(`↺ ${secs}s`, cw - 10, pwY); pwY += 10
  }
  // story streak — shows when player is clearing story words in sequence
  if (g.storyStreak >= 2) {
    const streakPulse = g.storyStreak >= 3 ? 0.35 + 0.2 * Math.abs(Math.sin(now / 380)) : 0.28
    ctx.fillStyle = `rgba(125,211,252,${streakPulse})`
    ctx.font = "7px monospace"; ctx.textAlign = "right"
    ctx.fillText(`◈ ${g.storyStreak} defined`, cw - 10, pwY)
  }

  // Active permanent upgrades list
  const jy = GH - 20
  const activeUpgrades = UPGRADES.filter(u => u.id !== "extra_life" && (g.upgrades[u.id] ?? 0) > 0)
  if (activeUpgrades.length > 0) {
    let uy = jy - 8; ctx.textAlign = "right"; ctx.font = "7px monospace"
    activeUpgrades.slice().reverse().forEach(u => {
      const count = g.upgrades[u.id]
      ctx.fillStyle = "rgba(150,107,236,0.55)"
      ctx.fillText(count > 1 ? `${u.name} ×${count}` : u.name, cw - 12, uy)
      uy -= 10
    })
  }

  // CRT scanline overlay (static)
  ctx.globalAlpha = 0.025; ctx.fillStyle = "#000000"
  for (let sy = 0; sy < GH; sy += 3) ctx.fillRect(0, sy, cw, 1)
  ctx.globalAlpha = 1

  // CRT sweep — a faint luminance band that scans top→bottom every 4.5s
  try {
    const sweepPeriod = 4500
    const sweepY = ((now % sweepPeriod) / sweepPeriod) * (GH + 60) - 30
    const sweepGrad = ctx.createLinearGradient(0, sweepY, 0, sweepY + 60)
    sweepGrad.addColorStop(0, "rgba(255,255,255,0)")
    sweepGrad.addColorStop(0.5, "rgba(255,255,255,0.018)")
    sweepGrad.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = sweepGrad; ctx.fillRect(0, Math.max(0, sweepY), cw, 60)
  } catch {}

  if (shook) ctx.restore()
}

function drawPaused(ctx: CanvasRenderingContext2D, g: GState, cw: number, now: number) {
  draw(ctx, g, cw, now, false)
  ctx.globalAlpha = 0.6; ctx.fillStyle = "#0d0d14"; ctx.fillRect(0, 0, cw, GH); ctx.globalAlpha = 1
  ctx.fillStyle = "#966bec"; ctx.font = "bold 18px monospace"; ctx.textAlign = "center"
  ctx.fillText("PAUSED", cw/2, GH/2 - 36)
  ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.font = "9px monospace"
  ctx.fillText("press P or ESC to resume", cw/2, GH/2 - 16)
  const activeUpgrades = UPGRADES.filter(u => u.id !== "extra_life" && (g.upgrades[u.id] ?? 0) > 0)
  if (activeUpgrades.length > 0) {
    ctx.fillStyle = "rgba(150,107,236,0.4)"; ctx.font = "8px monospace"
    ctx.fillText("upgrades:", cw/2, GH/2 + 6)
    activeUpgrades.forEach((u, i) => {
      const count = g.upgrades[u.id]
      ctx.fillStyle = "rgba(150,107,236,0.65)"; ctx.font = "8px monospace"
      ctx.fillText(count > 1 ? `${u.name} ×${count}` : u.name, cw/2, GH/2 + 20 + i * 13)
    })
  }
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

function VirtualBtn({ children, onPress, onRelease, fire, small }: {
  children: React.ReactNode; onPress: () => void; onRelease: () => void; fire?: boolean; small?: boolean
}) {
  return (
    <button
      onTouchStart={e => { e.preventDefault(); onPress() }}
      onTouchEnd={e => { e.preventDefault(); onRelease() }}
      onMouseDown={onPress} onMouseUp={onRelease} onMouseLeave={onRelease}
      style={{
        background: fire ? "rgba(150,107,236,0.25)" : "rgba(255,255,255,0.06)",
        border: `1px solid ${fire ? "rgba(150,107,236,0.45)" : "rgba(255,255,255,0.12)"}`,
        borderRadius: "6px", color: fire ? "#966bec" : "#d8d7d8",
        fontSize: fire ? "0.65rem" : "1rem", fontWeight: fire ? 600 : 400,
        letterSpacing: fire ? "0.12em" : 0,
        padding: small ? "0.45rem 0.7rem" : fire ? "0.65rem 1.5rem" : "0.55rem 1.1rem",
        cursor: "pointer", userSelect: "none", touchAction: "none",
        WebkitUserSelect: "none", outline: "none",
      }}
    >{children}</button>
  )
}

function Overlay({ children, onClick, dim }: { children: React.ReactNode; onClick: () => void; dim: number }) {
  return (
    <div onClick={onClick} style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:`rgba(13,13,20,${dim})`, cursor:"pointer", zIndex:10 }}>
      <div style={{ textAlign:"center", padding:"1.5rem" }}>{children}</div>
    </div>
  )
}

// ── CLI Compile Terminal ───────────────────────────────────────────────────
type CLILineType = "sys" | "ok" | "cmd" | "dim" | "blank"
interface CLILine { text: string; type: CLILineType }

const CLI_KEYWORDS: Record<string, string[]> = {
  fire_rate:    ["fire","fast","rapid","speed","rate","quick","burst","output","cycle","frequency","cadence"],
  word_slow:    ["slow","freeze","drift","inhibit","decel","reduce","noise","velocity","word","creep","dampen"],
  score_mul:    ["score","value","points","multiplier","stake","approval","weight","boost","amplify","earn"],
  triple:       ["triple","three","parallel","multi","fork","branch","trident","3"],
  spray:        ["spray","spread","arc","scatter","wide","burst","cannon","fragmentation","shotgun","swarm","disperse"],
  piercing:     ["pierce","anchor","through","penetrate","context","chain","pass","bore"],
  shield_regen: ["shield","firewall","regen","defense","protect","auto","repair","wall","barrier","recharge"],
  code_review:  ["review","boss","damage","double","heavy","power","strength","analysis","2x","focus"],
  homing:       ["homing","track","lock","curve","seek","hunt","follow","target","velocity","guided"],
  extra_life:   ["life","rollback","restore","health","heart","revive","heal","integrity","repair","survive"],
  auto_fire:    ["auto","autonomous","drone","standup","automatic","self","independent","scheduled","turret"],
  laser:        ["laser","beam","charge","pulse","column","vertical","hold","ray","heat","overload","cannon","focus"],
  cluster:      ["cluster","chain","explode","react","splash","fragment","cascade","burst","shrapnel","reaction","scatter","detonate"],
  mine:         ["mine","trap","proximity","drop","layer","bomb","plant","field","static","sticky","deploy","landmine"],
}

const CLI_RESPONSES: Record<string, (cmd: string) => CLILine[]> = {
  fire_rate: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Output oscillation: recalibrated", type:"ok" },
    { text:"> Fire interval: compressed 15%", type:"ok" },
    { text:"> QA CADENCE: initialized", type:"ok" },
    { text:"", type:"blank" },
    { text:"The Signal outputs faster. Pattern pressure increasing.", type:"dim" },
  ],
  word_slow: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Drift coefficient: reduced", type:"ok" },
    { text:"> Semantic velocity: clamped", type:"ok" },
    { text:"> SCOPE FREEZE: deployed", type:"ok" },
    { text:"", type:"blank" },
    { text:"Noise falls slower. More time to resolve each pattern.", type:"dim" },
  ],
  score_mul: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Value attribution engine: online", type:"ok" },
    { text:"> Resolution coefficient: +20%", type:"ok" },
    { text:"> STAKEHOLDER APPROVAL: granted", type:"ok" },
    { text:"", type:"blank" },
    { text:"Each resolved pattern carries more weight.", type:"dim" },
  ],
  triple: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Output geometry: tripled", type:"ok" },
    { text:"> Parallel fire vectors: loaded", type:"ok" },
    { text:"> TRIPLE OUTPUT: initialized", type:"ok" },
    { text:"", type:"blank" },
    { text:"The Signal fires three at once.", type:"dim" },
  ],
  spray: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Dispersion geometry: 5-vector arc", type:"ok" },
    { text:"> Spread calibration: maximum", type:"ok" },
    { text:"> SPRAY & PRAY: initialized", type:"ok" },
    { text:"", type:"blank" },
    { text:"Autonomous fragmentation pattern active.", type:"dim" },
  ],
  piercing: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Bullet coherence: sustained through targets", type:"ok" },
    { text:"> Semantic penetration: enabled", type:"ok" },
    { text:"> CONTEXT ANCHOR: deployed", type:"ok" },
    { text:"", type:"blank" },
    { text:"The Signal passes through noise without stopping.", type:"dim" },
  ],
  shield_regen: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Autonomous defense protocol: loaded", type:"ok" },
    { text:"> Firewall regeneration: every 25 seconds", type:"ok" },
    { text:"> AUTO FIREWALL: initialized", type:"ok" },
    { text:"", type:"blank" },
    { text:"The Signal defends itself.", type:"dim" },
  ],
  code_review: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Collapse pattern analysis: active", type:"ok" },
    { text:"> Damage coefficient vs large patterns: 2×", type:"ok" },
    { text:"> CODE REVIEW: initialized", type:"ok" },
    { text:"", type:"blank" },
    { text:"Heavy collapses take double damage.", type:"dim" },
  ],
  homing: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Target acquisition system: online", type:"ok" },
    { text:"> Ballistic curve computation: enabled", type:"ok" },
    { text:"> SPRINT VELOCITY: initialized", type:"ok" },
    { text:"", type:"blank" },
    { text:"Rounds curve toward semantic noise.", type:"dim" },
  ],
  extra_life: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Integrity snapshot: restored", type:"ok" },
    { text:"> Signal carrier health: +1", type:"ok" },
    { text:"> ROLLBACK: executed", type:"ok" },
    { text:"", type:"blank" },
    { text:"The Signal continues.", type:"dim" },
  ],
  auto_fire: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Autonomous targeting protocol: online", type:"ok" },
    { text:"> Self-directed fire interval: 3 seconds", type:"ok" },
    { text:"> DAILY STAND-UP: initialized", type:"ok" },
    { text:"", type:"blank" },
    { text:"The Signal fires itself.", type:"dim" },
  ],
  laser: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Coherence beam emitter: calibrated", type:"ok" },
    { text:"> Charge threshold: 0.8s — release to fire", type:"ok" },
    { text:"> Column purge protocol: armed", type:"ok" },
    { text:"> LASER PULSE: initialized", type:"ok" },
    { text:"", type:"blank" },
    { text:"Hold SPACE to charge. Release to fire a column beam.", type:"dim" },
  ],
  cluster: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Kill cascade engine: online", type:"ok" },
    { text:"> Shrapnel vectors: 4-way spread", type:"ok" },
    { text:"> CHAIN REACTION: initialized", type:"ok" },
    { text:"", type:"blank" },
    { text:"Every resolved pattern detonates into fragments.", type:"dim" },
  ],
  mine: (cmd) => [
    { text: `DIRECTIVE: "${cmd}"`, type:"dim" }, { text:"", type:"blank" },
    { text:"> Proximity detonator: armed", type:"ok" },
    { text:"> Trigger radius: 32px — blast radius: 65px", type:"ok" },
    { text:"> Deploy key: M — max 3 active", type:"ok" },
    { text:"> MINE LAYER: initialized", type:"ok" },
    { text:"", type:"blank" },
    { text:"Press M to drop a mine. Patterns detonate on contact.", type:"dim" },
  ],
}

function matchUpgrade(cmd: string, options: UpgradeDef[]): UpgradeDef {
  const lower = cmd.toLowerCase()
  let best = options[0], bestScore = -1
  options.forEach(opt => {
    const score = (CLI_KEYWORDS[opt.id] ?? []).reduce((s, kw) => s + (lower.includes(kw) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; best = opt }
  })
  return best
}

const REROLL_BASE_COST = 300

function CLIScreen({ options: initialOptions, onPick, score, kills, onReroll }: {
  options: UpgradeDef[]; onPick: (id: string) => void; score: number; kills: number
  onReroll?: () => UpgradeDef[]
}) {
  const totalTokens = Math.floor(score / 6) + kills * 3
  const [liveOptions, setLiveOptions] = useState(initialOptions)
  const [tokensSpent, setTokensSpent] = useState(0)
  const [rollCount, setRollCount] = useState(0)
  const [lines, setLines] = useState<CLILine[]>([])
  const [input, setInput] = useState("")
  const [phase, setPhase] = useState<"boot"|"ready"|"parsing"|"done">("boot")
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<"boot"|"ready"|"parsing"|"done">("boot")
  phaseRef.current = phase

  const tokensAvailable = totalTokens - tokensSpent
  const rerollCost = REROLL_BASE_COST * (rollCount + 1)
  const canReroll = !!onReroll && tokensAvailable >= rerollCost

  // Auto-scroll
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior:"smooth" }) }, [lines])

  // Boot sequence
  useEffect(() => {
    const boot: CLILine[] = [
      { text:"SIGNAL://runtime stabilized", type:"sys" },
      { text:`TOKENS AVAILABLE: ${totalTokens.toLocaleString()}`, type:"dim" },
      { text:onReroll ? `type "reroll" to re-roll directives (costs ${REROLL_BASE_COST} tokens)` : "", type:"dim" },
      { text:"", type:"blank" },
      { text:"SIGNAL://compile directive ready", type:"sys" },
      { text:"Describe what you want to build.", type:"dim" },
      { text:"", type:"blank" },
    ]
    let i = 0
    const tick = () => {
      if (i < boot.length) { setLines(prev => [...prev, boot[i++]]); setTimeout(tick, 90) }
      else { setPhase("ready"); setTimeout(() => inputRef.current?.focus(), 60) }
    }
    setTimeout(tick, 250)
  }, []) // eslint-disable-line

  // Idle hint after 7 seconds
  useEffect(() => {
    if (phase !== "ready") return
    const t = setTimeout(() => {
      setLines(prev => [...prev,
        { text:"SIGNAL://idle — syntax cache available", type:"sys" },
        { text:liveOptions.map((o, i) => `[${i+1}] ${o.name}`).join("  ·  "), type:"dim" },
        { text:canReroll ? `"reroll" to recompile — costs ${rerollCost} tokens (have ${tokensAvailable.toLocaleString()})` : "or describe freely", type:"dim" },
        { text:"", type:"blank" },
      ])
    }, 7000)
    return () => clearTimeout(t)
  }, [phase, liveOptions]) // eslint-disable-line

  function compileDirect(upgrade: UpgradeDef, label: string) {
    setLines(prev => [...prev, { text:`> ${label}`, type:"cmd" }])
    setInput("")
    setPhase("parsing")
    setTimeout(() => {
      setLines(prev => [...prev,
        { text:"", type:"blank" },
        { text:`SIGNAL://direct compile — ${upgrade.name}`, type:"sys" },
        { text:`> ${upgrade.desc}`, type:"ok" },
        { text:"", type:"blank" },
        { text:`SIGNAL://compile complete — ${upgrade.name}`, type:"sys" },
      ])
      setPhase("done")
      setTimeout(() => onPick(upgrade.id), 700)
    }, 380)
  }

  function compileFromText(cmd: string) {
    const matched = matchUpgrade(cmd, liveOptions)
    setLines(prev => [...prev, { text:`> ${cmd}`, type:"cmd" }])
    setInput("")
    setPhase("parsing")

    setTimeout(() => {
      setLines(prev => [...prev,
        { text:"", type:"blank" },
        { text:"SIGNAL://analyzing directive...", type:"sys" },
      ])
      const resp = CLI_RESPONSES[matched.id]?.(cmd) ?? [
        { text: `DIRECTIVE: "${cmd}"`, type:"dim" as CLILineType }, { text:"", type:"blank" as CLILineType },
        { text:`> Parsing non-standard input...`, type:"ok" as CLILineType },
        { text:`> Best match: ${matched.name}`, type:"ok" as CLILineType },
        { text:"", type:"blank" as CLILineType },
        { text:`${matched.name}: initialized`, type:"dim" as CLILineType },
      ]
      resp.forEach((line, i) => {
        setTimeout(() => setLines(prev => [...prev, line]), 500 + i * 85)
      })
      const totalMs = 500 + resp.length * 85 + 550
      setTimeout(() => {
        setLines(prev => [...prev,
          { text:"", type:"blank" },
          { text:`SIGNAL://compile complete — ${matched.name}`, type:"sys" },
        ])
        setPhase("done")
        setTimeout(() => onPick(matched.id), 750)
      }, totalMs)
    }, 280)
  }

  function handleReroll() {
    if (!onReroll) return
    if (tokensAvailable < rerollCost) {
      setLines(prev => [...prev,
        { text:"> reroll", type:"cmd" },
        { text:"", type:"blank" },
        { text:`SIGNAL://insufficient tokens — need ${rerollCost.toLocaleString()}`, type:"sys" },
        { text:`Available: ${tokensAvailable.toLocaleString()} · ${rerollCost - tokensAvailable} short`, type:"dim" },
        { text:"", type:"blank" },
      ])
      setInput(""); return
    }
    const newOpts = onReroll()
    if (!newOpts || newOpts.length === 0) return
    const newSpent = tokensSpent + rerollCost
    const newAvailable = totalTokens - newSpent
    setLiveOptions(newOpts)
    setTokensSpent(newSpent)
    setRollCount(r => r + 1)
    setLines(prev => [...prev,
      { text:"> reroll", type:"cmd" },
      { text:"", type:"blank" },
      { text:`SIGNAL://tokens consumed — ${rerollCost.toLocaleString()}`, type:"sys" },
      { text:`Remaining: ${newAvailable.toLocaleString()} · next reroll costs ${REROLL_BASE_COST * (rollCount + 2)}`, type:"dim" },
      { text:"", type:"blank" },
      { text:"SIGNAL://new directives compiled", type:"sys" },
      ...newOpts.map((o, i) => ({ text:`  [${i+1}]  ${o.name.padEnd(24)}${o.desc}`, type:"dim" as CLILineType })),
      { text:"", type:"blank" },
    ])
    setInput("")
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  function handleSubmit() {
    if (!input.trim() || phaseRef.current !== "ready") return
    const cmd = input.trim()
    // reroll command
    if (cmd.toLowerCase() === "reroll" || cmd.toLowerCase() === "re-roll") {
      handleReroll(); return
    }
    // help command
    if (cmd.toLowerCase() === "help" || cmd === "?") {
      setLines(prev => [...prev,
        { text:`> ${cmd}`, type:"cmd" },
        { text:"", type:"blank" },
        { text:"AVAILABLE COMPILE TARGETS:", type:"sys" },
        ...liveOptions.map((o, i) => ({ text:`  [${i+1}]  ${o.name.padEnd(24)}${o.desc}`, type:"dim" as CLILineType })),
        canReroll ? { text:`  reroll  — spend ${rerollCost} tokens for new directives`, type:"dim" as CLILineType } : { text:"", type:"blank" as CLILineType },
        { text:"", type:"blank" },
      ])
      setInput(""); return
    }
    // direct number
    if (["1","2","3"].includes(cmd)) {
      const opt = liveOptions[parseInt(cmd) - 1]
      if (opt) { compileDirect(opt, cmd); return }
    }
    compileFromText(cmd)
  }

  // 1/2/3 keyboard shortcuts (only when input not focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phaseRef.current !== "ready") return
      if (["1","2","3"].includes(e.key) && document.activeElement !== inputRef.current) {
        const opt = liveOptions[parseInt(e.key) - 1]
        if (opt) compileDirect(opt, e.key)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [liveOptions]) // eslint-disable-line

  const col = (t: CLILineType) => t === "sys" ? "#966bec" : t === "ok" ? "#4ade80" : t === "cmd" ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.0)"

  return (
    <div style={{ position:"absolute", inset:0, background:"#08080f", zIndex:10, display:"flex", flexDirection:"column", fontFamily:"monospace" }}>
      {/* Header bar */}
      <div style={{ borderBottom:"1px solid rgba(150,107,236,0.14)", padding:"0.55rem 1.5rem", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <span style={{ color:"rgba(150,107,236,0.7)", fontSize:"0.65rem", letterSpacing:"0.18em" }}>THE SIGNAL · COMPILE TERMINAL</span>
        <span style={{ color: tokensAvailable < rerollCost ? "rgba(74,222,128,0.3)" : "rgba(74,222,128,0.5)", fontSize:"0.62rem" }}>
          TOKENS: {tokensAvailable.toLocaleString()}{canReroll ? ` · reroll costs ${rerollCost}` : ""}
        </span>
      </div>
      {/* Terminal output */}
      <div style={{ flex:1, overflowY:"auto", padding:"1rem 1.5rem 0.5rem" }}>
        {lines.map((l, i) => (
          <div key={i} style={{
            color: l.type === "dim" ? "rgba(255,255,255,0.38)" : col(l.type),
            fontSize:"0.8rem", lineHeight:"1.8",
            minHeight: l.type === "blank" ? "0.6rem" : undefined,
            fontStyle: l.type === "dim" ? "normal" : undefined,
          }}>{l.text}</div>
        ))}
        {phase === "parsing" && (
          <div style={{ color:"#966bec", fontSize:"0.8rem", lineHeight:"1.8" }}>▋</div>
        )}
        <div ref={scrollRef} />
      </div>
      {/* Input */}
      <div style={{ borderTop:"1px solid rgba(255,255,255,0.055)", padding:"0.65rem 1.5rem 1rem", display:"flex", gap:"0.55rem", alignItems:"center", flexShrink:0 }}>
        <span style={{ color: phase === "ready" ? "#966bec" : "rgba(150,107,236,0.3)", fontSize:"0.85rem" }}>{">"}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleSubmit() }}
          disabled={phase !== "ready"}
          autoFocus
          placeholder={phase === "ready" ? "describe what to build…" : ""}
          style={{
            flex:1, background:"transparent", border:"none", outline:"none",
            color:"rgba(255,255,255,0.88)", fontFamily:"monospace", fontSize:"0.82rem",
            caretColor:"#966bec", opacity: phase === "ready" ? 1 : 0,
          }}
        />
      </div>
    </div>
  )
}

// ── Attract screen typewriter tagline ────────────────────────────────────
function AttractTagline() {
  const FULL = "Navigate semantic collapse.\nProtect The Signal."
  const [text, setText] = useState("")
  useEffect(() => {
    let i = 0; let cancelled = false
    function tick() {
      if (cancelled) return
      i++; setText(FULL.slice(0, i))
      if (i < FULL.length) setTimeout(tick, 38)
    }
    const t = setTimeout(tick, 1200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [])
  return (
    <p style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.75rem", margin:0, whiteSpace:"pre-line", minHeight:"2.4em", fontFamily:"monospace" }}>
      {text}{text.length < FULL.length ? <span className="cursor-blink">|</span> : null}
    </p>
  )
}

// ── Capy briefing screen with typewriter ─────────────────────────────────
function CapyScreen({ text, lineNum, totalLines, level, onAdvance }: {
  text: string; lineNum: number; totalLines: number; level: number; onAdvance: () => void
}) {
  const [displayed, setDisplayed] = useState("")
  const [done, setDone]           = useState(false)
  const skipRef = useRef(false)

  useEffect(() => {
    setDisplayed(""); setDone(false); skipRef.current = false
    let i = 0
    function tick() {
      if (skipRef.current) return
      i++
      setDisplayed(text.slice(0, i))
      if (i < text.length) setTimeout(tick, 20)
      else setDone(true)
    }
    const t = setTimeout(tick, 120)
    return () => { clearTimeout(t); skipRef.current = true }
  }, [text, lineNum]) // lineNum ensures reset even if same text repeats

  function handleClick() {
    if (!done) { skipRef.current = true; setDisplayed(text); setDone(true) }
    else onAdvance()
  }

  const nextBoss  = level <= 4 ? BOSSES[level - 1] : null
  const isFinale  = level > 4

  return (
    <div onClick={handleClick}
      style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
        background:"rgba(8,8,15,0.97)", cursor:"pointer", zIndex:10 }}>
      <div style={{ maxWidth:"380px", width:"100%", padding:"1.5rem", textAlign:"center" }}>

        {/* Capybara + sector indicator */}
        <div style={{ marginBottom:"1rem" }}>
          <div style={{ fontSize:"2.6rem", marginBottom:"0.5rem" }}>🦫</div>
          <p style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.57rem", fontFamily:"monospace",
            letterSpacing:"0.28em", margin:0 }}>
            {lineNum + 1} / {totalLines}
          </p>
        </div>

        {/* Dialog box */}
        <div className="capy-glow"
          style={{ background:"#111118", border:"1px solid rgba(150,107,236,0.3)", borderRadius:"6px",
            padding:"1.25rem 1.5rem", marginBottom:"1.1rem", minHeight:"4rem",
            display:"flex", alignItems:"center", justifyContent:"center" }}>
          <p style={{ color:"#f5f5f5", fontSize:"0.92rem", lineHeight:1.8, margin:0,
            whiteSpace:"pre-line", textAlign:"left" }}>
            {displayed}
            {!done && <span className="cursor-blink">|</span>}
          </p>
        </div>

        {/* Prompt + next sector hint */}
        <p style={{ color: done ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)",
          fontSize:"0.7rem", margin:"0 0 0.55rem", transition:"color 0.3s",
          fontFamily:"monospace" }}>
          {done ? "click to continue →" : "…"}
        </p>
        {nextBoss && done && (
          <p style={{ color:"#966bec", fontSize:"0.72rem", fontWeight:600,
            fontFamily:"monospace", letterSpacing:"0.08em", margin:0 }}>
            SECTOR {level} · {nextBoss.name}
          </p>
        )}
        {isFinale && done && (
          <p style={{ color:"#4ade80", fontSize:"0.72rem", fontWeight:600,
            fontFamily:"monospace", letterSpacing:"0.1em", margin:0 }}>
            ∞ INFINITE RECURSION
          </p>
        )}
      </div>
    </div>
  )
}

function GameOver({ score, level, kills, maxCombo, upgradeCount, shotsFired, isNewPB, onRestart, unlockedAgents, onShowStack, endless, endlessDepth, prevDepthBest }: { score: number; level: number; kills: number; maxCombo: number; upgradeCount: number; shotsFired: number; isNewPB: boolean; onRestart: () => void; unlockedAgents: string[]; onShowStack: () => void; endless?: boolean; endlessDepth?: number; prevDepthBest?: number }) {
  const accuracy = shotsFired > 0 ? Math.round((kills / shotsFired) * 100) : 0
  const isNewDepthPB = endless && endlessDepth != null && prevDepthBest != null && endlessDepth > prevDepthBest && endlessDepth >= 2
  const [handle, setHandle] = useState(() => {
    try { return localStorage.getItem("sb_handle") ?? "" } catch { return "" }
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)
  const [rank, setRank]             = useState<{ pct: number; total: number } | null>(null)
  const [copied, setCopied]         = useState(false)

  async function share() {
    const depthStr = endless && endlessDepth && endlessDepth > 1 ? ` · depth ${endlessDepth}` : ""
    const text = `I scored ${score.toLocaleString()} on Spec Blaster — ${kills} kills${depthStr}`
    const url = typeof window !== "undefined" ? window.location.origin : ""
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Spec Blaster", text: text + ". Play at " + url })
      } else {
        await navigator.clipboard.writeText(text + " → " + url)
        setCopied(true); setTimeout(() => setCopied(false), 2200)
      }
    } catch {}
  }

  useEffect(() => {
    if (score <= 0) return
    fetch("/api/leaderboard").then(r => r.json()).then((d: any) => {
      const scores: number[] = (d.scores ?? []).map((s: any) => s.score as number)
      if (scores.length > 0) {
        const below = scores.filter(s => score > s).length
        setRank({ pct: Math.round((below / scores.length) * 100), total: scores.length })
      }
    }).catch(() => {})
  }, [])

  async function submit() {
    if (!handle.trim() || submitting) return
    const h = handle.trim().slice(0, 20)
    try { localStorage.setItem("sb_handle", h) } catch {}
    setSubmitting(true)
    try {
      await fetch("/api/leaderboard", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ handle: h, score, level, kills }),
      })
      setSubmitted(true)
    } catch { setSubmitted(true) }
    setSubmitting(false)
  }

  return (
    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(13,13,20,0.97)", zIndex:10 }}>
      <div style={{ background:"#1e1e24", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"6px", padding:"2rem", maxWidth:"340px", width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:"2.25rem", marginBottom:"0.6rem" }}>🦫</div>
        {endless && endlessDepth && endlessDepth >= 9 ? (
          <>
            <p style={{ color:"#dc2626", fontWeight:700, fontSize:"1rem", margin:"0 0 0.1rem", fontFamily:"monospace", letterSpacing:"0.06em" }}>
              THE RECURSION CLAIMED YOU
            </p>
            <p style={{ color:"rgba(168,85,247,0.75)", fontSize:"0.62rem", margin:"0 0 0.2rem", fontFamily:"monospace", letterSpacing:"0.08em" }}>
              depth {endlessDepth} · beyond the void
            </p>
          </>
        ) : endless && endlessDepth && endlessDepth >= 5 ? (
          <>
            <p style={{ color:"#f87171", fontWeight:600, fontSize:"1rem", margin:"0 0 0.1rem" }}>SIGNAL LOST</p>
            <p style={{ color:"rgba(168,85,247,0.7)", fontSize:"0.62rem", margin:"0 0 0.2rem", fontFamily:"monospace", letterSpacing:"0.07em" }}>
              depth {endlessDepth} · you reached the void
            </p>
          </>
        ) : (
          <p style={{ color:"#f87171", fontWeight:600, fontSize:"1rem", margin:"0 0 0.2rem" }}>SIGNAL LOST</p>
        )}
        <p style={{ color:"#966bec", fontSize:"1.75rem", fontWeight:700, margin:"0 0 0.3rem", fontFamily:"monospace" }}>{score.toLocaleString()}</p>
        {isNewPB && <p style={{ color:"#facc15", fontSize:"0.72rem", margin:"0 0 0.2rem", fontFamily:"monospace", letterSpacing:"0.08em" }}>★ NEW PERSONAL BEST</p>}
        {isNewDepthPB && <p style={{ color:"rgba(168,85,247,0.85)", fontSize:"0.68rem", margin:"0 0 0.8rem", fontFamily:"monospace", letterSpacing:"0.07em" }}>∅ NEW DEPTH RECORD · {endlessDepth}</p>}
        {!isNewPB && !isNewDepthPB && <div style={{ marginBottom:"0.8rem" }} />}
        <div style={{ display:"grid", gridTemplateColumns: endless ? "1fr 1fr 1fr 1fr 1fr" : "1fr 1fr 1fr 1fr", gap:"0.4rem", marginBottom:"1.25rem" }}>
          {[
            endless ? ["DEPTH", endlessDepth ?? "—"] : ["SECTOR", level],
            ["PATTERNS", kills],
            ["CHAIN", `${maxCombo}×`],
            ["ACC", accuracy > 0 ? `${accuracy}%` : "—"],
            ...(endless ? [["UPGRADES", upgradeCount]] : []),
          ].map(([label, val], idx) => {
            const isDepthCell = endless && idx === 0
            const voidDepth = isDepthCell && typeof endlessDepth === "number" && endlessDepth >= 5
            return (
              <div key={label as string} style={{
                background: voidDepth ? "rgba(109,40,217,0.12)" : "rgba(255,255,255,0.04)",
                border: voidDepth ? "1px solid rgba(168,85,247,0.25)" : "1px solid transparent",
                borderRadius:"4px", padding:"0.4rem 0.3rem",
              }}>
                <p style={{ color: voidDepth ? "rgba(168,85,247,0.65)" : "#a09fa2", fontSize:"0.6rem", margin:"0 0 0.15rem", fontFamily:"monospace" }}>{label}</p>
                <p style={{ color: voidDepth ? "#c084fc" : "#d8d7d8", fontSize:"0.9rem", fontWeight:600, margin:0, fontFamily:"monospace" }}>{val}</p>
              </div>
            )
          })}
        </div>
        {!endless && upgradeCount > 0 && (
          <p style={{ color:"rgba(150,107,236,0.6)", fontSize:"0.68rem", margin:"0 0 0.4rem", fontFamily:"monospace" }}>
            {upgradeCount} upgrade{upgradeCount !== 1 ? "s" : ""} compiled
          </p>
        )}
        {accuracy > 0 && shotsFired >= 5 && (
          <p style={{
            color: accuracy >= 85 ? "rgba(74,222,128,0.7)" : accuracy >= 70 ? "rgba(125,211,252,0.6)" : "rgba(160,159,162,0.5)",
            fontSize:"0.62rem", margin:"0 0 0.55rem", fontFamily:"monospace", letterSpacing:"0.08em",
          }}>
            {accuracy >= 85 ? "◈ PRECISION CARRIER" : accuracy >= 70 ? "◈ CLEAN SIGNAL" : accuracy >= 50 ? "◈ SIGNAL STABLE" : "◈ SIGNAL DEGRADED"}
          </p>
        )}
        {rank !== null && (
          <p style={{ color:"rgba(253,186,116,0.65)", fontSize:"0.67rem", margin:"0 0 0.9rem", fontFamily:"monospace" }}>
            {rank.pct >= 90 ? "★ " : ""}{`top ${Math.max(1, 100 - rank.pct)}% of ${rank.total} runs`}
          </p>
        )}
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
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:"1rem", display:"flex", gap:"0.6rem", justifyContent:"center", flexWrap:"wrap" }}>
          <button onClick={onRestart} style={{ background:"transparent", border:"1px solid #4c4c51", borderRadius:"4px", padding:"0.4rem 0.9rem", color:"#d8d7d8", cursor:"pointer", fontSize:"0.8rem" }}>Play again</button>
          <button onClick={onShowStack} style={{ background:"transparent", border:"1px solid rgba(150,107,236,0.3)", borderRadius:"4px", padding:"0.4rem 0.9rem", color:"rgba(150,107,236,0.8)", cursor:"pointer", fontSize:"0.8rem", fontFamily:"monospace" }}>
            THE SIGNAL{unlockedAgents.length > 0 && <span style={{ marginLeft:"0.35rem", color:"#4ade80", fontSize:"0.7rem" }}>{unlockedAgents.length}</span>}
          </button>
          <a href="/leaderboard" style={{ border:"1px solid rgba(255,255,255,0.08)", borderRadius:"4px", padding:"0.4rem 0.9rem", color:"#a09fa2", textDecoration:"none", fontSize:"0.8rem" }}>Leaderboard</a>
          {score > 0 && <button onClick={share} style={{ background:"transparent", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"4px", padding:"0.4rem 0.9rem", color:"#a09fa2", cursor:"pointer", fontSize:"0.8rem" }}>{copied ? "Copied ✓" : "Share"}</button>}
        </div>
      </div>
    </div>
  )
}

// ── Signal Interior (Crew + Systems) ──────────────────────────────────────
function AgentModule({ unlocked, selected, onToggle, onClose }: {
  unlocked: string[]; selected: string[]; onToggle: (id: string) => void; onClose: () => void
}) {
  const deployCount = selected.filter(id => unlocked.includes(id)).length

  return (
    <div
      onClick={onClose}
      style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
        background:"rgba(8,8,15,0.97)", zIndex:20, cursor:"pointer", overflowY:"auto" }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:"580px", padding:"1.5rem 1.25rem", cursor:"default" }}>

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:"1.5rem" }}>
          <p style={{ color:"rgba(255,255,255,0.14)", fontSize:"0.58rem", fontFamily:"monospace", letterSpacing:"0.28em", margin:"0 0 0.35rem" }}>SIGNAL INTERIOR · CREW MANIFEST</p>
          <h2 style={{ color:"#966bec", fontSize:"1.3rem", fontWeight:700, fontFamily:"monospace", letterSpacing:"0.14em", margin:"0 0 0.5rem" }}>THE SIGNAL</h2>
          <p style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.72rem", margin:0, lineHeight:1.6 }}>
            The last coherent carrier of human meaning.
          </p>
          {unlocked.length > 0 && (
            <p style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.65rem", margin:"0.4rem 0 0", fontFamily:"monospace" }}>
              Click to deploy/bench agents for the next run
            </p>
          )}
        </div>

        {/* Agent grid */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"0.6rem", marginBottom:"1.25rem" }}>
          {AGENT_DEFS.map(agent => {
            const isUnlocked = unlocked.includes(agent.id)
            const isSelected = isUnlocked && selected.includes(agent.id)
            const borderCol = isSelected ? "rgba(74,222,128,0.32)" : isUnlocked ? "rgba(150,107,236,0.2)" : "rgba(255,255,255,0.05)"
            const bgCol = isSelected ? "rgba(74,222,128,0.06)" : isUnlocked ? "rgba(150,107,236,0.04)" : "rgba(255,255,255,0.01)"

            return (
              <div key={agent.id}
                onClick={isUnlocked ? () => onToggle(agent.id) : undefined}
                style={{
                  background: bgCol,
                  border: `1px solid ${borderCol}`,
                  borderRadius:"6px", padding:"0.85rem 0.75rem",
                  position:"relative", overflow:"hidden",
                  cursor: isUnlocked ? "pointer" : "default",
                  transition: "border-color 0.15s, background 0.15s",
                  opacity: isUnlocked ? 1 : 0.55,
                }}>
                {isSelected && (
                  <div style={{ position:"absolute", top:0, left:0, right:0, height:"1px",
                    background:"linear-gradient(90deg,transparent,rgba(74,222,128,0.6),transparent)" }} />
                )}
                <p style={{
                  color: isSelected ? "rgba(74,222,128,0.6)" : isUnlocked ? "rgba(150,107,236,0.55)" : "rgba(255,255,255,0.1)",
                  fontSize:"0.56rem", fontFamily:"monospace", letterSpacing:"0.14em", margin:"0 0 0.3rem"
                }}>{agent.station}</p>
                <p style={{
                  color: isSelected ? "#d8d7d8" : isUnlocked ? "#a09fa2" : "#404045",
                  fontSize:"0.72rem", fontWeight:600, margin:"0 0 0.25rem", fontFamily:"monospace"
                }}>{agent.name}</p>
                <p style={{
                  color: isUnlocked ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)",
                  fontSize:"0.63rem", margin:"0 0 0.45rem", lineHeight:1.5
                }}>{agent.desc}</p>
                {isUnlocked ? (
                  <div style={{ display:"flex", alignItems:"center", gap:"0.4rem" }}>
                    <span style={{
                      width:7, height:7, borderRadius:"50%",
                      background: isSelected ? "#4ade80" : "rgba(255,255,255,0.18)",
                      display:"inline-block", flexShrink:0,
                    }} />
                    <p style={{ color: isSelected ? "rgba(74,222,128,0.7)" : "rgba(255,255,255,0.22)",
                      fontSize:"0.57rem", fontFamily:"monospace", margin:0 }}>
                      {isSelected ? "DEPLOYED" : "BENCHED"}
                    </p>
                  </div>
                ) : (
                  <p style={{ color:"rgba(255,255,255,0.14)", fontSize:"0.56rem", fontFamily:"monospace", margin:0 }}>⊗ {agent.unlockNote}</p>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ textAlign:"center" }}>
          {unlocked.length === 0 ? (
            <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.72rem", margin:"0 0 1rem" }}>
              No crew online. Survive <span style={{ color:"#966bec" }}>THE RECURSION</span> to bring the first agent aboard.
            </p>
          ) : (
            <p style={{ color: deployCount > 0 ? "rgba(74,222,128,0.5)" : "rgba(255,255,255,0.2)",
              fontSize:"0.7rem", margin:"0 0 1rem", fontFamily:"monospace" }}>
              {deployCount > 0
                ? `${deployCount} of ${unlocked.length} crew deployed — The Signal carries them forward`
                : "No crew deployed — run solo"}
            </p>
          )}
          <button onClick={onClose} style={{ background:"transparent", border:"1px solid rgba(150,107,236,0.3)",
            borderRadius:"4px", padding:"0.45rem 1.5rem", color:"#966bec", cursor:"pointer", fontSize:"0.8rem" }}>
            Launch run
          </button>
        </div>

      </div>
    </div>
  )
}
