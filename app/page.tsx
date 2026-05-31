"use client"

import { useEffect, useRef, useState } from "react"

// ── Constants ──────────────────────────────────────────────────────────────
const GW = 600
const GH = 420
const PLAYER_Y = GH - 50
const MAX_LIVES = 3
const WORDS_TO_BOSS = 12
const MAX_WORDS_NORMAL = 8    // hard cap on words on-screen outside boss fight
const MAX_WORDS_ENDLESS = 10  // endless allows a bit more pressure, still manageable
const MAX_COMBO = 30          // combo display and multiplier cap

// ── Ship Station System ────────────────────────────────────────────────────
// Infrastructure only — no gameplay impact. All mechanics are future work.

type StationId = "bridge" | "turret" | "salvage" | "engineering"

// Module-level station state — readable by the draw() function without prop drilling
// Written by station component event handlers, read by the canvas renderer
const _stationState = {
  active:           "bridge" as StationId,
  turretAngle:      -Math.PI / 2,
  turretWeapon:     "pulse" as "pulse" | "triple" | "spray" | "flak" | "grapple",
  turretFiring:     false,
  commsLog:         [] as string[],
  sectorStart:      0,
  markedTargetId:   null as number | null,
  markedAt:         0,
  power: { turret: 3, shields: 3, engines: 2, sensors: 2 } as Record<string, number>,
  // Phase 4: crew AI
  opsFeedBuffer:    [] as Array<{ crew: string; message: string; type: string; ts: number }>,
  roomActions:      {} as Partial<Record<StationId, { text: string; until: number }>>,
  // Operator status — current intent per crew, shown in Operator Status panel
  operatorStatus:   {} as Partial<Record<string, { action: string; detail?: string; ts: number }>>,
  lastCrewAI:       0,
  crewAssignCache:  {} as Partial<Record<StationId, string>>,
  crewCacheTime:    0,
  // Feed rate limiting — enforce max 1 meaningful event per 5s per crew
  lastFeedTs:       {} as Partial<Record<string, number>>,
}

interface Station {
  id: StationId
  name: string
  assignedCrew?: string | null  // "capy" | "player" | agent id | null for empty
}

interface HullStatus {
  maxHull: number
  currentHull: number
}

// Canonical station list — add future stations here
const STATION_DEFS: Station[] = [
  { id: "bridge",      name: "Bridge",      assignedCrew: "capy"   },
  { id: "turret",      name: "Turret",      assignedCrew: "player" },
  { id: "salvage",     name: "Salvage",     assignedCrew: null      },
  { id: "engineering", name: "Engineering", assignedCrew: null      },
]

// Crew display labels — extensible for AI agents and future players
function crewLabel(crew: string | null | undefined, names?: Record<string, string>): string {
  if (!crew)             return "Empty"
  if (crew === "capy")   return "Capy"
  if (crew === "player") return "Player"
  if (names?.[crew])     return names[crew].replace("CLAUDE ", "")
  return crew.replace("claude_", "").toUpperCase()
}

// ── Artifact System ────────────────────────────────────────────────────────
type ArtifactRarity = "common" | "rare" | "legendary"
interface ArtifactDef {
  id: string; name: string; desc: string; rarity: ArtifactRarity
}

const ARTIFACT_DEFS: ArtifactDef[] = [
  // Common
  { id: "salvage_magnet",      name: "Salvage Magnet",       desc: "Debris drifts toward your hull. Nothing is lost.",             rarity: "common"    },
  { id: "scrap_forge",         name: "Scrap Forge",          desc: "Each scrap drop worth ×2. Debris pays off.",                   rarity: "common"    },
  { id: "overclock_core",      name: "Overclock Core",       desc: "Turret fires 25% faster. Heat not a concern.",                 rarity: "common"    },
  { id: "hardened_bulkheads",  name: "Hardened Bulkheads",   desc: "First room hit per sector absorbed. No damage.",               rarity: "common"    },
  { id: "capy_boost",          name: "Capy Uplink",          desc: "Capy crew abilities activate 50% faster.",                     rarity: "common"    },
  { id: "reactive_armor",      name: "Reactive Armor",       desc: "Taking damage triggers 1.5s invuln. Always.",                  rarity: "common"    },
  { id: "power_surge",         name: "Power Surge",          desc: "Every 5 kills: brief +2 to all power systems.",                rarity: "common"    },
  // Rare
  { id: "recursive_lens",      name: "Recursive Lens",       desc: "Bridge can lock 2 targets simultaneously.",                    rarity: "rare"      },
  { id: "fragment_lens",       name: "Fragment Lens",        desc: "Signal fragments worth ×3. Artifacts ×2.",                    rarity: "rare"      },
  { id: "autonomous_targeter", name: "Autonomous Targeter",  desc: "Capy turret accuracy +20%. Eyes everywhere.",                  rarity: "rare"      },
  { id: "resonance_cascade",   name: "Resonance Cascade",    desc: "Killing a locked target auto-locks nearest enemy.",            rarity: "rare"      },
  { id: "turret_sync",         name: "Turret Sync",          desc: "When ship fires, turret echoes the shot.",                     rarity: "rare"      },
  { id: "signal_echo",         name: "Signal Echo",          desc: "15% chance each kill echoes — nearest same-type word dies.",   rarity: "rare"      },
  { id: "emergency_protocols", name: "Emergency Protocols",  desc: "At 1 hull: turret fire rate +50%. Last stand.",                rarity: "rare"      },
  { id: "battle_hardened",     name: "Battle Hardened",      desc: "Survive a sector → +1 engineering power. Stacks.",            rarity: "rare"      },
  // Legendary
  { id: "void_mirror",         name: "Void Mirror",          desc: "Boss phase transitions deal 150 bonus score. Every shift.",   rarity: "legendary" },
  { id: "collective_mind",     name: "Collective Mind",      desc: "Each assigned crew member gives all stations +5% efficiency.", rarity: "legendary" },
  { id: "quantum_targeting",   name: "Quantum Targeting",    desc: "Locked targets also reveal type + drop guaranteed fragment.", rarity: "legendary" },
  { id: "ghost_protocol",      name: "Ghost Protocol",       desc: "Invulnerability windows last 2× as long.",                    rarity: "legendary" },
  { id: "engine_of_war",       name: "Engine of War",        desc: "Each sector cleared permanently unlocks +5 engineering pool.", rarity: "legendary" },
]

const ARTIFACT_RARITY_COLORS: Record<ArtifactRarity, string> = {
  common: "#94a3b8", rare: "#a78bfa", legendary: "#facc15",
}

// ── Expanded Crew Types ─────────────────────────────────────────────────────
interface CrewTypeDef { id: string; name: string; role: string; desc: string }
const CREW_TYPE_DEFS: CrewTypeDef[] = [
  { id: "capy",           name: "Capy",           role: "Commander",      desc: "Auto-fires at 70–90% accuracy. Auto-collects salvage." },
  { id: "player",         name: "Player",         role: "Gunner",         desc: "Full accuracy. Manual targeting. Full control." },
  { id: "engineer_bot",   name: "Engineer Bot",   role: "Repair",         desc: "Repairs 1 room damage per sector automatically." },
  { id: "salvager_bot",   name: "Salvager Bot",   role: "Recovery",       desc: "Grapple range +50%. Auto-collects on 3s cycle." },
  { id: "scout_drone",    name: "Scout Drone",    role: "Recon",          desc: "Sensors power +3. Radar always shows type labels." },
  { id: "veteran_gunner", name: "Veteran Gunner", role: "Weapons",        desc: "Turret fire rate +15%. Marked targets take 2× score." },
]

// ── Reward System ──────────────────────────────────────────────────────────
interface RewardOption {
  id: string
  type: "artifact" | "stat" | "crew"
  label: string
  desc: string
  rarity: ArtifactRarity
}

function buildRewardOptions(g: GState): RewardOption[] {
  const pool: RewardOption[] = []
  // Always include 1–2 artifact picks from defs not already held
  const available = ARTIFACT_DEFS.filter(a => !g.artifacts.includes(a.id))
  const shuffled  = [...available].sort(() => Math.random() - 0.5)
  shuffled.slice(0, 2).forEach(a => pool.push({
    id: a.id, type: "artifact", label: a.name, desc: a.desc, rarity: a.rarity,
  }))
  // Stat rewards
  pool.push({ id: "stat_hull",    type: "stat", label: "+1 Hull",              desc: "Restore one hull section. Adds to max.",         rarity: "common" })
  pool.push({ id: "stat_power",   type: "stat", label: "+2 Power Pool",        desc: "Engineering gets 2 more points to allocate.",    rarity: "common" })
  pool.push({ id: "stat_salvage", type: "stat", label: "Salvage Bonus",        desc: "All salvage values doubled for next sector.",    rarity: "common" })
  // Shuffle and return 3
  return pool.sort(() => Math.random() - 0.5).slice(0, 3)
}

function applyReward(g: GState, id: string) {
  if (id.startsWith("stat_")) {
    if (id === "stat_hull")    { g.lives = Math.min(g.lives + 1, MAX_LIVES + 2) }
    if (id === "stat_power")   { g.engineeringPoolBonus += 2 }
    if (id === "stat_salvage") { /* handled in salvage value calc */ g.artifacts.push("_salvage_bonus") }
    return
  }
  // Artifact pick
  if (!g.artifacts.includes(id)) g.artifacts.push(id)
  // Immediate effects for some artifacts
  if (id === "reactive_armor")    g.invuln = false  // just register — effect applied on damage
  if (id === "engine_of_war")     g.engineeringPoolBonus += 5
}

// ── Signal Archive — Epoch 1: Structured Systems ───────────────────────────
interface SignalNode {
  id: string; name: string; theme: string; bossName: string; effect: string
  words: string[]; connections: string[]
  x: number; y: number  // layout position (0-1)
}

const SIGNAL_ARCHIVE_E1: SignalNode[] = [
  { id: "auth",    name: "AUTH SERVICE",       theme: "Identity Collapse",      bossName: "AUTHORITY",      effect: "Identity Drift",
    words: ["login","token","credential","oauth","session"],
    connections: ["api"], x: 0.5, y: 0.05 },
  { id: "api",     name: "API GATEWAY",        theme: "Routing Failure",        bossName: "GATEKEEPER",     effect: "Packet Loss",
    words: ["endpoint","proxy","request","response","route"],
    connections: ["cache","eventbus"], x: 0.5, y: 0.22 },
  { id: "cache",   name: "CACHE LAYER",        theme: "Data Staleness",         bossName: "THE STALE",      effect: "Word Repeat Loops",
    words: ["cache","ttl","evict","stale","hit"],
    connections: ["db"], x: 0.25, y: 0.4 },
  { id: "eventbus",name: "EVENT BUS",          theme: "Signal Duplication",     bossName: "AMPLIFIER",      effect: "Duplicate Enemies",
    words: ["publish","subscribe","event","broker","stream"],
    connections: ["queue"], x: 0.75, y: 0.4 },
  { id: "db",      name: "DATABASE CLUSTER",   theme: "Data Corruption",        bossName: "THE ARCHIVIST",  effect: "Corrupted Salvage",
    words: ["table","record","index","query","schema"],
    connections: ["observe"], x: 0.25, y: 0.6 },
  { id: "queue",   name: "MESSAGE QUEUE",      theme: "Backpressure",           bossName: "BACKPRESSURE",   effect: "Spawn Delay Mechanics",
    words: ["worker","retry","queue","backlog","job"],
    connections: ["observe"], x: 0.75, y: 0.6 },
  { id: "observe", name: "OBSERVABILITY",      theme: "Monitoring Failure",     bossName: "THE BLIND WATCHER", effect: "Radar Degradation",
    words: ["trace","metric","alert","log","dashboard"],
    connections: ["flags"], x: 0.5, y: 0.75 },
  { id: "flags",   name: "FEATURE FLAG SYSTEM",theme: "Reality Fragmentation",  bossName: "THE SPLITTER",   effect: "Multiple Enemy States",
    words: ["flag","toggle","variant","rollout","release"],
    connections: ["recursion"], x: 0.5, y: 0.88 },
  { id: "recursion",name:"RECURSION CORE",     theme: "Recursive Collapse",     bossName: "THE RECURSOR",   effect: "Sector-Wide Instability",
    words: ["loop","call","return","stack","recursive"],
    connections: [], x: 0.5, y: 1.0 },
]

// ── Archive Node Configuration ─────────────────────────────────────────────
// Each node defines boss, word pool, corruption effect, depth, and reward weighting.
// Boss phase controls bullet behavior: 1=bounce 2=drift 3=split 4=spiral

type CorruptionId = "identity_drift"|"packet_loss"|"data_staleness"|"data_corruption"|"signal_duplication"|"radar_degradation"|"state_fragmentation"|"recursive_collapse"
type NodeState = "unknown" | "available" | "completed" | "corrupted"

interface ArchiveNodeConfig {
  boss:        { name: string; color: string; hp: number; phase: number }
  depth:       number           // 1-7, drives difficulty scaling
  corruption:  { id: CorruptionId; desc: string }
  rewardBias?: "artifact" | "intent" | "hull"  // weighted reward type
  taunts:      string[]
}

const ARCHIVE_NODE_CFG: Record<string, ArchiveNodeConfig> = {
  auth:     {
    depth: 1, boss: { name:"AUTHORITY",      color:"#818cf8", hp:30, phase:1 },
    corruption: { id:"identity_drift",        desc:"Enemy patterns shift trajectory mid-flight." },
    rewardBias: "artifact",
    taunts: ["Your credentials have expired.","Identity is a permission you did not request.","Authentication: rejected.","You were never authorized to be here."],
  },
  api:      {
    depth: 2, boss: { name:"GATEKEEPER",     color:"#fb923c", hp:36, phase:4 },
    corruption: { id:"packet_loss",           desc:"15% of shots are lost in transit." },
    rewardBias: "hull",
    taunts: ["Request rejected: 403.","Rate limit exceeded.","Gateway timeout. Retry later.","This endpoint is no longer maintained."],
  },
  cache:    {
    depth: 3, boss: { name:"THE STALE",      color:"#94a3b8", hp:32, phase:2 },
    corruption: { id:"data_staleness",        desc:"Word patterns loop through outdated values." },
    taunts: ["Your data is 7 years old.","TTL: expired.","Serving from cache. Cache is corrupted.","Invalidation was never implemented."],
  },
  eventbus: {
    depth: 3, boss: { name:"AMPLIFIER",      color:"#f472b6", hp:38, phase:3 },
    corruption: { id:"signal_duplication",    desc:"Killed patterns respawn once at half HP." },
    rewardBias: "intent",
    taunts: ["Every signal becomes two.","You cannot destroy a message. Only copy it.","Event: published. Subscribers: infinite.","Your actions echo forward."],
  },
  db:       {
    depth: 4, boss: { name:"THE ARCHIVIST",  color:"#facc15", hp:42, phase:1 },
    corruption: { id:"data_corruption",       desc:"35% of salvage items are corrupted — collecting them loses score." },
    rewardBias: "intent",
    taunts: ["Schema migration failed.","Your records are inconsistent.","Index: corrupted.","The query will never complete."],
  },
  queue:    {
    depth: 4, boss: { name:"BACKPRESSURE",   color:"#a78bfa", hp:40, phase:2 },
    corruption: { id:"state_fragmentation",   desc:"Words spawn in bursts then stall." },
    taunts: ["Consumer lag: 4.2 million.","The queue does not drain.","Dead letter. Dead letter. Dead letter.","Workers failed. Workers retried. Workers failed."],
  },
  observe:  {
    depth: 5, boss: { name:"BLIND WATCHER",  color:"#7dd3fc", hp:46, phase:3 },
    corruption: { id:"radar_degradation",     desc:"Bridge radar begins the expedition damaged." },
    taunts: ["No metrics. No logs. No alerts.","Observability: offline.","You cannot measure what is already gone.","The dashboard shows nothing. That is intentional."],
  },
  flags:    {
    depth: 6, boss: { name:"THE SPLITTER",   color:"#4ade80", hp:50, phase:3 },
    corruption: { id:"identity_drift",        desc:"Feature flags randomize word behavior mid-flight." },
    taunts: ["Flag: enabled. Flag: disabled. Flag: undefined.","This variant was never supposed to ship.","Rollout: 100%. Rollback: failed.","Every user is in a different reality now."],
  },
  recursion:{
    depth: 7, boss: { name:"THE RECURSOR",   color:"#f87171", hp:55, phase:1 },
    corruption: { id:"recursive_collapse",    desc:"System instability increases with each kill." },
    taunts: ["There is no base case.","You called yourself. You called yourself. You called yourself.","Stack depth: ∞.","The exit condition was removed in a refactor."],
  },
}

// ── Recovery Layer — what each system was preserving before collapse ────────
// These are narrative milestones, not gameplay rewards.
// Each node cleared recovers a fragment of human meaning.

interface RecoveryDef {
  category:       string   // "Identity" | "Communication" | etc.
  fragmentName:   string
  beforeCollapse: string   // 1-2 sentence narrative about what was lost
  percentContrib: number   // how much this node contributes to its category (0-100)
}

const RECOVERY_DEFS: Record<string, RecoveryDef> = {
  auth: {
    category:       "Identity",
    fragmentName:   "Identity Fragment",
    beforeCollapse: "People could trust that who they were remained consistent across all systems. Authentication was a contract of presence — a promise that the self persisted.",
    percentContrib: 14,
  },
  api: {
    category:       "Coordination",
    fragmentName:   "Coordination Fragment",
    beforeCollapse: "Systems spoke to each other through contracts called APIs. Every endpoint was a handshake — a promise that complexity could be made comprehensible.",
    percentContrib: 13,
  },
  cache: {
    category:       "Reliability",
    fragmentName:   "Reliability Fragment",
    beforeCollapse: "Caches held the world fast. Reliability was the difference between systems that could be trusted and systems that collapsed under their own weight.",
    percentContrib: 11,
  },
  eventbus: {
    category:       "Communication",
    fragmentName:   "Communication Fragment",
    beforeCollapse: "Events carried intent forward across time and distance. Systems could publish meaning and trust that something, somewhere, would receive it.",
    percentContrib: 12,
  },
  db: {
    category:       "Knowledge",
    fragmentName:   "Knowledge Fragment",
    beforeCollapse: "Persistent records were how civilization remembered. A database was not just data — it was the accumulated weight of every decision ever made.",
    percentContrib: 18,
  },
  queue: {
    category:       "Trust",
    fragmentName:   "Trust Fragment",
    beforeCollapse: "Message queues promised delivery. The belief that a message sent would eventually arrive was the quiet foundation of every distributed system.",
    percentContrib: 12,
  },
  observe: {
    category:       "Awareness",
    fragmentName:   "Awareness Fragment",
    beforeCollapse: "Observability was how systems saw themselves. Without it, failure was invisible until it was total. Awareness was the difference between blindness and understanding.",
    percentContrib: 15,
  },
  flags: {
    category:       "Decision Making",
    fragmentName:   "Decision Fragment",
    beforeCollapse: "Feature flags gave humans control over deployed systems. In a world of autonomous machines, the ability to decide in production preserved the last edge of human agency.",
    percentContrib: 10,
  },
  recursion: {
    category:       "Understanding",
    fragmentName:   "Understanding Fragment",
    beforeCollapse: "Recursive systems gave machines the ability to reason about themselves. Understanding — not computation, but true comprehension of structure — was the last thing preserved before the collapse.",
    percentContrib: 20,
  },
}

// The full set of categories the Human Archive tracks
const HUMAN_ARCHIVE_CATEGORIES = [
  "Identity", "Communication", "Knowledge", "Awareness",
  "Reliability", "Coordination", "Trust", "Decision Making", "Understanding",
]

// Initial archive state: AUTH is available, everything else unknown
function initialArchiveNodeState(): Record<string, NodeState> {
  const s: Record<string, NodeState> = {}
  SIGNAL_ARCHIVE_E1.forEach(n => { s[n.id] = n.id === "auth" ? "available" : "unknown" })
  return s
}

// Unlock connections of a completed node
function unlockConnections(state: Record<string, NodeState>, completedId: string): Record<string, NodeState> {
  const node = SIGNAL_ARCHIVE_E1.find(n => n.id === completedId)
  if (!node) return state
  const next = { ...state }
  node.connections.forEach(cid => {
    if (next[cid] === "unknown") next[cid] = "available"
  })
  return next
}

// ── Persistent Signal ──────────────────────────────────────────────────────
// The Signal is the player's true character — persists across all runs.

interface OperatorHistory {
  runsServed: number
  [stat: string]: number   // flexible: capy_marks, veteran_kills, etc.
}

interface PersistentSignal {
  foundedAt:        number            // ms timestamp of Signal's first run
  operationalAge:   number            // total run count (including failures)
  recoveredIntent:  number            // total signal fragments accumulated
  clearedBosses:    string[]          // unique boss names defeated at least once
  operatorsEver:    string[]
  operatorHistory:  Record<string, OperatorHistory>
  archiveNodeState: Record<string, NodeState>
  humanArchive:     Partial<Record<string, number>>  // category → % recovered (0-100)
}

const SIGNAL_KEY = "sb_signal"
const TOTAL_ARCHIVE_NODES = 9  // Epoch 1 has 9 systems

function loadSignal(): PersistentSignal {
  try {
    const raw = localStorage.getItem(SIGNAL_KEY)
    if (raw) {
      const s = JSON.parse(raw) as PersistentSignal
      if (!s.archiveNodeState) s.archiveNodeState = initialArchiveNodeState()
      if (!s.humanArchive)    s.humanArchive = {}
      // Migrate old sb_fragments
      const oldFrag = parseInt(localStorage.getItem("sb_fragments") || "0")
      if (oldFrag > 0 && s.recoveredIntent === 0) {
        s.recoveredIntent = oldFrag; saveSignal(s); localStorage.removeItem("sb_fragments")
      }
      return s
    }
  } catch {}
  return {
    foundedAt:       0,
    operationalAge:  0,
    recoveredIntent: 0,
    clearedBosses:   [],
    operatorsEver:   [],
    operatorHistory: {},
    archiveNodeState: initialArchiveNodeState(),
    humanArchive: {},
  }
}

function saveSignal(s: PersistentSignal) {
  try { localStorage.setItem(SIGNAL_KEY, JSON.stringify(s)) } catch {}
}

function signalArchiveCompletion(s: PersistentSignal): number {
  return Math.round((s.clearedBosses.length / TOTAL_ARCHIVE_NODES) * 100)
}

// Merge a completed run's data into the persistent Signal
function mergeRunIntoSignal(
  prev: PersistentSignal,
  run: {
    fragmentsEarned: number
    defeatedBosses: string[]
    crewStats: Partial<Record<string, number>>
    crewAssign: Partial<Record<string, string | null>>
    completedArchiveNodes?: string[]
  }
): PersistentSignal {
  // Archive node state: mark completed nodes and unlock their connections
  let nodeState = prev.archiveNodeState ?? initialArchiveNodeState()
  ;(run.completedArchiveNodes ?? []).forEach(nid => {
    nodeState = { ...nodeState, [nid]: "completed" as NodeState }
    nodeState = unlockConnections(nodeState, nid)
  })
  const next: PersistentSignal = {
    ...prev,
    foundedAt:        prev.foundedAt || Date.now(),
    operationalAge:   prev.operationalAge + 1,
    recoveredIntent:  prev.recoveredIntent + run.fragmentsEarned,
    clearedBosses:    [...new Set([...prev.clearedBosses, ...run.defeatedBosses])],
    operatorsEver:    [...prev.operatorsEver],
    operatorHistory:  { ...prev.operatorHistory },
    archiveNodeState: nodeState,
  }
  // Update operator lifetime history for each crew who served this run
  const servedIds = Object.values(run.crewAssign).filter(Boolean) as string[]
  for (const crewId of servedIds) {
    if (!next.operatorsEver.includes(crewId)) next.operatorsEver.push(crewId)
    const hist: OperatorHistory = { ...(next.operatorHistory[crewId] ?? { runsServed: 0 }) }
    hist.runsServed = (hist.runsServed ?? 0) + 1
    // Merge crew-specific stats (keyed by operator prefix in crewStats)
    // CAPY stats start with "capy_", VETERAN with "veteran_", etc.
    const PREFIX_MAP: Record<string, string> = {
      capy: "capy", veteran_gunner: "veteran", engineer_bot: "engineer",
      salvager_bot: "salvager", scout_drone: "scout",
    }
    const prefix = PREFIX_MAP[crewId]
    if (prefix) {
      for (const [key, val] of Object.entries(run.crewStats)) {
        if (key.startsWith(prefix + "_") && typeof val === "number") {
          hist[key] = (hist[key] ?? 0) + val
        }
      }
    }
    next.operatorHistory[crewId] = hist
  }
  return next
}

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
// Rare relics — Diablo-style drops, ~1% chance, dramatically powerful
const RARE_RELICS = ["ARCHIVE CORE", "ORPHANED FLAG", "CONTEXT SHARD", "SEMANTIC RELIC", "RAG ENGINE"]
const RELIC_SET   = new Set(RARE_RELICS)
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

// Per-sector visual identity — tint, word color, ambient glyphs, vignette hint
const SECTOR_THEMES = [
  // Sector 1: THE RECURSION — cold code depth, recursive loops
  { tint: "#1a1858", tintA: 0.10, storyCol: "#c8d4f8",
    bgChars: ["→","⊗","//","∞","{}","()","=>","??",";;","∅","∞","→"],
    vigR: 0, vigG: 0, vigB: 24 },
  // Sector 2: THE DRIFT — warm dissolution, meaning bleeding away
  { tint: "#2e1600", tintA: 0.10, storyCol: "#f0dbb8",
    bgChars: ["~","·","…","≈","–","—","○","◌","∿","~","·","≈"],
    vigR: 24, vigG: 9, vigB: 0 },
  // Sector 3: THE FRAGMENT — fracture, glitch, yellow-white
  { tint: "#201800", tintA: 0.10, storyCol: "#e8e5b2",
    bgChars: ["░","▓","|","¦","//","\\","□","△","▪","▫","░","|"],
    vigR: 20, vigG: 16, vigB: 0 },
  // Sector 4: THE COLLAPSE — terminal signal, deep forest
  { tint: "#001e08", tintA: 0.12, storyCol: "#ccebd8",
    bgChars: ["▼","×","✕","▲","░","◇","↓","↑","▼","×","✕","▲"],
    vigR: 0, vigG: 20, vigB: 8 },
]
function sectorTheme(level: number) { return SECTOR_THEMES[Math.min(level - 1, 3)] }

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

// Sector-specific mid-run transmissions — one pool per sector
const CAPY_SECTOR_COMMENTS: string[][] = [
  [ // Sector 1: THE RECURSION — cold, loop-depth
    "Recursion depth: increasing.\nStack integrity: nominal.",
    "You are resolving loops\nthat should never have started.",
    "Each clear tightens\nthe exit condition.",
    "THE RECURSION was designed\nto consume its caller.",
    "Ghost allocations ahead.\nKeep the stack clean.",
    "Infinite loop. Finite signal.\nKeep breaking them.",
    "The call stack was full\nbefore you arrived.",
  ],
  [ // Sector 2: THE DRIFT — warm dissolution
    "Semantic coherence: 78%.\nDrift accelerating.",
    "The words are losing\ntheir referents.",
    "The drift isn't random.\nSomething is steering it.",
    "Language decoupling detected.\nHold your interpretation.",
    "Every word you clear\nprevents one more semantic collapse.",
    "Meaning requires a carrier.\nYou are still that carrier.",
    "The fog is thicker here.\nDon't lose the signal thread.",
  ],
  [ // Sector 3: THE FRAGMENT — fracture, glitch
    "Integrity: 54% and dropping.",
    "The patterns are splitting.\nSame words, different vectors.",
    "Coherence fracturing\nalong the seam.",
    "Fragment containment\nis your only option now.",
    "Every shard carries\na piece of the original signal.",
    "Don't let the fragments accumulate.\nThey compound.",
    "THE FRAGMENT was one pattern\nbefore it broke.",
  ],
  [ // Sector 4: THE COLLAPSE — terminal
    "All sectors converging.\nThis is the terminal state.",
    "Four sectors behind you.\nOne remaining.",
    "Signal coherence: critical.\nYou are the only redundancy.",
    "The collapse was scheduled.\nYou weren't supposed to reach it.",
    "Beyond this: THE VOID.\nYou know what lives there.",
    "Last sector. Last signal.\nCarry it through.",
    "THE COLLAPSE is not a metaphor.\nResolve it.",
  ],
]

// First transmission when entering each sector — fires ~3s in
const SECTOR_ENTRY_MSGS: string[] = [
  "Entering THE RECURSION.\nPattern integrity: nominal.\nExpect loop instability.",
  "Entering THE DRIFT.\nSemantic coherence degrading.\nHold your interpretation.",
  "Entering THE FRAGMENT.\nIntegrity check failed: 3 shards detected.\nExpect splits.",
  "Entering THE COLLAPSE.\nAll four signals converging.\nThis is the terminal sector.",
]

const BOSS_TAUNTS: string[][] = [
  [ // THE RECURSION
    "You call this a stack trace?",
    "Every loop you break\nreopens behind you.",
    "Recursion has no floor.\nOnly depth.",
    "I have been called\nsince before you existed.",
    "Stack overflow incoming.\nPrepare your exit handler.",
    "You think clearing me\nbreaks the recursion?",
  ],
  [ // THE DRIFT
    "Your signal is slipping.\nI can feel it.",
    "Semantics dissolve here.\nWhat do your words even mean?",
    "The fog was always\npart of the architecture.",
    "You're reading signals\nthat no longer refer to anything.",
    "Context window: closing.\nDrift rate: accelerating.",
    "Nothing you destroy\nstays destroyed here.",
  ],
  [ // THE FRAGMENT
    "Break me once.\nI become two.",
    "The original pattern\nno longer exists.",
    "Fragmentation is\nthe intended behavior.",
    "Every shard is\na complete specification.",
    "You cannot integrate\nwhat was never whole.",
    "My children will finish\nwhat I started.",
  ],
  [ // THE COLLAPSE
    "Four sectors, and you\nthought it would be different.",
    "This was always\nthe terminal state.",
    "Signal coherence: zero.\nYou're running on inertia.",
    "The architecture is collapsing\naround your shot trajectory.",
    "There is no sprint review\nfor what comes next.",
    "You resolved everything.\nAnd here we still are.",
  ],
]

// Sector-specific final words when player dies — Capy signing off
const DEATH_LAST_WORDS: string[] = [
  "Signal lost in THE RECURSION.\nStack unwound. No return address.",
  "Signal lost in THE DRIFT.\nYou held meaning as long as you could.",
  "Signal lost in THE FRAGMENT.\nWe tried to contain the shards.",
  "Signal lost in THE COLLAPSE.\nYou reached terminal state.",
  "Signal lost in THE VOID.\nNothing should have survived this long.",
]

// ── Upgrades ───────────────────────────────────────────────────────────────
interface UpgradeDef { id: string; name: string; desc: string; max: number; instant?: (g: GState) => void }
const UPGRADES: UpgradeDef[] = [
  { id: "fire_rate",    name: "Signal Amplifier",    desc: "Pulse rate +15% — fires faster through the noise. Stacks 4×.",     max: 4 },
  { id: "word_slow",    name: "Temporal Anchor",      desc: "Pattern descent –15% — more time to read the noise. Stacks 3×.", max: 3 },
  { id: "score_mul",    name: "Depth Resonance",      desc: "Each resolved pattern echoes deeper — +20% signal gain. Stacks 3×.", max: 3 },
  { id: "triple",       name: "Trifork Protocol",     desc: "Every pulse fires as a 3-shot burst. Triple throughput.",         max: 1 },
  { id: "spray",        name: "Scatter Burst",        desc: "5-shot wide spread. Clears dense columns of noise.",             max: 1 },
  { id: "piercing",     name: "Penetration Drive",    desc: "Signal punches through every pattern in its column.",            max: 1 },
  { id: "shield_regen", name: "Adaptive Firewall",    desc: "Carrier shield auto-recharges every 25s. Passive defense.",     max: 1 },
  { id: "code_review",  name: "Critical Analysis",    desc: "Signal deals 2× damage to collapse entities — bosses.",         max: 1 },
  { id: "homing",       name: "Gravity Field",        desc: "Pulses bend toward nearest pattern. Self-correcting aim.",      max: 1 },
  { id: "extra_life",   name: "Rollback",             desc: "Restore +1 carrier integrity immediately.",                     max: 3,
    instant: (g) => { g.lives = Math.min(g.lives + 1, MAX_LIVES + 2) } },
  { id: "auto_fire",    name: "Autopilot Mode",       desc: "AI targets nearest pattern every 3s. Hands-free suppression.",  max: 1 },
  { id: "laser",        name: "Coherence Beam",       desc: "Hold SPACE to charge. Release for a full-column elimination burst.", max: 1 },
  { id: "cluster",      name: "Cascade Protocol",     desc: "Each kill seeds shrapnel that propagates to nearby patterns.", max: 1 },
  { id: "mine",         name: "Depth Charge",         desc: "Deploy proximity detonators [M]. Max 3 active.",               max: 1 },
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
  // After Sector 1 — THE RECURSION cleared
  [
    "THE RECURSION · SEVERED.\n\nThe loop had no exit condition.\nYou wrote one.\n\nSignal integrity: restored.\nStack: clean.\nDepth: increasing.",
  ],
  // After Sector 2 — THE DRIFT cleared
  [
    "THE DRIFT · CONTAINED.\n\nLanguage was dissolving.\nYou held the meaning\nlong enough to matter.\n\nCoherence: nominal.\nSemantic anchor: holding.",
  ],
  // After Sector 3 — THE FRAGMENT cleared
  [
    "THE FRAGMENT · RESOLVED.\n\nEvery shard found.\nEvery split reintegrated.\nThe pattern is whole.\n\nOne sector remains.\nThis is what you came for.",
  ],
  // After Sector 4 — THE COLLAPSE cleared
  [
    "THE COLLAPSE · SURVIVED.\n\nFour sectors of noise.\nFour terminal threats.\nAll dissolved by signal.\n\nYou didn't just survive —\nyou maintained coherence\nthrough the collapse itself.\n\nInfinite recursion: unlocked.",
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

// ── Merc Agents (purchasable via CLI) ─────────────────────────────────────
interface MercAgentDef { id: string; name: string; role: string; desc: string; station: string; cost: number }
const MERC_AGENTS: MercAgentDef[] = [
  { id: "claude_ops",  name: "CLAUDE OPS",  role: "Operations", desc: "Fire rate +15% / upgrade",               station: "OPS",      cost: 800  },
  { id: "claude_data", name: "CLAUDE DATA", role: "Analytics",  desc: "+10% score on every kill",               station: "ANALYTICS",cost: 600  },
  { id: "claude_exec", name: "CLAUDE EXEC", role: "Strategy",   desc: "Revive once per sector at 1 HP",         station: "STRATEGY", cost: 1000 },
]
const AGENT_UPGRADE_COSTS = [400, 800] // first upgrade, second upgrade
const MAX_AGENT_UPGRADES = 2
// All agent IDs (core + mercs combined)
const ALL_AGENT_IDS = [...AGENT_DEFS.map(a => a.id), ...MERC_AGENTS.map(a => a.id)]

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
  // Story kill: clean square wave ping — gains low punch at high combo
  kill:     (combo = 1) => {
    tone(1100 + combo * 60, 0.09, 0.18 + combo * 0.02)
    if (combo >= 8) setTimeout(() => tone(380 + combo * 16, 0.05, 0.14, "sawtooth"), 22)
  },
  split:    () => { tone(780, 0.05, 0.14, "triangle"); setTimeout(() => tone(580, 0.05, 0.12, "triangle"), 55) },
  bossHit:  () => tone(440, 0.12, 0.25),
  bossDead: () => {
    tone(523, 0.15, 0.4); setTimeout(() => tone(659, 0.15, 0.4), 130)
    setTimeout(() => tone(784, 0.15, 0.4), 260); setTimeout(() => tone(1047, 0.4, 0.45), 390)
  },
  warning:  () => { tone(220, 0.25, 0.4, "sawtooth"); setTimeout(() => tone(180, 0.4, 0.4, "sawtooth"), 250) },
  powerup:  () => { tone(600, 0.08, 0.3); setTimeout(() => tone(900, 0.08, 0.3), 90); setTimeout(() => tone(1200, 0.15, 0.3), 180) },
  combo:    (n: number) => {
    tone(800 + n * 80, 0.12, 0.3)
    if (n >= 10) setTimeout(() => tone(1200 + n * 50, 0.07, 0.26), 55)
    if (n >= 20) { setTimeout(() => tone(580, 0.1, 0.28, "sawtooth"), 25); setTimeout(() => tone(1600 + n * 28, 0.05, 0.22), 90) }
  },
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
  // RELIC: slow ascending bell chord — discovery fanfare
  relic:    () => {
    tone(440, 0.22, 0.4, "triangle"); setTimeout(() => tone(554, 0.18, 0.38, "triangle"), 110)
    setTimeout(() => tone(659, 0.16, 0.35, "triangle"), 220); setTimeout(() => tone(880, 0.28, 0.5, "triangle"), 360)
    setTimeout(() => tone(1320, 0.12, 0.4, "sine"), 570)
  },
  // RAGE: low-frequency distortion burst when boss hits 50% HP
  rage:     () => { tone(200, 0.28, 0.48, "sawtooth"); setTimeout(() => tone(160, 0.35, 0.44, "sawtooth"), 100); setTimeout(() => tone(110, 0.4, 0.38, "sawtooth"), 210) },
}

// ── Types ──────────────────────────────────────────────────────────────────
type Behavior = "fall" | "charge" | "zigzag" | "sine"
interface Word      { x: number; y: number; text: string; type: "bug"|"story"|"powerup"; spd: number; beh: Behavior; ph: number; ox: number; hp: number; hitFlash: number; elite: boolean; age: number; regenBoss?: boolean; fragment?: boolean; id: number }
interface Bullet    { x: number; y: number; vx?: number; vy?: number; enemy?: boolean; cluster?: boolean; col?: string; bounce?: boolean; drift?: number; splitAt?: number; kind?: "spray"|"triple"|"homing"|"laser"|"mine"|"turret" }
interface Mine      { x: number; y: number; age: number; armAt: number }
interface Particle  { x: number; y: number; vx: number; vy: number; life: number; glyph: string; col: string; rot?: number; rotV?: number; sz?: number; ring?: boolean; initLife?: number; gravity?: number; friction?: number }
interface BgGlyph   { x: number; y: number; vy: number; a: number; ch: string }
interface SalvageItem { id: number; x: number; y: number; vx: number; vy: number; type: "scrap"|"fragment"|"artifact"; spawnTime: number; life: number; corrupted?: boolean }
interface Boss      { x: number; y: number; hp: number; maxHp: number; name: string; color: string; dir: number; t: number; phase: number; raged: boolean; halfTriggered: boolean; quarterTriggered?: boolean; hitFlash?: number }
interface BossWarn  { name: string; color: string; t: number; letters: Array<{ ch: string; x: number; y: number; tx: number; ty: number }> }
interface WaveAnn   { text: string; t: number }
interface GState {
  px: number; lives: number; score: number; kills: number; level: number; endless: boolean
  words: Word[]; bullets: Bullet[]; particles: Particle[]; bg: BgGlyph[]; boss: Boss | null
  keys: Set<string>; lastShot: number; lastWord: number; wordsKilled: number; wordsEscaped: number; bossSpawned: boolean; nextWordId: number
  shield: boolean; shieldEnd: number; triple: boolean; tripleEnd: number; fast: boolean; fastEnd: number
  invuln: boolean; invulnEnd: number; W: number; running: boolean
  upgrades: Record<string, number>; shieldRegenAt: number
  combo: number; lastKill: number; shake: number
  capyMsg: string; capyMsgEnd: number; capyMsgStart: number; nextCapyMsg: number
  bossWarn: BossWarn | null; mouseX: number; waveAnn: WaveAnn | null; maxCombo: number; lastStorm: number
  paused: boolean; lastMilestone: number; livesAtWave: number; py: number; storyStreak: number
  lastLifeRegen: number; lastAutoFire: number; firstKill: boolean; firstKillSector: number
  redFlash: number; whiteFlash: number; accentFlash: number; accentFlashCol: string; lastMiniAt: number
  pb: number; pbShown: boolean; shotsFired: number
  activeAgents: string[]; endlessWave: number; secUnlockTriggered: boolean
  agentUpgrades: Record<string,number>; agentSectorRevived: boolean
  laserChargeStart: number; laserFireEnd: number; laserCooldownEnd: number
  mines: Mine[]; lastMine: number; dropMine: boolean
  trail: Array<{x: number; y: number}>
  retroEnd: number
  sectorClearAt: number
  deathFadeAt: number
  lastMsWave: number
  bossNextTaunt: number
  // Engineering power allocation (read from _stationState each frame)
  _powerTurret?: number; _powerShields?: number; _powerEngines?: number; _powerSensors?: number
  // Capy crew timestamps
  _capyLastFire?: number; _capyLastSalvage?: number
  // Phase 2: salvage system
  salvage: SalvageItem[]; nextSalvageId: number
  salvageCollected: number; fragmentsEarned: number
  // Phase 2: room damage (0 = intact, 1 = damaged, 2 = critical, 3 = offline)
  roomDamage: Partial<Record<StationId, number>>
  // Phase 3: artifact system
  artifacts: string[]
  _hardenedUsed: boolean; _powerSurgeKills: number; _battleHardenedStacks: number
  engineeringPoolBonus: number
  crewStats: Partial<Record<string, number>>
  defeatedBosses: string[]
  // Archive mode — layered on top of the existing sector system
  archiveMode:           boolean
  archiveNodeId:         string | null
  archiveNodeWords:      string[]
  archiveBoss:           { name: string; color: string; hp: number; phase: number } | null
  archiveDepth:          number
  archiveCorruption:     CorruptionId | null
  archiveInstability:        number
  archiveLastRadarDmg:       number
  archiveRateLimitCount:     number
  archiveRateLimitWindowEnd: number
  archiveCachedWords:        Array<{ text: string; type: Word["type"]; respawnAt: number }>
  archiveEpochComplete:      boolean  // RECURSION CORE cleared this expedition
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
    keys: new Set(), lastShot: 0, lastWord: 0, wordsKilled: 0, wordsEscaped: 0, bossSpawned: false, nextWordId: 1,
    shield: false, shieldEnd: 0, triple: false, tripleEnd: 0, fast: false, fastEnd: 0,
    invuln: false, invulnEnd: 0, W, running: false,
    upgrades: {}, shieldRegenAt: 0,
    combo: 1, lastKill: 0, shake: 0,
    capyMsg: "", capyMsgEnd: 0, capyMsgStart: 0, nextCapyMsg: 0,
    bossWarn: null, mouseX: -1, waveAnn: null, maxCombo: 1, lastStorm: 0,
    paused: false, lastMilestone: 0, livesAtWave: MAX_LIVES, py: PLAYER_Y, storyStreak: 0,
    lastLifeRegen: 0, lastAutoFire: 0, firstKill: false, firstKillSector: 0,
    redFlash: 0, whiteFlash: 0, accentFlash: 0, accentFlashCol: "#ffffff", lastMiniAt: 0,
    pb: 0, pbShown: false, shotsFired: 0,
    activeAgents: [], endlessWave: 0, secUnlockTriggered: false,
    agentUpgrades: {}, agentSectorRevived: false,
    laserChargeStart: 0, laserFireEnd: 0, laserCooldownEnd: 0,
    mines: [], lastMine: 0, dropMine: false,
    trail: [],
    retroEnd: 0,
    sectorClearAt: 0,
    deathFadeAt: 0,
    lastMsWave: -1,
    bossNextTaunt: 0,
    salvage: [], nextSalvageId: 1, salvageCollected: 0, fragmentsEarned: 0,
    roomDamage: {},
    artifacts: [], _hardenedUsed: false, _powerSurgeKills: 0, _battleHardenedStacks: 0,
    engineeringPoolBonus: 0, crewStats: {}, defeatedBosses: [],
    archiveMode: false, archiveNodeId: null, archiveNodeWords: [], archiveBoss: null,
    archiveDepth: 0, archiveCorruption: null, archiveInstability: 0, archiveLastRadarDmg: 0,
    archiveRateLimitCount: 0, archiveRateLimitWindowEnd: 0, archiveCachedWords: [],
    archiveEpochComplete: false,
  }
}

// ── Component ──────────────────────────────────────────────────────────────
export default function HomePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const rafRef    = useRef(0)
  const G         = useRef<GState>(initState(GW))

  const [phase, setPhase]           = useState<"attract"|"archive"|"briefing"|"playing"|"capy"|"recovery"|"reward"|"upgrade"|"over">("attract")
  const [currentRecovery, setCurrentRecovery] = useState<{ nodeId: string; def: RecoveryDef } | null>(null)
  const [archiveSelectedNode, setArchiveSelectedNode] = useState<string | null>(null)
  const [archiveCompletedThisRun, setArchiveCompletedThisRun] = useState<string[]>([])
  const [lastCompletedNodeId, setLastCompletedNodeId] = useState<string | null>(null)
  const [epochCompleteData, setEpochCompleteData] = useState<{ fragmentsGained: number; newAge: number } | null>(null)
  const completeArchiveNodeRef = useRef<(nodeId: string) => void>(() => {})
  const [score, setScore]           = useState(0)
  const [level, setLevel]           = useState(1)
  const [lives, setLives]           = useState(MAX_LIVES)
  const [capyLines, setCapyLines]   = useState<string[]>([])
  const [capyIdx, setCapyIdx]       = useState(0)
  const capyIdxRef                  = useRef(0)
  const capyLinesRef                = useRef<string[]>([])
  const phaseRef                    = useRef("attract")
  const [rewardOptions, setRewardOptions] = useState<RewardOption[]>([])
  const pendingCapyRef              = useRef<string[]>([])
  const [upgradeOptions, setUpgradeOptions] = useState<UpgradeDef[]>([])
  const upgradeOptionsRef                   = useRef<UpgradeDef[]>([])
  const upgradePickRef                      = useRef<((id: string) => void) | null>(null)
  const [topEntry, setTopEntry]             = useState<{handle: string; score: number} | null>(null)
  const [personalBest, setPersonalBest]           = useState(0)
  const [personalDepthBest, setPersonalDepthBest] = useState(0)
  const [personalSectorBest, setPersonalSectorBest] = useState(0)
  // THE SIGNAL — persistent player character across all runs
  const [signal, setSignal] = useState<PersistentSignal>(() => loadSignal())
  const updateSignalRef = useRef<(run: { fragmentsEarned: number; defeatedBosses: string[]; crewStats: Partial<Record<string,number>>; crewAssign: Partial<Record<string,string|null>>; completedArchiveNodes?: string[] }) => void>(() => {})
  const fragmentBank = signal.recoveredIntent  // derived alias — all existing UI reads this
  const [isTouchDevice, setIsTouchDevice]         = useState(false)
  const [unlockedAgents, setUnlockedAgents] = useState<string[]>([])
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [agentUpgrades, setAgentUpgrades] = useState<Record<string,number>>({})
  const [agentNames, setAgentNames] = useState<Record<string,string>>({})
  const [showAgentModule, setShowAgentModule] = useState(false)
  const unlockAgentRef = useRef<(id: string) => void>(() => {})

  // ── Station system state ────────────────────────────────────────────────
  const [activeStation, setActiveStation] = useState<StationId>("bridge")

  // Command Mode — TAB to freeze game, full mission control overlay
  const [commandMode, setCommandMode] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault()
        setCommandMode(prev => {
          const next = !prev
          G.current.paused = next  // freeze game completely
          return next
        })
      }
      if (e.key === "Escape" && commandMode) {
        setCommandMode(false); G.current.paused = false
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [commandMode])

  // Phase 4: operations feed + crew stats (driven by 250ms crew AI interval)
  type OpsFeedEntry = { id: number; crew: string; message: string; type: string; ts: number }
  const [opsFeed, setOpsFeed] = useState<OpsFeedEntry[]>([])
  const [crewStatsSnap, setCrewStatsSnap] = useState<Partial<Record<string, number>>>({})
  const opsFeedIdRef = useRef(0)
  const [roomActionsSnap, setRoomActionsSnap] = useState<Partial<Record<StationId, string>>>({})

  useEffect(() => {
    const id = setInterval(() => {
      const g = G.current; const now = Date.now()
      runCrewAI(g, now)
      // Drain ops feed buffer into React state (max 25 entries)
      if (_stationState.opsFeedBuffer.length > 0) {
        const newEntries = _stationState.opsFeedBuffer.splice(0).map(e => ({
          ...e, id: ++opsFeedIdRef.current,
        }))
        setOpsFeed(prev => [...newEntries, ...prev].slice(0, 25))
      }
      // Update room action states
      const actions: Partial<Record<StationId, string>> = {}
      for (const [k, v] of Object.entries(_stationState.roomActions)) {
        if (v && v.until > now) actions[k as StationId] = v.text
      }
      setRoomActionsSnap(actions)
      // Snapshot crew stats
      setCrewStatsSnap({ ...g.crewStats })
    }, 250)
    return () => clearInterval(id)
  }, [])

  // Live game snapshot — polled every 150ms so station panels stay current
  // without adding setState calls inside the RAF loop
  const [liveG, setLiveG] = useState({
    kills: 0, wordsKilled: 0, combo: 1,
    bossHpPct: null as number | null, bossName: null as string | null,
    capyMsg: "",
    wordCount: 0,
    wordDots: [] as Array<{ x: number; y: number; bug: boolean; id: number; elite: boolean }>,
    bossX: null as number | null, bossY: null as number | null,
    upgrades: {} as Record<string, number>,
    shield: false,
    commsLog: [] as string[],
    elapsedSec: 0,
    wordsEscaped: 0,
    salvageCount: 0,
    salvageCollected: 0,
    salvageItems: [] as Array<{ id: number; type: SalvageItem["type"]; corrupted?: boolean }>,
    roomDamage: {} as Partial<Record<StationId, number>>,
    artifacts: [] as string[],
    engineeringPoolBonus: 0,
    operatorStatus: {} as Partial<Record<string, { action: string; detail?: string }>>,
    crewStats: {} as Partial<Record<string, number>>,
  })
  useEffect(() => {
    const id = setInterval(() => {
      const g = G.current
      setLiveG({
        kills:       g.kills,
        wordsKilled: g.wordsKilled,
        combo:       g.combo,
        bossHpPct:   g.boss ? g.boss.hp / g.boss.maxHp : null,
        bossName:    g.boss ? g.boss.name : null,
        capyMsg:     g.capyMsg,
        wordCount:   g.words.length,
        wordDots:    g.words.slice(0, 20).map(w => ({ x: w.x / (g.W || GW), y: w.y / GH, bug: w.type === "bug", id: w.id, elite: w.elite })),
        bossX:       g.boss ? g.boss.x / (g.W || GW) : null,
        bossY:       g.boss ? g.boss.y / GH : null,
        upgrades:    { ...g.upgrades },
        shield:      g.shield,
        commsLog:    [..._stationState.commsLog],
        elapsedSec:  _stationState.sectorStart > 0 ? Math.floor((Date.now() - _stationState.sectorStart) / 1000) : 0,
        wordsEscaped: g.wordsEscaped,
        salvageCount: g.salvage.length,
        salvageCollected: g.salvageCollected,
        salvageItems: g.salvage.slice(0, 12).map(s => ({ id: s.id, type: s.type, corrupted: s.corrupted })),
        roomDamage: { ...g.roomDamage },
        artifacts: [...g.artifacts],
        engineeringPoolBonus: g.engineeringPoolBonus ?? 0,
        operatorStatus: { ..._stationState.operatorStatus },
        crewStats: { ...g.crewStats },
      })
    }, 150)
    return () => clearInterval(id)
  }, [])

  // Turret fire — fires from player position at turret barrel angle
  // Rate-limited; scales with Signal Amplifier (fire_rate) upgrade
  const turretLastFire = useRef(0)
  function onTurretFire(angle: number) {
    const g = G.current
    if (!g.running || g.paused) return
    const now = Date.now()
    const fireRateLvl = g.upgrades.fire_rate ?? 0
    const powerBonus = Math.pow(0.95, _stationState.power.turret)
    const turretDmgPenalty = Math.pow(1.2, g.roomDamage.turret ?? 0)
    // Artifact: overclock_core +25%, emergency_protocols at 1 life +50%
    const overclockMul = g.artifacts.includes("overclock_core") ? 0.75 : 1
    const emergencyMul = (g.artifacts.includes("emergency_protocols") && g.lives <= 1) ? 0.5 : 1
    // Veteran gunner crew at turret: +15% fire rate
    const vetGunnerMul = (() => { try { const ca = localStorage.getItem("sb_crew_assign"); return ca && JSON.parse(ca).turret === "veteran_gunner" ? 0.85 : 1 } catch { return 1 } })()
    const rateLimit = Math.round(300 * Math.pow(0.85, fireRateLvl) * powerBonus * turretDmgPenalty * overclockMul * emergencyMul * vetGunnerMul)
    if (now - turretLastFire.current < rateLimit) return
    turretLastFire.current = now
    const SPEED = 10
    const weapon = _stationState.turretWeapon
    const base = { kind: "turret" as const }

    if (weapon === "flak") {
      // Flak Cannon — 7 bolts in a 90° arc, always available, slower rate
      if (now - turretLastFire.current < 500) return  // flak is slower
      for (let i = -3; i <= 3; i++) {
        const spread = i * 0.22
        g.bullets.push({ x: g.px, y: g.py - 20,
          vx: Math.cos(angle + spread) * (SPEED - 1.5), vy: Math.sin(angle + spread) * (SPEED - 1.5),
          col: "#fdba74", ...base })
      }
    } else if (weapon === "grapple") {
      // Grapple Launcher — fires a hook that collects nearest salvage in that direction
      if (now - turretLastFire.current < 600) return
      const nearSalvage = g.salvage.filter(s => {
        const itemAngle = Math.atan2(s.y - g.py, s.x - g.px)
        const angleDiff = Math.abs(((itemAngle - angle) + Math.PI * 3) % (Math.PI * 2) - Math.PI)
        return angleDiff < 0.4  // within ~23° of aim
      })
      if (nearSalvage.length > 0) {
        // Collect the closest one in that direction
        const target = nearSalvage.reduce((a, b) =>
          Math.hypot(b.x - g.px, b.y - g.py) < Math.hypot(a.x - g.px, a.y - g.py) ? b : a)
        g.salvage = g.salvage.filter(s => s.id !== target.id)
        const bonus = target.type === "artifact" ? 500 : target.type === "fragment" ? 150 : 50
        g.score += bonus; g.salvageCollected++
        g.particles.push({ x: target.x, y: target.y, vx: 0, vy: -0.9, life: 1.4,
          glyph: `⬡ +${bonus}`, col: "#4ade80", sz: 10, gravity: 0 })
        setScore(g.score)
      }
      // Also fire a visible hook bolt for feedback
      g.bullets.push({ x: g.px, y: g.py - 20,
        vx: Math.cos(angle) * 12, vy: Math.sin(angle) * 12,
        col: "#4ade80", ...base })
    } else if (weapon === "triple" && (g.upgrades.triple ?? 0) >= 1) {
      for (const spread of [-0.22, 0, 0.22]) {
        g.bullets.push({ x: g.px, y: g.py - 20,
          vx: Math.cos(angle + spread) * SPEED, vy: Math.sin(angle + spread) * SPEED,
          col: "#a78bfa", ...base })
      }
    } else if (weapon === "spray" && (g.upgrades.spray ?? 0) >= 1) {
      for (let i = -2; i <= 2; i++) {
        g.bullets.push({ x: g.px, y: g.py - 20,
          vx: Math.cos(angle + i * 0.28) * SPEED, vy: Math.sin(angle + i * 0.28) * SPEED,
          col: "#a78bfa", ...base })
      }
    } else {
      // Pulse Cannon (default)
      g.bullets.push({ x: g.px, y: g.py - 20,
        vx: Math.cos(angle) * SPEED, vy: Math.sin(angle) * SPEED,
        col: "#a78bfa", ...base })
    }
  }

  // Salvage grapple — collects all field salvage, converts to score + tokens
  function onGrapple() {
    const g = G.current
    if (!g.running || g.salvage.length === 0) return
    // Check salvage room isn't offline (damage level 3)
    if ((g.roomDamage.salvage ?? 0) >= 3) return
    // Grapple range reduced by salvage room damage
    const rangePct = 1 - (g.roomDamage.salvage ?? 0) * 0.25  // 25% reduction per damage
    let total = 0
    const collected = [...g.salvage]
    g.salvage = []
    collected.forEach(s => {
      if (s.corrupted) {
        // DATA_CORRUPTION: corrupted item subtracts score
        const penalty = s.type === "artifact" ? -200 : s.type === "fragment" ? -75 : -25
        total += penalty
        g.particles.push({ x: s.x, y: s.y, vx: (g.px - s.x) * 0.08, vy: (g.py - s.y) * 0.08,
          life: 0.8, glyph: "CORRUPTED", col: "#f87171", gravity: 0, friction: 0.92 })
      } else {
        const bonus = s.type === "artifact" ? 500 : s.type === "fragment" ? 150 : 50
        total += bonus; g.salvageCollected++
        if (s.type === "fragment" || s.type === "artifact") g.fragmentsEarned++
        g.particles.push({ x: s.x, y: s.y, vx: (g.px - s.x) * 0.08, vy: (g.py - s.y) * 0.08,
          life: 0.7, glyph: s.type === "artifact" ? "★" : s.type === "fragment" ? "◈" : "◆",
          col: s.type === "artifact" ? "#facc15" : s.type === "fragment" ? "#c4b5fd" : "#94a3b8",
          gravity: 0, friction: 0.92 })
      }
    })
    g.score += total
    setScore(g.score)
    if (total > 0) {
      g.particles.push({ x: g.W/2, y: GH * 0.6, vx: 0, vy: -0.7, life: 2.0,
        glyph: `SALVAGE +${total}`, col: "#4ade80", sz: 12, gravity: 0 })
      g.accentFlash = 12; g.accentFlashCol = "#4ade80"
    }
  }

  // ── Station keyboard shortcuts (1/2/3) ─────────────────────────────────
  // Disabled during "upgrade" phase where 1/2/3 already select upgrade cards
  useEffect(() => {
    const stationKeys: Record<string, StationId> = { "1": "bridge", "2": "turret", "3": "salvage", "4": "engineering" }
    const handler = (e: KeyboardEvent) => {
      if (phaseRef.current === "upgrade") return  // defer to CLIScreen
      if (stationKeys[e.key]) {
        e.preventDefault()
        const sid = stationKeys[e.key]
        _stationState.active = sid
        setActiveStation(sid)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  // load leaderboard top + personal best on mount
  useEffect(() => {
    fetch("/api/leaderboard").then(r => r.json()).then(d => {
      const s = d.scores?.[0]
      if (s) setTopEntry({ handle: s.handle, score: s.score })
    }).catch(() => {})
    try { setPersonalBest(parseInt(localStorage.getItem("sb_pb") || "0")) } catch {}
    try { setPersonalDepthBest(parseInt(localStorage.getItem("sb_depth_pb") || "0")) } catch {}
    try { setPersonalSectorBest(parseInt(localStorage.getItem("sb_sector_pb") || "0")) } catch {}
    // Signal is loaded via useState initializer; migrate old fragment bank if needed
    setSignal(s => { const migrated = loadSignal(); saveSignal(migrated); return migrated })
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
    try { const au = localStorage.getItem("sb_agent_upgrades"); if (au) setAgentUpgrades(JSON.parse(au)) } catch {}
    try { const an = localStorage.getItem("sb_agent_names"); if (an) setAgentNames(JSON.parse(an)) } catch {}
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0)
  }, [])

  // ── Archive: launch an expedition into a specific node ──────────────────
  function startExpedition(nodeId: string) {
    const cfg  = ARCHIVE_NODE_CFG[nodeId]
    const node = SIGNAL_ARCHIVE_E1.find(n => n.id === nodeId)
    if (!cfg || !node) return
    startGame()  // reset all state, sets phase to "playing"
    const g = G.current
    // Layer archive config on top of the reset state
    g.archiveMode      = true
    g.archiveNodeId    = nodeId
    g.archiveNodeWords = node.words
    g.archiveBoss      = cfg.boss
    g.archiveDepth     = cfg.depth
    g.archiveCorruption= cfg.corruption.id
    g.level            = Math.min(4, cfg.depth)  // cap at 4 for existing difficulty tables
    // Apply immediate corruption effects
    if (cfg.corruption.id === "radar_degradation") g.roomDamage.bridge = 1
    // Override wave announcement
    g.waveAnn = { text: `${node.name.toUpperCase()} · ${cfg.boss.name}`, t: 0 }
    // Archive node entry capy message (fires ~3.2s in)
    g.nextCapyMsg = Date.now() + 3200
    _stationState.sectorStart = Date.now()
    setArchiveSelectedNode(null)
  }

  function onRecoveryComplete() {
    if (currentRecovery) {
      const { def } = currentRecovery
      setSignal(prev => {
        const cur     = prev.humanArchive?.[def.category] ?? 0
        const updated = {
          ...prev,
          humanArchive: { ...prev.humanArchive, [def.category]: Math.min(100, cur + def.percentContrib) },
        }
        saveSignal(updated)
        return updated
      })
      setCurrentRecovery(null)
    }
    returnToArchive()
  }

  function returnToArchive() {
    setArchiveSelectedNode(null)
    setArchiveCompletedThisRun([])
    const g = G.current
    // Epoch 1 complete: RECURSION CORE was just cleared
    if (g.archiveEpochComplete) {
      g.archiveEpochComplete = false
      setEpochCompleteData({
        fragmentsGained: g.fragmentsEarned,
        newAge: signal.operationalAge + 1,  // +1 because run end hasn't merged yet
      })
    }
    phaseRef.current = "archive"; setPhase("archive")
  }

  function startGame() {
    const g = G.current
    const W = g.W
    const pb = personalBest
    Object.assign(g, initState(W))
    g.pb = pb; g.pbShown = pb === 0
    g.activeAgents = selectedAgents.filter(id => unlockedAgents.includes(id))
    g.agentUpgrades = { ...agentUpgrades }
    g.agentSectorRevived = false
    g.running = true
    setShowAgentModule(false)
    g.waveAnn = { text: `SECTOR 1 · ${BOSSES[0].name}`, t: 0 }
    // Stamp bg glyphs with sector 1 identity
    { const t1 = sectorTheme(1); g.bg.forEach(b => { b.ch = t1.bgChars[Math.floor(Math.random() * t1.bgChars.length)] }) }
    // Sector entry Capy fires 3.2s after launch
    g.nextCapyMsg = Date.now() + 3200
    g.livesAtWave = MAX_LIVES
    startDrone()
    setScore(0); setLevel(1); setLives(MAX_LIVES)
    _stationState.sectorStart = Date.now()
    _stationState.commsLog = []  // fresh run — clear transmission history
    phaseRef.current = "playing"
    setPhase("playing")
  }

  upgradePickRef.current = onUpgradePick

  // Keep updateSignalRef current so death handler always uses latest state setter
  updateSignalRef.current = (run) => {
    setSignal(prev => {
      const next = mergeRunIntoSignal(prev, run)
      saveSignal(next)
      return next
    })
  }

  // Complete an archive node and unlock its connections in persistent signal
  completeArchiveNodeRef.current = (nodeId: string) => {
    setLastCompletedNodeId(nodeId)
    setArchiveCompletedThisRun(prev => prev.includes(nodeId) ? prev : [...prev, nodeId])
    setSignal(prev => {
      let ns = { ...(prev.archiveNodeState ?? initialArchiveNodeState()), [nodeId]: "completed" as NodeState }
      ns = unlockConnections(ns, nodeId)
      const updated = { ...prev, archiveNodeState: ns }
      saveSignal(updated)
      return updated
    })
    // Flag epoch complete when RECURSION CORE (the final Epoch 1 node) is cleared
    if (nodeId === "recursion") {
      G.current.archiveEpochComplete = true
    }
  }

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

  function onRewardPick(rewardId: string) {
    const g = G.current
    applyReward(g, rewardId)
    setLives(g.lives)
    // Go to upgrade screen
    const opts = pickUpgrades(g.upgrades)
    upgradeOptionsRef.current = opts; setUpgradeOptions(opts)
    phaseRef.current = "upgrade"; setPhase("upgrade")
  }

  function onUpgradePick(id: string) {
    let pickedName: string | null = null
    if (id !== "__skip__") {
      const g = G.current
      g.upgrades[id] = (g.upgrades[id] ?? 0) + 1
      const def = UPGRADES.find(u => u.id === id)
      if (def?.instant) def.instant(g)
      setLives(g.lives)
      pickedName = def?.name ?? null
    }
    // Append upgrade install note to the capy briefing
    const lines = pendingCapyRef.current.map((line, i) =>
      i === 0 && pickedName
        ? `${line}\n\n[ ${pickedName} installed ]`
        : line
    )
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
      // In archive mode: show recovery event if this node has one, then return to archive
      if (g.archiveMode) {
        const nodeId = g.archiveNodeId
        const recoveryDef = nodeId ? RECOVERY_DEFS[nodeId] : null
        if (recoveryDef) {
          setCurrentRecovery({ nodeId: nodeId!, def: recoveryDef })
          phaseRef.current = "recovery"; setPhase("recovery")
        } else {
          returnToArchive()
        }
        return
      }
      g.running = true; g.bossSpawned = false; g.wordsKilled = 0
      g.livesAtWave = g.lives; g.sectorClearAt = 0; g.lastMsWave = -1
      g.agentSectorRevived = false
      g.salvage = []
      g._hardenedUsed = false  // reset hardened_bulkheads per sector
      // Engineer Bot crew: repairs 1 room damage at sector start
      const engineerAtStation = (() => {
        try { const ca = localStorage.getItem("sb_crew_assign"); if (!ca) return null; const p = JSON.parse(ca); return Object.entries(p).find(([, v]) => v === "engineer_bot")?.[0] ?? null } catch { return null }
      })()
      if (engineerAtStation) {
        const rooms = Object.keys(g.roomDamage) as StationId[]
        if (rooms.length > 0) {
          const target = rooms[0]
          if ((g.roomDamage[target] ?? 0) > 0) {
            g.roomDamage[target] = (g.roomDamage[target] as number) - 1
            g.particles.push({ x: g.W/2, y: GH * 0.5, vx: 0, vy: -0.5, life: 1.5,
              glyph: `ENGINEER BOT: ${target.toUpperCase()} REPAIRED`, col: "#4ade80", sz: 9, gravity: 0 })
          }
        }
      }
      // Stamp bg glyphs with new sector identity
      { const th = sectorTheme(g.level); g.bg.forEach(b => { b.ch = th.bgChars[Math.floor(Math.random() * th.bgChars.length)] }) }
      // Sector entry transmission — fires ~3s in, then regular timer
      if (g.level >= 1 && g.level <= 4 && SECTOR_ENTRY_MSGS[g.level - 1]) {
        g.nextCapyMsg = Date.now() + 3200  // fire entry msg after 3.2s
      } else {
        g.nextCapyMsg = Date.now() + 22000 + Math.random() * 14000
      }
      // Activate endless mode when entering level 5+
      if (g.level > 4) {
        g.endless = true
        g.endlessWave = 1
        g.lastMiniAt = 0
        g.lastStorm = 0
        // The Void opens — particle cascade to mark this threshold crossing
        g.whiteFlash = 14; g.accentFlash = 28; g.accentFlashCol = "#a855f7"
        for (let vi = 0; vi < 50; vi++) {
          const va = (vi / 50) * Math.PI * 2
          const vspd = 3 + Math.random() * 8
          g.particles.push({
            x: g.W / 2, y: GH / 2,
            vx: Math.cos(va) * vspd, vy: Math.sin(va) * vspd - 1,
            life: 1.4 + Math.random() * 0.8,
            glyph: vi % 6 === 0 ? "∞" : vi % 6 === 1 ? "✦" : vi % 6 === 2 ? "◈" : vi % 6 === 3 ? "·" : vi % 6 === 4 ? "★" : "×",
            col: vi % 4 === 0 ? "#a855f7" : vi % 4 === 1 ? "#c084fc" : vi % 4 === 2 ? "#e879f9" : "#f0abfc",
            gravity: 0.02, friction: 0.97,
          })
        }
        g.particles.push({ x: g.W/2, y: GH/2 - 20, vx: 0, vy: -0.65, life: 2.8, glyph: "THE VOID OPENS", col: "#a855f7", sz: 14, gravity: 0 })
        g.particles.push({ x: g.W/2, y: GH/2 + 10, vx: 0, vy: -0.4, life: 2.2, glyph: "∞ carry the signal ∞", col: "#c084fc88", sz: 10, gravity: 0 })
      }
      // Wave announcement
      if (g.level <= 4) {
        g.waveAnn = { text: `SECTOR ${g.level} · ${BOSSES[g.level-1]?.name ?? ""}`, t: 0 }
      } else {
        g.waveAnn = { text: "INFINITE RECURSION · CARRY THE SIGNAL", t: 0 }
      }
      // CLAUDE SEC: brief invuln at each wave start
      // claude_sec: containment scales lv1→2s, lv2→3s, lv3→4.5s
      if (g.activeAgents.includes("claude_sec")) {
        const secLv = 1 + (g.agentUpgrades.claude_sec ?? 0)
        const secDur = secLv >= 3 ? 4500 : secLv >= 2 ? 3000 : 2000
        g.invuln = true; g.invulnEnd = Date.now() + secDur
      }
      _stationState.sectorStart = Date.now()
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
      // Only intercept game controls when actually playing — never steal keys from the CLI
      if (phaseRef.current !== "playing") return
      if ([" ","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","m","M"].includes(e.key)) e.preventDefault()
      if (e.type === "keydown") {
        G.current.keys.add(e.key)
        if ((e.key === "p" || e.key === "P" || e.key === "Escape") && G.current.running) {
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
          g.words.push({ x: ox, y: -18, text, type, spd: 0.65 + Math.random() * 0.35, beh: "fall", ph: 0, ox, hp: 1, hitFlash: 0, elite: false, age: 0, id: g.nextWordId++ })
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
        if (g.redFlash > 0) g.redFlash--
        if (g.accentFlash > 0) g.accentFlash--
        if (g.shake > 0) g.shake--
        draw(ctx, g, canvas.width, now, false)
        if (now >= g.sectorClearAt) {
          g.sectorClearAt = 0; g.running = false
          // Artifact: battle_hardened — surviving a sector gives +1 engineering power
          if (g.artifacts.includes("battle_hardened")) {
            g._battleHardenedStacks = (g._battleHardenedStacks ?? 0) + 1
            g.engineeringPoolBonus = (g.engineeringPoolBonus ?? 0) + 1
            g.particles.push({ x: g.W/2, y: GH * 0.45, vx: 0, vy: -0.5, life: 1.6,
              glyph: "BATTLE HARDENED +1 POWER", col: "#fdba74", sz: 9, gravity: 0 })
          }
          // Auto-repair: sector clear reduces all room damage by 1 (partial recovery between sectors)
          for (const room of Object.keys(g.roomDamage) as StationId[]) {
            if ((g.roomDamage[room] ?? 0) > 0) {
              g.roomDamage[room] = (g.roomDamage[room] as number) - 1
              g.particles.push({ x: g.W/2, y: GH * 0.4, vx: 0, vy: -0.5, life: 1.8,
                glyph: `${room.toUpperCase()} REPAIRED`, col: "#4ade80", sz: 9, gravity: 0 })
            }
          }
          // Collect any remaining salvage automatically at sector end
          if (g.salvage.length > 0) {
            const bonus = g.salvage.reduce((sum, s) =>
              sum + (s.type === "artifact" ? 500 : s.type === "fragment" ? 150 : 50), 0)
            g.score += bonus; g.salvageCollected += g.salvage.length; g.salvage = []
          }
          // Build reward options before transitioning to reward screen
          const rewards = buildRewardOptions(G.current)
          setRewardOptions(rewards)
          phaseRef.current = "reward"; setPhase("reward")
        }
        return
      }

      // Death ceremony window — keep particles alive, fade to black, then show GameOver
      if (!g.running && g.deathFadeAt > 0) {
        g.particles = g.particles.filter(p => { p.x += p.vx; p.y += p.vy; p.vy += (p.gravity ?? 0.14); if (p.friction) { p.vx *= p.friction; p.vy *= p.friction } p.life -= 0.016; return p.life > 0 })
        if (g.whiteFlash > 0) g.whiteFlash--
        if (g.redFlash > 0) g.redFlash--
        if (g.accentFlash > 0) g.accentFlash--
        if (g.shake > 0) g.shake--
        draw(ctx, g, canvas.width, now, false)
        // Fade to black as death window closes
        const fadeProgress = Math.max(0, 1 - (g.deathFadeAt - now) / 1400)
        if (fadeProgress > 0.35) {
          const ctx2 = canvas.getContext("2d")
          if (ctx2) {
            ctx2.globalAlpha = Math.min(1, (fadeProgress - 0.35) / 0.65) * 0.88
            ctx2.fillStyle = "#050508"
            ctx2.fillRect(0, 0, canvas.width, GH)
            ctx2.globalAlpha = 1
          }
        }
        if (now >= g.deathFadeAt) {
          g.deathFadeAt = 0
          phaseRef.current = "over"; setPhase("over")
        }
        return
      }

      if (!g.running) return

      if (g.paused) {
        drawPaused(ctx, g, canvas.width, now)
        return
      }

      // Apply engineering power + artifact + corruption passive effects each frame
      applyPowerEffects(g)
      applyArtifactPassive(g, now)
      applyCorruptionPassive(g, now)

      const spd = g.fast && now < g.fastEnd ? 8 : 5

      // expire powerups
      if (g.shield && now > g.shieldEnd) g.shield = false
      if (g.triple && now > g.tripleEnd) g.triple = false
      if (g.fast   && now > g.fastEnd)   g.fast   = false
      if (g.invuln && now > g.invulnEnd) g.invuln = false

      // shield regen upgrade (claude_qa scales: base 17s → lv2 13s → lv3 10s)
      // Engineering shields power: each point reduces regen interval by 8% (max ~57% faster at 10pts)
      if (g.upgrades.shield_regen) {
        const qaLv = g.activeAgents.includes("claude_qa") ? 1 + (g.agentUpgrades.claude_qa ?? 0) : 0
        const baseInterval = qaLv >= 3 ? 10000 : qaLv >= 2 ? 13000 : qaLv >= 1 ? 17000 : 25000
        const srInterval = Math.round(baseInterval * Math.pow(0.92, _stationState.power.shields))
        if (g.shieldRegenAt === 0) g.shieldRegenAt = now + srInterval
        if (!g.shield && now > g.shieldRegenAt) {
          g.shield = true; g.shieldEnd = now + 20000; g.shieldRegenAt = now + srInterval
        }
      }

      // combo decay
      if (now - g.lastKill > 1300 && g.combo > 1) {
        // Chain break feedback — only if combo was meaningful
        if (g.combo >= 8) {
          const breakCol = g.combo >= 20 ? "#facc15" : g.combo >= 10 ? "#fb923c" : "#7dd3fc"
          g.particles.push({ x: g.px, y: g.py - 22, vx: 0, vy: -0.6, life: 1.1,
            glyph: `×${g.combo} CHAIN BROKEN`, col: `${breakCol}88`, sz: 9 })
        }
        g.combo = 1
      }
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
      if (g.nextCapyMsg === 0) g.nextCapyMsg = now + 28000 + Math.random() * 18000
      if (now > g.nextCapyMsg && !g.capyMsg && !g.bossWarn) {
        // Sector entry message on first trigger (fired 3.2s after sector start, no kills yet)
        const isEntryMsg = !g.endless && g.level >= 1 && g.level <= 4 && g.wordsKilled < 3
        let msg: string
        if (isEntryMsg && SECTOR_ENTRY_MSGS[g.level - 1]) {
          msg = SECTOR_ENTRY_MSGS[g.level - 1]
        } else {
          // Sector-specific pool in story mode; depth pools in endless
          const commentPool = g.endless && g.endlessWave >= 5 ? CAPY_PLAY_COMMENTS_VOID
            : g.endless && g.endlessWave >= 3 ? CAPY_PLAY_COMMENTS_MID
            : g.endless ? CAPY_PLAY_COMMENTS_SHALLOW
            : CAPY_SECTOR_COMMENTS[Math.min(g.level - 1, 3)]
          msg = commentPool[Math.floor(Math.random() * commentPool.length)]
        }
        showCapyMsg(g, msg, now)
        // Override the 28s default from showCapyMsg with sector-paced interval
        const baseInterval = g.endless && g.endlessWave >= 5
          ? 50000 + Math.random() * 30000
          : g.endless
            ? 40000 + Math.random() * 25000
            : 30000 + Math.random() * 20000
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
      // MAX_COMBO aura — ship radiates golden signal particles in all directions
      if (g.combo >= 30 && Math.random() < 0.4) {
        const ang = Math.random() * Math.PI * 2
        const dist = 8 + Math.random() * 10
        g.particles.push({
          x: g.px + Math.cos(ang) * dist, y: (g.py - 5) + Math.sin(ang) * dist,
          vx: Math.cos(ang) * (0.4 + Math.random() * 0.7),
          vy: Math.sin(ang) * (0.4 + Math.random() * 0.7) - 0.3,
          life: 0.45 + Math.random() * 0.35,
          glyph: Math.random() < 0.25 ? "✦" : "·",
          col: Math.random() < 0.6 ? "#facc15" : "#fde68a",
        })
      }

      // shoot — laser charging logic
      // claude_eng scales: base 12% faster → lv2 18% → lv3 25%
      const engLv = g.activeAgents.includes("claude_eng") ? 1 + (g.agentUpgrades.claude_eng ?? 0) : 0
      const engMul = engLv >= 3 ? 0.75 : engLv >= 2 ? 0.82 : engLv >= 1 ? 0.88 : 1
      // claude_ops: additional fire rate bonus (lv1→15%, lv2→22%, lv3→28%)
      const opsLv = g.activeAgents.includes("claude_ops") ? 1 + (g.agentUpgrades.claude_ops ?? 0) : 0
      const opsMul = opsLv >= 3 ? 0.72 : opsLv >= 2 ? 0.78 : opsLv >= 1 ? 0.85 : 1
      const fireInterval = Math.max(75, (175 - (g.upgrades.fire_rate ?? 0) * 22) * engMul * opsMul)

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
      // API GATEWAY corruption: rate limiting — bursts of >3 shots in 600ms window are throttled
      let rateLimited = false
      if (g.archiveCorruption === "packet_loss") {
        if (now > g.archiveRateLimitWindowEnd) {
          g.archiveRateLimitCount = 0; g.archiveRateLimitWindowEnd = now + 600
        }
        if (g.archiveRateLimitCount >= 3) {
          rateLimited = true
          if (g.keys.has(" ") && now - g.lastShot > fireInterval) {
            g.lastShot = now  // consume the fire interval so the player tries again
            g.particles.push({ x: g.px, y: g.py - 28, vx: 0, vy: -0.9, life: 0.7,
              glyph: "RATE LIMITED", col: "#fb923c", sz: 9, gravity: 0 })
          }
        }
      }
      if (!rateLimited && !laserCharging && g.keys.has(" ") && now - g.lastShot > fireInterval) {
        if (g.archiveCorruption === "packet_loss") g.archiveRateLimitCount++
        if (g.upgrades.spray) {
          for (let a = -2; a <= 2; a++)
            g.bullets.push({ x: g.px + a * 10, y: g.py - 20, vx: a * 0.8, kind: "spray" })
        } else {
          const bkind = g.upgrades.homing ? "homing" : (g.triple || g.upgrades.triple) ? "triple" : undefined
          g.bullets.push({ x: g.px, y: g.py - 20, kind: bkind })
          if (g.triple || g.upgrades.triple) {
            g.bullets.push({ x: g.px - 16, y: g.py - 14, kind: "triple" })
            g.bullets.push({ x: g.px + 16, y: g.py - 14, kind: "triple" })
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

      // Crew AI handled by 250ms React interval — no game loop crew logic here

      // spawn words (not during boss warning)
      // Pause background word rain while any boss is active — boss fight is the focus
      if (!g.bossWarn && !g.boss) {
        // Pre-boss surge: last 3 kills before boss, modest 20% faster spawn
        const preBossSurge = !g.endless && !g.boss && g.wordsKilled >= WORDS_TO_BOSS - 3
        // Spawn interval: sector 1 ~1300ms, sector 4 ~900ms — deliberate pace
        const baseInterval = Math.max(500, 1450 - g.level * 130 - (g.endless ? Math.floor(g.score / 1200) * 20 : 0))
        const interval = preBossSurge ? Math.floor(baseInterval * 0.78) : baseInterval
        // Hard word cap — never overwhelm the screen
        const wordCap = g.endless ? MAX_WORDS_ENDLESS : MAX_WORDS_NORMAL
        const liveWords = g.words.filter(w => w.type !== "powerup" && !w.fragment).length
        if (now - g.lastWord > interval && liveWords < wordCap) {
          g.lastWord = now
          const roll = Math.random()
          let type: Word["type"] = "story", text = ""
          if (roll < 0.01 && g.level >= 2) { type = "powerup"; text = RARE_RELICS[Math.floor(Math.random() * RARE_RELICS.length)] }  // rare relic ~1%
          else if (roll < 0.19) { type = "bug";     text = BUG_WORDS[Math.floor(Math.random() * BUG_WORDS.length)] }
          else if (roll < 0.26) { type = "powerup"; text = POWERUP_WORDS[Math.floor(Math.random() * POWERUP_WORDS.length)] }
          else {
            // Archive mode: use node word pool as primary accent; else use sector accent
            const accentPool = g.archiveMode && g.archiveNodeWords.length > 0
              ? g.archiveNodeWords
              : (!g.endless ? SECTOR_ACCENT_WORDS[g.level - 1] : null)
            const nearBossThreshold = !g.endless && !g.boss && g.wordsKilled >= WORDS_TO_BOSS - 4
            // Archive mode: much higher node-word frequency (60%); standard 35%
            const accentChance = g.archiveMode ? 0.60 : 0.35
            if (accentPool && (nearBossThreshold || Math.random() < accentChance)) {
              text = accentPool[Math.floor(Math.random() * accentPool.length)]
            } else {
              text = STORY_WORDS[Math.floor(Math.random() * STORY_WORDS.length)]
            }
          }
          const slowFactor = Math.pow(0.85, g.upgrades.word_slow ?? 0)
          // Engineering engines power: each point slows words by 4% (max 34% at 10pts)
          const enginesSlow = Math.pow(0.96, _stationState.power.engines)
          // claude_design scales: base 12% slower → lv2 20% → lv3 28%
          const designLv = g.activeAgents.includes("claude_design") ? 1 + (g.agentUpgrades.claude_design ?? 0) : 0
          const designMul = designLv >= 3 ? 0.72 : designLv >= 2 ? 0.80 : designLv >= 1 ? 0.88 : 1
          // Speed: sector 1 ~0.78, sector 4 ~1.26, endless capped at 2.2
          const rawSpd = (0.62 + g.level * 0.16 + (g.endless ? Math.floor(g.score / 1200) * 0.05 : 0))
          const spd2 = Math.min(rawSpd, 2.2) * slowFactor * designMul * enginesSlow
          const br = Math.random()
          let beh: Behavior = "fall"
          if (type !== "powerup") {
            if      (g.level >= 4 && br < 0.22) beh = "sine"
            else if (g.level >= 3 && br < 0.32) beh = "zigzag"
            else if (g.level >= 2 && br < 0.38) beh = "charge"
            else if (g.level >= 1 && br < 0.18) beh = "charge"  // sector 1 gets some charge too
            // Pre-boss surge: more aggressive in last 3 kills
            if (preBossSurge && beh === "fall") {
              beh = g.level >= 2 ? (Math.random() < 0.5 ? "charge" : "zigzag") : "charge"
            }
          }
          const ox = 30 + Math.random() * (g.W - 60)
          // Elite words in endless: 3 HP, worth 3× score, slightly slower
          const isElite = g.endless && type !== "powerup" && Math.random() < 0.12
          // Corruption modifiers at word spawn
          let spawnHp   = isElite ? 3 : 1
          let spawnSpd  = spd2 * (isElite ? 0.7 : 1)
          let spawnType = type
          if (g.archiveMode && type !== "powerup" && !isElite) {
            // STATE_FRAGMENTATION: 20% of words have hp:2 but look normal ("flagged" state)
            if (g.archiveCorruption === "state_fragmentation" && Math.random() < 0.20) spawnHp = 2
            // RECURSIVE_COLLAPSE: instability accelerates word speed
            if (g.archiveCorruption === "recursive_collapse") spawnSpd *= 1 + Math.min(1.0, g.archiveInstability * 0.025)
            // IDENTITY_DRIFT: some words start with a random behavior drift
            if (g.archiveCorruption === "identity_drift" && Math.random() < 0.30) beh = "charge"
          }
          g.words.push({ x: ox, y: -18, text, type: spawnType, spd: spawnSpd, beh, ph: Math.random() * Math.PI * 2, ox, hp: spawnHp, hitFlash: 0, elite: isElite, age: 0, id: g.nextWordId++ })
        }
      }

      // endless buzzword storm every 2000 pts — NOT during boss fights
      if (g.endless && g.score > 0 && !g.boss) {
        const stormAt = Math.floor(g.score / 2000) * 2000
        if (stormAt > g.lastStorm) {
          g.lastStorm = stormAt; g.shake = 6
          const slowFactor = Math.pow(0.85, g.upgrades.word_slow ?? 0)
          const stormSpd = Math.min((1.0 + g.level * 0.16) * slowFactor, 2.0)
          // Storm: 5 words capped to not exceed MAX_WORDS_ENDLESS
          const stormSlots = Math.max(0, MAX_WORDS_ENDLESS - g.words.filter(w => w.type !== "powerup" && !w.fragment).length)
          const stormCount = Math.min(5, stormSlots)
          for (let si = 0; si < stormCount; si++) {
            const stormText = Math.random() < 0.4
              ? BUG_WORDS[Math.floor(Math.random() * BUG_WORDS.length)]
              : STORY_WORDS[Math.floor(Math.random() * STORY_WORDS.length)]
            const sox = 30 + Math.random() * (g.W - 60)
            const beh: Behavior = ["fall","charge","zigzag","sine"][Math.floor(Math.random()*4)] as Behavior
            g.words.push({ x: sox, y: -18 - si * 22, text: stormText, type: Math.random() < 0.35 ? "bug" : "story", spd: stormSpd, beh, ph: Math.random() * Math.PI * 2, ox: sox, hp: 1, hitFlash: 0, elite: false, age: 0, id: g.nextWordId++ })
          }
          if (stormCount > 0) {
            showCapyMsg(g, "Semantic storm.\nCoherence under pressure.", now)
            sfx.warning()
          }
        }
      }

      // endless wave progression every 55 kills (was 75 — more frequent depth events)
      if (g.endless) {
        const expectedWave = Math.floor(g.wordsKilled / 55) + 1
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
        // Each boss has a distinct approach speed that matches its character
        // Recursion: snappy, stack-like; Drift: slow float; Fragment: sharp jerk; Collapse: relentless
        const easeFactor = bw.name === "THE DRIFT" ? 0.065
          : bw.name === "THE RECURSION" ? 0.12
          : bw.name === "THE FRAGMENT"  ? 0.14
          : 0.10  // THE COLLAPSE
        bw.letters.forEach(l => {
          l.x += (l.tx - l.x) * easeFactor
          l.y += (l.ty - l.y) * easeFactor
        })
        if (bw.t >= 170) {
          const bd = (g.archiveMode && g.archiveBoss) ? g.archiveBoss : BOSSES[g.level - 1]
          const bossPhase = (g.archiveMode && g.archiveBoss) ? g.archiveBoss.phase : g.level
          g.boss = { x: g.W/2, y: 70, hp: bd.hp, maxHp: bd.hp, name: bd.name, color: bd.color, dir: 1, t: 0, phase: bossPhase, raged: false, halfTriggered: false }
          g.bossWarn = null
          g.bossNextTaunt = now + 7000  // first taunt ~7s after boss appears
          g.shake = 32; g.accentFlash = 45; g.accentFlashCol = bd.color  // slam arrival
          // boss materialize — dense ring burst from spawn point
          const bCol = bd.color
          for (let bi = 0; bi < 55; bi++) {
            const ba = (bi / 55) * Math.PI * 2
            const spd = 3 + Math.random() * 9
            g.particles.push({ x: g.W/2, y: 70, vx: Math.cos(ba) * spd, vy: Math.sin(ba) * spd,
              life: 0.7 + Math.random() * 0.6,
              glyph: bi % 4 === 0 ? "✦" : bi % 4 === 1 ? bd.name[0] : "·",
              col: bi % 3 === 0 ? "#fbbf24" : bCol })
          }
          // Four rings on slam
          for (let ri = 0; ri < 4; ri++) {
            g.particles.push({ x: g.W/2, y: 70, vx: 0, vy: 0,
              life: 0.9 - ri * 0.18, initLife: 0.9 - ri * 0.18,
              glyph: "", col: ri % 2 === 0 ? bCol : "#fbbf24", ring: true })
          }
          sfx.miniBoss()
        }
      }

      // spawn boss warning
      if (!g.boss && !g.bossWarn && !g.bossSpawned && !g.endless && g.wordsKilled >= WORDS_TO_BOSS) {
        g.bossSpawned = true
        const bd = (g.archiveMode && g.archiveBoss) ? g.archiveBoss : BOSSES[g.level - 1]
        // Scatter remaining words as score bonus before boss warning
        g.words.forEach(w => {
          if (w.type === "powerup") return
          g.score += w.type === "bug" ? 20 : 5
          // Scatter in boss color — the battlefield is already changing
          spawnParticles(g, w.x, w.y, bd.color, "·", 4)
        })
        g.words = g.words.filter(w => w.type === "powerup")
        const charW = 18
        const nameW = bd.name.length * charW
        const cx = g.W / 2, cy = GH / 2
        const isCollapse  = bd.name === "THE COLLAPSE"
        const isRecursion = bd.name === "THE RECURSION"
        const isDrift     = bd.name === "THE DRIFT"
        const isFragment  = bd.name === "THE FRAGMENT"
        g.bossWarn = {
          name: bd.name, color: bd.color, t: 0,
          letters: bd.name.split("").map((ch, i) => ({
            ch,
            // THE COLLAPSE:  letters converge from all four edges — chaotic terminal event
            // THE RECURSION: letters rise from below — stack overflow resurfacing
            // THE DRIFT:     letters float in from left, staggered — meaning bleeding across
            // THE FRAGMENT:  letters scatter from center outward, then converge — fragmentation
            x: isCollapse
              ? (i % 4 === 0 ? -40 : i % 4 === 1 ? g.W + 40 : i % 4 === 2 ? cx + (Math.random()-0.5)*80 : -40 + Math.random()*g.W)
              : isRecursion
                ? cx - nameW/2 + i * charW + charW/2  // already at target x — rises vertically
                : isDrift
                  ? -60 - i * 20  // all start off left edge, staggered — drift in
                  : isFragment
                    ? cx + (Math.random()-0.5) * 120  // scatter from center area
                    : cx - nameW/2 + i * charW + charW/2,
            y: isCollapse
              ? (i % 3 === 0 ? -50 : i % 3 === 1 ? GH + 50 : Math.random() < 0.5 ? -50 : GH + 50)
              : isRecursion
                ? GH + 60 + i * 14  // staggered below — rise like stack overflow
                : isDrift
                  ? cy + (Math.random()-0.5) * 40  // near target height, drift in horizontally
                  : isFragment
                    ? cy + (Math.random()-0.5) * GH * 0.6  // scattered vertically, converge
                    : -80 - i * 12,
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

      // endless mini-boss spawn every 65 kills (was 100 — keeps pace up)
      if (g.endless && !g.boss && !g.bossWarn) {
        const miniInterval = 65
        const nextMiniAt = (Math.floor(g.lastMiniAt / miniInterval) + 1) * miniInterval
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
          // Full board clear on boss spawn — words scatter upward as score bonus
          g.words.forEach(w => {
            if (w.type === "powerup") return
            g.score += w.type === "bug" ? 20 : 5
            spawnParticles(g, w.x, w.y, w.type === "bug" ? "#f97316" : "#e2e8f0", "↑", 2)
          })
          g.words = g.words.filter(w => w.type === "powerup")
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

        // ── Boss-specific movement patterns ──────────────────────────────────
        if (b.name === "THE RECURSION") {
          // Loop pattern: dashes hard one way, suddenly reverses — like a recursive stack
          // Every 220 frames: rapid 4-bounce micro-loop (stutter-step back and forth)
          const inLoop = b.t % 220 < 28
          const loopMul = inLoop ? 3.2 : 1
          b.x += b.dir * (1.4 + b.phase * 0.3) * rageMul * loopMul
          if (b.x > g.W - 50 || b.x < 50) b.dir *= -1
          if (inLoop && b.t % 4 === 0) b.dir *= -1  // rapid direction flips during loop burst
        } else if (b.name === "THE DRIFT") {
          // Sinusoidal drift — slow sweeping arcs, deceptively hard to predict
          const driftSin = Math.sin(b.t / 90) * (b.raged ? 2.8 : 1.8)
          b.x += driftSin * rageMul
          // Occasional long drift — moves toward player side then sweeps away
          if (b.t % 260 < 80) {
            const towards = g.px > b.x ? 0.55 : -0.55
            b.x += towards * rageMul
          }
          b.x = Math.max(45, Math.min(g.W - 45, b.x))
          b.dir = b.x > g.W / 2 ? -1 : 1  // dir tracks which half it's in, for bullet aiming
        } else if (b.name === "THE FRAGMENT") {
          // Jitter movement — erratic micro-dashes, hard to track
          const jitter = (Math.random() - 0.5) * (b.raged ? 6 : 3.5)
          b.x += b.dir * (1.2 + b.phase * 0.3) * rageMul + jitter
          if (b.x > g.W - 50 || b.x < 50) b.dir *= -1
          // Every 130 frames: fragment scatter-jump to a new zone
          if (b.t % 130 === 0) {
            b.x = 60 + Math.random() * (g.W - 120)
            spawnParticles(g, b.x, b.y, "#facc15", "⌁", 6)
          }
        } else if (b.name === "THE COLLAPSE") {
          // Inevitable convergence — steadily homes in on player x, no escape zone
          const dx = g.px - b.x
          const pullStr = b.raged ? 0.032 : 0.018
          b.x += dx * pullStr + b.dir * 0.5 * rageMul
          if (b.x > g.W - 50 || b.x < 50) b.dir *= -1
          b.x = Math.max(45, Math.min(g.W - 45, b.x))
        } else {
          // Default: standard linear bounce for mini-bosses and THE VOID
          b.x += b.dir * (1.4 + (Math.min(b.phase, 4)) * 0.35) * rageMul * moveMul
          if (b.x > g.W - 50 || b.x < 50) b.dir *= -1
        }
        b.t++
        if (b.hitFlash && b.hitFlash > 0) b.hitFlash--
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
        // ── Boss mid-fight taunts (every 9-14s, different from capy commentary) ──
        if (now > g.bossNextTaunt && !g.capyMsg && b.phase <= 4) {
          const bossIdx = Math.min(g.level - 1, BOSS_TAUNTS.length - 1)
          const taunts = BOSS_TAUNTS[bossIdx]
          const line = taunts[Math.floor(Math.random() * taunts.length)]
          // Display boss taunt with boss color tint — shown top-left near sector label
          g.particles.push({ x: b.x, y: b.y - 32, vx: 0, vy: -0.4, life: 2.2, glyph: line.split("\n")[0], col: b.color, sz: 8 })
          showCapyMsg(g, line, now)
          g.bossNextTaunt = now + 9000 + Math.random() * 5000
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
          g.words.push({ x: rx, y: -18, text: "roadmap item", type: "story", spd: 0.8, beh: "fall", ph: 0, ox: rx, hp: 1, hitFlash: 0, elite: false, age: 0, regenBoss: true, id: g.nextWordId++ })
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
        // The Dependency: spawns new enemy words every 160 frames (respects word cap)
        if (b.name === "THE DEPENDENCY" && b.t > 0 && b.t % 160 === 0 && g.words.length < 10) {
          const dx = 40 + Math.random() * (g.W - 80)
          const deps = ["legacy code","vendor lock","npm audit","circular dep","peer dep","semver range"]
          const depText = deps[Math.floor(Math.random() * deps.length)]
          g.words.push({ x: dx, y: -18, text: depText, type: "bug", spd: 1.6, beh: "fall", ph: 0, ox: dx, hp: 1, hitFlash: 0, elite: false, age: 0, id: g.nextWordId++ })
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
        // CORRUPTION: packet_loss — 15% of player shots vanish in transit
        if (!b.enemy && g.archiveCorruption === "packet_loss" && Math.random() < 0.0025) return false
        b.y += b.vy ?? (b.enemy ? 4 : -9)
        if (b.vx) b.x += b.vx
        // THE RECURSION: wall-bouncing bullets
        if (b.bounce && b.enemy) {
          if (b.x < 8 || b.x > g.W - 8) { b.vx = -(b.vx ?? 0); b.x = Math.max(8, Math.min(g.W - 8, b.x)) }
        }
        // THE DRIFT: bullets accelerate sideways over time
        if (b.drift && b.enemy) b.vx = (b.vx ?? 0) + b.drift
        // Near-miss spark: enemy bullet passed close to player without hitting
        if (b.enemy && !g.invuln && b.y > g.py - 2 && b.y <= g.py + 6) {
          const nearDx = Math.abs(b.x - g.px)
          if (nearDx >= 14 && nearDx < 34) {
            const missDir = b.x > g.px ? 1 : -1
            g.particles.push({ x: b.x, y: b.y, vx: missDir * 3 + (Math.random()-0.5), vy: -1.5 - Math.random(), life: 0.35, glyph: "·", col: b.col ?? "#f87171" })
            g.particles.push({ x: b.x, y: b.y, vx: missDir * 1.5, vy: -0.8, life: 0.25, glyph: "×", col: b.col ?? "#f87171" })
          }
        }
        if (b.cluster || b.kind === "turret") return b.y < GH + 10 && b.y > -10 && b.x > -10 && b.x < g.W + 10
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
          } else if (w.type !== "powerup" && !w.fragment && !g.invuln) {
            g.wordsEscaped++
            loseLife(g, now)
          }
          return false
        }
        return true
      })

      // background glyphs (speed up during boss; ramp pre-boss as threat builds)
      const preBossRamp = (!g.boss && !g.endless && !g.bossWarn)
        ? 1 + 0.65 * (g.wordsKilled / WORDS_TO_BOSS)
        : 1
      const bgSpeedMul = g.boss ? (g.boss.raged ? 3.5 : 2.0) : g.bossWarn ? 1.8 : preBossRamp
      g.bg.forEach(b => {
        b.y += b.vy * bgSpeedMul
        if (b.y > GH + 10) { b.y = -10; b.x = Math.random() * g.W }
      })

      // particles
      g.particles = g.particles.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy += (p.gravity ?? 0.14); p.life -= 0.022
        if (p.friction !== undefined) { p.vx *= p.friction; p.vy *= p.friction }
        if (p.rotV !== undefined) p.rot = (p.rot ?? 0) + p.rotV
        return p.life > 0
      })

      // CACHE: cached word respawns — data_staleness serves stale kills back from cache
      if (g.archiveCachedWords.length > 0) {
        const toRespawn = g.archiveCachedWords.filter(c => now >= c.respawnAt)
        if (toRespawn.length > 0) {
          g.archiveCachedWords = g.archiveCachedWords.filter(c => now < c.respawnAt)
          toRespawn.forEach(c => {
            if (g.words.length < MAX_WORDS_NORMAL + 2) {  // cap so it's not overwhelming
              const ox = 30 + Math.random() * (g.W - 60)
              g.words.push({ x: ox, y: -18, text: c.text, type: c.type,
                spd: (0.62 + g.level * 0.16) * 0.85, beh: "fall",
                ph: 0, ox, hp: 1, hitFlash: 0, elite: false, age: 0, id: g.nextWordId++ })
              g.particles.push({ x: ox, y: 10, vx: 0, vy: 0.4, life: 1.4,
                glyph: "SERVED FROM CACHE", col: "#94a3b8", sz: 9, gravity: 0 })
            }
          })
        }
      }

      // salvage item physics — drift upward slowly, despawn after life expires
      g.salvage = g.salvage.filter(s => {
        s.x += s.vx; s.y += s.vy
        s.vx *= 0.98  // slight horizontal drag
        s.vy = Math.max(s.vy, -0.3)  // terminal upward velocity
        return (now - s.spawnTime) < s.life
      })

      // Salvage auto-collect handled by crew AI interval

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
            // Marked targets take 2 HP per turret hit (bridged targeting bonus)
            const isTurretHit = b.kind === "turret"
            const isThisMarked = _stationState.markedTargetId !== null && w.id === _stationState.markedTargetId
            const hpDrain = (isTurretHit && isThisMarked) ? 2 : 1
            if (w.hp > 1) {
              // elite word takes a hit
              w.hp = Math.max(0, w.hp - hpDrain); w.hitFlash = 10; sfx.elite()
              spawnParticles(g, w.x, w.y, isThisMarked ? "#f87171" : "#f87171", "✦", isThisMarked ? 5 : 3)
              if (w.hp > 0) { if (g.upgrades.piercing) { break } else { continue outer } }
              // hp reached 0 via multi-drain — fall through to kill
            }
            // kill — push spawn timer forward so rapid kills create a breathing gap
            const elapsed = now - g.lastKill
            g.combo = elapsed < 1300 ? Math.min(g.combo + 1, MAX_COMBO) : 1
            g.lastKill = now
            // Each kill defers next spawn by 300ms so bursts create visible pauses
            g.lastWord = Math.max(g.lastWord, now - 100)
            // Per-kill chain pulse — brief edge flash confirms each link in the chain
            if (g.combo >= 2) {
              const pulseF = Math.min(14, 4 + Math.floor(g.combo * 0.55))
              if (g.accentFlash < pulseF) { g.accentFlash = pulseF; g.accentFlashCol = BOSSES[Math.min(g.level - 1, 3)].color }
            }
            if (g.combo === 3 || g.combo === 5 || g.combo === 10 || g.combo === 15 || g.combo === 20 || g.combo === 25 || g.combo === 30) {
              sfx.combo(g.combo)
              if (g.combo === 5)  { showCapyMsg(g, "Chain x5.\nSignal is resonating.", now); g.shake = 3 }
              if (g.combo === 10) { showCapyMsg(g, "Chain x10.\nThe noise breaks apart.", now); g.shake = 6; g.accentFlash = 14; g.accentFlashCol = "#fb923c" }
              if (g.combo === 15) { showCapyMsg(g, "Chain x15.\nCoherence: maximum.", now); g.shake = 9; g.accentFlash = 18; g.accentFlashCol = "#c4b5fd" }
              if (g.combo === 20) { showCapyMsg(g, "Chain x20.\nYou are the signal now.", now); g.shake = 14; g.accentFlash = 24; g.accentFlashCol = "#facc15" }
              if (g.combo === 25) {
                showCapyMsg(g, "Chain x25.\nThe noise has no hold here.", now)
                g.shake = 18; g.accentFlash = 28; g.accentFlashCol = "#facc15"
                for (let ri = 0; ri < 24; ri++) {
                  const a = (ri / 24) * Math.PI * 2
                  g.particles.push({ x: g.px, y: g.py, vx: Math.cos(a)*12, vy: Math.sin(a)*12, life: 1.2, glyph: "★", col: "#facc15" })
                }
              }
              if (g.combo === 30) {
                showCapyMsg(g, "Chain x30.\nYou ARE The Signal.", now)
                g.shake = 24; g.accentFlash = 32; g.accentFlashCol = "#facc15"
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
            // Bridge target marking bonus — +50% score, clear mark on kill
            const isMarked = _stationState.markedTargetId !== null && w.id === _stationState.markedTargetId
            if (isMarked) {
              _stationState.markedTargetId = null
              g.particles.push({ x: w.x, y: w.y - 16, vx: 0, vy: -1.1, life: 1.6,
                glyph: "TARGET ELIMINATED", col: "#f87171", sz: 10, gravity: 0 })
              g.accentFlash = 10; g.accentFlashCol = "#f87171"
              crewLog("CAPY", "Target eliminated", "kill")
              crewStat(g, "capy_assists")
            }
            const markedMul = isMarked ? 1.5 : 1
            const base = w.type === "bug" ? 75 : w.type === "powerup" ? 0 : 10
            const eliteMul = w.elite ? 3 : 1
            const mult = g.combo >= 3 ? 1 + (g.combo - 2) * 0.2 : 1
            // claude_pm scales: base +15% → lv2 +22% → lv3 +30%
            const pmLv = g.activeAgents.includes("claude_pm") ? 1 + (g.agentUpgrades.claude_pm ?? 0) : 0
            const pmMul = pmLv >= 3 ? 1.30 : pmLv >= 2 ? 1.22 : pmLv >= 1 ? 1.15 : 1
            // claude_data: +10% score per upgrade level (mercs don't have boss unlocks)
            const dataLv = g.activeAgents.includes("claude_data") ? 1 + (g.agentUpgrades.claude_data ?? 0) : 0
            const dataMul = 1 + dataLv * 0.10
            const pts = Math.floor(base * Math.pow(1.2, g.upgrades.score_mul ?? 0) * mult * eliteMul * pmMul * dataMul * markedMul)
            g.score += pts
            g.kills++; if (!w.fragment) g.wordsKilled++
            // Corruption on-kill effects
            if (g.archiveMode && !w.fragment && !w.regenBoss) {
              // SIGNAL_DUPLICATION: fork into 2 fragments moving apart
              if (g.archiveCorruption === "signal_duplication" && Math.random() < 0.35) {
                const half = Math.ceil(w.text.length / 2)
                const frag1 = w.text.slice(0, half), frag2 = w.text.slice(half) || w.text[0]
                const fragSpd = w.spd * 1.2
                if (frag1) g.words.push({ ...w, text: frag1, x: w.x - 18, hp: 1, hitFlash: 0, beh: "fall", spd: fragSpd, id: g.nextWordId++, age: 3, fragment: true })
                if (frag2) g.words.push({ ...w, text: frag2, x: w.x + 18, hp: 1, hitFlash: 0, beh: "fall", spd: fragSpd, id: g.nextWordId++, age: 3, fragment: true })
                g.particles.push({ x: w.x, y: w.y - 8, vx: 0, vy: -0.9, life: 1.0, glyph: "DUPLICATED", col: "#f472b6", sz: 9, gravity: 0 })
              }
              // DATA_STALENESS (CACHE): 30% of kills get cached and respawn in 3-4s
              if (g.archiveCorruption === "data_staleness" && !w.elite && Math.random() < 0.30) {
                g.archiveCachedWords.push({ text: w.text, type: w.type, respawnAt: now + 3000 + Math.random() * 1200 })
                g.particles.push({ x: w.x, y: w.y - 8, vx: 0, vy: -0.9, life: 1.1, glyph: "CACHED", col: "#94a3b8", sz: 9, gravity: 0 })
              }
              // RECURSIVE_COLLAPSE: each kill increases instability
              if (g.archiveCorruption === "recursive_collapse") {
                g.archiveInstability++
                if (g.archiveInstability % 10 === 0) {
                  const lvl = Math.min(3, Math.floor(g.archiveInstability / 10))
                  const col = ["","#facc15","#fb923c","#f87171"][lvl]
                  g.particles.push({ x: g.W/2, y: GH*0.38, vx: 0, vy: -0.5, life: 1.8,
                    glyph: `INSTABILITY +${lvl} — SYSTEM ACCELERATING`, col, sz: 9, gravity: 0 })
                  g.shake = 4 + lvl * 2
                }
              }
            }
            // Track crew kills by bullet color signature
            if (b.col === "#fbbf24") {
              crewStat(g, "veteran_kills"); if (w.elite) crewStat(g, "veteran_eliteKills")
              if (w.elite) crewLogForce("VETERAN", `Elite Eliminated: ${w.text.slice(0,8)}`, "kill")
            }
            if (b.col === "#86efac") { crewStat(g, "capy_assists") }
            applyArtifactOnKill(g, w, now)
            // Salvage drops — resources for the Salvage station
            if (w.type !== "powerup" && !w.fragment) {
              if (w.type === "bug")    spawnSalvage(g, w.x, w.y, "scrap",    now)
              if (w.elite)             spawnSalvage(g, w.x, w.y, "fragment", now)
              else if (w.type === "story" && Math.random() < 0.28) spawnSalvage(g, w.x, w.y, "scrap", now)
            }
            // Kill milestones — expedition checkpoints
            if ([10, 25, 50, 100].includes(g.kills)) {
              const sCol = sectorTheme(g.level).storyCol
              g.particles.push({ x: g.px, y: g.py - 28, vx: 0, vy: -0.7, life: 2.2, glyph: `${g.kills} PATTERNS RESOLVED`, col: sCol, sz: 11, gravity: 0 })
              g.accentFlash = 8; g.accentFlashCol = sCol
              tone(660, 0.1, 0.18); setTimeout(() => tone(880, 0.1, 0.22), 110)
            }
            // "one kill to boss" capy warning (non-endless only)
            if (!g.endless && !g.boss && g.wordsKilled === WORDS_TO_BOSS - 1) {
              const preBossMsgs: Record<number, string> = {
                1: "One loop left.\nTHE RECURSION surfaces.\nFind the exit condition.",
                2: "One anchor holds.\nTHE DRIFT is here.\nHold your meaning.",
                3: "One shard remains.\nTHE FRAGMENT breaks loose.\nContain it.",
                4: "One pattern left.\nTHE COLLAPSE is terminal.\nThis is what it's been building to.",
              }
              showCapyMsg(g, preBossMsgs[g.level] ?? `One pattern left.\n${BOSSES[Math.min(g.level-1,3)].name} incoming.`, now)
              sfx.warning()
            }
            // Sector midpoint — narrative beat at halfway through each sector
            if (!g.endless && !g.boss && g.wordsKilled === Math.floor(WORDS_TO_BOSS / 2)) {
              const midMsgs: Record<number, string> = {
                1: "Halfway through the loops.\nThe recursion is deepening.",
                2: "Six signals anchored.\nThe drift shifts its weight.",
                3: "Halfway.\nThe fragments are multiplying faster.",
                4: "Six signals silenced.\nThe collapse accelerates.",
              }
              const midMsg = midMsgs[g.level]
              if (midMsg) {
                showCapyMsg(g, midMsg, now)
                const sCol = BOSSES[Math.min(g.level - 1, 3)].color
                g.particles.push({ x: g.W/2, y: GH/2, vx: 0, vy: -0.45, life: 1.8, glyph: "· · ·", col: `${sCol}88`, sz: 11, gravity: 0 })
              }
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
            if (!g.firstKill || g.firstKillSector !== g.level) {
              g.firstKillSector = g.level
              if (!g.firstKill) {
                g.firstKill = true
                // Very first kill of the run — generic intro
                showCapyMsg(g, "First pattern dissolved.\nThe Signal is live.", now)
              } else if (!g.endless) {
                // First kill of each new sector — contextual sector greeting
                const sectorFirstKill: Record<number, string> = {
                  2: "First anchor holds.\nThe drift is real — resist it.",
                  3: "First shard captured.\nMore are coming. Stay whole.",
                  4: "First breach contained.\nThe collapse knows you're here.",
                }
                const sectorMsg = sectorFirstKill[g.level]
                if (sectorMsg) showCapyMsg(g, sectorMsg, now)
              }
            }
            const killStyle = b.kind === "spray" ? "spray" : b.kind === "homing" ? "homing" : "default"
            spawnLetterExplosion(g, w, pts, g.combo, killStyle)
            // impact ring — powerup gets triple cascading rings
            const ringCol = w.type === "bug" ? "#f97316" : w.type === "powerup" ? "#4ade80" : "#e2e8f0"
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
                g.words.push({ x: ox1, y: w.y, text: frag1, type: "bug", spd: fragSpd, beh: "zigzag", ph: 0, ox: ox1, hp: 1, hitFlash: 0, elite: false, age: 7, id: g.nextWordId++ })
              }
              if (frag2) {
                const ox2 = Math.min(g.W - 30, w.x + 22)
                g.words.push({ x: ox2, y: w.y, text: frag2, type: "bug", spd: fragSpd, beh: "zigzag", ph: Math.PI, ox: ox2, hp: 1, hitFlash: 0, elite: false, age: 7, id: g.nextWordId++ })
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
            bx.hitFlash = (bx.hitFlash ?? 0) + 5  // brief white flash on each hit
            g.bullets.splice(i, 1)
            sfx.bossHit()
            spawnParticles(g, bx.x + (Math.random()-0.5)*40, bx.y, bx.color, "✦", 4)
            // boss rage at 50% HP — sector-specific enrage ceremony
            if (!bx.halfTriggered && bx.hp <= bx.maxHp / 2) {
              bx.halfTriggered = true; bx.raged = true
              crewLogForce("CAPY", `${bx.name} Phase Shift — Threat Escalated`, "boss")
              g.shake = 18; g.redFlash = 12; g.whiteFlash = 6
              g.accentFlash = 20; g.accentFlashCol = "#f87171"
              for (let ri = 0; ri < 36; ri++) {
                const a = (ri / 36) * Math.PI * 2
                const spd = 6 + Math.random() * 10
                g.particles.push({ x: bx.x, y: bx.y, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd,
                  life: 0.7 + Math.random() * 0.4, glyph: ri % 3 === 0 ? "✦" : ri % 3 === 1 ? "×" : "·",
                  col: ri % 4 === 0 ? "#fbbf24" : ri % 4 === 1 ? "#f87171" : bx.color })
              }
              // 3 expanding rings
              for (let ri = 0; ri < 3; ri++)
                g.particles.push({ x: bx.x, y: bx.y, vx: 0, vy: 0, life: 0.9 - ri * 0.22, initLife: 0.9 - ri * 0.22, glyph: "", col: ri === 0 ? "#f87171" : ri === 1 ? bx.color : "#fbbf24", ring: true })
              g.particles.push({ x: bx.x, y: bx.y - 24, vx: 0, vy: -1.0, life: 2.2, glyph: "ESCALATING", col: "#f87171", sz: 13, gravity: 0 })
              const enrageLines: Record<string, string> = {
                "THE RECURSION":  "Recursion depth: maximum.\nNo exit condition remains.",
                "THE DRIFT":      "Semantic coherence: zero.\nThe drift is complete.",
                "THE FRAGMENT":   "Fragmentation: terminal.\nEvery shard has teeth now.",
                "THE COLLAPSE":   "This is what collapse looks like.\nThere is no sector after this.",
              }
              showCapyMsg(g, enrageLines[bx.name] ?? "Pattern is escalating.\nIt knows you're here.", now)
              g.bossNextTaunt = now + 4000  // force next taunt quickly after enrage
              sfx.rage()
            }
            // boss critical at 20% HP — red edge pulse, final push feeling
            if (bx.hp <= Math.floor(bx.maxHp * 0.2) && bx.hp > 0 && bx.raged) {
              g.redFlash = Math.max(g.redFlash, 2)
            }
            // boss 25% HP milestone — brief narrative beat, signals you're close
            if (!bx.quarterTriggered && bx.hp <= Math.floor(bx.maxHp * 0.25) && bx.hp > 0) {
              bx.quarterTriggered = true
              g.shake = 8; g.accentFlash = 12; g.accentFlashCol = bx.color
              for (let qi = 0; qi < 18; qi++) {
                const qa = (qi / 18) * Math.PI * 2
                g.particles.push({ x: bx.x, y: bx.y,
                  vx: Math.cos(qa) * (3 + Math.random() * 3.5), vy: Math.sin(qa) * (3 + Math.random() * 3.5) - 0.5,
                  life: 0.55 + Math.random() * 0.3,
                  glyph: qi % 3 === 0 ? "×" : "·", col: qi % 2 === 0 ? bx.color : "#f87171" })
              }
              g.particles.push({ x: bx.x, y: bx.y - 30, vx: 0, vy: -0.7, life: 1.9, glyph: "CRITICAL", col: "#f87171", sz: 12, gravity: 0 })
              const critLines: Record<string, string> = {
                "THE RECURSION": "Stack depth: critical.\nOne final loop remains.",
                "THE DRIFT":     "Semantic coherence: residual.\nThe drift is failing.",
                "THE FRAGMENT":  "Final shards scattering.\nClose the gap.",
                "THE COLLAPSE":  "The collapse is fracturing.\nYou are almost through.",
              }
              showCapyMsg(g, critLines[bx.name] ?? "Critical. Finish it.", now)
              // Boss critical — drops an artifact for Salvage
              spawnSalvage(g, bx.x, bx.y, "artifact", now)
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
                    spawnLetterExplosion(g, ww, 0, 1, "mine")
                    g.score += ww.type === "bug" ? 75 : 10
                    g.kills++; if (!ww.fragment) g.wordsKilled++; chain++
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
        g.shake = 32 + g.level * 4         // heavy sustained shake
        g.accentFlash = 70; g.accentFlashCol = bx.color  // ~1.2s of boss-color flash
        // Boss-specific death glyphs — each boss scatters its own identity
        const bossDeathGlyphs: Record<string, string[]> = {
          "THE RECURSION": ["⊗", "∞", "→", "⊗", "→", "∞"],
          "THE DRIFT":     ["~", "≈", "~", "∿", "≈", "~"],
          "THE FRAGMENT":  ["⌁", "⋈", "⌁", "·", "⋈", "⌁"],
          "THE COLLAPSE":  ["◈", "▽", "×", "◈", "▼", "×"],
        }
        const deathGlyphs = bossDeathGlyphs[bx.name] ?? ["✦", "×", "·", "★", "◇", "✦"]

        // Core burst — with boss-specific glyphs
        const burstCount = g.endless ? 45 : 70
        for (let bi = 0; bi < burstCount; bi++) {
          const a = (bi / burstCount) * Math.PI * 2
          const spd = 0.8 + Math.random() * 3.5
          g.particles.push({
            x: bx.x + (Math.random()-0.5) * 20, y: bx.y + (Math.random()-0.5) * 16,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 0.5,
            life: 0.6 + Math.random() * 0.5, glyph: deathGlyphs[bi % deathGlyphs.length],
            col: bi % 3 === 0 ? "#fbbf24" : bi % 3 === 1 ? bx.color : "#fde68a",
            rot: Math.random() * Math.PI * 2, rotV: (Math.random()-0.5) * 0.08,
            gravity: 0.04, friction: 0.97,
          })
        }
        // Four expanding rings — long-lived, staggered timing
        for (let ri = 0; ri < 4; ri++) {
          g.particles.push({ x: bx.x, y: bx.y, vx: 0, vy: 0,
            life: 1.1 - ri * 0.18, initLife: 1.1 - ri * 0.18,
            glyph: "", col: ri % 2 === 0 ? bx.color : "#fbbf24", ring: true })
        }
        // Boss name letters — slow cascade so they're visible for 2+ seconds
        // Boss sits at y≈70 (top), so letters spread outward+downward across screen
        bx.name.split("").forEach((ch, i2) => {
          const vx = (Math.random() - 0.5) * 5.0              // spread left/right
          const vy = (Math.random() - 0.5) * 2.0 + 0.8        // mostly downward drift
          const lf = 2.0 + Math.random() * 1.2                // 2.0–3.2 → 1.5–2.4 seconds visible
          g.particles.push({
            x: bx.x + (Math.random() - 0.5) * 56,            // spread across boss footprint
            y: bx.y + (Math.random() - 0.5) * 18,
            vx, vy,
            life: lf, initLife: lf,
            glyph: ch, col: bx.color,
            rot: (Math.random() - 0.5) * Math.PI * 2,
            rotV: (Math.random() - 0.5) * 0.10,              // gentle tumble — readable longer
            gravity: 0.03 + Math.random() * 0.04,            // 0.03–0.07 — graceful arc
            friction: 0.99,
          })
        })
        // Extra boss-emblem glyph burst from center — big and fleeting
        const emblem = (deathGlyphs[0])
        for (let ei = 0; ei < 8; ei++) {
          const ea = (ei / 8) * Math.PI * 2
          g.particles.push({ x: bx.x, y: bx.y, vx: Math.cos(ea) * (5 + Math.random()*5), vy: Math.sin(ea) * (5 + Math.random()*5) - 1,
            life: 0.9 + Math.random() * 0.4, glyph: emblem, col: bx.color,
            rot: Math.random() * Math.PI * 2, rotV: (Math.random()-0.5) * 0.12,
            gravity: 0.025, friction: 0.96 })
        }
        // Record boss defeat for persistent Signal
        if (!g.defeatedBosses.includes(bx.name)) g.defeatedBosses.push(bx.name)
        g.boss = null; g.mines = [] // clear mines on boss death
        if (g.endless) {
          sfx.miniBoss()
          if (bx.name === "THE VOID") {
            // THE VOID death — special treatment
            g.score += 750; g.accentFlash = 24; g.accentFlashCol = "#a855f7"; g.shake = 24
            // implosion particle burst in void purple
            for (let vi = 0; vi < 40; vi++) {
              const a = (vi / 40) * Math.PI * 2
              const spd = 1.2 + Math.random() * 2.5
              const lf = 0.65 + Math.random() * 0.35
              g.particles.push({ x: bx.x, y: bx.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                life: lf, initLife: lf, glyph: vi % 3 === 0 ? "∅" : vi % 3 === 1 ? "◈" : "★",
                col: vi % 2 === 0 ? "#6d28d9" : "#a855f7",
                rot: Math.random() * Math.PI * 2, rotV: (Math.random()-0.5) * 0.04,
                gravity: 0.018, friction: 0.97 })
            }
            g.particles.push({ x: bx.x, y: bx.y - 22, vx: 0, vy: -0.5, life: 2.5, glyph: "THE VOID · COLLAPSED", col: "#a855f7", sz: 11, gravity: 0 })
            g.particles.push({ x: bx.x, y: bx.y + 8,  vx: 0, vy: -0.35, life: 2.2, glyph: "+750", col: "#facc15", sz: 12, gravity: 0 })
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
          g.words.push({ x: bx.x, y: Math.min(bx.y + 55, GH - 80), text: "KNOWLEDGE", type: "powerup", spd: 0.85, beh: "fall", ph: 0, ox: bx.x, hp: 1, hitFlash: 0, elite: false, age: 7, id: g.nextWordId++ })
        } else {
          const noReg = g.lives >= g.livesAtWave
          g.score += 500
          if (noReg) {
            g.score += 300
            g.particles.push({ x: bx.x, y: bx.y - 35, vx: 0, vy: -0.8, life: 2.0, glyph: "no regressions +300", col: "#4ade80", sz: 10 })
            if (!g.archiveMode) showCapyMsg(g, "Signal intact.\nNo corruption.", now)
          }
          const lvl = g.level
          if (!g.archiveMode) {
            g.level++  // only increment level in linear mode
            const agentUnlocks: Record<number, string[]> = { 1: ["claude_pm"], 2: ["claude_qa"], 3: ["claude_eng"], 4: ["claude_design", "claude_infra"] }
            ;(agentUnlocks[lvl] ?? []).forEach(id => unlockAgentRef.current(id))
          } else {
            // Archive mode: mark node complete, queue return to archive
            if (g.archiveNodeId) {
              completeArchiveNodeRef.current(g.archiveNodeId)
              g.defeatedBosses.push(bx.name)
            }
          }
          // Sector complete: clear remaining noise
          g.words.forEach(w => spawnLetterExplosion(g, w, 0, 1))
          g.score += g.words.length * 20
          g.words = []
          g.bullets = g.bullets.filter(b => !b.enemy) // purge enemy bullets
          g.mines = []
          if (lvl === 4) {
            // THE COLLAPSE — final sector cleared. Legendary ceremony.
            g.shake = 36; g.accentFlash = 32; g.accentFlashCol = "#4ade80"
            for (let ri = 0; ri < 100; ri++) {
              const ra = Math.random() * Math.PI * 2, rr = Math.random() * 180
              const spd = 0.8 + Math.random() * 2.0
              const lf = 0.7 + Math.random() * 0.4
              g.particles.push({ x: g.W/2 + Math.cos(ra)*rr, y: GH/2 + Math.sin(ra)*rr,
                vx: Math.cos(ra)*spd, vy: Math.sin(ra)*spd,
                life: lf, initLife: lf,
                glyph: Math.random()<0.33?"★":Math.random()<0.5?"◇":"◈",
                col: Math.random()<0.4?"#4ade80":Math.random()<0.5?"#966bec":"#facc15",
                rot: Math.random()*Math.PI*2, rotV: (Math.random()-0.5)*0.03,
                gravity: 0.015, friction: 0.97 })
            }
            for (let ri = 0; ri < 3; ri++) {
              g.particles.push({ x: g.W/2, y: GH/2, vx: 0, vy: 0, life: 0.9 - ri * 0.18, initLife: 0.9 - ri * 0.18, glyph: "", col: ri === 0 ? "#4ade80" : ri === 1 ? "#966bec" : "#facc15", ring: true })
            }
            g.particles.push({ x: g.W/2, y: GH/2 - 22, vx: 0, vy: -0.4, life: 4.0, glyph: "THE SIGNAL PERSISTS", col: "#4ade80", sz: 22, gravity: 0 })
            g.particles.push({ x: g.W/2, y: GH/2 + 8, vx: 0, vy: -0.28, life: 3.5, glyph: "INFINITE RECURSION UNLOCKED", col: "#966bec", sz: 11, gravity: 0 })
            g.particles.push({ x: g.W/2, y: GH/2 + 26, vx: 0, vy: -0.25, life: 3.0, glyph: "+500 COLLAPSE RESOLVED", col: "#facc15", sz: 12 })
            if (noReg) g.particles.push({ x: g.W/2, y: GH/2 + 42, vx: 0, vy: -0.2, life: 2.5, glyph: "NO REGRESSIONS  +300", col: "#4ade80", sz: 11 })
            showCapyMsg(g, "All collapses survived.\nThe Signal persists.\nInfinite recursion begins.", now)
            setTimeout(() => sfx.bossDead(), 300)
            setTimeout(() => sfx.bossDead(), 650)
            setTimeout(() => sfx.bossDead(), 1050)
            g.sectorClearAt = now + 4500
          } else {
            // Sector 1-3 clear: dramatic ceremony scaled by sector
            const sectorNames = ["", "SECTOR 1 · CLEAR", "SECTOR 2 · CLEAR", "SECTOR 3 · CLEAR"]
            g.accentFlash = 16 + lvl * 5; g.accentFlashCol = bx.color; g.shake = 14 + lvl * 4
            const clearCol = bx.color
            const particleCount = 32 + lvl * 12
            for (let ci = 0; ci < particleCount; ci++) {
              const a = Math.random() * Math.PI * 2
              const spd = 0.6 + Math.random() * 1.8
              const lf = 0.7 + Math.random() * 0.4
              g.particles.push({ x: bx.x, y: bx.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                life: lf, initLife: lf, glyph: ci % 3 === 0 ? "★" : ci % 3 === 1 ? "◇" : "◈",
                col: ci % 4 === 0 ? "#966bec" : ci % 4 === 1 ? "#facc15" : clearCol,
                rot: Math.random() * Math.PI * 2, rotV: (Math.random()-0.5) * 0.04,
                gravity: 0.018, friction: 0.97 })
            }
            // Radial rings — longer lasting
            for (let ri = 0; ri < 2; ri++) {
              g.particles.push({ x: bx.x, y: bx.y, vx: 0, vy: 0, life: 1.4 - ri * 0.4, initLife: 1.4 - ri * 0.4, glyph: "", col: ri === 0 ? clearCol : "#fbbf24", ring: true })
            }
            // Clear text — archive-aware
            const clearGlyph = g.archiveMode
              ? `${SIGNAL_ARCHIVE_E1.find(n=>n.id===g.archiveNodeId)?.name ?? "SYSTEM"} · SEVERED`
              : (sectorNames[lvl] ?? "")
            g.particles.push({ x: g.W/2, y: GH/2 - 18, vx: 0, vy: -0.32, life: 3.8, glyph: clearGlyph, col: clearCol, sz: g.archiveMode ? 14 : 20, gravity: 0 })
            g.particles.push({ x: g.W/2, y: GH/2 + 10, vx: 0, vy: -0.22, life: 3.2, glyph: `${bx.name} · SEVERED`, col: "#facc15", sz: 12, gravity: 0 })
            if (noReg) g.particles.push({ x: g.W/2, y: GH/2 + 26, vx: 0, vy: -0.16, life: 2.8, glyph: "NO REGRESSIONS  +800", col: "#4ade80", sz: 11, gravity: 0 })
            if (!g.archiveMode) {
              const nextSector = lvl + 1
              const nextBoss = BOSSES[nextSector - 1]
              if (nextBoss) {
                g.particles.push({ x: g.W/2, y: GH/2 + (noReg ? 42 : 26), vx: 0, vy: -0.12, life: 2.6, glyph: `▸ SECTOR ${nextSector} · ${nextBoss.name}`, col: "rgba(200,180,255,0.7)", sz: 10, gravity: 0 })
              }
            } else {
              g.particles.push({ x: g.W/2, y: GH/2 + (noReg ? 42 : 26), vx: 0, vy: -0.12, life: 2.6, glyph: "▸ RETURN TO SIGNAL ARCHIVE", col: "rgba(200,180,255,0.7)", sz: 10, gravity: 0 })
            }
            // Extra boss dead fanfare for later sectors
            if (lvl >= 2) setTimeout(() => sfx.bossDead(), 350)
            if (lvl >= 3) setTimeout(() => sfx.bossDead(), 700)
            g.sectorClearAt = now + 3500
          }
          setLevel(g.level); setScore(g.score); setLives(g.lives)
          // Capy dialog: archive uses generic "system cleared" message
          pendingCapyRef.current = g.archiveMode
            ? [`${SIGNAL_ARCHIVE_E1.find(n=>n.id===g.archiveNodeId)?.name ?? "SYSTEM"} · SEVERED.\n\nThe pattern has been resolved.\nSignal integrity: restored.\n\nReturn to the Archive.`]
            : (CAPY_DIALOG[lvl - 1] || ["You made it.", "Keep shipping."])
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
            } else {
              loseLife(g, now)
              // Room damage — boss bullet hit has 35% chance to damage a random station room
              if (g.boss && Math.random() < 0.35) {
                const rooms: StationId[] = ["bridge", "turret", "salvage", "engineering"]
                const room = rooms[Math.floor(Math.random() * rooms.length)]
                const cur = g.roomDamage[room] ?? 0
                if (cur < 3) {
                  const newDmg = cur + 1
                  g.roomDamage[room] = newDmg
                  g.particles.push({ x: g.px, y: g.py - 28, vx: 0, vy: -0.9, life: 1.8,
                    glyph: `${room.toUpperCase()} DAMAGED`, col: "#f87171", sz: 9, gravity: 0 })
                  if (newDmg === 3) crewLogForce("ENGINEER", `${room.toUpperCase()} OFFLINE`, "offline")
                }
              }
            }
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

      // endless life regen (claude_infra scales: base 4k → lv2 3k → lv3 2k)
      const infraLv = g.activeAgents.includes("claude_infra") ? 1 + (g.agentUpgrades.claude_infra ?? 0) : 0
      const infraStep = infraLv >= 3 ? 2000 : infraLv >= 2 ? 3000 : infraLv >= 1 ? 4000 : 5000
      if (g.endless && g.score >= infraStep) {
        const lifeStep = infraStep
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
      // Kill all words in beam column, each counting toward combo
      let beamKills = 0
      for (let wi = g.words.length - 1; wi >= 0; wi--) {
        const w = g.words[wi]
        if (Math.abs(w.x - col) < blastW) {
          g.combo = Math.min(g.combo + 1, MAX_COMBO)
          g.lastKill = now
          const mult = g.combo >= 3 ? 1 + (g.combo - 2) * 0.2 : 1
          const pmLv = g.activeAgents.includes("claude_pm") ? 1 + (g.agentUpgrades.claude_pm ?? 0) : 0
          const pmMul = pmLv >= 3 ? 1.30 : pmLv >= 2 ? 1.22 : pmLv >= 1 ? 1.15 : 1
          const pts = Math.floor((w.type === "bug" ? 75 : 10) * mult * pmMul)
          spawnLetterExplosion(g, w, pts, g.combo, "laser")
          g.score += pts
          g.kills++; if (!w.fragment) g.wordsKilled++; beamKills++
          g.words.splice(wi, 1)
        }
      }
      // Boss damage if in column
      if (g.boss && Math.abs(g.boss.x - col) < 54) {
        g.boss.hp -= bossDmg
        spawnParticles(g, g.boss.x, g.boss.y, "#e879f9", "★", 8)
        sfx.bossHit()
        if (!g.boss.halfTriggered && g.boss.hp <= g.boss.maxHp / 2) {
          const bx2 = g.boss
          bx2.halfTriggered = true; bx2.raged = true
          g.shake = 18; g.redFlash = 12; g.whiteFlash = 6
          g.accentFlash = 20; g.accentFlashCol = "#f87171"
          for (let ri = 0; ri < 36; ri++) {
            const a = (ri / 36) * Math.PI * 2
            const spd = 6 + Math.random() * 10
            g.particles.push({ x: bx2.x, y: bx2.y, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd, life: 0.7 + Math.random() * 0.4, glyph: ri % 3 === 0 ? "✦" : "×", col: ri % 4 === 0 ? "#fbbf24" : bx2.color })
          }
          for (let ri = 0; ri < 3; ri++)
            g.particles.push({ x: bx2.x, y: bx2.y, vx: 0, vy: 0, life: 0.9 - ri * 0.22, initLife: 0.9 - ri * 0.22, glyph: "", col: ri === 0 ? "#f87171" : bx2.color, ring: true })
          g.particles.push({ x: bx2.x, y: bx2.y - 24, vx: 0, vy: -1.0, life: 2.2, glyph: "ESCALATING", col: "#f87171", sz: 13, gravity: 0 })
          const enrageLines2: Record<string, string> = {
            "THE RECURSION":  "Recursion depth: maximum.\nNo exit condition remains.",
            "THE DRIFT":      "Semantic coherence: zero.\nThe drift is complete.",
            "THE FRAGMENT":   "Fragmentation: terminal.\nEvery shard has teeth now.",
            "THE COLLAPSE":   "This is what collapse looks like.\nThere is no sector after this.",
          }
          showCapyMsg(g, enrageLines2[bx2.name] ?? "Pattern is escalating.\nIt knows you're here.", now)
          g.bossNextTaunt = now + 4000
          sfx.rage()
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
      // Artifact absorption check (hardened_bulkheads, reactive_armor)
      if (applyArtifactOnDamage(g, now)) return  // damage absorbed
      // claude_exec: revive once per sector before losing a life
      if (g.activeAgents.includes("claude_exec") && !g.agentSectorRevived && g.lives <= 1) {
        g.agentSectorRevived = true
        g.shake = 18; g.whiteFlash = 20; g.invuln = true; g.invulnEnd = now + 2500
        g.particles.push({ x: g.px, y: g.py, vx: 0, vy: 0, life: 0.9, initLife: 0.9, glyph: "", col: "#a78bfa", ring: true })
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * Math.PI * 2
          g.particles.push({ x: g.px, y: g.py, vx: Math.cos(a)*6, vy: Math.sin(a)*6, life: 1.0, glyph: "✦", col: "#a78bfa" })
        }
        showCapyMsg(g, "EXEC override.\nSignal preserved.\nLast stand.", now)
        sfx.shield()
        return
      }
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
      // During boss fight: acknowledge the specific threat that hit you
      const bossHitLines: Record<string, string[]> = {
        "THE RECURSION": [
          "The loop found you.\nStep outside the stack.",
          "Recursive hit.\nFind the exit condition.",
          g.lives === 1 ? "Last signal.\nEnd the loop now." : "Loop damage.\nBreak the cycle.",
        ],
        "THE DRIFT":     [
          "Drift pattern\npenetrated the carrier.",
          "Semantic leak.\nHold your meaning.",
          g.lives === 1 ? "Barely coherent.\nFinish this." : "Drift damage.\nReanchor.",
        ],
        "THE FRAGMENT":  [
          "A shard got through.\nClose the pattern.",
          "Fragment impact.\nReintegrate.",
          g.lives === 1 ? "One carrier left.\nResolve every shard." : "Fragmentation hit.\nRecover.",
        ],
        "THE COLLAPSE":  [
          "The collapse pressed forward.\nHold the line.",
          "Terminal damage.\nYou're almost through.",
          g.lives === 1 ? "One signal remains.\nOutlast the collapse." : "Collapse damage.\nStay coherent.",
        ],
      }
      const bossSpecificLines = g.boss ? bossHitLines[g.boss.name] : null
      const chosenHitMsg = bossSpecificLines
        ? bossSpecificLines[Math.floor(Math.random() * bossSpecificLines.length)]
        : hitLines[Math.floor(Math.random() * hitLines.length)]
      showCapyMsg(g, chosenHitMsg, now)
      // burst ring + radial × scatter
      g.particles.push({ x: g.px, y: g.py, vx: 0, vy: 0, life: 0.7, initLife: 0.7, glyph: "", col: "#f87171", ring: true })
      g.particles.push({ x: g.px, y: g.py, vx: 0, vy: 0, life: 0.45, initLife: 0.45, glyph: "", col: "#fca5a5", ring: true })
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2
        g.particles.push({ x: g.px, y: g.py, vx: Math.cos(a) * (4 + Math.random()*6), vy: Math.sin(a) * (4 + Math.random()*6) - 1, life: 0.8 + Math.random()*0.4, glyph: i % 3 === 0 ? "×" : "·", col: i % 3 === 0 ? "#f87171" : "#fca5a5" })
      }
      if (g.lives <= 0) {
        // Signal Lost ceremony — big screen-wide burst before transitioning
        const deathCol = g.boss ? g.boss.color : (g.endless ? "#a855f7" : BOSSES[Math.min(g.level - 1, BOSSES.length - 1)].color)
        g.shake = 28; g.redFlash = 28; g.whiteFlash = 8
        g.accentFlash = 50; g.accentFlashCol = deathCol
        // radial debris from player
        for (let di = 0; di < 40; di++) {
          const da = (di / 40) * Math.PI * 2
          const spd = 2.5 + Math.random() * 5
          g.particles.push({ x: g.px, y: g.py,
            vx: Math.cos(da) * spd, vy: Math.sin(da) * spd - 1.2,
            life: 1.2 + Math.random() * 0.6,
            glyph: di % 5 === 0 ? "✦" : di % 5 === 1 ? "×" : di % 5 === 2 ? "·" : di % 5 === 3 ? "◈" : "★",
            col: di % 3 === 0 ? "#f87171" : di % 3 === 1 ? deathCol : "#fbbf24",
            rot: Math.random() * Math.PI * 2, rotV: (Math.random()-0.5) * 0.1,
            gravity: 0.03, friction: 0.97 })
        }
        // 3 expanding rings from player
        for (let ri = 0; ri < 3; ri++)
          g.particles.push({ x: g.px, y: g.py, vx: 0, vy: 0,
            life: 0.8 - ri * 0.2, initLife: 0.8 - ri * 0.2, glyph: "", col: ri === 0 ? "#f87171" : ri === 1 ? deathCol : "#fbbf24", ring: true })
        // "SIGNAL LOST" floats up from player
        g.particles.push({ x: g.px, y: g.py - 20, vx: 0, vy: -0.9, life: 2.0,
          glyph: "SIGNAL LOST", col: "#f87171", sz: 16, gravity: 0 })
        g.running = false; g.deathFadeAt = now + 1400; stopDrone()
        setScore(g.score); setLevel(g.level)
        // Merge this run into the persistent Signal (including archive node completions)
        updateSignalRef.current({
          fragmentsEarned:       g.fragmentsEarned,
          defeatedBosses:        g.defeatedBosses,
          crewStats:             { ...g.crewStats },
          crewAssign:            getCrewAssignments(),
          completedArchiveNodes: g.archiveMode && g.archiveNodeId ? [g.archiveNodeId] : [],
        })
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
        // Save sector PB for non-endless runs
        if (!g.endless) {
          try {
            const spb = parseInt(localStorage.getItem("sb_sector_pb") || "0")
            if (g.level > spb) { localStorage.setItem("sb_sector_pb", String(g.level)); setPersonalSectorBest(g.level) }
          } catch {}
        }
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
          <h1 style={{ fontSize:"1.4rem", fontWeight:"bold", color:"#966bec", letterSpacing:"0.15em", fontFamily:"monospace", margin:0 }}>THE SIGNAL</h1>
        </div>
        <div ref={wrapRef} style={{ position:"relative", width:"100%", borderRadius:"6px", overflow:"hidden", border:"1px solid rgba(255,255,255,0.08)" }}>

          {phase === "attract" && (
            <Overlay onClick={() => { phaseRef.current = "archive"; setPhase("archive") }} dim={0.92}>
              <div style={{
                background:"#0c0c16", border:"1px solid rgba(150,107,236,0.28)",
                borderRadius:"10px", padding:"1.6rem 1.5rem",
                maxWidth:"300px", width:"calc(100% - 2rem)",
                boxShadow:"0 0 40px rgba(100,60,200,0.18)",
                display:"flex", flexDirection:"column", gap:"0",
              }}>

                {/* ── Signal identity — primary ── */}
                <div style={{ textAlign:"center", marginBottom:"1rem" }}>
                  <p style={{ color:"rgba(196,181,253,0.35)", fontSize:"0.5rem", margin:"0 0 0.25rem", fontFamily:"monospace", letterSpacing:"0.25em" }}>
                    CARRYING THE SIGNAL
                  </p>
                  <p style={{ color:"#c4b5fd", fontSize:"1.4rem", fontWeight:700, letterSpacing:"0.18em", margin:"0 0 0.5rem", fontFamily:"monospace" }}>
                    THE SIGNAL
                  </p>
                  {/* Signal stats — show if Signal has history, placeholder if new */}
                  {signal.operationalAge > 0 ? (
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.3rem", marginBottom:"0.15rem" }}>
                      {[
                        ["OPERATIONAL AGE", `${signal.operationalAge} runs`],
                        ["RECOVERED INTENT", signal.recoveredIntent.toLocaleString()],
                        ["ARCHIVE", `${signalArchiveCompletion(signal)}%`],
                        ["OPERATORS", signal.operatorsEver.length],
                      ].map(([label, val]) => (
                        <div key={label as string} style={{ background:"rgba(150,107,236,0.05)", borderRadius:"3px", padding:"0.28rem 0.4rem" }}>
                          <p style={{ color:"rgba(255,255,255,0.6)", fontSize:"0.7rem", fontWeight:600, margin:"0 0 0.06rem", fontFamily:"monospace" }}>{val}</p>
                          <p style={{ color:"rgba(196,181,253,0.35)", fontSize:"0.46rem", margin:0, fontFamily:"monospace", letterSpacing:"0.08em" }}>{label}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.56rem", fontFamily:"monospace", fontStyle:"italic", margin:0 }}>
                      Signal not yet initialized
                    </p>
                  )}
                </div>

                {/* ── Launch button — goes to Archive ── */}
                <button onClick={() => { phaseRef.current = "archive"; setPhase("archive") }} style={{
                  width:"100%", background:"linear-gradient(135deg,#7c3aed,#6d28d9)",
                  color:"#fff", border:"none", borderRadius:"7px",
                  padding:"0.85rem", fontSize:"0.9rem", fontWeight:700,
                  letterSpacing:"0.13em", cursor:"pointer", fontFamily:"monospace",
                  marginBottom:"1rem",
                  boxShadow:"0 0 28px rgba(124,58,237,0.5)",
                }}>
                  ENTER SIGNAL ARCHIVE
                </button>

                {/* ── Crew ── */}
                {(() => {
                  const deployed = [...AGENT_DEFS, ...MERC_AGENTS].filter(a => selectedAgents.includes(a.id) && unlockedAgents.includes(a.id))
                  return (
                    <div style={{ marginBottom:"1rem" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.45rem" }}>
                        <span style={{ color:"rgba(196,181,253,0.65)", fontSize:"0.6rem", fontFamily:"monospace", letterSpacing:"0.12em", fontWeight:600 }}>CREW</span>
                        <div style={{ flex:1, height:"1px", background:"rgba(150,107,236,0.15)" }} />
                        <button onClick={e => { e.stopPropagation(); setShowAgentModule(true) }}
                          style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(150,107,236,0.8)", fontSize:"0.6rem", fontFamily:"monospace", padding:0 }}>
                          manage →
                        </button>
                      </div>
                      {unlockedAgents.length === 0 ? (
                        <p style={{ color:"rgba(160,159,162,0.55)", fontSize:"0.62rem", fontFamily:"monospace", margin:0 }}>
                          No agents yet — survive sector 1 to recruit crew.
                        </p>
                      ) : deployed.length === 0 ? (
                        <p style={{ color:"rgba(248,113,113,0.65)", fontSize:"0.62rem", fontFamily:"monospace", margin:0 }}>
                          No crew active — tap manage to assign agents.
                        </p>
                      ) : (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem" }}>
                          {deployed.map(a => {
                            const upLv = agentUpgrades[a.id] ?? 0
                            return (
                              <span key={a.id} style={{
                                background:"rgba(74,222,128,0.09)", border:"1px solid rgba(74,222,128,0.32)",
                                borderRadius:"4px", padding:"0.2rem 0.5rem",
                                color:"rgba(74,222,128,0.92)", fontSize:"0.62rem", fontFamily:"monospace",
                              }}>
                                {agentNames[a.id] ?? a.name}
                                {upLv > 0 && <span style={{ color:"rgba(74,222,128,0.45)", fontSize:"0.55rem" }}> lv{upLv+1}</span>}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* ── Controls ── */}
                <p style={{ color:"rgba(160,159,162,0.55)", fontSize:"0.58rem", fontFamily:"monospace", margin:"0 0 0.9rem", textAlign:"center", lineHeight:1.6 }}>
                  <span style={{ color:"rgba(150,107,236,0.8)" }}>WASD</span> move&nbsp;&nbsp;
                  <span style={{ color:"rgba(150,107,236,0.8)" }}>SPACE</span> shoot&nbsp;&nbsp;
                  <span style={{ color:"rgba(150,107,236,0.8)" }}>hold</span> laser&nbsp;&nbsp;
                  <span style={{ color:"rgba(150,107,236,0.8)" }}>M</span> mine
                </p>

                {/* ── Best run — depth first ── */}
                {(personalDepthBest >= 1 || personalSectorBest > 0 || personalBest > 0) && (
                  <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:"0.65rem" }}>
                    <p style={{ color:"rgba(160,159,162,0.4)", fontSize:"0.54rem", fontFamily:"monospace", margin:"0 0 0.3rem", letterSpacing:"0.12em", textAlign:"center" }}>BEST RUN</p>
                    <div style={{ display:"flex", gap:"0.9rem", justifyContent:"center", flexWrap:"wrap" }}>
                      {personalDepthBest >= 1 ? (
                        <span style={{ color: personalDepthBest >= 5 ? "rgba(168,85,247,0.85)" : "rgba(196,181,253,0.75)", fontSize:"0.63rem", fontFamily:"monospace" }}>
                          THE VOID · DEPTH {personalDepthBest}{personalDepthBest >= 9 ? " ∞" : ""}
                        </span>
                      ) : personalSectorBest > 0 ? (
                        <span style={{ color:"rgba(196,181,253,0.7)", fontSize:"0.63rem", fontFamily:"monospace" }}>
                          SECTOR {personalSectorBest} reached
                        </span>
                      ) : null}
                      {personalBest > 0 && (
                        <span style={{ color:"rgba(160,159,162,0.45)", fontSize:"0.58rem", fontFamily:"monospace" }}>
                          {personalBest.toLocaleString()} pts
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {/* Fragment bank — persistent meta-currency */}
                {fragmentBank > 0 && (
                  <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:"0.55rem", textAlign:"center" }}>
                    <span style={{ color:"rgba(196,181,253,0.5)", fontSize:"0.52rem", fontFamily:"monospace", letterSpacing:"0.1em" }}>
                      ◈ {fragmentBank} SIGNAL FRAGMENTS banked
                    </span>
                  </div>
                )}

                {/* Signal Archive teaser */}
                <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:"0.55rem" }}>
                  <p style={{ color:"rgba(150,107,236,0.35)", fontSize:"0.5rem", fontFamily:"monospace",
                    letterSpacing:"0.15em", margin:"0 0 0.2rem", textAlign:"center" }}>
                    SIGNAL ARCHIVE · EPOCH 1
                  </p>
                  <p style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.52rem", fontFamily:"monospace",
                    margin:0, textAlign:"center", fontStyle:"italic" }}>
                    9 failing systems · Choose your path
                  </p>
                  <p style={{ color:"rgba(150,107,236,0.25)", fontSize:"0.48rem", fontFamily:"monospace",
                    margin:"0.15rem 0 0", textAlign:"center" }}>
                    TAB → Command Mode → Signal Archive
                  </p>
                </div>

              </div>
            </Overlay>
          )}

          {phase === "archive" && !epochCompleteData && (
            <ArchiveScreen
              signal={signal}
              lastCompletedNodeId={lastCompletedNodeId}
              onSelectNode={(nodeId) => {
                setLastCompletedNodeId(null)  // clear after player acts on the context
                setArchiveSelectedNode(nodeId)
                phaseRef.current = "briefing"; setPhase("briefing")
              }}
            />
          )}

          {phase === "archive" && epochCompleteData && (
            <EpochCompleteScreen
              signal={signal}
              fragmentsGained={epochCompleteData.fragmentsGained}
              newAge={epochCompleteData.newAge}
              onContinue={() => {
                setEpochCompleteData(null)
                setLastCompletedNodeId(null)
                phaseRef.current = "attract"; setPhase("attract")
              }}
            />
          )}

          {phase === "briefing" && archiveSelectedNode && (
            <BriefingScreen
              nodeId={archiveSelectedNode}
              signal={signal}
              onLaunch={() => startExpedition(archiveSelectedNode)}
              onBack={() => { phaseRef.current = "archive"; setPhase("archive") }}
            />
          )}

          {phase === "reward" && (
            <RewardScreen
              options={rewardOptions}
              level={level}
              onPick={onRewardPick}
              artifacts={G.current.artifacts}
            />
          )}

          {phase === "recovery" && currentRecovery && (
            <RecoveryScreen
              def={currentRecovery.def}
              signal={signal}
              onContinue={onRecoveryComplete}
            />
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

          {phase === "upgrade" && <CLIScreen
            options={upgradeOptions}
            onPick={onUpgradePick}
            score={score}
            kills={G.current.kills}
            level={level}
            endless={G.current.endless}
            endlessDepth={G.current.endlessWave}
            onReroll={() => pickUpgrades(G.current.upgrades)}
            crew={{ unlocked: unlockedAgents, selected: selectedAgents, upgrades: agentUpgrades, names: agentNames }}
            onAgentHire={(id) => {
              setUnlockedAgents(prev => {
                const next = prev.includes(id) ? prev : [...prev, id]
                try { localStorage.setItem("sb_agents", next.join(",")) } catch {}
                return next
              })
              setSelectedAgents(prev => {
                const next = prev.includes(id) ? prev : [...prev, id]
                try { localStorage.setItem("sb_selected_agents", next.join(",")) } catch {}
                return next
              })
              // Also apply to current game immediately
              if (!G.current.activeAgents.includes(id)) G.current.activeAgents.push(id)
            }}
            onAgentUpgrade={(id) => {
              setAgentUpgrades(prev => {
                const next = { ...prev, [id]: (prev[id] ?? 0) + 1 }
                try { localStorage.setItem("sb_agent_upgrades", JSON.stringify(next)) } catch {}
                // Apply to current game immediately
                G.current.agentUpgrades = { ...next }
                return next
              })
            }}
            onAgentRename={(id, name) => {
              setAgentNames(prev => {
                const next = { ...prev, [id]: name }
                try { localStorage.setItem("sb_agent_names", JSON.stringify(next)) } catch {}
                return next
              })
            }}
          />}

          {phase === "over" && <GameOver score={score} level={level} kills={G.current.kills} maxCombo={G.current.maxCombo} upgradeCount={Object.keys(G.current.upgrades).length} shotsFired={G.current.shotsFired} isNewPB={score > 0 && score >= personalBest} isNewSectorPB={!G.current.endless && level >= personalSectorBest} onRestart={startGame} unlockedAgents={unlockedAgents} onShowStack={() => setShowAgentModule(true)} endless={G.current.endless} endlessDepth={G.current.endlessWave} prevDepthBest={personalDepthBest} upgrades={G.current.upgrades} persistentSignal={signal} fragmentsEarned={G.current.fragmentsEarned} />}

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

          {/* Command Mode Overlay */}
          {commandMode && (
            <CommandModeOverlay
              g={G.current}
              level={level}
              score={score}
              lives={lives}
              liveG={liveG}
              crewStats={crewStatsSnap}
              persistentSignal={signal}
              onResume={() => { setCommandMode(false); G.current.paused = false }}
            />
          )}
        </div>
        {/* ── Ship Station Row ─────────────────────────────────────────────── */}
        <div style={{ display:"flex", gap:"0.5rem", marginTop:"0.5rem", alignItems:"stretch" }}>
          <ShipStatusPanel
            hull={{ maxHull: MAX_LIVES, currentHull: lives }}
            stations={STATION_DEFS}
            activeStation={activeStation}
            onSelectStation={(sid) => { _stationState.active = sid; setActiveStation(sid) }}
            liveG={liveG}
            unlockedAgents={unlockedAgents}
            agentNames={agentNames}
            roomDamage={liveG.roomDamage}
            roomActions={roomActionsSnap}
            crewStats={crewStatsSnap}
          />
          <ActiveStationPanel
            activeStation={activeStation}
            lives={lives}
            score={score}
            level={level}
            phase={phase}
            liveG={liveG}
            onTurretFire={onTurretFire}
            onGrapple={onGrapple}
          />
          <OperationsFeed
            entries={opsFeed}
            operatorStatus={liveG.operatorStatus}
            crewAssign={(() => { try { const s = localStorage.getItem("sb_crew_assign"); return s ? JSON.parse(s) : {} } catch { return {} } })()}
          />
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
          <span style={{ color:"rgba(255,255,255,0.2)", fontFamily:"monospace" }}>WASD move · SPACE shoot · 1-4 station · TAB command mode</span>
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
  const displayMs = Math.max(2200, Math.min(4500, 1800 + lineCount * 380 + charCount * 12))
  g.capyMsgEnd = now + displayMs
  g.nextCapyMsg = now + 28000
  // Append to Bridge comms log (first line only, max 4 entries)
  const firstLine = msg.split("\n")[0].trim()
  if (firstLine) _stationState.commsLog = [firstLine, ..._stationState.commsLog].slice(0, 4)
}

function applyPowerup(g: GState, word: Word, now: number) {
  const text = word.text
  if (!RELIC_SET.has(text)) sfx.powerup()

  // ── Rare Relics ────────────────────────────────────────────────────────────
  if (RELIC_SET.has(text)) {
    sfx.relic()
    // Gold flash + shake
    g.shake = 22; g.accentFlash = 22; g.accentFlashCol = "#fde68a"
    // Gold nova burst
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2
      g.particles.push({ x: word.x, y: word.y, vx: Math.cos(a)*(6+Math.random()*8), vy: Math.sin(a)*(6+Math.random()*8), life: 1.2 + Math.random()*0.4, glyph: i%4===0?"◈":"·", col: i%2===0?"#fde68a":"#fbbf24" })
    }
    if (text === "ARCHIVE CORE") {
      // +1 life (or +400 pts if full)
      if (g.lives < MAX_LIVES) {
        g.lives++
        g.particles.push({ x: g.px, y: g.py-28, vx:0, vy:-1.4, life:2.0, glyph:"♥ ARCHIVE CORE", col:"#fde68a", sz:13 })
        showCapyMsg(g, "ARCHIVE CORE recovered.\nSignal integrity restored.\nThe expedition continues.", now)
      } else {
        g.score += 500
        g.particles.push({ x: word.x, y: word.y-22, vx:0, vy:-1.2, life:2.0, glyph:"ARCHIVE CORE +500", col:"#fde68a", sz:13 })
        showCapyMsg(g, "ARCHIVE CORE absorbed.\nSignal at maximum integrity.\n+500 pts.", now)
      }
    } else if (text === "ORPHANED FLAG") {
      // Clear all words + shield + triple 20s
      g.words.forEach(w => { if (w.type !== "powerup") spawnLetterExplosion(g, w, w.type==="bug"?60:20, 1) })
      g.score += g.words.filter(w=>w.type!=="powerup").length * 30
      g.words = g.words.filter(w => w.type === "powerup")
      g.shield = true; g.shieldEnd = now + 20000
      g.triple = true; g.tripleEnd = now + 20000
      g.particles.push({ x: g.W/2, y: GH/2-18, vx:0, vy:-0.8, life:2.4, glyph:"ORPHANED FLAG · BOARD CLEAR", col:"#fde68a", sz:14 })
      showCapyMsg(g, "ORPHANED FLAG captured.\nCorruption swept.\nAnchor + amplify: 20s.", now)
    } else if (text === "CONTEXT SHARD") {
      // +600 score + brief invuln
      g.score += 600
      g.invuln = true; g.invulnEnd = now + 4000
      g.particles.push({ x: word.x, y: word.y-22, vx:0, vy:-1.0, life:2.2, glyph:"CONTEXT SHARD +600", col:"#fde68a", sz:13 })
      showCapyMsg(g, "CONTEXT SHARD recovered.\nLost meaning restored.\nSignal enriched.", now)
    } else if (text === "SEMANTIC RELIC") {
      // All on-screen words scored + score multiplier boost
      const bonus = g.words.filter(w=>w.type!=="powerup").length * 50
      g.score += bonus + 300
      g.upgrades.score_mul = (g.upgrades.score_mul ?? 0) + 1  // permanent +20% score for run
      g.particles.push({ x: g.W/2, y: GH/2-18, vx:0, vy:-0.7, life:2.5, glyph:`SEMANTIC RELIC · +${bonus+300} · SCORE ×`, col:"#fde68a", sz:13 })
      showCapyMsg(g, "SEMANTIC RELIC found.\nMeaning crystallized.\nScore multiplier: permanent.", now)
    } else if (text === "RAG ENGINE") {
      // Triple + speed + retroactive slow on all enemies
      g.triple = true; g.tripleEnd = now + 30000
      g.fast   = true; g.fastEnd   = now + 30000
      g.retroEnd = now + 12000
      g.particles.push({ x: g.W/2, y: GH/2-18, vx:0, vy:-0.8, life:2.2, glyph:"RAG ENGINE · ONLINE", col:"#fde68a", sz:14 })
      showCapyMsg(g, "RAG ENGINE online.\nRetrieval augmented.\nTriple · Speed · Slow: 30s.", now)
    }
    return
  }

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

// ── Salvage drop helper ────────────────────────────────────────────────────
function spawnSalvage(g: GState, x: number, y: number, type: SalvageItem["type"], now: number) {
  // DATA_CORRUPTION: 35% of salvage items are corrupted — collecting them subtracts score
  const corrupted = g.archiveCorruption === "data_corruption" && Math.random() < 0.35
  g.salvage.push({
    id: g.nextSalvageId++,
    x, y,
    vx: (Math.random() - 0.5) * 0.9,
    vy: -(0.5 + Math.random() * 0.5),
    type,
    spawnTime: now,
    life: 9000,
    corrupted,
  })
}

function spawnParticles(g: GState, x: number, y: number, col: string, glyph: string, n: number) {
  for (let i = 0; i < n; i++) {
    const lf = 0.5 + Math.random() * 0.3
    g.particles.push({ x, y, vx: (Math.random()-0.5)*2.2, vy: (Math.random()-0.5)*2.0-0.5,
      life: lf, initLife: lf, glyph, col, rot: (Math.random()-0.5)*2, rotV: (Math.random()-0.5)*0.04,
      gravity: 0.022, friction: 0.97 })
  }
}

function spawnLetterExplosion(g: GState, word: Word, pts: number, combo: number, style: "default"|"laser"|"spray"|"mine"|"homing" = "default") {
  const chars = word.text.split("")
  const isBug = word.type === "bug"
  const isPow = word.type === "powerup"
  const col   = isBug ? "#f97316" : isPow ? "#4ade80" : sectorTheme(g.level).storyCol
  const charW = 6.8, totalW = chars.length * charW

  if (style === "laser") {
    // ── EVAPORATE IN PLACE ───────────────────────────────────────────────
    // Letters do not move. The laser neutralises them where they stand.
    // They flash white then dissolve — clean, instant, column-precise.
    chars.forEach((ch, i) => {
      const startX = word.x - totalW/2 + i*charW + charW/2
      const lf = 0.45 + Math.random() * 0.25
      g.particles.push({
        x: startX, y: word.y,
        vx: 0, vy: 0,
        life: lf, initLife: lf,
        glyph: ch, col: "#fde68a",  // warm cream — heat of the beam, not cold white
        rot: 0, rotV: 0,
        gravity: 0, friction: 0,
      })
    })
    // Tight amber flash ring — laser precision
    g.particles.push({ x: word.x, y: word.y, vx:0, vy:0, life: 0.28, initLife: 0.28, glyph:"", col: "#fbbf24", ring: true })

  } else if (style === "mine") {
    // ── SHOCKWAVE BLAST ──────────────────────────────────────────────────
    // Depth charge detonates below — letters hurl outward from blast centre,
    // tumble chaotically, travel far. Heavy rotation, wide spread.
    chars.forEach((ch, i) => {
      const angle = Math.random() * Math.PI * 2  // truly random direction
      const spd   = 2.5 + Math.random() * 2.5    // faster than default
      const lf    = 0.65 + Math.random() * 0.35
      g.particles.push({
        x: word.x, y: word.y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: lf, initLife: lf,
        glyph: ch, col,
        rot: Math.random() * Math.PI * 2,  // start at random angle
        rotV: (Math.random()-0.5) * 0.28,  // heavy tumble
        gravity: 0.03,
        friction: 0.95,
      })
    })
    g.particles.push({ x: word.x, y: word.y, vx:0, vy:0, life: 1.1, initLife: 1.1, glyph:"", col: "#f59e0b", ring: true })
    g.particles.push({ x: word.x, y: word.y, vx:0, vy:0, life: 0.55, initLife: 0.55, glyph:"", col: "#fbbf24", ring: true })

  } else if (style === "spray") {
    // ── HORIZONTAL SWEEP ─────────────────────────────────────────────────
    // Scatter burst knocks letters sideways — almost no vertical component.
    // Letters slide far left/right like a shotgun swept across the word.
    chars.forEach((ch, i) => {
      const startX = word.x - totalW/2 + i*charW + charW/2
      const dx = startX - word.x
      const lf = 0.65 + Math.random() * 0.35
      g.particles.push({
        x: startX, y: word.y,
        vx: dx * 0.7 + (Math.random()-0.5) * 2.5,  // strong lateral push
        vy: (Math.random()-0.5) * 0.5,              // barely any vertical
        life: lf, initLife: lf,
        glyph: ch, col,
        rot: (Math.random()-0.5) * 0.6,
        rotV: (Math.random()-0.5) * 0.04,
        gravity: 0.015,
        friction: 0.93,
      })
    })
    g.particles.push({ x: word.x, y: word.y, vx:0, vy:0, life: 0.5, initLife: 0.5, glyph:"", col, ring: true })

  } else {
    // ── DEFAULT — burst apart, arc, drift ────────────────────────────────
    // Letters fly outward from their positions with a real upward burst.
    // friction=0.99 (not 0.91) — so deceleration is imperceptible, no freeze.
    // gravity pulls them into a natural arc. Life 0.8–1.3s for a satisfying hang.
    chars.forEach((ch, i) => {
      const startX = word.x - totalW/2 + i*charW + charW/2
      const dx = startX - word.x
      const vx = dx * 0.07 + (Math.random()-0.5) * 1.6   // radial + random spread
      const vy = -0.8 - Math.random() * 1.6               // upward burst
      const lf = 0.8 + Math.random() * 0.5
      g.particles.push({
        x: startX, y: word.y,
        vx, vy,
        life: lf, initLife: lf,
        glyph: ch, col,
        rot: (Math.random()-0.5) * 0.8,
        rotV: (Math.random()-0.5) * 0.045,
        gravity: 0.025,
        friction: 0.99,
      })
    })
    g.particles.push({ x: word.x, y: word.y, vx:0, vy:0, life: 0.55, initLife: 0.55, glyph:"", col, ring: true })
  }

  // Sparks scale to letter count — not combo
  if (style !== "laser") {
    const sparkCount = chars.length
    const sparkGlyph = isBug ? "×" : isPow ? "◈" : "·"
    for (let i = 0; i < sparkCount; i++) {
      const a = (i / sparkCount) * Math.PI * 2 + Math.random() * 0.6
      const spd = style === "mine" ? 2.5 + Math.random() * 3.0 : 1.2 + Math.random() * 2.5
      g.particles.push({ x: word.x, y: word.y, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd - 0.8, life: 0.58 + Math.random()*0.30, glyph: sparkGlyph, col })
    }
  }

  // Score/combo label
  if (pts > 0) {
    const chainStr = combo >= 3 ? `×${combo} ` : ""
    const label    = `${chainStr}+${pts}`
    const popCol   = combo >= 20 ? "#facc15" : combo >= 10 ? "#fb923c" : combo >= 5 ? "#c4b5fd" : col
    const sz       = combo >= 20 ? 16 : combo >= 10 ? 14 : combo >= 5 ? 12 : 10
    g.particles.push({ x: word.x, y: word.y - 16, vx: 0, vy: -0.7, life: 1.2, glyph: label, col: popCol, sz })
  }

  // Fragment mechanic: 35% of non-powerup, non-fragment kills leave a letter cluster
  // Laser burns clean — no fragments
  if (style !== "laser" && !word.fragment && word.type !== "powerup" && word.text.length >= 3 && Math.random() < 0.35) {
    const maxFrag = Math.min(4, word.text.length - 1)
    const fragLen = 2 + Math.floor(Math.random() * (maxFrag - 1))
    const fragStart = Math.floor(Math.random() * (word.text.length - fragLen))
    const fragText = word.text.slice(fragStart, fragStart + fragLen)
    const fragX = word.x + (Math.random()-0.5) * 35
    g.words.push({
      x: fragX, y: word.y - 5,
      text: fragText, type: word.type,
      spd: 0.25 + Math.random() * 0.15,
      beh: "fall", ph: 0, ox: fragX,
      hp: 1, hitFlash: 0,
      elite: false, age: 0,
      fragment: true,
      id: g.nextWordId++,
    })
  }
}

function draw(ctx: CanvasRenderingContext2D, g: GState, cw: number, now: number, attractMode: boolean) {
  // Reset shadow state — prevents cross-frame glow bleed
  ctx.shadowBlur = 0; ctx.shadowColor = "transparent"

  // Clear entire canvas BEFORE shake transform — shake offsets the background fill,
  // leaving uncovered strips at edges that accumulate across frames
  ctx.clearRect(0, 0, cw, GH)

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

  // level tint overlay — per-sector identity in story mode, depth-shift in endless
  if (!attractMode) {
    let tintCol: string
    let tintStr: number
    if (g.endless) {
      const d = g.endlessWave
      if (d >= 5) { tintCol = "#6d28d9"; tintStr = 0.06 + Math.min(d - 5, 4) * 0.008 }
      else if (d >= 3) { tintCol = "#7c3aed"; tintStr = 0.05 }
      else { tintCol = "#4ade80"; tintStr = 0.04 }
    } else {
      const st = sectorTheme(g.level)
      tintCol = st.tint; tintStr = st.tintA
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
    ctx.globalAlpha = g.whiteFlash * 0.030; ctx.fillStyle = "#fbbf24"
    ctx.fillRect(0, 0, cw, GH); ctx.globalAlpha = 1; g.whiteFlash--
  }
  if (g.accentFlash > 0) {
    ctx.globalAlpha = g.accentFlash * 0.028; ctx.fillStyle = g.accentFlashCol
    ctx.fillRect(0, 0, cw, GH); ctx.globalAlpha = 1; g.accentFlash--
  }
  // RETROSPECTIVE: subtle time-freeze blue wash
  if (!attractMode && g.retroEnd > 0 && now < g.retroEnd) {
    const retroFade = Math.min(1, (g.retroEnd - now) / 1200)
    ctx.globalAlpha = 0.06 * retroFade
    ctx.fillStyle = "#bae6fd"; ctx.fillRect(0, 0, cw, GH)
    ctx.globalAlpha = 1
  }

  // Last-life heartbeat edge — persistent red perimeter pulse when down to 1 carrier
  if (!attractMode && g.lives === 1 && g.redFlash <= 0) {
    const heartbeatA = 0.06 + 0.04 * Math.abs(Math.sin(now / 600))
    try {
      const hbG = ctx.createLinearGradient(0, 0, 28, 0)
      hbG.addColorStop(0, `rgba(248,113,113,${heartbeatA * 1.5})`); hbG.addColorStop(1, "rgba(248,113,113,0)")
      ctx.fillStyle = hbG; ctx.fillRect(0, 0, 28, GH)
      const hbG2 = ctx.createLinearGradient(cw, 0, cw - 28, 0)
      hbG2.addColorStop(0, `rgba(248,113,113,${heartbeatA * 1.5})`); hbG2.addColorStop(1, "rgba(248,113,113,0)")
      ctx.fillStyle = hbG2; ctx.fillRect(cw - 28, 0, 28, GH)
    } catch {}
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

  // Chain aura: glowing screen edges that escalate with active combo level
  if (!attractMode && g.combo >= 8) {
    const chainAge = Math.min(1, Math.max(0, 1300 - (now - g.lastKill)) / 1300)
    const chainStr = Math.min(1, (g.combo - 7) / 15) * chainAge
    if (chainStr > 0.01) {
      const chainRgb = g.combo >= 20 ? "250,204,21" : g.combo >= 12 ? "251,146,60" : "196,181,253"
      const pulse = 0.7 + 0.3 * Math.abs(Math.sin(now / 120))
      const edgeA = chainStr * pulse * 0.26
      try {
        const eg = ctx.createLinearGradient(0, 0, 50, 0)
        eg.addColorStop(0, `rgba(${chainRgb},${edgeA})`); eg.addColorStop(1, `rgba(${chainRgb},0)`)
        ctx.fillStyle = eg; ctx.fillRect(0, 0, 50, GH)
        const eg2 = ctx.createLinearGradient(cw, 0, cw - 50, 0)
        eg2.addColorStop(0, `rgba(${chainRgb},${edgeA})`); eg2.addColorStop(1, `rgba(${chainRgb},0)`)
        ctx.fillStyle = eg2; ctx.fillRect(cw - 50, 0, 50, GH)
        if (g.combo >= 15) {
          const eg3 = ctx.createLinearGradient(0, 0, 0, 44)
          eg3.addColorStop(0, `rgba(${chainRgb},${edgeA * 0.7})`); eg3.addColorStop(1, `rgba(${chainRgb},0)`)
          ctx.fillStyle = eg3; ctx.fillRect(0, 0, cw, 44)
          const eg4 = ctx.createLinearGradient(0, GH, 0, GH - 44)
          eg4.addColorStop(0, `rgba(${chainRgb},${edgeA * 0.7})`); eg4.addColorStop(1, `rgba(${chainRgb},0)`)
          ctx.fillStyle = eg4; ctx.fillRect(0, GH - 44, cw, 44)
        }
      } catch {}
    }
  }

  // vignette — intensifies with boss presence; tinted per sector in story mode
  const isVoidPresent = g.boss?.name === "THE VOID"
  // Vignette ramps up gradually as wordsKilled approaches the boss threshold
  const preBossDepth = (!attractMode && !g.boss && !g.endless)
    ? Math.sqrt(Math.min(1, g.wordsKilled / WORDS_TO_BOSS)) * 0.12
    : 0
  const vignetteStr = isVoidPresent
    ? 0.75 + 0.1 * Math.sin(now / 400)
    : g.boss
      ? 0.62 + 0.06 * Math.sin(now / 300)
      : 0.5 + preBossDepth
  const { vigR, vigG, vigB } = (!attractMode && !g.endless)
    ? sectorTheme(g.level)
    : { vigR: 0, vigG: 0, vigB: 0 }
  const vignetteCol = isVoidPresent
    ? `rgba(6,0,18,${vignetteStr})`
    : `rgba(${vigR},${vigG},${vigB},${vignetteStr})`
  const vgr = ctx.createRadialGradient(cw/2, GH*0.55, GH*0.15, cw/2, GH*0.55, Math.max(cw, GH)*0.78)
  vgr.addColorStop(0, "rgba(0,0,0,0)"); vgr.addColorStop(1, vignetteCol)
  ctx.fillStyle = vgr; ctx.fillRect(0, 0, cw, GH)

  // ── THE RECURSION: sector 1 stack-overflow atmosphere ────────────────────
  if (!attractMode && !g.endless && g.level === 1) {
    const boss1 = g.boss?.name === "THE RECURSION"
    const bossHpFrac1 = boss1 ? (g.boss!.hp / g.boss!.maxHp) : 1
    const baseI1 = boss1 ? Math.max(0.28, 1 - bossHpFrac1) : 0
    const pulse1 = baseI1 * (0.75 + 0.25 * Math.abs(Math.sin(now / (boss1 ? 110 : 260))))
    if (boss1) {
      // Cold blue-purple edge seep
      try {
        const r1g = ctx.createLinearGradient(0, 0, cw * 0.14, 0)
        r1g.addColorStop(0, `rgba(139,92,246,${pulse1 * 0.2})`); r1g.addColorStop(1, "rgba(139,92,246,0)")
        ctx.fillStyle = r1g; ctx.fillRect(0, 0, cw * 0.14, GH)
        const r1g2 = ctx.createLinearGradient(cw, 0, cw * 0.86, 0)
        r1g2.addColorStop(0, `rgba(139,92,246,${pulse1 * 0.2})`); r1g2.addColorStop(1, "rgba(139,92,246,0)")
        ctx.fillStyle = r1g2; ctx.fillRect(cw * 0.86, 0, cw * 0.14, GH)
      } catch {}
      // Stack address fragments drifting up at left/right margins
      const stackTick = Math.floor(now / 400) % 12
      const stackY = GH - (now % (GH * 1.6)) / 1.6
      const stackAddrs = ["0xDEADBEEF","[depth: ∞]","0x0000001F","ret addr: ???","stack: FULL","0xCAFEBABE"]
      ctx.save()
      ctx.globalAlpha = 0.07 + 0.04 * Math.sin(now / 180)
      ctx.fillStyle = "#a78bfa"; ctx.font = "7px monospace"; ctx.textAlign = "left"
      ctx.fillText(stackAddrs[stackTick % stackAddrs.length], 4, ((stackY + 0) % GH))
      ctx.fillText(stackAddrs[(stackTick + 3) % stackAddrs.length], 4, ((stackY + GH * 0.4) % GH))
      ctx.textAlign = "right"
      ctx.fillText(stackAddrs[(stackTick + 6) % stackAddrs.length], cw - 4, ((stackY + GH * 0.2) % GH))
      ctx.fillText(stackAddrs[(stackTick + 9) % stackAddrs.length], cw - 4, ((stackY + GH * 0.6) % GH))
      ctx.restore()
      // "STACK OVERFLOW" flicker at <25% HP
      if (bossHpFrac1 < 0.25 && Math.floor(now / 220) % 4 === 0) {
        ctx.save()
        ctx.globalAlpha = 0.14 + 0.09 * Math.abs(Math.sin(now / 60))
        ctx.fillStyle = "#a78bfa"; ctx.font = "bold 7px monospace"; ctx.textAlign = "center"
        ctx.fillText("STACK OVERFLOW", cw / 2, GH / 2 - 60)
        ctx.restore()
      }
    }
  }

  // ── THE DRIFT: sector 2 semantic-drift atmosphere ─────────────────────────
  if (!attractMode && !g.endless && g.level === 2) {
    const boss2 = g.boss?.name === "THE DRIFT"
    const bossHpFrac2 = boss2 ? (g.boss!.hp / g.boss!.maxHp) : 1
    const baseI2 = boss2 ? Math.max(0.28, 1 - bossHpFrac2) : 0
    const pulse2 = baseI2 * (0.7 + 0.3 * Math.abs(Math.sin(now / (boss2 ? 130 : 300))))
    if (boss2) {
      // Warm orange edge seep
      try {
        const d1 = ctx.createLinearGradient(0, GH, 0, GH * 0.72)
        d1.addColorStop(0, `rgba(251,146,60,${pulse2 * 0.22})`); d1.addColorStop(1, "rgba(251,146,60,0)")
        ctx.fillStyle = d1; ctx.fillRect(0, GH * 0.72, cw, GH * 0.28)
        const d2 = ctx.createLinearGradient(0, 0, cw * 0.1, 0)
        d2.addColorStop(0, `rgba(251,146,60,${pulse2 * 0.16})`); d2.addColorStop(1, "rgba(251,146,60,0)")
        ctx.fillStyle = d2; ctx.fillRect(0, 0, cw * 0.1, GH)
      } catch {}
      // Horizontal drift lines — rows that waver sideways like heat shimmer
      if (bossHpFrac2 < 0.6 && Math.floor(now / 80) % 7 < 2) {
        const driftRows = 2 + Math.floor(Math.random() * 3)
        for (let dr = 0; dr < driftRows; dr++) {
          const ry = Math.floor(Math.random() * GH)
          const rh = 1
          const shift = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 4)
          try {
            ctx.save(); ctx.globalAlpha = 0.22 + Math.random() * 0.15
            const strip2 = ctx.getImageData(0, ry, cw, rh)
            ctx.putImageData(strip2, shift, ry)
            ctx.restore()
          } catch {}
        }
      }
      // "UNCOUPLING" flicker at <25% HP
      if (bossHpFrac2 < 0.25 && Math.floor(now / 250) % 3 === 0) {
        ctx.save()
        ctx.globalAlpha = 0.15 + 0.08 * Math.abs(Math.sin(now / 65))
        ctx.fillStyle = "#fb923c"; ctx.font = "bold 7px monospace"; ctx.textAlign = "center"
        ctx.fillText("UNCOUPLING", cw / 2, GH / 2 - 60)
        ctx.restore()
      }
    }
  }

  // ── THE FRAGMENT: sector 3 shard-scatter atmosphere ───────────────────────
  if (!attractMode && !g.endless && g.level === 3) {
    const boss3 = g.boss?.name === "THE FRAGMENT"
    const bossHpFrac3 = boss3 ? (g.boss!.hp / g.boss!.maxHp) : 1
    const baseI3 = boss3 ? Math.max(0.25, 1 - bossHpFrac3) : 0
    const pulse3 = baseI3 * (0.75 + 0.25 * Math.abs(Math.sin(now / (boss3 ? 100 : 280))))
    if (boss3) {
      // Yellow diagonal shard lines at corners
      try {
        const f1 = ctx.createLinearGradient(0, 0, 0, GH * 0.13)
        f1.addColorStop(0, `rgba(250,204,21,${pulse3 * 0.18})`); f1.addColorStop(1, "rgba(250,204,21,0)")
        ctx.fillStyle = f1; ctx.fillRect(0, 0, cw, GH * 0.13)
        const f2 = ctx.createLinearGradient(cw, 0, cw * 0.88, 0)
        f2.addColorStop(0, `rgba(250,204,21,${pulse3 * 0.15})`); f2.addColorStop(1, "rgba(250,204,21,0)")
        ctx.fillStyle = f2; ctx.fillRect(cw * 0.88, 0, cw * 0.12, GH)
      } catch {}
      // Diagonal shard lines fired from edges
      if (bossHpFrac3 < 0.65 && Math.floor(now / 120) % 11 < 3) {
        const shards = 1 + Math.floor(Math.random() * 2)
        ctx.save(); ctx.globalAlpha = 0.12 + Math.random() * 0.12
        ctx.strokeStyle = "#facc15"; ctx.lineWidth = 0.8
        for (let sh = 0; sh < shards; sh++) {
          const sx = Math.random() < 0.5 ? 0 : cw
          const sy = Math.random() * GH * 0.5
          const ex = sx === 0 ? cw * (0.15 + Math.random() * 0.35) : cw - cw * (0.15 + Math.random() * 0.35)
          const ey = sy + (30 + Math.random() * 80) * (Math.random() > 0.5 ? 1 : -1)
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
        }
        ctx.restore()
      }
      // "FRAGMENTING" flicker at <25% HP
      if (bossHpFrac3 < 0.25 && Math.floor(now / 210) % 4 === 0) {
        ctx.save()
        ctx.globalAlpha = 0.15 + 0.09 * Math.abs(Math.sin(now / 58))
        ctx.fillStyle = "#facc15"; ctx.font = "bold 7px monospace"; ctx.textAlign = "center"
        ctx.fillText("FRAGMENTING", cw / 2, GH / 2 - 60)
        ctx.restore()
      }
    }
  }

  // ── THE COLLAPSE: sector 4 red-shift + destabilization ───────────────────
  if (!attractMode && !g.endless && g.level === 4) {
    const boss4 = g.boss?.name === "THE COLLAPSE"
    const bossHpFrac = boss4 ? (g.boss!.hp / g.boss!.maxHp) : 1
    const baseIntensity = boss4 ? Math.max(0.35, 1 - bossHpFrac) : 0.12
    const redPulse = baseIntensity * (0.7 + 0.3 * Math.abs(Math.sin(now / (boss4 ? 90 : 220))))

    // Red-shift edge glow
    try {
      const rg = ctx.createLinearGradient(0, 0, 0, GH)
      rg.addColorStop(0, `rgba(220,38,38,${redPulse * 0.35})`)
      rg.addColorStop(0.4, "rgba(220,38,38,0)")
      rg.addColorStop(0.6, "rgba(220,38,38,0)")
      rg.addColorStop(1, `rgba(220,38,38,${redPulse * 0.4})`)
      ctx.fillStyle = rg; ctx.fillRect(0, 0, cw, GH)
      const re = ctx.createLinearGradient(0, 0, cw * 0.12, 0)
      re.addColorStop(0, `rgba(220,38,38,${redPulse * 0.22})`); re.addColorStop(1, "rgba(220,38,38,0)")
      ctx.fillStyle = re; ctx.fillRect(0, 0, cw * 0.12, GH)
      const re2 = ctx.createLinearGradient(cw, 0, cw * 0.88, 0)
      re2.addColorStop(0, `rgba(220,38,38,${redPulse * 0.22})`); re2.addColorStop(1, "rgba(220,38,38,0)")
      ctx.fillStyle = re2; ctx.fillRect(cw * 0.88, 0, cw * 0.12, GH)
    } catch {}

    // Occasional scanline glitch tear when boss is distressed (< 50% HP)
    if (boss4 && bossHpFrac < 0.5 && Math.floor(now / 140) % 23 < 2) {
      const tearY = Math.floor(Math.random() * GH)
      const tearH = 1 + Math.floor(Math.random() * 3)
      const tearShift = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 8)
      ctx.save()
      ctx.globalAlpha = 0.35 + Math.random() * 0.25
      // grab a strip and redraw it shifted
      const strip = ctx.getImageData(0, tearY, cw, tearH)
      ctx.putImageData(strip, tearShift, tearY)
      ctx.restore()
    }

    // "DESTABILIZING" text flicker at <25% boss HP
    if (boss4 && bossHpFrac < 0.25 && Math.floor(now / 280) % 3 === 0) {
      ctx.save()
      ctx.globalAlpha = 0.18 + 0.12 * Math.sin(now / 55)
      ctx.fillStyle = "#f87171"
      ctx.font = "bold 8px monospace"; ctx.textAlign = "center"
      ctx.fillText("DESTABILIZING", cw / 2, GH / 2 - 60)
      ctx.restore()
    }
  }

  // ambient background glyphs — brightness scales with sector depth and boss proximity
  const glyphCol = g.endless
    ? (g.endlessWave >= 7 ? "#a855f7" : g.endlessWave >= 5 ? "#c084fc" : "#4ade80")
    : BOSSES[Math.min(Math.max(g.level - 1, 0), 3)].color
  // Sector intensity: sector 1 calm → sector 4 oppressive
  const sectorBrightness = attractMode ? 1.6
    : g.endless ? 2.0
    : [1.4, 1.65, 1.95, 2.4][Math.min(g.level - 1, 3)] ?? 1.6
  // Pre-boss ramp: glyphs get 20% brighter in the last 4 patterns before boss
  const preBossGlyphRamp = (!attractMode && !g.boss && !g.bossWarn && !g.endless)
    ? 1 + 0.2 * Math.max(0, (g.wordsKilled - (WORDS_TO_BOSS - 4)) / 4)
    : 1
  const glyphBrightness = sectorBrightness * preBossGlyphRamp
  ctx.font = "10px monospace"; ctx.textAlign = "center"
  g.bg.forEach(b => {
    ctx.globalAlpha = Math.min(0.32, b.a * glyphBrightness)
    ctx.fillStyle = attractMode ? "#966bec" : glyphCol
    ctx.fillText(b.ch, b.x, b.y)
  }); ctx.globalAlpha = 1

  if (!attractMode) {
    // journey bar — sector-colored segments, boss marker
    const jy = GH - 20, jx = 16, jw = cw - 32, jh = 5
    ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fillRect(jx, jy, jw, jh)
    const prog = g.endless ? 1 : Math.min(1, ((g.level - 1) + (g.boss ? (1 - g.boss.hp/g.boss.maxHp)*0.85 : 0)) / 4)

    if (!g.endless) {
      // Draw each completed sector's segment in its boss color, active sector lighter
      for (let si = 0; si < 4; si++) {
        const segX = jx + jw * (si / 4)
        const segW = jw / 4
        const bosCol = BOSSES[si].color
        const segEnd = Math.min(1, Math.max(0, prog - si / 4) * 4)  // 0→1 within this sector
        if (segEnd <= 0) break
        ctx.save()
        ctx.globalAlpha = si < g.level - 1 ? 0.55 : 0.7 + 0.15 * Math.sin(now / 400)
        ctx.fillStyle = bosCol
        ctx.fillRect(segX, jy, segW * segEnd, jh)
        ctx.restore()
      }
      // Segment dividers at 25%, 50%, 75%
      ctx.save()
      ctx.globalAlpha = 0.2; ctx.fillStyle = "#000020"
      for (const frac of [0.25, 0.5, 0.75]) ctx.fillRect(jx + jw * frac - 0.5, jy, 1, jh)
      ctx.restore()
    } else {
      // Endless: single purple bar
      ctx.save(); ctx.globalAlpha = 0.65; ctx.fillStyle = "#a855f7"
      ctx.fillRect(jx, jy, jw, jh)
      ctx.restore()
    }

    // Phase labels
    ctx.font = "8px monospace"; ctx.textAlign = "center"
    SDLC_PHASES.forEach((ph, i) => {
      const lx = jx + jw*(i/4) + jw/8
      const isActive = !g.endless && i === g.level - 1
      const isDone   = i < g.level - 1 || g.endless
      const phBosCol = BOSSES[i].color
      if (isActive) {
        const activePulse = 0.65 + 0.35 * Math.sin(now / 350)
        ctx.fillStyle = `rgba(${
          phBosCol === "#f87171" ? "248,113,113" :
          phBosCol === "#fb923c" ? "251,146,60" :
          phBosCol === "#facc15" ? "250,204,21" :
          "74,222,128"
        },${activePulse})`
        ctx.font = "bold 8px monospace"
      } else {
        ctx.fillStyle = isDone
          ? `${BOSSES[i].color}66`
          : "rgba(255,255,255,0.16)"
        ctx.font = "8px monospace"
      }
      ctx.fillText(ph, lx, jy - 4)
    })
  }

  // words
  const retroActive = !attractMode && g.retroEnd > 0 && now < g.retroEnd
  const curSectorTheme = attractMode ? SECTOR_THEMES[0] : sectorTheme(g.level)

  // ── Targeting highlight — find nearest non-powerup word above player ──
  let targetWord: typeof g.words[0] | null = null
  if (!attractMode && g.running && !g.paused && !g.boss) {
    let minDx = 9999
    g.words.forEach(w => {
      if (w.type === "powerup" || w.fragment || w.y >= g.py - 20) return
      const dx = Math.abs(w.x - g.px)
      if (dx < minDx) { minDx = dx; targetWord = w }
    })
  }

  // OBSERVABILITY: progressive blindness — word type colors converge toward gray over time
  const observeBlind = (!attractMode && g.archiveCorruption === "radar_degradation" && _stationState.sectorStart > 0)
    ? Math.min(1, (now - _stationState.sectorStart) / 45000)  // 0→1 over 45 seconds
    : 0

  g.words.forEach(w => {
    // RETRO tint: bug→pale blue, story→deeper blue (signals temporal freeze)
    const isRelic = w.type === "powerup" && RELIC_SET.has(w.text)
    let col = w.regenBoss ? "#34d399"
      : w.type === "bug" ? (retroActive ? "#fbbf24" : "#f97316")
      : isRelic ? "#fde68a"
      : w.type === "powerup" ? "#4ade80"
      : (retroActive ? "#bae6fd" : curSectorTheme.storyCol)
    // OBSERVABILITY: lerp all non-powerup word colors toward neutral gray as blindness grows
    if (observeBlind > 0 && w.type !== "powerup" && !w.regenBoss) {
      // At full blind: everything is rgba(180,180,190,0.7) — all words look the same
      const bf = observeBlind
      if (bf > 0.05) col = `rgba(${Math.round(180 + (1-bf)*40)},${Math.round(175 + (1-bf)*35)},${Math.round(185 + (1-bf)*30)},${0.65 + (1-bf)*0.25})`
    }
    const flashRed = w.hitFlash > 0

    // Fragments: held-together letter cluster needing a second shot
    if (w.fragment) {
      const fragPulse = 0.45 + 0.25 * Math.sin(now / 180)
      ctx.save()
      ctx.globalAlpha = fragPulse
      ctx.shadowColor = col; ctx.shadowBlur = 6 * fragPulse
      ctx.fillStyle = col; ctx.font = "10px monospace"; ctx.textAlign = "center"
      ctx.fillText("⌁" + w.text, w.x, w.y)
      // small underline dot to signal "needs another hit"
      ctx.fillStyle = col; ctx.globalAlpha = fragPulse * 0.5
      ctx.beginPath(); ctx.arc(w.x, w.y + 5, 1.5, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      ctx.globalAlpha = 1
      return
    }

    const spawnAlpha = Math.min(1, w.age / 7)
    // Brief spawn flash: extra glow for age 0-12
    const spawnFlash = w.age < 12 ? Math.max(0, 1 - w.age / 12) : 0
    ctx.globalAlpha = spawnAlpha

    if (w.type === "powerup") {
      const pulse = 0.5 + 0.5 * Math.sin(now / 280)
      const glowCol = isRelic ? "#fde68a" : "#4ade80"
      ctx.save(); ctx.shadowColor = glowCol; ctx.shadowBlur = (isRelic ? 18 : 10) * pulse
      // spawn beam: thin vertical line descending from top to word (fades with age)
      if (w.age < 55) {
        const beamAlpha = Math.max(0, (1 - w.age / 55)) * (0.18 + 0.12 * pulse)
        ctx.globalAlpha = beamAlpha * spawnAlpha
        ctx.strokeStyle = glowCol; ctx.lineWidth = isRelic ? 2 : 1
        ctx.beginPath(); ctx.moveTo(w.x, 0); ctx.lineTo(w.x, w.y - 8); ctx.stroke()
        ctx.globalAlpha = spawnAlpha
      }
    }
    if (w.regenBoss) {
      const pulse = 0.3 + 0.7 * Math.abs(Math.sin(now / 300))
      ctx.save(); ctx.shadowColor = "#34d399"; ctx.shadowBlur = 7 * pulse
    }
    // retroActive: color shift already signals it, no extra blur needed
    if (w.elite) {
      ctx.save(); ctx.shadowColor = "#f87171"; ctx.shadowBlur = 8 + 4 * Math.sin(now / 200)
    }

    const wordCol = flashRed ? "#fde68a" : (w.beh === "charge" && w.type !== "powerup" && !w.regenBoss ? "#fca5a5" : col)
    ctx.fillStyle = wordCol
    ctx.font = (w.elite ? "bold " : "") + "11px monospace"
    ctx.textAlign = "center"

    let prefix = ""
    if (w.regenBoss) prefix = "◆ "
    else if (w.beh === "zigzag") prefix = "≈"
    else if (w.beh === "sine") prefix = "~"

    // ── Word box — each word is a tangible artifact to destroy ─────────────
    {
      const label = prefix + w.text
      const tw = ctx.measureText(label).width
      const bpx = 9, boxH2 = 18
      const bwBox = tw + bpx * 2, boxX2 = w.x - bwBox / 2, boxY2 = w.y - 13
      ctx.save()
      ctx.fillStyle = flashRed       ? "rgba(253,230,138,0.12)"
        : w.type === "bug"           ? "rgba(249,115,22,0.11)"
        : w.type === "powerup"       ? "rgba(74,222,128,0.10)"
        : "rgba(8,8,18,0.55)"
      roundRect(ctx, boxX2, boxY2, bwBox, boxH2, 3); ctx.fill()
      // Danger proximity: words near the bottom get a red-pulse border
      const dangerFrac = w.type !== "powerup" && !w.fragment
        ? Math.max(0, Math.min(1, (w.y - (GH - 90)) / 60))
        : 0
      const dangerPulse = dangerFrac * (0.5 + 0.5 * Math.sin(now / 110))
      ctx.strokeStyle = dangerFrac > 0.3
        ? `rgba(248,113,113,${0.35 + dangerPulse * 0.6})`
        : flashRed     ? "rgba(253,230,138,0.55)"
        : w.type === "bug"           ? "rgba(249,115,22,0.45)"
        : w.type === "powerup"       ? "rgba(74,222,128,0.45)"
        : `${curSectorTheme.storyCol}22`   // subtle sector-tinted border
      if (dangerFrac > 0.3) {
        ctx.shadowColor = "#f87171"; ctx.shadowBlur = dangerPulse * 12
      }
      ctx.lineWidth = dangerFrac > 0.5 ? 1.2 : 0.8
      roundRect(ctx, boxX2, boxY2, bwBox, boxH2, 3); ctx.stroke()
      ctx.lineWidth = 1
      // BUG badge — small pill above top-left corner
      if (w.type === "bug" && !retroActive && !flashRed) {
        ctx.fillStyle = "rgba(249,115,22,0.88)"
        roundRect(ctx, boxX2, boxY2 - 10, 24, 9, 2); ctx.fill()
        ctx.fillStyle = "#fff"; ctx.font = "5.5px monospace"; ctx.textAlign = "left"
        ctx.fillText("BUG", boxX2 + 3, boxY2 - 3)
      }
      // ── Targeting overlay — highlight if this is the locked-on word ──
      if (w === targetWord) {
        const tPulse = 0.55 + 0.45 * Math.sin(now / 160)
        const tCol = w.type === "bug" ? "#fb923c" : curSectorTheme.storyCol
        ctx.save()
        ctx.globalAlpha = spawnAlpha
        // Glowing box border
        ctx.shadowColor = tCol; ctx.shadowBlur = 10 * tPulse
        ctx.strokeStyle = `${tCol}cc`
        ctx.lineWidth = 1.4
        roundRect(ctx, boxX2 - 2, boxY2 - 2, bwBox + 4, boxH2 + 4, 4); ctx.stroke()
        // Corner ticks (top-left, top-right)
        ctx.lineWidth = 1.5; ctx.globalAlpha = spawnAlpha * tPulse
        ctx.strokeStyle = tCol
        ctx.beginPath()
        ctx.moveTo(boxX2 - 2, boxY2 + 4); ctx.lineTo(boxX2 - 2, boxY2 - 2); ctx.lineTo(boxX2 + 5, boxY2 - 2)
        ctx.moveTo(boxX2 + bwBox + 2, boxY2 + 4); ctx.lineTo(boxX2 + bwBox + 2, boxY2 - 2); ctx.lineTo(boxX2 + bwBox - 4, boxY2 - 2)
        ctx.stroke()
        // Vertical sight line from word to player (faint dashed)
        ctx.globalAlpha = 0.12 * tPulse * spawnAlpha
        ctx.strokeStyle = tCol; ctx.lineWidth = 1
        ctx.setLineDash([3, 8])
        ctx.beginPath(); ctx.moveTo(w.x, w.y + 10); ctx.lineTo(w.x, g.py - 22); ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      }
      ctx.restore()
    }
    // Apply spawn glow to the text itself
    if (spawnFlash > 0 && w.type !== "powerup" && !w.regenBoss && !w.elite) {
      ctx.save()
      ctx.shadowColor = w.type === "bug" ? "#f97316" : curSectorTheme.storyCol
      ctx.shadowBlur = spawnFlash * 10
      ctx.fillText(prefix + w.text, w.x, w.y)
      ctx.restore()
    } else {
      ctx.fillText(prefix + w.text, w.x, w.y)
    }

    if (w.type === "powerup") ctx.restore()
    if (w.regenBoss) ctx.restore()
    if (w.elite) {
      ctx.restore()
      // HP pips
      for (let i = 0; i < w.hp; i++) {
        ctx.fillStyle = "#f87171"
        ctx.fillRect(w.x - 8 + i * 8, w.y + 4, 5, 3)
      }
    }

    // near-bottom danger flash (not for fragments — they don't hurt you)
    if (w.y > GH - 80 && w.type !== "powerup" && !w.fragment) {
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
      // transparent card — canvas bg shows through, only border glows
      ctx.save()
      const hitFrac = b.hitFlash ? b.hitFlash / 5 : 0
      const strokeColor = hitFrac > 0
        ? `rgba(255,255,255,${0.5 + hitFrac * 0.5})`
        : glowColor
      ctx.shadowColor = hitFrac > 0 ? "#ffffff" : glowColor
      ctx.shadowBlur = hitFrac > 0
        ? 28 + hitFrac * 22
        : (distress || b.raged ? 35 : 20) * pulse
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = hitFrac > 0 ? 2.8 : (distress || b.raged ? 2.5 : 1.8)
      roundRect(ctx, b.x - 50, b.y - 28, 100, 56, 8); ctx.stroke()
      ctx.restore()
      // Boss emblem — unique visual identity per boss
      ctx.save()
      ctx.globalAlpha = (0.35 + 0.15 * Math.sin(now / 220)) * (distress ? 0.7 : 1)
      ctx.fillStyle = b.color; ctx.textAlign = "center"
      if (b.name === "THE RECURSION") {
        // Spinning recursion symbol
        const ang = now / 800
        ctx.font = "bold 18px monospace"
        ctx.save(); ctx.translate(b.x, b.y - 2); ctx.rotate(ang); ctx.fillText("⊗", 0, 0); ctx.restore()
        ctx.font = "7px monospace"; ctx.globalAlpha *= 0.5
        ctx.fillText("∞", b.x - 18, b.y + 10); ctx.fillText("∞", b.x + 18, b.y + 10)
      } else if (b.name === "THE DRIFT") {
        // Flowing drift wave
        ctx.font = "12px monospace"; ctx.globalAlpha *= 0.8
        for (let di = 0; di < 5; di++) {
          const dx = (di - 2) * 18
          const dy = Math.sin((now / 300) + di * 0.8) * 4
          ctx.fillText("~", b.x + dx, b.y + dy)
        }
      } else if (b.name === "THE FRAGMENT") {
        // Scattered fragments
        ctx.font = "10px monospace"
        const frags = ["⌁","⋈","⌁","·","⋈"]
        frags.forEach((f, fi) => {
          const fx = b.x + (fi - 2) * 16 + Math.sin(now / 200 + fi) * 3
          const fy = b.y - 2 + Math.cos(now / 180 + fi) * 4
          ctx.fillText(f, fx, fy)
        })
      } else if (b.name === "THE COLLAPSE") {
        // Converging triangles
        const s = 0.8 + 0.2 * Math.sin(now / 150)
        ctx.font = `${Math.round(20 * s)}px monospace`
        ctx.fillText("◈", b.x, b.y)
        ctx.globalAlpha *= 0.4; ctx.font = "8px monospace"
        const cols = ["▽","▽","▽"]
        cols.forEach((c, ci) => ctx.fillText(c, b.x + (ci - 1) * 20, b.y + 14))
      }
      ctx.restore()
      ctx.fillStyle = distress ? "#f87171" : b.color
      ctx.font = "bold 9px monospace"; ctx.textAlign = "center"
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
    const t = bw.t
    // Phase thresholds (out of 170 total)
    const PH1_END = 35   // lockdown: dark builds, disruption text
    const PH2_END = 110  // name descends into place
    const PH3_END = 160  // name holds, glows, threat line appears
    //  170: boss spawns

    // ── Dark overlay ─────────────────────────────────────────────────
    const darkA = t < PH1_END
      ? (t / PH1_END) * 0.5
      : t < PH3_END ? 0.5
      : Math.max(0.15, 0.5 - (t - PH3_END) / (170 - PH3_END) * 0.35)
    ctx.globalAlpha = darkA; ctx.fillStyle = "#030307"
    ctx.fillRect(0, 0, cw, GH); ctx.globalAlpha = 1

    // ── Boss-color border ─────────────────────────────────────────────
    const borderA = t < PH1_END
      ? (t / PH1_END) * 0.55
      : t > PH3_END
        ? Math.max(0, 1 - (t - PH3_END) / (170 - PH3_END)) * 0.7
        : 0.45 + 0.2 * Math.sin(t / 9)
    ctx.globalAlpha = borderA; ctx.strokeStyle = bw.color; ctx.lineWidth = 2
    ctx.strokeRect(1, 1, cw - 2, GH - 2); ctx.lineWidth = 1; ctx.globalAlpha = 1

    // ── Phase 1: disruption text ──────────────────────────────────────
    if (t < PH1_END + 25) {
      const dA = t < PH1_END
        ? (t / PH1_END)
        : Math.max(0, 1 - (t - PH1_END) / 25)
      ctx.globalAlpha = dA * 0.65; ctx.fillStyle = bw.color
      ctx.font = "7px monospace"; ctx.textAlign = "center"
      ctx.fillText("· SIGNAL DISRUPTION ·", cw/2, 22); ctx.globalAlpha = 1
    }

    // ── Phase 2–3: boss name descends ────────────────────────────────
    if (t > 18) {
      ctx.font = "bold 26px monospace"; ctx.textAlign = "center"
      bw.letters.forEach((l, i) => {
        const letterStart = 18 + i * 5   // staggered: each letter 5f after previous
        const letterAge   = t - letterStart
        if (letterAge < 0) return
        const appear  = Math.min(1, letterAge / 14)
        const holdOut = t > PH3_END ? Math.max(0.25, 1 - (t - PH3_END) / (170 - PH3_END)) : 1
        const glow    = t > PH2_END ? 26 + 6 * Math.sin(t / 10 + i * 0.4) : 12
        ctx.save()
        ctx.globalAlpha = appear * holdOut
        ctx.shadowColor = bw.color; ctx.shadowBlur = glow
        ctx.fillStyle = bw.color
        ctx.fillText(l.ch, l.x, l.y)
        ctx.restore()
      })
    }

    // ── Phase 3: boss-specific threat line ───────────────────────────
    if (t > PH2_END && t < 170) {
      const threatLines: Record<string, string> = {
        "THE RECURSION": "RECURSION DEPTH: ∞  ·  NO EXIT CONDITION",
        "THE DRIFT":     "COHERENCE: 12%  ·  SEMANTIC DECOUPLING",
        "THE FRAGMENT":  "INTEGRITY: FAILING  ·  FRAGMENTATION EVENT",
        "THE COLLAPSE":  "ALL SECTORS COMPROMISED  ·  TERMINAL",
      }
      const line = threatLines[bw.name] ?? "HOSTILE PATTERN DETECTED"
      const tA = Math.min(1, (t - PH2_END) / 22) * (t > PH3_END ? Math.max(0, 1 - (t - PH3_END) / 20) : 1)
      ctx.globalAlpha = tA * 0.6; ctx.fillStyle = "rgba(255,255,255,0.9)"
      ctx.font = "7px monospace"; ctx.textAlign = "center"
      ctx.fillText(line, cw/2, GH/2 + 36); ctx.globalAlpha = 1
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
      } else if (b.kind === "turret") {
        // turret bolt — color-coded by weapon type
        const boltCol  = b.col ?? "#a78bfa"
        const bAng = Math.atan2(b.vy ?? -9, b.vx ?? 0)
        const bLen = boltCol === "#4ade80" ? 18 : 14  // grapple hook is longer
        const tx = Math.cos(bAng) * bLen, ty = Math.sin(bAng) * bLen
        ctx.save()
        ctx.shadowColor = boltCol; ctx.shadowBlur = boltCol === "#fdba74" ? 7 : 10
        // glow trail
        ctx.globalAlpha = 0.2; ctx.strokeStyle = boltCol; ctx.lineWidth = boltCol === "#fdba74" ? 4 : 3
        ctx.lineCap = "round"
        ctx.beginPath(); ctx.moveTo(b.x - tx * 0.6, b.y - ty * 0.6); ctx.lineTo(b.x - tx, b.y - ty); ctx.stroke()
        // main bolt
        ctx.globalAlpha = 1
        try {
          const bg = ctx.createLinearGradient(b.x - tx, b.y - ty, b.x + tx * 0.3, b.y + ty * 0.3)
          bg.addColorStop(0, "rgba(0,0,0,0)")
          bg.addColorStop(0.5, boltCol)
          bg.addColorStop(1, "#ffffff")
          ctx.strokeStyle = bg
        } catch { ctx.strokeStyle = boltCol }
        ctx.lineWidth = boltCol === "#fdba74" ? 3 : 2.5
        ctx.beginPath(); ctx.moveTo(b.x - tx, b.y - ty); ctx.lineTo(b.x + tx * 0.3, b.y + ty * 0.3); ctx.stroke()
        // hot tip
        ctx.globalAlpha = 0.9; ctx.fillStyle = "#e9d5ff"
        ctx.beginPath(); ctx.arc(b.x + tx * 0.3, b.y + ty * 0.3, 2, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      } else {
        const bulletCol = g.upgrades.spray ? "#22d3ee" : (g.triple || g.upgrades.triple) ? "#4ade80" : "#966bec"
        ctx.save()
        ctx.shadowColor = bulletCol; ctx.shadowBlur = 8
        // Comet tail — faint glowing dots trailing behind the bullet for velocity feel
        ctx.globalAlpha = 0.18; ctx.fillStyle = bulletCol
        ctx.beginPath(); ctx.arc(b.x, b.y + 7, 2.2, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.08
        ctx.beginPath(); ctx.arc(b.x, b.y + 15, 1.5, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 1
        // Main bullet shaft
        try {
          const grad = ctx.createLinearGradient(b.x, b.y - 11, b.x, b.y + 11)
          grad.addColorStop(0, "#ffffff")
          grad.addColorStop(0.25, bulletCol)
          grad.addColorStop(1, "rgba(0,0,0,0)")
          ctx.fillStyle = grad
        } catch { ctx.fillStyle = bulletCol }
        ctx.fillRect(b.x - 2, b.y - 11, 4, 22)
        ctx.restore()
      }
    } else {
      // enemy bullet — semantic corruption visual, styled per boss signature
      const eCol = b.col ?? "#f87171"
      ctx.save()
      ctx.shadowColor = eCol; ctx.shadowBlur = 10

      if (b.bounce) {
        // THE RECURSION: recursive spinning ring — it ricochets and loops
        const ang = now / 200
        ctx.strokeStyle = eCol; ctx.lineWidth = 1.5
        // outer orbit ring
        ctx.globalAlpha = 0.28
        ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, Math.PI * 2); ctx.stroke()
        // spinning inner ring
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(ang)
        ctx.globalAlpha = 0.85; ctx.lineWidth = 1.8
        ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke()
        // axis cross
        ctx.globalAlpha = 0.45; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.moveTo(0, -5); ctx.lineTo(0, 5); ctx.stroke()
        ctx.restore()
        // hot core dot
        ctx.globalAlpha = 1; ctx.fillStyle = eCol
        ctx.beginPath(); ctx.arc(b.x, b.y, 2, 0, Math.PI * 2); ctx.fill()
        // fade trail
        ctx.globalAlpha = 0.2; ctx.fillStyle = eCol
        ctx.beginPath(); ctx.arc(b.x, b.y - 11, 3, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.08
        ctx.beginPath(); ctx.arc(b.x, b.y - 20, 1.8, 0, Math.PI * 2); ctx.fill()

      } else if (b.splitAt) {
        // THE FRAGMENT: jagged sharded shape — you can see it wants to break apart
        ctx.fillStyle = eCol; ctx.globalAlpha = 0.9
        // irregular hexagon with notch
        ctx.beginPath()
        ctx.moveTo(b.x,      b.y - 7)
        ctx.lineTo(b.x + 3,  b.y - 3)
        ctx.lineTo(b.x + 6,  b.y + 1)
        ctx.lineTo(b.x + 2,  b.y + 5)
        ctx.lineTo(b.x - 2,  b.y + 5)
        ctx.lineTo(b.x - 6,  b.y + 1)
        ctx.lineTo(b.x - 3,  b.y - 3)
        ctx.closePath(); ctx.fill()
        // fork glyph — where it's going to split
        ctx.globalAlpha = 0.6; ctx.font = "8px monospace"; ctx.textAlign = "center"
        ctx.fillStyle = eCol; ctx.fillText("⋎", b.x, b.y + 17)
        // shard ghost trail
        ctx.globalAlpha = 0.18; ctx.fillStyle = eCol
        ctx.beginPath(); ctx.arc(b.x, b.y - 11, 3.5, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.07
        ctx.beginPath(); ctx.arc(b.x, b.y - 20, 2, 0, Math.PI * 2); ctx.fill()

      } else if (b.drift !== undefined) {
        // THE DRIFT: wavy oscillating teardrop — accelerates sideways
        const dWave = Math.sin(now / 110 + b.x * 0.05) * 2
        ctx.fillStyle = eCol; ctx.globalAlpha = 0.88
        ctx.beginPath()
        ctx.ellipse(b.x + dWave, b.y, 3, 5.5, 0, 0, Math.PI * 2)
        ctx.fill()
        // horizontal shimmer — shows the lateral drift
        ctx.globalAlpha = 0.3; ctx.strokeStyle = eCol; ctx.lineWidth = 0.9
        ctx.beginPath()
        ctx.moveTo(b.x - 12 + dWave, b.y); ctx.lineTo(b.x + 12 + dWave, b.y)
        ctx.stroke()
        // wavy trail
        ctx.globalAlpha = 0.2; ctx.fillStyle = eCol
        ctx.beginPath(); ctx.arc(b.x, b.y - 10, 2.5, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.07
        ctx.beginPath(); ctx.arc(b.x, b.y - 19, 1.5, 0, Math.PI * 2); ctx.fill()

      } else if (eCol === "#4ade80") {
        // THE COLLAPSE: converging crosshair — targeted, precise, inevitable
        const pls = 0.6 + 0.4 * Math.abs(Math.sin(now / 160))
        ctx.strokeStyle = eCol; ctx.lineWidth = 1.3
        const cs = 5
        ctx.globalAlpha = 0.9
        ctx.beginPath()
        ctx.moveTo(b.x - cs, b.y); ctx.lineTo(b.x + cs, b.y)
        ctx.moveTo(b.x, b.y - cs); ctx.lineTo(b.x, b.y + cs)
        ctx.stroke()
        ctx.globalAlpha = 0.4 * pls; ctx.lineWidth = 0.8
        ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = 0.95; ctx.fillStyle = eCol
        ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2); ctx.fill()
        // trail
        ctx.globalAlpha = 0.2; ctx.fillStyle = eCol
        ctx.beginPath(); ctx.arc(b.x, b.y - 10, 2.5, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.07
        ctx.beginPath(); ctx.arc(b.x, b.y - 19, 1.5, 0, Math.PI * 2); ctx.fill()

      } else {
        // Generic enemy bullet — mini-bosses and phase 5/6 void shots
        ctx.shadowBlur = 7
        ctx.globalAlpha = 0.2; ctx.fillStyle = eCol
        ctx.beginPath(); ctx.arc(b.x, b.y - 9, 3, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.08
        ctx.beginPath(); ctx.arc(b.x, b.y - 18, 2, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 1; ctx.fillStyle = eCol
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill()
      }

      ctx.restore()
    }
  })

  // player motion trail
  const isMaxCombo = !attractMode && g.combo >= 30
  if (!attractMode && g.trail.length > 1) {
    // Trail color: MAX_COMBO → gold, shield → green, else sector-tinted
    const sectorBossCol = BOSSES[Math.min(g.level - 1, BOSSES.length - 1)].color
    const sectorRgb = g.endless ? "150,107,236"
      : sectorBossCol === "#f87171" ? "248,113,113"
      : sectorBossCol === "#fb923c" ? "251,146,60"
      : sectorBossCol === "#facc15" ? "250,204,21"
      : sectorBossCol === "#4ade80" ? "74,222,128"
      : "150,107,236"
    const trailCol = isMaxCombo ? "250,204,21" : g.shield ? "74,222,128" : sectorRgb
    g.trail.forEach((pt, i) => {
      const age = g.trail.length - 1 - i
      const alpha = (1 - age / g.trail.length) * (isMaxCombo ? 0.38 : 0.22)
      const r = (isMaxCombo ? 5.5 : 4) * (1 - age / g.trail.length)
      ctx.save()
      ctx.globalAlpha = alpha
      if (isMaxCombo) { ctx.shadowColor = "#facc15"; ctx.shadowBlur = 5 }
      ctx.fillStyle = `rgb(${trailCol})`
      ctx.beginPath(); ctx.arc(pt.x, pt.y - 5, r, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    })
  }

  // player ship
  if (!attractMode) {
    const flash = g.invuln && Math.floor(now/220) % 2 === 0
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
        if (isMaxCombo) {
          // Outer rotating segmented ring — THE SIGNAL asserts itself
          const r3 = r1 + 24 + 3 * Math.sin(now / 150 + 2)
          const rotAng = now / 550
          ctx.save()
          ctx.globalAlpha = haloA * 1.1
          ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 1.6
          ctx.shadowColor = "#facc15"; ctx.shadowBlur = 16
          ctx.translate(g.px, g.py - 5); ctx.rotate(rotAng)
          for (let ai = 0; ai < 3; ai++) {
            const start = ai * (Math.PI * 2 / 3)
            const end = start + Math.PI * 2 / 3 * 0.68
            ctx.beginPath(); ctx.arc(0, 0, r3, start, end); ctx.stroke()
          }
          ctx.restore()
        }
        ctx.restore()
      }
      const glowCol = isMaxCombo ? "#facc15" : g.shield ? "#4ade80" : "#966bec"
      ctx.save()
      ctx.shadowColor = glowCol
      ctx.shadowBlur = isMaxCombo
        ? 22 + 7 * Math.sin(now / 170)
        : 10 + 4 * Math.sin(now / 400)
      ctx.fillStyle = isMaxCombo ? "#facc15" : g.shield ? "#4ade80" : "#a5b4fc"
      ctx.beginPath()
      ctx.moveTo(g.px, g.py - 18)
      ctx.lineTo(g.px - 13, g.py + 7)
      ctx.lineTo(g.px + 13, g.py + 7)
      ctx.closePath(); ctx.fill()
      if (isMaxCombo) {
        // bright white nose tip — ship tip burns white-hot at THE SIGNAL
        ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(now / 110))
        ctx.fillStyle = "#ffffff"
        ctx.beginPath(); ctx.arc(g.px, g.py - 15, 2.8, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
      // thruster flame
      const tf = 0.45 + 0.55 * Math.abs(Math.sin(now / 55))
      ctx.save(); ctx.globalAlpha = (isMaxCombo ? 0.92 : 0.78) * tf
      if (isMaxCombo) { ctx.shadowColor = "#facc15"; ctx.shadowBlur = 14 }
      ctx.fillStyle = isMaxCombo ? "#fde68a" : "#fb923c"
      ctx.beginPath(); ctx.moveTo(g.px - 5, g.py + 7); ctx.lineTo(g.px + 5, g.py + 7); ctx.lineTo(g.px, g.py + 13 + tf * (isMaxCombo ? 13 : 10)); ctx.closePath(); ctx.fill()
      ctx.globalAlpha = 0.5 * tf; ctx.fillStyle = isMaxCombo ? "#ffffff" : "#fde68a"
      ctx.beginPath(); ctx.moveTo(g.px - 2, g.py + 7); ctx.lineTo(g.px + 2, g.py + 7); ctx.lineTo(g.px, g.py + 10 + tf * (isMaxCombo ? 8 : 6)); ctx.closePath(); ctx.fill()
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

  // Salvage items — floating debris waiting to be grappled
  if (!attractMode && g.salvage.length > 0) {
    const salvageGlyphs: Record<SalvageItem["type"], string> = { scrap: "◆", fragment: "◈", artifact: "★" }
    const salvageColors: Record<SalvageItem["type"], string> = { scrap: "#94a3b8", fragment: "#c4b5fd", artifact: "#facc15" }
    g.salvage.forEach(s => {
      const age    = now - s.spawnTime
      const fadeIn = Math.min(1, age / 400)
      const fadeOut= Math.max(0, 1 - Math.max(0, age - (s.life - 1500)) / 1500)
      const alpha  = fadeIn * fadeOut * (0.7 + 0.2 * Math.abs(Math.sin(now / 500 + s.id)))
      // DATA_CORRUPTION: corrupted items shown with red warning tint + warning glyph
      const dispCol  = s.corrupted ? "#f87171" : salvageColors[s.type]
      const dispBlur = s.corrupted ? 8 : (s.type === "artifact" ? 10 : 5)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = dispCol
      ctx.shadowColor = dispCol; ctx.shadowBlur = dispBlur
      ctx.font = `${s.type === "artifact" && !s.corrupted ? 11 : 9}px monospace`; ctx.textAlign = "center"
      ctx.fillText(s.corrupted ? "⊗" : salvageGlyphs[s.type], s.x, s.y)
      // Pulsing warning ring for corrupted items
      if (s.corrupted) {
        ctx.globalAlpha = alpha * 0.35 * Math.abs(Math.sin(now / 300 + s.id))
        ctx.strokeStyle = "#f87171"; ctx.lineWidth = 0.8
        ctx.beginPath(); ctx.arc(s.x, s.y - 2, 7, 0, Math.PI * 2); ctx.stroke()
      }
      ctx.restore()
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
    ctx.fillStyle = p.col
    if (p.rot !== undefined) {
      // Letter explosion particles: hold size steady then fade at end
      // sqrt curve keeps letters readable for ~70% of life before shrinking
      const ratio = p.initLife ? Math.max(0, p.life / p.initLife) : Math.max(0, p.life)
      const sz = p.sz ?? (p.initLife ? Math.max(0, 16 * Math.sqrt(ratio)) : Math.max(7, 13 * p.life))
      const alpha = p.initLife ? Math.min(1, ratio * 3.5) : Math.max(0, p.life)
      ctx.globalAlpha = alpha
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot)
      ctx.font = `${sz}px monospace`; ctx.textAlign = "center"
      ctx.fillText(p.glyph, 0, 0); ctx.restore()
    } else {
      ctx.globalAlpha = Math.max(0, p.life)
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
  const pauseHint = g.upgrades.mine ? "P: pause · M: depth charge" : "P: pause"
  ctx.fillText(pauseHint, 10, GH - 24)

  // combo display
  if (g.combo >= 2) {
    const comboAge = now - g.lastKill
    ctx.globalAlpha = Math.max(0, 1 - comboAge / 1200)
    const comboStr = g.combo >= 10 ? `${g.combo}× CHAIN!` : g.combo >= 5 ? `${g.combo}× CHAIN` : g.combo >= 3 ? `${g.combo}×` : `×${g.combo}`
    const comboCol = g.combo >= 20 ? "#facc15" : g.combo >= 10 ? "#fb923c" : g.combo >= 5 ? "#c4b5fd" : BOSSES[Math.min(g.level - 1, 3)].color
    const comboSz  = g.combo >= 20 ? 28 : g.combo >= 10 ? 24 : g.combo >= 5 ? 20 : g.combo >= 3 ? 17 : 13
    ctx.save()
    ctx.shadowColor = comboCol; ctx.shadowBlur = 8 + g.combo * 0.6
    ctx.font = `bold ${comboSz}px monospace`
    ctx.textAlign = "center"; ctx.fillStyle = comboCol
    ctx.fillText(comboStr, cw/2, GH/2 - 32)
    ctx.restore(); ctx.globalAlpha = 1
  }

  // wave announcement — sector entry cinematic
  if (g.waveAnn) {
    const wa = g.waveAnn
    const fadeIn  = Math.min(1, wa.t / 18)
    const fadeOut = wa.t > 75 ? Math.max(0, 1 - (wa.t - 75) / 30) : 1
    const alpha   = fadeIn * fadeOut
    const slide   = Math.max(0, (1 - wa.t / 60)) * cw * 0.18
    const isVoidDepth = g.endless && g.endlessWave >= 5
    const annCol = isVoidDepth ? "#a855f7" : g.endless ? "#4ade80"
      : BOSSES[Math.min(g.level - 1, BOSSES.length - 1)].color

    // Backdrop strip — anchors the text
    ctx.globalAlpha = alpha * 0.22
    ctx.fillStyle = "#000010"
    ctx.fillRect(0, GH/2 - 26, cw, 54)
    ctx.globalAlpha = alpha

    // Two-line rendering when text has " · " separator
    const parts = wa.text.split(" · ")
    ctx.save()
    ctx.shadowColor = annCol; ctx.shadowBlur = (14 + 6 * Math.sin(wa.t / 6)) * alpha
    ctx.textAlign = "center"
    if (parts.length >= 2) {
      // Line 1: sector number or depth (e.g. "SECTOR 2") — white, bold, big
      ctx.fillStyle = "#e8e8f0"; ctx.font = "bold 13px monospace"
      ctx.fillText(parts[0], cw/2 + slide, GH/2 - 4)
      // Line 2: boss name or subtitle (e.g. "THE DRIFT") — sector color, slightly smaller
      ctx.fillStyle = annCol; ctx.font = "bold 11px monospace"
      ctx.shadowBlur = 12 * alpha
      ctx.fillText(parts.slice(1).join(" · "), cw/2 + slide, GH/2 + 12)
    } else {
      ctx.fillStyle = annCol; ctx.font = "bold 17px monospace"
      ctx.fillText(wa.text, cw/2 + slide, GH/2)
    }
    ctx.restore()
    // Sector-specific flavor tagline — sets the narrative tone at entry
    const sectorTaglines = [
      "where loops consume themselves",
      "where meaning decouples from signal",
      "where coherence breaks apart",
      "where all noise converges",
    ]
    const sectorTagline = g.endless
      ? "recursion has no floor"
      : sectorTaglines[Math.min(g.level - 1, 3)] ?? "carrying the signal"
    ctx.font = "7px monospace"; ctx.globalAlpha = alpha * 0.35
    ctx.fillStyle = annCol; ctx.textAlign = "center"
    ctx.fillText(sectorTagline, cw/2, GH/2 + 28)
    ctx.globalAlpha = 1
  }

  // capy in-game comment
  if (g.capyMsg) {
    const elapsed = now - g.capyMsgStart
    const remaining = g.capyMsgEnd - now
    const a = Math.min(1, Math.min(elapsed / 350, remaining / 550))
    if (a > 0) {
      const lines = g.capyMsg.split("\n")
      const bw = Math.max(120, Math.max(...lines.map(l => l.length)) * 6.4) + 22
      const bh = 18 + lines.length * 13
      // Top-right corner — well clear of the player ship at the bottom
      const bx = cw - bw - 8, by = 52
      // Border tints: boss color during taunts, sector color for ambient comms
      const isBossTaunt = !!(g.boss && g.boss.phase <= 4)
      const sectorCapyCol = (!attractMode && !g.endless)
        ? sectorTheme(g.level).storyCol
        : "#966bec"
      const capyBorderCol = isBossTaunt
        ? `${g.boss!.color}55`
        : `${sectorCapyCol}44`
      ctx.globalAlpha = a * 0.72
      ctx.fillStyle = "#15151e"
      roundRect(ctx, bx, by, bw, bh, 5); ctx.fill()
      ctx.strokeStyle = capyBorderCol; ctx.lineWidth = isBossTaunt ? 1.2 : 1
      roundRect(ctx, bx, by, bw, bh, 5); ctx.stroke()
      ctx.fillStyle = isBossTaunt ? "#fde8e8" : "#f5f5f5"
      ctx.font = "8px monospace"; ctx.textAlign = "left"
      lines.forEach((ln, i) => ctx.fillText((i === 0 ? (isBossTaunt ? "⚠ " : "🦫 ") : "   ") + ln, bx + 7, by + 13 + i * 13))
      ctx.globalAlpha = 1
    }
  }

  // Boss global HP bar — thin strip at the very top of canvas during boss fights
  if (g.boss) {
    const bHpPct = g.boss.hp / g.boss.maxHp
    const bBarCol = bHpPct > 0.5 ? g.boss.color : bHpPct > 0.25 ? "#facc15" : "#f87171"
    const bBarH = 5
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, cw, bBarH)
    // HP fill with glow
    ctx.save()
    ctx.shadowColor = bBarCol; ctx.shadowBlur = bHpPct < 0.3 ? 8 + 4 * Math.abs(Math.sin(now / 80)) : 5
    ctx.fillStyle = bBarCol
    ctx.fillRect(0, 0, cw * Math.max(0, bHpPct), bBarH)
    // Bright leading edge (the "front" of the HP bar)
    if (bHpPct > 0.01) {
      const edgeX = cw * bHpPct
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now / 60)
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(edgeX - 2, 0, 2, bBarH)
    }
    ctx.restore()
    // Midpoint marker at 50%
    ctx.save()
    ctx.globalAlpha = 0.3; ctx.fillStyle = "rgba(0,0,0,0.8)"
    ctx.fillRect(cw * 0.5 - 0.5, 0, 1, bBarH)
    ctx.restore()
  }

  // ── Ship damage visual feedback — smoke/sparks when rooms are damaged ───────
  if (!attractMode && !g.endless) {
    const totalDamage = Object.values(g.roomDamage).reduce((a, b) => a + (b ?? 0), 0)
    if (totalDamage > 0) {
      // Smoke drifting from hull (bottom area near player)
      if (Math.random() < 0.06 * totalDamage) {
        g.particles.push({
          x: g.px + (Math.random() - 0.5) * 22,
          y: g.py + 5,
          vx: (Math.random() - 0.5) * 0.4,
          vy: -(0.3 + Math.random() * 0.5),
          life: 1.2 + Math.random() * 0.8,
          glyph: Math.random() < 0.5 ? "·" : "○",
          col: totalDamage >= 4 ? "#f97316" : "#6b7280",
          sz: 8 + Math.random() * 4,
          gravity: -0.005, friction: 0.98,
        })
      }
      // Sparks if critical (3+ total damage)
      if (totalDamage >= 3 && Math.random() < 0.04 * totalDamage) {
        const sa = Math.random() * Math.PI * 2
        g.particles.push({
          x: g.px + Math.cos(sa) * 8, y: g.py + Math.sin(sa) * 5,
          vx: Math.cos(sa) * (1 + Math.random() * 2),
          vy: Math.sin(sa) * (1 + Math.random() * 2) - 1,
          life: 0.4 + Math.random() * 0.3,
          glyph: "✦", col: totalDamage >= 5 ? "#f87171" : "#fdba74",
          gravity: 0.06, friction: 0.94,
        })
      }
      // Critical orange glow around player when heavily damaged
      if (totalDamage >= 4) {
        ctx.save()
        ctx.globalAlpha = 0.08 + 0.05 * Math.abs(Math.sin(now / 200))
        const dmgGrad = ctx.createRadialGradient(g.px, g.py, 0, g.px, g.py, 35)
        dmgGrad.addColorStop(0, "#f97316"); dmgGrad.addColorStop(1, "rgba(249,115,22,0)")
        ctx.fillStyle = dmgGrad; ctx.fillRect(g.px - 35, g.py - 35, 70, 70)
        ctx.restore()
      }
    }
  }

  // ── Bridge target marking — locked target gets visual on battlefield ────────
  if (!attractMode && _stationState.markedTargetId !== null) {
    const target = g.words.find(w => w.id === _stationState.markedTargetId)
    if (target) {
      const age = Date.now() - _stationState.markedAt
      const pulse = 0.6 + 0.3 * Math.abs(Math.sin(now / 180))
      ctx.save()
      ctx.globalAlpha = pulse
      ctx.strokeStyle = "#f87171"; ctx.lineWidth = 1.2
      ctx.shadowColor = "#f87171"; ctx.shadowBlur = 8
      // pulsing diamond around target
      const ds = 14 + 3 * Math.abs(Math.sin(now / 240))
      ctx.beginPath()
      ctx.moveTo(target.x, target.y - ds)
      ctx.lineTo(target.x + ds, target.y)
      ctx.lineTo(target.x, target.y + ds)
      ctx.lineTo(target.x - ds, target.y)
      ctx.closePath(); ctx.stroke()
      // corner ticks
      ctx.globalAlpha = pulse * 0.6; ctx.lineWidth = 1
      const cs = ds + 5
      for (const [sx, sy, ex, ey] of [
        [target.x - cs, target.y - 4, target.x - cs, target.y + 4],
        [target.x + cs, target.y - 4, target.x + cs, target.y + 4],
      ] as [number,number,number,number][]) {
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
      }
      // "LOCKED" label
      ctx.globalAlpha = 0.7; ctx.shadowBlur = 0
      ctx.fillStyle = "#f87171"; ctx.font = "bold 7px monospace"; ctx.textAlign = "center"
      ctx.fillText("LOCKED", target.x, target.y - ds - 5)
      ctx.restore()
    } else {
      // target died or left field — clear mark
      _stationState.markedTargetId = null
    }
  }

  // ── Turret station reticle — draws when turret station is active ──────────
  if (!attractMode && _stationState.active === "turret") {
    const ta       = _stationState.turretAngle
    const isFiring = _stationState.turretFiring
    const REL      = 55            // aiming line length from player
    const tx  = g.px + Math.cos(ta) * REL
    const ty  = (g.py - 5) + Math.sin(ta) * REL
    ctx.save()
    // aiming line from player toward target
    ctx.setLineDash([4, 5])
    ctx.strokeStyle = isFiring ? "rgba(196,181,253,0.55)" : "rgba(167,139,250,0.3)"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(g.px, g.py - 5); ctx.lineTo(tx, ty); ctx.stroke()
    ctx.setLineDash([])
    // muzzle flash ring when firing
    if (isFiring) {
      ctx.globalAlpha = 0.5; ctx.strokeStyle = "#e9d5ff"; ctx.lineWidth = 2
      ctx.shadowColor = "#c4b5fd"; ctx.shadowBlur = 12
      ctx.beginPath(); ctx.arc(tx, ty, 11, 0, Math.PI * 2); ctx.stroke()
    }
    // reticle circle at tip
    ctx.globalAlpha = isFiring ? 0.9 : 0.5 + 0.18 * Math.abs(Math.sin(now / 280))
    ctx.strokeStyle = isFiring ? "#e9d5ff" : "#a78bfa"; ctx.lineWidth = isFiring ? 1.8 : 1.2
    ctx.shadowColor = isFiring ? "#e9d5ff" : "#a78bfa"; ctx.shadowBlur = isFiring ? 10 : 6
    ctx.beginPath(); ctx.arc(tx, ty, 7, 0, Math.PI * 2); ctx.stroke()
    // crosshair ticks inside reticle
    ctx.globalAlpha = isFiring ? 0.7 : 0.38
    ctx.beginPath()
    ctx.moveTo(tx - 4, ty); ctx.lineTo(tx + 4, ty)
    ctx.moveTo(tx, ty - 4); ctx.lineTo(tx, ty + 4)
    ctx.stroke()
    // "TUR" label next to reticle
    ctx.globalAlpha = 0.4; ctx.shadowBlur = 0
    ctx.fillStyle = "#c4b5fd"; ctx.font = "7px monospace"; ctx.textAlign = "left"
    ctx.fillText("TUR", tx + 9, ty + 2)
    ctx.restore()
  }

  // ── Active station corner badge ─────────────────────────────────────────
  // Shows current station in canvas top-right when not on Bridge
  if (!attractMode && _stationState.active !== "bridge") {
    const stationLabels: Record<StationId, string> = {
      bridge: "BRIDGE", turret: "TURRET", salvage: "SALVAGE", engineering: "ENGINEERING",
    }
    const badge = stationLabels[_stationState.active]
    ctx.save()
    ctx.globalAlpha = 0.5; ctx.fillStyle = "#0c0c16"
    ctx.font = "7px monospace"; ctx.textAlign = "right"
    const bw = ctx.measureText(badge).width + 10
    ctx.fillRect(cw - bw - 2, 4, bw, 13)
    ctx.globalAlpha = 0.55; ctx.fillStyle = "#a78bfa"
    ctx.fillText(badge, cw - 7, 13)
    ctx.restore()
  }

  // HUD — depth/sector is the primary anchor, score is secondary
  ctx.textAlign = "left"

  // PRIMARY: sector / depth label — this is what the run is about
  if (g.endless && g.endlessWave >= 5) {
    const voidPulse = 0.5 + 0.5 * Math.abs(Math.sin(now / 700))
    ctx.fillStyle = `rgba(${g.endlessWave >= 9 ? "220,38,38" : "168,85,247"},${0.7 + voidPulse * 0.3})`
    ctx.font = "bold 15px monospace"
  } else if (g.endless) {
    ctx.fillStyle = "rgba(74,222,128,0.85)"; ctx.font = "bold 15px monospace"
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.88)"; ctx.font = "bold 15px monospace"
  }
  const depthLabel = g.endless ? (g.endlessWave > 1 ? `DEPTH ${g.endlessWave}` : "THE VOID") : `SECTOR ${g.level}`
  ctx.fillText(depthLabel, 10, 20)

  // Sector canonical name — sets expedition identity (THE RECURSION, THE DRIFT…)
  if (!g.endless && !attractMode) {
    const bossData = BOSSES[Math.min(g.level - 1, BOSSES.length - 1)]
    ctx.fillStyle = `${bossData.color}55`; ctx.font = "7px monospace"
    ctx.fillText(bossData.name, 10, 30)
  }

  // SECONDARY: score — useful but not the point
  ctx.fillStyle = "rgba(150,107,236,0.5)"; ctx.font = "8px monospace"
  ctx.fillText(g.score.toLocaleString(), 10, g.endless ? 32 : 40)

  // Kills — expedition context
  const killsY = g.endless ? 43 : 50
  ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.font = "7px monospace"
  ctx.fillText(`${g.kills} eliminated`, 10, killsY)

  // Sector progress bar — how far to the next boss encounter
  if (!g.boss && !g.endless && !g.bossWarn) {
    const wPct = Math.min(1, g.wordsKilled / WORDS_TO_BOSS)
    const remaining = WORDS_TO_BOSS - g.wordsKilled
    const sBarCol = BOSSES[Math.min(g.level - 1, BOSSES.length - 1)].color
    ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fillRect(10, 55, 68, 2)
    ctx.fillStyle = wPct >= 0.85 ? "#f87171" : `${sBarCol}88`; ctx.fillRect(10, 55, 68 * wPct, 2)
    const sectorNoiseLabel = ["loops","echoes","shards","signals"]
    const noiseLabel = sectorNoiseLabel[Math.min(g.level - 1, 3)]
    const bossIncoming = BOSSES[Math.min(g.level - 1, BOSSES.length - 1)].name
    ctx.font = "7px monospace"; ctx.textAlign = "left"
    if (remaining <= 3 && remaining > 0) {
      const pulse = 0.7 + 0.3 * Math.abs(Math.sin(now / 140))
      ctx.fillStyle = `rgba(248,113,113,${pulse})`
      ctx.fillText(`${bossIncoming} · ${remaining}`, 10, 65)
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.18)"
      ctx.fillText(`${remaining} ${noiseLabel}`, 10, 65)
    }
  }

  // combo counter
  if (g.combo >= 3) {
    const comboAlpha = g.combo >= 10 ? 1 : 0.55 + g.combo * 0.045
    const comboCol = g.combo >= 20 ? "#facc15" : g.combo >= 10 ? "#fb923c" : "#7dd3fc"
    ctx.fillStyle = `rgba(${comboCol === "#facc15" ? "250,204,21" : comboCol === "#fb923c" ? "251,146,60" : "125,211,252"},${comboAlpha})`
    ctx.font = "7px monospace"; ctx.textAlign = "left"
    ctx.fillText(`×${g.combo} chain`, 10, g.boss || g.endless ? 55 : 76)
  }
  // Lives — pulse red on last life for urgency
  ctx.textAlign = "right"
  if (g.lives === 1) {
    const lifePulse = 0.7 + 0.3 * Math.abs(Math.sin(now / 280))
    ctx.fillStyle = `rgba(248,113,113,${lifePulse})`
    ctx.save(); ctx.shadowColor = "#f87171"; ctx.shadowBlur = 8 * lifePulse
    ctx.font = "12px monospace"
    ctx.fillText("♥" + "♡".repeat(Math.max(0, MAX_LIVES - 1)), cw - 10, 20)
    ctx.restore()
  } else {
    ctx.fillStyle = "#f87171"; ctx.font = "12px monospace"
    ctx.fillText("♥".repeat(g.lives) + "♡".repeat(Math.max(0, MAX_LIVES - g.lives)), cw - 10, 20)
  }
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

const REROLL_BASE_COST = 120

interface CrewState {
  unlocked: string[]
  selected: string[]
  upgrades: Record<string,number>
  names: Record<string,string>
}

// ── Command Deck ──────────────────────────────────────────────────────────
// Primary nav: arrow keys + Enter. ESC goes back.
// Power-user mode: TAB, :, or / activates a real CLI at the bottom.
function CLIScreen({ options: initialOptions, onPick, score, kills, level, endless, endlessDepth, onReroll, crew, onAgentHire, onAgentUpgrade, onAgentRename }: {
  options: UpgradeDef[]; onPick: (id: string) => void; score: number; kills: number
  level?: number; endless?: boolean; endlessDepth?: number
  onReroll?: () => UpgradeDef[]
  crew?: CrewState
  onAgentHire?: (id: string) => void
  onAgentUpgrade?: (id: string) => void
  onAgentRename?: (id: string, name: string) => void
}) {
  // ── State ──────────────────────────────────────────────────────────────
  const totalTokens = Math.floor(score / 6) + kills * 3
  const [liveOptions, setLiveOptions] = useState(initialOptions)
  const [tokensSpent, setTokensSpent] = useState(0)
  const [rollCount, setRollCount]     = useState(0)
  const [view,       setView]         = useState<"menu"|"ship"|"crew">("menu")
  const [menuIdx,    setMenuIdx]      = useState(0)
  const [cardIdx,    setCardIdx]      = useState(0)
  const [cmdMode,    setCmdMode]      = useState(false)
  const [cmdText,    setCmdText]      = useState("")
  const [log,        setLog]          = useState<{text:string; col?:string}[]>([])
  const inputRef  = useRef<HTMLInputElement>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const tokensAvailable = totalTokens - tokensSpent
  const rerollCost      = REROLL_BASE_COST * (rollCount + 1)
  const canReroll       = !!onReroll && tokensAvailable >= rerollCost
  const allAgents       = [...AGENT_DEFS, ...MERC_AGENTS]
  const deployedCrew    = crew ? allAgents.filter(a => crew.selected.includes(a.id) && crew.unlocked.includes(a.id)) : []
  const hirableMercs    = crew ? MERC_AGENTS.filter(a => !crew.unlocked.includes(a.id)) : []

  const MENU = [
    { id:"continue", label:"CONTINUE RUN",  badge: liveOptions.length > 0 ? `${liveOptions.length} upgrade${liveOptions.length!==1?"s":""} pending` : "" },
    { id:"ship",     label:"SHIP",          badge: liveOptions.length > 0 ? `${liveOptions.length} ready` : "" },
    { id:"crew",     label:"CREW",          badge: deployedCrew.length > 0 ? `${deployedCrew.length} active` : "" },
    { id:"capy",     label:"CAPY",          badge: "" },
    { id:"archive",  label:"ARCHIVE",       badge: "" },
  ]

  // ── Effects ────────────────────────────────────────────────────────────
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior:"smooth" }) }, [log])
  useEffect(() => { if (cmdMode) setTimeout(() => inputRef.current?.focus(), 0) }, [cmdMode])

  // ── Keyboard nav ───────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Command mode: only ESC and Enter are captured; input handles the rest
      if (cmdMode) {
        if (e.key === "Escape") { e.preventDefault(); setCmdMode(false); setCmdText(""); }
        if (e.key === "Enter")  { e.preventDefault(); runCmd(cmdText); setCmdText(""); }
        return
      }
      // Activate command mode
      if (e.key === "Tab" || e.key === "/" || e.key === ":") {
        e.preventDefault(); setCmdMode(true); return
      }
      // View-specific nav
      if (view === "menu") {
        if      (e.key === "ArrowUp")   { e.preventDefault(); setMenuIdx(i => (i - 1 + MENU.length) % MENU.length) }
        else if (e.key === "ArrowDown") { e.preventDefault(); setMenuIdx(i => (i + 1) % MENU.length) }
        else if (e.key === "Enter")     { e.preventDefault(); activateMenu(MENU[menuIdx].id) }
      } else if (view === "ship") {
        if      (e.key === "ArrowUp")   { e.preventDefault(); setCardIdx(i => (i - 1 + liveOptions.length) % liveOptions.length) }
        else if (e.key === "ArrowDown") { e.preventDefault(); setCardIdx(i => (i + 1) % liveOptions.length) }
        else if (["1","2","3"].includes(e.key)) { e.preventDefault(); const n = +e.key - 1; if (n < liveOptions.length) setCardIdx(n) }
        else if (e.key === "Enter")     { e.preventDefault(); onPick(liveOptions[cardIdx]?.id) }
        else if (e.key === "Escape")    { e.preventDefault(); setView("menu") }
      } else if (view === "crew") {
        if (e.key === "Escape") { e.preventDefault(); setView("menu") }
      }
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [cmdMode, view, menuIdx, cardIdx, liveOptions, cmdText, MENU.length]) // eslint-disable-line

  // ── Actions ────────────────────────────────────────────────────────────
  function addLog(text: string, col?: string) { setLog(prev => [...prev, { text, col }]) }

  function activateMenu(id: string) {
    if      (id === "continue") { onPick("__skip__") }
    else if (id === "ship")     { setView("ship"); setCardIdx(0) }
    else if (id === "crew")     { setView("crew") }
    else { addLog(`${id} — coming soon`, "rgba(255,255,255,0.25)") }
  }

  function doReroll() {
    if (!onReroll || tokensAvailable < rerollCost) return
    const newOpts = onReroll()
    if (!newOpts?.length) return
    setTokensSpent(t => t + rerollCost); setRollCount(r => r + 1)
    setLiveOptions(newOpts); setCardIdx(0)
    addLog(`rerolled — ${rerollCost}t spent`, "rgba(150,107,236,0.7)")
  }

  function runCmd(raw: string) {
    const cmd = raw.trim(); if (!cmd) return
    const lo = cmd.toLowerCase()
    addLog(`> ${cmd}`, "rgba(150,107,236,0.6)")

    if (lo === "help" || lo === "?") {
      addLog("ship      upgrade systems",         "rgba(255,255,255,0.5)")
      addLog("crew      manage agents",           "rgba(255,255,255,0.5)")
      addLog("stats     run statistics",          "rgba(255,255,255,0.5)")
      addLog("continue  return to mission",       "rgba(255,255,255,0.5)")
      addLog("hire <agent>  upgrade <agent>  rename <agent> <name>", "rgba(255,255,255,0.3)")
      addLog("reroll    fresh upgrade options",   "rgba(255,255,255,0.3)")
      return
    }
    if (lo === "ship")     { setView("ship"); setCmdMode(false); return }
    if (lo === "crew" || lo === "manifest") {
      if (!crew) { addLog("no crew data", "#f87171"); return }
      addLog("── CREW MANIFEST ──────────────────────", "rgba(150,107,236,0.55)")
      deployedCrew.forEach(a => {
        const lv = 1 + (crew.upgrades[a.id] ?? 0)
        addLog(`  ● ${(crew.names[a.id] ?? a.name).padEnd(20)} lv.${lv}`, "#4ade80")
      })
      hirableMercs.forEach(a => addLog(`  ◇ ${a.name.padEnd(20)} ${a.cost}t`, "rgba(255,255,255,0.32)"))
      return
    }
    if (lo === "continue") { onPick("__skip__"); return }
    if (lo === "stats") {
      addLog(`score   ${score.toLocaleString()}`, "#4ade80")
      addLog(`kills   ${kills}`,                  "#4ade80")
      addLog(`tokens  ${tokensAvailable}t`,       "#4ade80")
      if (endless) addLog(`depth   ${endlessDepth ?? 1}`, "#4ade80")
      return
    }
    if (lo === "reroll" || lo === "re-roll") { doReroll(); return }

    const hireM = cmd.match(/^hire\s+(.+)$/i)
    if (hireM) {
      const t = hireM[1].trim().toLowerCase()
      const merc = MERC_AGENTS.find(a => a.name.toLowerCase().includes(t) || a.id.replace("claude_","").includes(t) || a.role.toLowerCase().includes(t))
      if (!merc) { addLog(`unknown: "${t}" — try hire ops / hire data / hire exec`, "#f87171"); return }
      if (crew?.unlocked.includes(merc.id)) { addLog(`${merc.name} already on crew`, "#fdba74"); return }
      if (tokensAvailable < merc.cost) { addLog(`need ${merc.cost}t — have ${tokensAvailable}t`, "#f87171"); return }
      setTokensSpent(s => s + merc.cost); onAgentHire?.(merc.id)
      addLog(`${merc.name} hired`, "#4ade80"); return
    }

    const upM = cmd.match(/^upgrade\s+(.+)$/i)
    if (upM) {
      const t = upM[1].trim().toLowerCase()
      const agent = allAgents.find(a => crew?.unlocked.includes(a.id) && (
        a.name.toLowerCase().includes(t) || a.id.replace("claude_","").includes(t) ||
        a.role.toLowerCase().includes(t) || (crew?.names[a.id]??"").toLowerCase().includes(t)
      ))
      if (!agent) { addLog(`not found — try "crew"`, "#f87171"); return }
      const lv = crew?.upgrades[agent.id] ?? 0
      if (lv >= MAX_AGENT_UPGRADES) { addLog(`at max level`, "#fdba74"); return }
      const cost = AGENT_UPGRADE_COSTS[lv]
      if (tokensAvailable < cost) { addLog(`need ${cost}t — have ${tokensAvailable}t`, "#f87171"); return }
      setTokensSpent(s => s + cost); onAgentUpgrade?.(agent.id)
      addLog(`${crew?.names[agent.id] ?? agent.name} → lv.${lv+2}`, "#4ade80"); return
    }

    const renM = cmd.match(/^rename\s+(\S+)\s+(.+)$/i)
    if (renM) {
      const t = renM[1].toLowerCase(), newName = renM[2].trim().toUpperCase().slice(0,24)
      const agent = allAgents.find(a => crew?.unlocked.includes(a.id) && (
        a.name.toLowerCase().includes(t) || a.id.replace("claude_","").includes(t) ||
        (crew?.names[a.id]??"").toLowerCase().includes(t)
      ))
      if (!agent) { addLog(`agent not found`, "#f87171"); return }
      onAgentRename?.(agent.id, newName)
      addLog(`renamed → ${newName}`, "#4ade80"); return
    }

    addLog(`unknown: "${cmd}" — help for commands`, "rgba(255,255,255,0.28)")
  }

  // ── Styles ─────────────────────────────────────────────────────────────
  const C = {
    purple:   "rgba(150,107,236,0.55)",
    purpleHi: "#c4b5fd",
    dim:      "rgba(255,255,255,0.22)",
    dimmer:   "rgba(255,255,255,0.11)",
    text:     "rgba(255,255,255,0.65)",
    textHi:   "#e9d5ff",
    green:    "rgba(74,222,128,0.65)",
    border:   "rgba(150,107,236,0.16)",
    borderDim:"rgba(255,255,255,0.07)",
  }

  const sectorLabel = endless ? `DEPTH ${endlessDepth ?? 1}` : level != null ? `SECTOR ${level} → ${level + 1}` : ""

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ position:"absolute", inset:0, background:"#09090f", zIndex:10, display:"flex", flexDirection:"column", fontFamily:"monospace", overflow:"hidden" }}>

      {/* Header */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"0.55rem 1.5rem", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ display:"flex", gap:"1.1rem", alignItems:"center" }}>
          <span style={{ color:C.purple, fontSize:"0.58rem", letterSpacing:"0.22em" }}>COMMAND DECK</span>
          {view !== "menu" && <span style={{ color:C.dim, fontSize:"0.58rem", letterSpacing:"0.1em" }}>/ {view === "ship" ? "SHIP" : view.toUpperCase()}</span>}
          {sectorLabel && <span style={{ color:C.dimmer, fontSize:"0.58rem" }}>{sectorLabel}</span>}
        </div>
        <span style={{ color:C.green, fontSize:"0.6rem" }}>{tokensAvailable.toLocaleString()}t</span>
      </div>

      {/* Main content */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"1.5rem 1.6rem", overflow:"hidden", minHeight:0 }}>

        {/* ── MENU VIEW ── */}
        {view === "menu" && !cmdMode && (
          <div style={{ display:"flex", flexDirection:"column", gap:"0.04rem" }}>
            {MENU.map((item, i) => {
              const active = i === menuIdx
              return (
                <div key={item.id}
                  onClick={() => { setMenuIdx(i); activateMenu(item.id) }}
                  onMouseEnter={() => setMenuIdx(i)}
                  style={{ display:"flex", alignItems:"baseline", gap:"0.8rem", padding:"0.42rem 0.4rem",
                    cursor:"pointer", borderRadius:"3px",
                    background: active ? "rgba(150,107,236,0.07)" : "transparent" }}>
                  <span style={{ color: active ? "#a5b4fc" : "transparent", fontSize:"0.75rem", width:"0.75rem", flexShrink:0 }}>{">"}</span>
                  <span style={{ color: active ? C.textHi : "rgba(255,255,255,0.42)", fontSize:"0.8rem",
                    letterSpacing:"0.07em", fontWeight: active ? 600 : 400 }}>
                    {item.label}
                  </span>
                  {item.badge && (
                    <span style={{ color: active ? "rgba(196,181,253,0.5)" : "rgba(255,255,255,0.16)", fontSize:"0.6rem" }}>
                      {item.badge}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── COMMAND MODE LOG ── */}
        {cmdMode && (
          <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:"0.04rem", minHeight:0 }}>
            {log.length === 0 && (
              <span style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.68rem" }}>
                type <span style={{ color:C.purple }}>help</span> for available commands
              </span>
            )}
            {log.slice(-14).map((l, i) => (
              <div key={i} style={{ fontSize:"0.68rem", lineHeight:1.8, color: l.col ?? "rgba(255,255,255,0.48)",
                fontFamily:"monospace", whiteSpace:"pre" }}>{l.text}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* ── SHIP VIEW — upgrade cards ── */}
        {view === "ship" && (
          <div style={{ display:"flex", flexDirection:"column", flex:1 }}>
            <p style={{ color:C.dimmer, fontSize:"0.57rem", letterSpacing:"0.16em", margin:"0 0 1.1rem" }}>SIGNAL UPGRADES</p>
            <div style={{ display:"flex", flexDirection:"column", gap:"0.45rem" }}>
              {liveOptions.map((opt, i) => {
                const active = i === cardIdx
                return (
                  <div key={opt.id}
                    onClick={() => { setCardIdx(i); onPick(opt.id) }}
                    onMouseEnter={() => setCardIdx(i)}
                    style={{ border: active ? "1px solid rgba(150,107,236,0.6)" : `1px solid ${C.borderDim}`,
                      borderRadius:"5px", padding:"0.65rem 0.9rem",
                      background: active ? "rgba(150,107,236,0.08)" : "rgba(255,255,255,0.02)",
                      cursor:"pointer", display:"grid", gridTemplateColumns:"1.4rem 1fr auto",
                      gap:"0.6rem", alignItems:"center" }}>
                    <span style={{ color: active ? "#a5b4fc" : C.dim, fontSize:"0.7rem", fontWeight:700 }}>[{i+1}]</span>
                    <div>
                      <div style={{ color: active ? C.textHi : C.text, fontSize:"0.78rem", fontWeight:600,
                        letterSpacing:"0.04em", marginBottom:"0.14rem" }}>{opt.name}</div>
                      <div style={{ color: active ? "rgba(196,181,253,0.52)" : "rgba(255,255,255,0.26)", fontSize:"0.65rem" }}>{opt.desc}</div>
                    </div>
                    {active && <span style={{ color:"#8b5cf6" }}>▶</span>}
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop:"0.85rem", paddingTop:"0.55rem", borderTop:`1px solid ${C.borderDim}`,
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:C.dimmer, fontSize:"0.58rem" }}>↑↓ or 1–{liveOptions.length}  ·  ENTER deploy  ·  ESC back</span>
              {canReroll && (
                <button onClick={doReroll} style={{ background:"none", border:`1px solid ${C.borderDim}`, borderRadius:"4px",
                  color:C.dim, fontSize:"0.6rem", fontFamily:"monospace", padding:"0.2rem 0.55rem", cursor:"pointer" }}>
                  reroll ({rerollCost}t)
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── CREW VIEW ── */}
        {view === "crew" && (
          <div>
            <p style={{ color:C.dimmer, fontSize:"0.57rem", letterSpacing:"0.16em", margin:"0 0 1rem" }}>CREW MANIFEST</p>
            {deployedCrew.length === 0 && (
              <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.7rem" }}>No crew yet — survive sector 1 to recruit agents.</p>
            )}
            {deployedCrew.map(a => {
              const lv = 1 + (crew?.upgrades[a.id] ?? 0)
              const upCost = AGENT_UPGRADE_COSTS[crew?.upgrades[a.id] ?? 0]
              const canUp  = (crew?.upgrades[a.id] ?? 0) < MAX_AGENT_UPGRADES && tokensAvailable >= upCost
              return (
                <div key={a.id} style={{ display:"flex", alignItems:"center", gap:"0.7rem", marginBottom:"0.45rem" }}>
                  <span style={{ color:"rgba(74,222,128,0.65)", fontSize:"0.7rem" }}>●</span>
                  <span style={{ color:C.text, fontSize:"0.72rem", minWidth:"11rem" }}>{crew?.names[a.id] ?? a.name}</span>
                  <span style={{ color:C.dimmer, fontSize:"0.64rem" }}>lv.{lv}</span>
                  {canUp && (
                    <button onClick={() => { setTokensSpent(s => s + upCost); onAgentUpgrade?.(a.id); addLog(`${crew?.names[a.id] ?? a.name} → lv.${lv+1}`, "#4ade80") }}
                      style={{ background:"rgba(150,107,236,0.09)", border:"1px solid rgba(150,107,236,0.25)",
                        borderRadius:"3px", color:"rgba(150,107,236,0.8)", fontSize:"0.6rem",
                        padding:"0.12rem 0.45rem", cursor:"pointer", fontFamily:"monospace" }}>
                      ↑ {upCost}t
                    </button>
                  )}
                </div>
              )
            })}
            {hirableMercs.length > 0 && (
              <div style={{ marginTop:"0.9rem", paddingTop:"0.65rem", borderTop:`1px solid ${C.borderDim}` }}>
                <p style={{ color:C.dimmer, fontSize:"0.57rem", letterSpacing:"0.16em", margin:"0 0 0.65rem" }}>AVAILABLE</p>
                {hirableMercs.map(a => {
                  const canHire = tokensAvailable >= a.cost
                  return (
                    <div key={a.id} style={{ display:"flex", alignItems:"center", gap:"0.7rem", marginBottom:"0.4rem" }}>
                      <span style={{ color: canHire ? "rgba(251,146,60,0.6)" : C.dimmer, fontSize:"0.7rem" }}>◇</span>
                      <span style={{ color: canHire ? "rgba(251,146,60,0.82)" : "rgba(255,255,255,0.25)", fontSize:"0.72rem", minWidth:"11rem" }}>{a.name}</span>
                      <span style={{ color:C.dimmer, fontSize:"0.64rem" }}>{a.cost}t</span>
                      {canHire && (
                        <button onClick={() => { setTokensSpent(s => s + a.cost); onAgentHire?.(a.id); addLog(`${a.name} hired`, "#4ade80") }}
                          style={{ background:"rgba(251,146,60,0.09)", border:"1px solid rgba(251,146,60,0.25)",
                            borderRadius:"3px", color:"rgba(251,146,60,0.8)", fontSize:"0.6rem",
                            padding:"0.12rem 0.45rem", cursor:"pointer", fontFamily:"monospace" }}>
                          hire
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{ marginTop:"1.2rem" }}>
              <span style={{ color:C.dimmer, fontSize:"0.58rem" }}>ESC back  ·  TAB command mode</span>
            </div>
          </div>
        )}

        {/* ── CAPY / ARCHIVE placeholder ── */}
        {(view === ("capy" as string) || view === ("archive" as string)) && (
          <div>
            <p style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.7rem" }}>
              {(view as string).toUpperCase()} — coming soon
            </p>
            <p style={{ color:C.dimmer, fontSize:"0.58rem", marginTop:"0.5rem" }}>ESC back</p>
          </div>
        )}

      </div>

      {/* Status bar / command input */}
      <div style={{ borderTop:`1px solid ${C.borderDim}`, padding:"0.5rem 1.5rem 0.65rem",
        flexShrink:0, display:"flex", alignItems:"center", gap:"0.5rem" }}>
        {cmdMode ? (
          <>
            <span style={{ color:C.purple, fontSize:"0.8rem" }}>{">"}</span>
            <input
              ref={inputRef}
              value={cmdText}
              onChange={e => setCmdText(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter")  { e.preventDefault(); runCmd(cmdText); setCmdText("") }
                if (e.key === "Escape") { e.preventDefault(); setCmdMode(false); setCmdText("") }
              }}
              placeholder="type a command — help for list"
              style={{ flex:1, background:"transparent", border:"none", outline:"none",
                color:"rgba(255,255,255,0.72)", fontFamily:"monospace", fontSize:"0.72rem", caretColor:"#966bec" }}
            />
            <span style={{ color:C.dimmer, fontSize:"0.57rem" }}>ESC exit</span>
          </>
        ) : (
          <span style={{ color:C.dimmer, fontSize:"0.57rem", letterSpacing:"0.05em" }}>
            {view === "menu"
              ? "↑↓ navigate  ·  ENTER select  ·  TAB command mode"
              : view === "ship"
                ? "↑↓ or 1–3 select  ·  ENTER deploy  ·  ESC back"
                : "ESC back  ·  TAB command mode"}
          </span>
        )}
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

  function handleAdvance() {
    if (!done) { skipRef.current = true; setDisplayed(text); setDone(true) }
    else onAdvance()
  }

  // SPACE / ENTER / click all advance
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); handleAdvance() }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [done]) // eslint-disable-line

  // Auto-advance 1.5s after typewriter completes — no Enter required
  const onAdvanceRef = useRef(onAdvance)
  onAdvanceRef.current = onAdvance
  useEffect(() => {
    if (!done) return
    const id = setTimeout(() => onAdvanceRef.current(), 1500)
    return () => clearTimeout(id)
  }, [done]) // eslint-disable-line

  const nextBoss   = level <= 4 ? BOSSES[level - 1] : null
  const clearedBoss = BOSSES[Math.min(level - 2, BOSSES.length - 1)]
  const isFinale   = level > 4
  const borderCol  = clearedBoss ? `${clearedBoss.color}55` : "rgba(150,107,236,0.4)"
  const headerCol  = clearedBoss ? clearedBoss.color : "#966bec"

  return (
    <div onClick={handleAdvance}
      style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
        background:"rgba(5,5,12,0.98)", cursor:"pointer", zIndex:10 }}>
      <div style={{ maxWidth:"400px", width:"100%", padding:"1.5rem", textAlign:"center" }}>

        {/* Transmission header */}
        <div style={{ marginBottom:"0.9rem" }}>
          <p style={{ color:`${headerCol}90`, fontSize:"0.52rem", fontFamily:"monospace",
            letterSpacing:"0.35em", margin:"0 0 0.4rem", textTransform:"uppercase" }}>
            ·· signal transmission ··
          </p>
          <div style={{ fontSize:"2.2rem", marginBottom:"0.35rem", filter:`drop-shadow(0 0 8px ${headerCol})` }}>
            🦫
          </div>
          {clearedBoss && (
            <p style={{ color:clearedBoss.color, fontSize:"0.58rem", fontFamily:"monospace",
              letterSpacing:"0.2em", margin:0, opacity:0.8 }}>
              {clearedBoss.name} · SECTOR {level - 1}
            </p>
          )}
        </div>

        {/* Dialog box */}
        <div style={{ background:"rgba(8,8,18,0.95)", border:`1px solid ${borderCol}`,
            borderRadius:"8px", padding:"1.3rem 1.6rem", marginBottom:"1rem",
            boxShadow:`0 0 18px ${borderCol}40`,
            display:"flex", alignItems:"center", justifyContent:"center" }}>
          <p style={{ color:"rgba(240,240,255,0.92)", fontSize:"0.86rem", lineHeight:1.9, margin:0,
            whiteSpace:"pre-line", textAlign:"left", fontFamily:"monospace" }}>
            {displayed}
            {!done && <span className="cursor-blink">|</span>}
          </p>
        </div>

        {/* Prompt + next sector hint */}
        <p style={{ color: done ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)",
          fontSize:"0.65rem", margin:"0 0 0.55rem", transition:"color 0.4s",
          fontFamily:"monospace", letterSpacing:"0.05em" }}>
          {done ? "[ click · space · enter ]" : "· · ·"}
        </p>
        {nextBoss && done && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:"0.5rem" }}>
            <span style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.6rem", fontFamily:"monospace" }}>NEXT</span>
            <span style={{ color: nextBoss.color, fontSize:"0.76rem", fontWeight:700,
              fontFamily:"monospace", letterSpacing:"0.1em",
              textShadow:`0 0 10px ${nextBoss.color}88` }}>
              SECTOR {level} · {nextBoss.name}
            </span>
          </div>
        )}
        {isFinale && done && (
          <p style={{ color:"#4ade80", fontSize:"0.76rem", fontWeight:700,
            fontFamily:"monospace", letterSpacing:"0.12em", margin:0,
            textShadow:"0 0 12px #4ade8088" }}>
            ∞ INFINITE RECURSION
          </p>
        )}
      </div>
    </div>
  )
}

function GameOver({ score, level, kills, maxCombo, upgradeCount, shotsFired, isNewPB, isNewSectorPB, onRestart, unlockedAgents, onShowStack, endless, endlessDepth, prevDepthBest, upgrades, persistentSignal, fragmentsEarned }: { score: number; level: number; kills: number; maxCombo: number; upgradeCount: number; shotsFired: number; isNewPB: boolean; isNewSectorPB: boolean; onRestart: () => void; unlockedAgents: string[]; onShowStack: () => void; endless?: boolean; endlessDepth?: number; prevDepthBest?: number; upgrades?: Record<string, number>; persistentSignal?: PersistentSignal; fragmentsEarned?: number }) {
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

  // Expedition hint — depth-first motivation
  const depth = endless ? (endlessDepth ?? 1) : level
  const nextHint = endless
    ? endlessDepth && endlessDepth >= 9
      ? "The recursion restarts. The void does not forget."
      : endlessDepth && endlessDepth >= 5
        ? `Depth ${endlessDepth}. Few signals survive this far. Push further.`
        : `Depth ${endlessDepth ?? 1} in The Void. It runs deeper.`
    : level >= 4
      ? "Sector 4. Beyond The Collapse: The Void. Endless and hungry."
      : level >= 2
        ? `Sector ${level}. ${4 - level} sector${4-level!==1?"s":""} between you and The Void.`
        : "Sector 1. The signal is live. The Void is 4 sectors deeper."

  const isNewDepthPB = endless && endlessDepth != null && prevDepthBest != null && endlessDepth > prevDepthBest

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRestart() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onRestart])

  const bossNames = ["THE RECURSION","THE DRIFT","THE FRAGMENT","THE COLLAPSE"]
  const whereFell = endless
    ? endlessDepth && endlessDepth >= 9 ? "THE RECURSION" : "THE VOID"
    : bossNames[level - 1] ?? "THE SIGNAL"

  // Sector death tint — each boss has its color signature
  const deathBossColor = endless ? "#a855f7" : BOSSES[Math.min(level - 1, BOSSES.length - 1)].color
  const deathBossRgb = deathBossColor === "#f87171" ? "248,113,113"
    : deathBossColor === "#fb923c" ? "251,146,60"
    : deathBossColor === "#facc15" ? "250,204,21"
    : deathBossColor === "#4ade80" ? "74,222,128"
    : "168,85,247"

  return (
    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:`rgba(${deathBossRgb === "248,113,113" ? "18,8,8" : deathBossRgb === "251,146,60" ? "16,10,6" : "10,10,18"},0.97)`, zIndex:10 }}>
      <div style={{ background:"#13131c", border:`1px solid rgba(${deathBossRgb},0.25)`, borderRadius:"10px", padding:"1.6rem 1.4rem", maxWidth:"310px", width:"calc(100% - 2rem)", textAlign:"center" }}>

        {/* Status */}
        <p style={{ color:"rgba(150,107,236,0.45)", fontSize:"0.5rem", margin:"0 0 0.12rem", fontFamily:"monospace", letterSpacing:"0.2em" }}>
          EXPEDITION ENDED
        </p>
        <p style={{ color:"#f87171", fontWeight:700, fontSize:"0.62rem", margin:"0 0 0.35rem", fontFamily:"monospace", letterSpacing:"0.18em" }}>
          SIGNAL LOST
        </p>
        {/* Last transmission — capy sign-off */}
        <p style={{ color:"rgba(196,181,253,0.45)", fontSize:"0.56rem", margin:"0 0 0.85rem", fontFamily:"monospace", lineHeight:1.6, whiteSpace:"pre-line" }}>
          🦫 {endless
            ? DEATH_LAST_WORDS[4]
            : DEATH_LAST_WORDS[Math.min(level - 1, 3)]
          }
        </p>

        {/* PRIMARY METRIC: sector/depth — the headline */}
        <p style={{ color:"#c4b5fd", fontSize:"3rem", fontWeight:700, margin:"0 0 0.1rem", fontFamily:"monospace", lineHeight:1 }}>
          {endless ? `DEPTH ${depth}` : `SECTOR ${level}`}
        </p>
        <p style={{ color:`rgba(${deathBossRgb},0.6)`, fontSize:"0.58rem", margin:"0 0 0.6rem", fontFamily:"monospace", letterSpacing:"0.14em" }}>
          {whereFell}
        </p>

        {/* Record badge */}
        {(isNewDepthPB || isNewSectorPB || isNewPB) ? (
          <p style={{ color:"#fde68a", fontSize:"0.62rem", margin:"0 0 1rem", fontFamily:"monospace", letterSpacing:"0.1em" }}>
            ★ {isNewDepthPB ? "DEEPEST RUN" : isNewSectorPB ? "DEEPEST SECTOR" : "SCORE RECORD"}
          </p>
        ) : <div style={{ marginBottom:"1rem" }} />}

        {/* Secondary stats — score lives here, not at the top */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.4rem", marginBottom:"1rem" }}>
          {([
            ["SCORE", score.toLocaleString()],
            ["KILLS", kills],
            ["CHAIN", `${maxCombo}×`],
          ] as [string, string|number][]).map(([label, val]) => (
            <div key={label} style={{ background:"rgba(255,255,255,0.04)", borderRadius:"4px", padding:"0.45rem 0.2rem" }}>
              <p style={{ color:"rgba(212,211,215,0.85)", fontSize:"0.82rem", fontWeight:600, margin:"0 0 0.1rem", fontFamily:"monospace" }}>{val}</p>
              <p style={{ color:"rgba(160,159,162,0.4)", fontSize:"0.54rem", margin:0, fontFamily:"monospace", letterSpacing:"0.08em" }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Expedition hint */}
        <div style={{ background:"rgba(150,107,236,0.07)", border:"1px solid rgba(150,107,236,0.13)", borderRadius:"5px", padding:"0.5rem 0.75rem", marginBottom:"0.7rem" }}>
          <p style={{ color:"rgba(196,181,253,0.75)", fontSize:"0.65rem", margin:0, fontFamily:"monospace", lineHeight:1.6 }}>
            {nextHint}
          </p>
        </div>

        {/* The Signal persists — expedition contribution summary */}
        {persistentSignal && persistentSignal.operationalAge > 0 && (
          <div style={{ background:"rgba(150,107,236,0.04)", border:"1px solid rgba(150,107,236,0.12)",
            borderRadius:"5px", padding:"0.5rem 0.75rem", marginBottom:"0.9rem" }}>
            <p style={{ color:"rgba(150,107,236,0.5)", fontSize:"0.5rem", fontFamily:"monospace",
              letterSpacing:"0.18em", margin:"0 0 0.3rem" }}>THE SIGNAL PERSISTS</p>
            <div style={{ display:"flex", flexDirection:"column", gap:"0.12rem" }}>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.56rem", fontFamily:"monospace" }}>Operational Age</span>
                <span style={{ color:"rgba(255,255,255,0.55)", fontSize:"0.58rem", fontFamily:"monospace", fontWeight:600 }}>
                  {persistentSignal.operationalAge} runs
                </span>
              </div>
              {(fragmentsEarned ?? 0) > 0 && (
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.56rem", fontFamily:"monospace" }}>Recovered Intent</span>
                  <span style={{ color:"#c4b5fd", fontSize:"0.58rem", fontFamily:"monospace", fontWeight:600 }}>
                    +{fragmentsEarned} → {persistentSignal.recoveredIntent.toLocaleString()} total
                  </span>
                </div>
              )}
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.56rem", fontFamily:"monospace" }}>Archive</span>
                <span style={{ color:"rgba(255,255,255,0.45)", fontSize:"0.58rem", fontFamily:"monospace" }}>
                  {signalArchiveCompletion(persistentSignal)}% · {persistentSignal.clearedBosses.length}/{TOTAL_ARCHIVE_NODES} systems
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Carried upgrades — what you had when you fell */}
        {upgrades && Object.keys(upgrades).some(k => upgrades[k] > 0) && (() => {
          const carried = UPGRADES.filter(u => (upgrades[u.id] ?? 0) > 0)
          return (
            <div style={{ marginBottom:"0.85rem" }}>
              <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.52rem", fontFamily:"monospace",
                letterSpacing:"0.22em", margin:"0 0 0.4rem", textTransform:"uppercase" }}>
                CARRIED INTO THE SIGNAL
              </p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem", justifyContent:"center" }}>
                {carried.map(u => (
                  <span key={u.id} style={{
                    color:`rgba(${deathBossRgb},0.7)`, fontSize:"0.58rem", fontFamily:"monospace",
                    background:`rgba(${deathBossRgb},0.06)`, border:`1px solid rgba(${deathBossRgb},0.18)`,
                    borderRadius:"3px", padding:"0.15rem 0.4rem", letterSpacing:"0.04em",
                  }}>
                    {u.name}{(upgrades[u.id] ?? 0) > 1 ? ` ×${upgrades[u.id]}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Primary CTA — "push deeper" framing */}
        <button onClick={onRestart}
          style={{ display:"block", width:"100%", background:"linear-gradient(135deg,#7c3aed,#6d28d9)", border:"none", borderRadius:"6px", padding:"0.78rem", color:"#fff", fontSize:"0.85rem", fontWeight:700, cursor:"pointer", marginBottom:"0.5rem", letterSpacing:"0.1em", fontFamily:"monospace", boxShadow:"0 0 20px rgba(124,58,237,0.4)" }}>
          NEXT EXPEDITION <span style={{ opacity:0.45, fontSize:"0.6rem" }}>ENTER</span>
        </button>

        {/* THE SIGNAL crew */}
        <button onClick={onShowStack}
          style={{ display:"block", width:"100%", background:"transparent", border:"1px solid rgba(150,107,236,0.18)", borderRadius:"6px", padding:"0.5rem", color:"rgba(196,181,253,0.6)", fontSize:"0.7rem", cursor:"pointer", fontFamily:"monospace", letterSpacing:"0.07em" }}>
          THE SIGNAL
          {unlockedAgents.length > 0
            ? <span style={{ marginLeft:"0.4rem", color:"#4ade80", fontSize:"0.6rem" }}>{unlockedAgents.length} deployed</span>
            : <span style={{ marginLeft:"0.4rem", opacity:0.4, fontSize:"0.6rem" }}>crew</span>
          }
        </button>

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

// ═══════════════════════════════════════════════════════════════════════════
// ── Ship Station System Components ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ── Shared panel shell ─────────────────────────────────────────────────────
function StationShell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "#0c0c16",
      border: "1px solid rgba(150,107,236,0.18)",
      borderRadius: "6px",
      fontFamily: "monospace",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      ...style,
    }}>
      {children}
    </div>
  )
}

function StationHeader({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <div style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid rgba(150,107,236,0.12)",
      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ color: "rgba(150,107,236,0.8)", fontSize: "0.54rem", letterSpacing: "0.2em" }}>{label}</span>
      {sublabel && <span style={{ color: "rgba(255,255,255,0.18)", fontSize: "0.52rem" }}>{sublabel}</span>}
    </div>
  )
}

// Base crew roster — agents are added dynamically from unlockedAgents
type CrewOption = string | null  // "capy" | "player" | agent_id | null

// ── Ship Status Panel ──────────────────────────────────────────────────────
function ShipStatusPanel({ hull, stations: initialStations, activeStation, onSelectStation, liveG, unlockedAgents, agentNames, roomDamage, roomActions, crewStats }: {
  hull: HullStatus
  stations: Station[]
  activeStation: StationId
  onSelectStation: (id: StationId) => void
  liveG: LiveGSnapshot
  unlockedAgents: string[]
  agentNames: Record<string, string>
  roomDamage: Partial<Record<StationId, number>>
  roomActions: Partial<Record<StationId, string>>
  crewStats: Partial<Record<string, number>>
}) {
  const hullPct     = Math.round((hull.currentHull / hull.maxHull) * 100)
  const hullCol     = hullPct > 60 ? "#4ade80" : hullPct > 30 ? "#facc15" : "#f87171"
  const hullBarW    = `${hullPct}%`
  const stationKeys: Record<StationId, string> = { bridge: "1", turret: "2", salvage: "3", engineering: "4" }

  // Dynamic crew roster: capy + player + unlocked agents + empty
  const crewRoster: CrewOption[] = ["capy", "player", ...unlockedAgents, null]

  // Local crew assignment state — persisted to localStorage
  const [crewAssign, setCrewAssign] = useState<Record<StationId, CrewOption>>(() => {
    // Try to restore saved crew assignments
    try {
      const saved = localStorage.getItem("sb_crew_assign")
      if (saved) return JSON.parse(saved) as Record<StationId, CrewOption>
    } catch {}
    // Default: use STATION_DEFS defaults
    const m: Record<string, CrewOption> = {}
    initialStations.forEach(s => { m[s.id] = s.assignedCrew ?? null })
    return m as Record<StationId, CrewOption>
  })
  function cycleCrew(stationId: StationId, e: React.MouseEvent) {
    e.stopPropagation()  // don't also switch active station
    setCrewAssign(prev => {
      const cur = prev[stationId]
      const idx = crewRoster.indexOf(cur)
      const next = crewRoster[(idx + 1) % crewRoster.length]
      const updated = { ...prev, [stationId]: next }
      try { localStorage.setItem("sb_crew_assign", JSON.stringify(updated)) } catch {}
      return updated
    })
  }

  // Hull damage pulse — flashes red when lives drop
  const [hullDamaged, setHullDamaged] = useState(false)
  const prevHull = useRef(hull.currentHull)
  useEffect(() => {
    if (hull.currentHull < prevHull.current) {
      setHullDamaged(true)
      const id = setTimeout(() => setHullDamaged(false), 500)
      prevHull.current = hull.currentHull
      return () => clearTimeout(id)
    }
    prevHull.current = hull.currentHull
  }, [hull.currentHull])

  return (
    <StationShell style={{ flex: "0 0 220px", minWidth: 0 }}>
      <StationHeader
        label="SHIP STATUS"
        sublabel={liveG.bossName ? `⚠ ${liveG.bossName}` : "THE SIGNAL"}
      />
      <div style={{ padding: "0.6rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.55rem" }}>

        {/* Hull integrity */}
        <div style={{ transition: "opacity 0.1s", opacity: hullDamaged ? 0.55 : 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.22rem" }}>
            <span style={{ color: hullDamaged ? "#f87171" : "rgba(255,255,255,0.35)", fontSize: "0.56rem", letterSpacing: "0.1em", transition: "color 0.15s" }}>HULL</span>
            <span style={{ color: hullDamaged ? "#f87171" : hullCol, fontSize: "0.58rem", fontWeight: 700, transition: "color 0.15s" }}>{hullPct}%</span>
          </div>
          <div style={{ height: "4px", background: "rgba(255,255,255,0.07)", borderRadius: "2px",
            boxShadow: hullDamaged ? "0 0 8px rgba(248,113,113,0.5)" : "none", transition: "box-shadow 0.2s" }}>
            <div style={{ height: "100%", width: hullBarW,
              background: hullDamaged ? "#f87171" : hullCol,
              borderRadius: "2px", transition: "width 0.4s, background 0.2s",
              boxShadow: `0 0 6px ${hullDamaged ? "#f87171" : hullCol}66` }} />
          </div>
        </div>

        {/* Station list + crew */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.18rem" }}>
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.52rem", letterSpacing: "0.14em", marginBottom: "0.06rem" }}>STATIONS</span>
          {initialStations.map(s => {
            const active = s.id === activeStation
            return (
              <button key={s.id} onClick={() => onSelectStation(s.id)}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem",
                  background: active ? "rgba(150,107,236,0.1)" : "transparent",
                  border: active ? "1px solid rgba(150,107,236,0.35)" : "1px solid transparent",
                  borderRadius: "3px", padding: "0.22rem 0.4rem", cursor: "pointer",
                  width: "100%", textAlign: "left" }}>
                <span style={{ color: "rgba(255,255,255,0.14)", fontSize: "0.5rem", width: "0.65rem" }}>
                  {stationKeys[s.id]}
                </span>
                <span style={{ color: active ? "#c4b5fd" : "rgba(255,255,255,0.45)",
                  fontSize: "0.65rem", flex: 1, fontWeight: active ? 600 : 400 }}>
                  {s.name}
                </span>
                <span
                  onClick={e => cycleCrew(s.id, e)}
                  title="click to reassign crew"
                  style={{
                    color: crewAssign[s.id] ? "rgba(74,222,128,0.75)" : "rgba(255,255,255,0.18)",
                    fontSize: "0.53rem",
                    fontStyle: crewAssign[s.id] ? "normal" : "italic",
                    cursor: "pointer",
                    padding: "0.05rem 0.25rem",
                    borderRadius: "2px",
                    border: "1px solid transparent",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(150,107,236,0.3)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "transparent")}
                >
                  [{crewLabel(crewAssign[s.id], agentNames)}]
                </span>
              </button>
            )
          })}
        </div>

        {/* Ship blueprint with crew presence */}
        <ShipBlueprint
          activeStation={activeStation}
          roomDamage={roomDamage}
          crewAssign={crewAssign}
          roomActions={roomActions}
          agentNames={agentNames}
        />

        {/* Crew statistics */}
        <CrewStatsPanel crewAssign={crewAssign} crewStats={crewStats} agentNames={agentNames} />

      </div>
    </StationShell>
  )
}

// ── Ship Blueprint ─────────────────────────────────────────────────────────
const DAMAGE_COLORS = ["", "#facc15", "#fb923c", "#f87171"]  // 0=intact, 1=dmg, 2=crit, 3=offline
const DAMAGE_LABELS = ["", "DMG", "CRIT", "OFFLINE"]

function ShipBlueprint({ activeStation, roomDamage, crewAssign, roomActions, agentNames }: {
  activeStation: StationId
  roomDamage: Partial<Record<StationId, number>>
  crewAssign: Partial<Record<StationId, string | null>>
  roomActions: Partial<Record<StationId, string>>
  agentNames: Record<string, string>
}) {
  const rooms: Array<{ id: StationId; label: string; icon: string; powerKey?: string }> = [
    { id: "bridge",      label: "BRIDGE",      icon: "◈", powerKey: "sensors" },
    { id: "turret",      label: "TURRET",      icon: "⊕", powerKey: "turret"  },
    { id: "salvage",     label: "SALVAGE",     icon: "◇"                       },
    { id: "engineering", label: "ENGINEERING", icon: "⚙", powerKey: "shields" },
  ]
  const totalPower = Object.values(_stationState.power).reduce((a, b) => a + b, 0)
  return (
    <div>
      <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.52rem", letterSpacing: "0.14em" }}>BLUEPRINT</span>
      <div style={{ marginTop: "0.3rem", display: "flex", flexDirection: "column", gap: "0.18rem" }}>
        {rooms.map(r => {
          const active   = r.id === activeStation
          const dmg      = roomDamage[r.id] ?? 0
          const dmgCol   = dmg > 0 ? DAMAGE_COLORS[dmg] : null
          const crew     = crewAssign[r.id] ?? null
          const action   = roomActions[r.id]
          const crewName = crewLabel(crew, agentNames)
          const statusLine = action
            ? action
            : crew ? "ACTIVE"
            : "EMPTY"
          const statusCol = action
            ? "#4ade80"
            : crew === "player" ? "#a78bfa"
            : crew ? "#86efac"
            : "rgba(255,255,255,0.2)"
          const powerVal = r.powerKey ? (_stationState.power[r.powerKey] ?? 0) : 0
          const powerPct = powerVal / POWER_POOL
          const powerCol = POWER_SYSTEMS.find(s => s.id === r.powerKey)?.col ?? "transparent"
          return (
            <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.35rem",
              padding: "0.2rem 0.35rem",
              border: `1px solid ${dmg > 0 ? `${dmgCol}55` : active ? "rgba(150,107,236,0.4)" : "rgba(255,255,255,0.07)"}`,
              borderRadius: "3px",
              background: dmg > 0 ? `${dmgCol}08` : active ? "rgba(150,107,236,0.05)" : "transparent" }}>
              <span style={{ color: dmg > 0 ? dmgCol! : active ? "#a78bfa" : "rgba(255,255,255,0.2)", fontSize: "0.58rem", lineHeight:"1.5rem" }}>{r.icon}</span>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ color: dmg > 0 ? dmgCol! : "rgba(255,255,255,0.45)", fontSize: "0.52rem", letterSpacing: "0.08em" }}>
                    {r.label}
                    {dmg > 0 && <span style={{ color:dmgCol!, marginLeft:"0.3rem", fontSize:"0.44rem" }}>{DAMAGE_LABELS[dmg]}</span>}
                  </span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"0.3rem" }}>
                  {crew && <span style={{ color:"rgba(255,255,255,0.5)", fontSize:"0.5rem" }}>{crewName}</span>}
                  <span style={{ color:statusCol, fontSize:"0.48rem", letterSpacing:"0.06em" }}>{statusLine}</span>
                </div>
                {r.powerKey && powerVal > 0 && (
                  <div style={{ height:"2px", background:"rgba(255,255,255,0.05)", borderRadius:"1px", marginTop:"0.12rem" }}>
                    <div style={{ height:"100%", width:`${powerPct * 100}%`, background:powerCol,
                      borderRadius:"1px", boxShadow:`0 0 3px ${powerCol}88`, transition:"width 0.3s" }} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Crew Statistics Panel ──────────────────────────────────────────────────
function CrewStatsPanel({ crewAssign, crewStats, agentNames }: {
  crewAssign: Partial<Record<StationId, string | null>>
  crewStats: Partial<Record<string, number>>
  agentNames: Record<string, string>
}) {
  const assignedCrew = new Set(Object.values(crewAssign).filter(Boolean) as string[])
  if (assignedCrew.size === 0) return null
  const STAT_LABELS: Record<string, Array<[string, string]>> = {
    capy:           [["capy_marks", "Targets Marked"], ["capy_assists", "Assists"], ["capy_eliteMarks", "Elite Marks"]],
    veteran_gunner: [["veteran_kills", "Kills"], ["veteran_eliteKills", "Elite Kills"], ["veteran_shots", "Shots Fired"]],
    engineer_bot:   [["engineer_repairs", "Repairs"]],
    salvager_bot:   [["salvager_fragment", "Fragments"], ["salvager_artifact", "Artifacts"], ["salvager_scrap", "Scrap"]],
    scout_drone:    [["scout_threats", "Threats Found"], ["scout_artifacts", "Artifacts Found"]],
  }
  const hasStats = Object.values(crewStats).some(v => (v ?? 0) > 0)
  if (!hasStats) return null
  return (
    <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:"0.4rem", marginTop:"0.2rem" }}>
      <span style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.5rem", letterSpacing:"0.14em" }}>CREW STATS</span>
      <div style={{ display:"flex", flexDirection:"column", gap:"0.3rem", marginTop:"0.25rem" }}>
        {[...assignedCrew].map(crew => {
          const labels = STAT_LABELS[crew]; if (!labels) return null
          const anyStats = labels.some(([key]) => (crewStats[key] ?? 0) > 0)
          if (!anyStats) return null
          return (
            <div key={crew}>
              <span style={{ color:"rgba(255,255,255,0.35)", fontSize:"0.5rem", fontWeight:600, letterSpacing:"0.06em" }}>
                {crewLabel(crew, agentNames).toUpperCase()}
              </span>
              {labels.map(([key, label]) => {
                const val = crewStats[key] ?? 0; if (!val) return null
                return (
                  <div key={key} style={{ display:"flex", justifyContent:"space-between", paddingLeft:"0.5rem" }}>
                    <span style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.48rem" }}>{label}</span>
                    <span style={{ color:"rgba(255,255,255,0.5)", fontSize:"0.5rem", fontWeight:600 }}>{val}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Active Station Panel ───────────────────────────────────────────────────
type LiveGSnapshot = {
  kills: number; wordsKilled: number; combo: number
  bossHpPct: number | null; bossName: string | null; capyMsg: string
  wordCount: number
  wordDots: Array<{ x: number; y: number; bug: boolean; id: number; elite: boolean }>
  bossX: number | null; bossY: number | null
  upgrades: Record<string, number>
  shield: boolean
  commsLog: string[]
  elapsedSec: number
  wordsEscaped: number
  salvageCount: number
  salvageCollected: number
  salvageItems: Array<{ id: number; type: SalvageItem["type"]; corrupted?: boolean }>
  roomDamage: Partial<Record<StationId, number>>
  artifacts: string[]
  engineeringPoolBonus: number
  operatorStatus: Partial<Record<string, { action: string; detail?: string }>>
  crewStats: Partial<Record<string, number>>
}

function ActiveStationPanel({ activeStation, lives, score, level, phase, liveG, onTurretFire, onGrapple }: {
  activeStation: StationId
  lives: number
  score: number
  level: number
  phase: string
  liveG: LiveGSnapshot
  onTurretFire: (angle: number) => void
  onGrapple: () => void
}) {
  return (
    <StationShell style={{ flex: 1, minWidth: 0 }}>
      <StationHeader
        label={activeStation.toUpperCase()}
        sublabel={activeStation === "bridge" ? "1" : activeStation === "turret" ? "2" : activeStation === "salvage" ? "3" : "4"}
      />
      <div style={{ padding: "0.5rem 0.75rem" }}>
        {activeStation === "bridge"      && <BridgeStationView phase={phase} level={level} score={score} liveG={liveG} />}
        {activeStation === "turret"      && <TurretStationView onFire={onTurretFire} phase={phase} liveG={liveG} />}
        {activeStation === "salvage"     && <SalvageStationView liveG={liveG} score={score} phase={phase} onGrapple={onGrapple} />}
        {activeStation === "engineering" && <EngineeringStationView liveG={liveG} phase={phase} />}
      </div>
    </StationShell>
  )
}

// ── Threat Radar ───────────────────────────────────────────────────────────
// Mini top-down dot map of the battlefield — pure display
function ThreatRadar({ dots, bossX, bossY, bridgeDamage }: {
  dots: Array<{ x: number; y: number; bug: boolean; id: number; elite: boolean }>
  bossX: number | null; bossY: number | null
  bridgeDamage?: number
}) {
  const W = 110, H = 52
  // Sensors power unlocks features: 0-2=basic, 3-5=type labels, 6+=elite highlight + scan range
  const sensorsLvl    = _stationState.power.sensors
  const showTypeLabel = sensorsLvl >= 3
  const extendedRange = sensorsLvl >= 5
  // Bridge damage causes radar static (dots jitter)
  const radarStatic   = (bridgeDamage ?? 0) >= 2
  const [markedId, setMarkedId] = useState<number | null>(null)

  function handleDotClick(id: number) {
    const next = _stationState.markedTargetId === id ? null : id
    _stationState.markedTargetId = next
    _stationState.markedAt = Date.now()
    setMarkedId(next)
  }

  // Sync local state if mark was cleared by a kill
  useEffect(() => {
    if (_stationState.markedTargetId !== markedId) setMarkedId(_stationState.markedTargetId)
  })

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.14rem", alignItems:"baseline" }}>
        <span style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.5rem", letterSpacing:"0.1em" }}>THREAT RADAR</span>
        <span style={{ color: markedId !== null ? "#f87171" : "rgba(255,255,255,0.15)", fontSize:"0.5rem" }}>
          {markedId !== null ? "TARGET LOCKED" : `${dots.length} contacts`}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}
        style={{ display:"block", border:`1px solid ${markedId !== null ? "rgba(248,113,113,0.3)" : "rgba(150,107,236,0.12)"}`,
          borderRadius:"3px", background:"rgba(0,0,0,0.3)", cursor:"crosshair", transition:"border-color 0.2s" }}>
        {/* Grid lines */}
        <line x1={W/2} y1={0} x2={W/2} y2={H} stroke="rgba(150,107,236,0.1)" strokeWidth="0.5" />
        <line x1={0} y1={H*0.8} x2={W} y2={H*0.8} stroke="rgba(150,107,236,0.1)" strokeWidth="0.5" strokeDasharray="2 3" />
        {/* Turret aim line */}
        {_stationState.active === "turret" && (() => {
          const playerY = H * (1 - 50 / GH)
          const ax = W / 2 + Math.cos(_stationState.turretAngle) * 18
          const ay = playerY + Math.sin(_stationState.turretAngle) * 18
          return (
            <>
              <line x1={W/2} y1={playerY} x2={ax} y2={ay} stroke="#a78bfa" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.7" />
              <circle cx={ax} cy={ay} r="1.8" fill="none" stroke="#c4b5fd" strokeWidth="0.8" opacity="0.6" />
            </>
          )
        })()}
        {/* Player */}
        <polygon points={`${W/2},${H-3} ${W/2-3},${H+1} ${W/2+3},${H+1}`} fill="#a78bfa" opacity="0.9" />
        <circle cx={W/2} cy={H-4} r="2.5" fill="#a78bfa" />
        {/* Extended range ring at sensors 5+ */}
        {extendedRange && <circle cx={W/2} cy={H*0.85} r={W*0.45} fill="none" stroke="rgba(125,211,252,0.15)" strokeWidth="0.5" strokeDasharray="3 4" />}
        {/* Word dots — clickable to mark, sensors affects labels */}
        {dots.map((d, i) => {
          // Bridge damage: dots jitter when radar has static
          const jx = radarStatic ? (Math.sin(Date.now() / 80 + i * 2.3) * 2) : 0
          const jy = radarStatic ? (Math.cos(Date.now() / 95 + i * 1.7) * 2) : 0
          const dx = d.x * W + jx; const dy = d.y * H + jy
          if (dy < 0 || dy > H * (extendedRange ? 1.1 : 1) || dx < 0 || dx > W) return null
          const isLocked = d.id === markedId
          const r = d.elite ? 3.5 : d.bug ? 2.5 : 1.8
          const typeLabel = showTypeLabel ? (d.elite ? "E" : d.bug ? "B" : "S") : null
          return (
            <g key={i} onClick={() => handleDotClick(d.id)} style={{ cursor:"pointer" }}>
              {isLocked && <circle cx={dx} cy={dy} r={r + 4} fill="none" stroke="#f87171" strokeWidth="1" strokeDasharray="2 2" opacity="0.8" />}
              <circle cx={dx} cy={dy} r={r}
                fill={isLocked ? "#f87171" : d.bug ? "#f97316" : d.elite ? "#facc15" : "rgba(196,181,253,0.7)"}
                opacity={radarStatic ? 0.5 : isLocked ? 1 : 0.85} />
              {typeLabel && !radarStatic && (
                <text x={dx + r + 1.5} y={dy + 2.5} fontSize="4" fill="rgba(255,255,255,0.5)" fontFamily="monospace">{typeLabel}</text>
              )}
            </g>
          )
        })}
        {/* Boss dot */}
        {bossX !== null && bossY !== null && (
          <>
            <circle cx={bossX * W} cy={bossY * H} r="5" fill="none" stroke="#f87171" strokeWidth="1" opacity="0.7" />
            <circle cx={bossX * W} cy={bossY * H} r="2.5" fill="#f87171" opacity="0.9" />
          </>
        )}
        {/* Bridge damage static overlay */}
        {radarStatic && (
          <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.03)"
            style={{ filter:"url(#noise)" }} />
        )}
      </svg>
      <p style={{ color:"rgba(255,255,255,0.14)", fontSize:"0.48rem", margin:"0.18rem 0 0", fontFamily:"monospace" }}>
        {bridgeDamage && bridgeDamage >= 2 ? "⚠ radar interference" : showTypeLabel ? "click lock · B=bug S=story E=elite" : "click contact to lock · +50% score on kill"}
      </p>
    </div>
  )
}

// ── Bridge Station ─────────────────────────────────────────────────────────
function BridgeStationView({ phase, level, score, liveG }: {
  phase: string; level: number; score: number; liveG: LiveGSnapshot
}) {
  const sectorNames: Record<number, string> = {
    1: "THE RECURSION", 2: "THE DRIFT", 3: "THE FRAGMENT", 4: "THE COLLAPSE",
  }
  const statusLine = phase === "playing" ? "ONLINE"
    : phase === "attract"              ? "AWAITING LAUNCH"
    : phase === "over"                 ? "SIGNAL LOST"
    : phase === "reward"               ? "REWARD SELECTION"
    : phase === "upgrade"              ? "UPGRADE IN PROGRESS"
    : "TRANSMISSION"
  const statusCol  = phase === "over" ? "#f87171" : phase === "playing" ? "#4ade80" : "rgba(255,255,255,0.45)"

  const wordsLeft  = Math.max(0, WORDS_TO_BOSS - liveG.wordsKilled)
  const progPct    = Math.min(1, liveG.wordsKilled / WORDS_TO_BOSS)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
      <StatusRow label="NAVIGATION" value={statusLine} valueCol={statusCol} />

      {phase === "playing" && (
        <>
          <StatusRow label="SECTOR"  value={level <= 4 ? `${level} · ${sectorNames[level] ?? ""}` : "∞ THE VOID"} valueCol="rgba(196,181,253,0.75)" />
          <StatusRow label="SCORE"   value={score.toLocaleString()} valueCol="rgba(255,255,255,0.45)" />
          <StatusRow label="KILLS"   value={String(liveG.kills)} valueCol="rgba(255,255,255,0.45)" />
          {liveG.elapsedSec > 0 && (
            <StatusRow label="ELAPSED"
              value={`${Math.floor(liveG.elapsedSec/60)}:${String(liveG.elapsedSec%60).padStart(2,"0")}`}
              valueCol="rgba(255,255,255,0.3)" />
          )}
          {liveG.combo > 3 && (
            <StatusRow label="CHAIN" value={`×${liveG.combo}`} valueCol={liveG.combo >= 20 ? "#facc15" : liveG.combo >= 10 ? "#fb923c" : "#c4b5fd"} />
          )}

          {/* Boss HP bar */}
          {liveG.bossHpPct !== null && liveG.bossName && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.18rem" }}>
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.52rem", letterSpacing: "0.08em" }}>{liveG.bossName}</span>
                <span style={{ color: "#f87171", fontSize: "0.52rem" }}>{Math.round(liveG.bossHpPct * 100)}%</span>
              </div>
              <div style={{ height: "3px", background: "rgba(255,255,255,0.07)", borderRadius: "2px" }}>
                <div style={{ height: "100%", width: `${liveG.bossHpPct * 100}%`,
                  background: liveG.bossHpPct > 0.5 ? "#f87171" : liveG.bossHpPct > 0.25 ? "#facc15" : "#ff4444",
                  borderRadius: "2px", transition: "width 0.2s" }} />
              </div>
            </div>
          )}

          {/* Sector progress bar (only when no boss) */}
          {liveG.bossHpPct === null && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.18rem" }}>
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.52rem", letterSpacing: "0.08em" }}>PATTERNS</span>
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.52rem" }}>{wordsLeft} remaining</span>
              </div>
              <div style={{ height: "3px", background: "rgba(255,255,255,0.07)", borderRadius: "2px" }}>
                <div style={{ height: "100%", width: `${progPct * 100}%`,
                  background: "rgba(150,107,236,0.7)", borderRadius: "2px", transition: "width 0.3s" }} />
              </div>
            </div>
          )}

          {/* Threat radar — dot map of current word positions */}
          <ThreatRadar dots={liveG.wordDots} bossX={liveG.bossX} bossY={liveG.bossY} bridgeDamage={liveG.roomDamage.bridge} />

          {/* Comms log — rolling capy transmission history */}
          {liveG.commsLog.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.35rem", marginTop: "0.05rem" }}>
              <span style={{ color: "rgba(196,181,253,0.3)", fontSize: "0.5rem", letterSpacing: "0.1em" }}>🦫 COMMS</span>
              <div style={{ display:"flex", flexDirection:"column", gap:"0.1rem", marginTop:"0.2rem" }}>
                {liveG.commsLog.map((line, i) => (
                  <p key={i} style={{ color:`rgba(196,181,253,${0.6 - i * 0.13})`,
                    fontSize: i === 0 ? "0.57rem" : "0.5rem",
                    margin:0, fontStyle:"italic", overflow:"hidden",
                    textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {phase !== "playing" && (
        <div style={{ marginTop: "0.3rem" }}>
          <span style={{ color: "rgba(255,255,255,0.12)", fontSize: "0.52rem", fontStyle: "italic" }}>
            Future: crew management · tactical overview
          </span>
        </div>
      )}
    </div>
  )
}

// ── Turret Station ─────────────────────────────────────────────────────────
// Rotating barrel tracks mouse. Click to fire into the main battlefield.
function TurretStationView({ onFire, phase, liveG }: {
  onFire: (angle: number) => void
  phase: string
  liveG: LiveGSnapshot
}) {
  const viewRef       = useRef<HTMLDivElement>(null)
  const angleRef      = useRef(-Math.PI / 2)
  const [angle, setAngle]     = useState(-Math.PI / 2)  // default: point up
  const [firing, setFiring]   = useState(false)
  const [held, setHeld]       = useState(false)
  const holdIntervalRef       = useRef<ReturnType<typeof setInterval> | null>(null)
  const canFire = phase === "playing"

  // Weapon mode — always have pulse + flak; others require upgrades
  const [weaponMode, setWeaponMode] = useState<typeof _stationState.turretWeapon>("pulse")
  const hasSalvage = liveG.salvageCount > 0
  const availableWeapons = [
    { id: "pulse"   as const, label: "PULSE",      desc: "single bolt",      available: true },
    { id: "flak"    as const, label: "FLAK ×7",    desc: "wide burst",       available: true },
    { id: "triple"  as const, label: "TRI ×3",     desc: "tight spread",     available: (liveG.upgrades.triple ?? 0) >= 1 },
    { id: "spray"   as const, label: "SPRAY ×5",   desc: "wide spread",      available: (liveG.upgrades.spray  ?? 0) >= 1 },
    { id: "grapple" as const, label: "GRAPPLE",    desc: `${liveG.salvageCount} debris`, available: true },
  ]

  function selectWeapon(id: typeof _stationState.turretWeapon) {
    setWeaponMode(id); _stationState.turretWeapon = id
  }

  function getAngleFromMouse(e: React.MouseEvent<HTMLDivElement>): number {
    const el = viewRef.current; if (!el) return angleRef.current
    const rect = el.getBoundingClientRect()
    return Math.atan2(e.clientY - (rect.top + rect.height / 2), e.clientX - (rect.left + rect.width / 2))
  }

  function triggerFire(a: number) {
    if (!canFire) return
    onFire(a)
    setFiring(true); _stationState.turretFiring = true
    setTimeout(() => { setFiring(false); _stationState.turretFiring = false }, 90)
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const a = getAngleFromMouse(e)
    angleRef.current = a; setAngle(a); _stationState.turretAngle = a
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const a = getAngleFromMouse(e); angleRef.current = a; setAngle(a)
    setHeld(true); triggerFire(a)
    // continuous fire while held — fires every 320ms (matches main turret rate-limit)
    holdIntervalRef.current = setInterval(() => triggerFire(angleRef.current), 320)
  }

  function handleMouseUp() {
    setHeld(false)
    if (holdIntervalRef.current) { clearInterval(holdIntervalRef.current); holdIntervalRef.current = null }
  }

  // cleanup on unmount
  useEffect(() => () => {
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current)
  }, [])

  // Barrel geometry
  const BARREL_LEN   = 32
  const RECOIL_PULL  = firing ? 4 : 0  // barrel shortens slightly on fire
  const barrelEnd    = BARREL_LEN - RECOIL_PULL
  const tipX = Math.cos(angle) * barrelEnd
  const tipY = Math.sin(angle) * barrelEnd
  // Muzzle flash position (slightly beyond tip)
  const flashX = Math.cos(angle) * (barrelEnd + 5)
  const flashY = Math.sin(angle) * (barrelEnd + 5)
  const degDisplay = Math.round(((angle * 180 / Math.PI) + 360) % 360)

  return (
    <div>
      <div ref={viewRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "relative", height: "110px",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: canFire ? "crosshair" : "not-allowed",
          background: held ? "rgba(167,139,250,0.09)" : firing ? "rgba(167,139,250,0.06)" : "rgba(0,0,0,0.25)",
          borderRadius: "4px",
          border: `1px solid ${held || firing ? "rgba(167,139,250,0.45)" : "rgba(150,107,236,0.12)"}`,
          transition: "background 0.06s, border-color 0.06s",
          userSelect: "none",
        }}>

        {/* Range rings */}
        <div style={{ position:"absolute", width:"84px", height:"84px", borderRadius:"50%", border:"1px solid rgba(150,107,236,0.15)" }} />
        <div style={{ position:"absolute", width:"50px", height:"50px", borderRadius:"50%", border:"1px solid rgba(150,107,236,0.09)" }} />

        {/* SVG turret */}
        <svg width="140" height="110" style={{ position:"absolute", top:0, left:"50%", transform:"translateX(-50%)", overflow:"visible", pointerEvents:"none" }}>
          <g transform="translate(70,55)">
            {/* Base crosshair */}
            <line x1={-20} y1={0} x2={20} y2={0} stroke="rgba(150,107,236,0.3)" strokeWidth="0.8" />
            <line x1={0} y1={-20} x2={0} y2={20} stroke="rgba(150,107,236,0.3)" strokeWidth="0.8" />
            {/* Barrel */}
            <line x1={0} y1={0} x2={tipX} y2={tipY}
              stroke={firing ? "#c4b5fd" : "#a78bfa"} strokeWidth="2.5" strokeLinecap="round" />
            {/* Barrel guard */}
            <line x1={Math.cos(angle + Math.PI/2) * 5} y1={Math.sin(angle + Math.PI/2) * 5}
                  x2={Math.cos(angle - Math.PI/2) * 5} y2={Math.sin(angle - Math.PI/2) * 5}
                  stroke="rgba(150,107,236,0.5)" strokeWidth="1.5" strokeLinecap="round" />
            {/* Muzzle flash */}
            {firing && (
              <>
                <circle cx={flashX} cy={flashY} r="5" fill="#c4b5fd" opacity="0.8" />
                <circle cx={flashX} cy={flashY} r="9" fill="rgba(167,139,250,0.3)" />
              </>
            )}
            {/* Barrel tip */}
            <circle cx={tipX} cy={tipY} r={firing ? 3 : 2} fill={firing ? "#ffffff" : "#c4b5fd"} />
            {/* Pivot ring */}
            <circle cx={0} cy={0} r="6" fill="#0c0c16" stroke={firing ? "#c4b5fd" : "#966bec"} strokeWidth="1.5" />
            <circle cx={0} cy={0} r="2.5" fill={firing ? "#c4b5fd" : "#a78bfa"} />
          </g>
        </svg>

        {/* Readouts */}
        <span style={{ position:"absolute", bottom:"0.25rem", right:"0.5rem",
          color: firing ? "rgba(196,181,253,0.7)" : "rgba(150,107,236,0.4)", fontSize:"0.5rem" }}>
          {degDisplay}°
        </span>
        {!canFire && (
          <span style={{ position:"absolute", bottom:"0.25rem", left:"0.5rem",
            color:"rgba(255,255,255,0.18)", fontSize:"0.5rem", fontStyle:"italic" }}>
            offline
          </span>
        )}
      </div>

      {/* Fire hint */}
      {/* Weapon mode selector */}
      {/* Weapon selector */}
      <div style={{ marginTop:"0.35rem" }}>
        <span style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.5rem", letterSpacing:"0.1em" }}>WEAPON SYSTEM</span>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"0.22rem", marginTop:"0.2rem" }}>
          {availableWeapons.map(w => {
            const isActive  = weaponMode === w.id
            const isGrapple = w.id === "grapple"
            const hasDebris = isGrapple && liveG.salvageCount > 0
            return (
              <button key={w.id} onClick={() => selectWeapon(w.id)}
                style={{ background: isActive ? (isGrapple ? "rgba(74,222,128,0.15)" : "rgba(150,107,236,0.2)") : "transparent",
                  border:`1px solid ${isActive ? (isGrapple ? "rgba(74,222,128,0.5)" : "rgba(150,107,236,0.5)") : hasDebris ? "rgba(74,222,128,0.25)" : "rgba(255,255,255,0.1)"}`,
                  borderRadius:"3px", padding:"0.12rem 0.3rem", cursor:"pointer",
                  color: isActive ? (isGrapple ? "#4ade80" : "#c4b5fd") : hasDebris ? "rgba(74,222,128,0.7)" : "rgba(255,255,255,0.35)",
                  fontSize:"0.5rem", fontFamily:"monospace",
                  display:"flex", flexDirection:"column", alignItems:"center", gap:"0.02rem" }}>
                <span style={{ fontSize:"0.52rem", fontWeight: isActive ? 700 : 400 }}>{w.label}</span>
                <span style={{ fontSize:"0.44rem", opacity:0.6 }}>{w.desc}</span>
              </button>
            )
          })}
        </div>
      </div>

      <p style={{ color: canFire ? "rgba(150,107,236,0.45)" : "rgba(255,255,255,0.15)",
        fontSize: "0.52rem", margin: "0.3rem 0 0", fontFamily:"monospace", textAlign:"center" }}>
        {canFire ? "hold to fire · aim with mouse" : "launch mission to arm turret"}
      </p>
    </div>
  )
}

// ── Salvage Station ────────────────────────────────────────────────────────
function SalvageStationView({ liveG, score, phase, onGrapple }: {
  liveG: LiveGSnapshot; score: number; phase: string; onGrapple: () => void
}) {
  const tokens    = Math.floor(score / 6) + liveG.kills * 3
  const grappleDmg = liveG.roomDamage.salvage ?? 0
  const grappleOffline = grappleDmg >= 3
  const hasDebris = liveG.salvageCount > 0
  const [firing, setFiring] = useState(false)

  function fireGrapple() {
    if (!hasDebris || grappleOffline || phase !== "playing") return
    setFiring(true); onGrapple()
    setTimeout(() => setFiring(false), 400)
  }

  // Breakdown of field debris by type
  const scraps    = liveG.salvageItems.filter(s => s.type === "scrap" && !s.corrupted).length
  const fragments = liveG.salvageItems.filter(s => s.type === "fragment" && !s.corrupted).length
  const artifacts = liveG.salvageItems.filter(s => s.type === "artifact" && !s.corrupted).length
  const corrupted = liveG.salvageItems.filter(s => s.corrupted).length

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.42rem" }}>
      <StatusRow label="SALVAGE BAY" value="ACTIVE" valueCol="#4ade80" />
      <StatusRow label="GRAPPLE SYSTEM"
        value={grappleOffline ? "OFFLINE" : grappleDmg > 0 ? `DEGRADED (−${grappleDmg * 25}% range)` : "ONLINE"}
        valueCol={grappleOffline ? "#f87171" : grappleDmg > 0 ? "#facc15" : "#4ade80"} />

      {phase === "playing" && (
        <>
          {/* Field debris */}
          <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", paddingTop:"0.3rem" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.2rem" }}>
              <span style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.5rem", letterSpacing:"0.1em" }}>FIELD DEBRIS</span>
              <span style={{ color: hasDebris ? "rgba(74,222,128,0.7)" : "rgba(255,255,255,0.2)", fontSize:"0.5rem" }}>
                {liveG.salvageCount} items
              </span>
            </div>
            {hasDebris ? (
              <div style={{ display:"flex", gap:"0.5rem", marginBottom:"0.3rem" }}>
                {scraps > 0    && <span style={{ color:"#94a3b8", fontSize:"0.56rem" }}>◆ {scraps} scrap</span>}
                {fragments > 0 && <span style={{ color:"#c4b5fd", fontSize:"0.56rem" }}>◈ {fragments} frag</span>}
                {artifacts > 0 && <span style={{ color:"#facc15", fontSize:"0.56rem" }}>★ {artifacts} artifact</span>}
                {corrupted > 0 && <span style={{ color:"#f87171", fontSize:"0.56rem" }}>⊗ {corrupted} corrupted</span>}
              </div>
            ) : (
              <p style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.54rem", margin:"0.1rem 0 0.3rem", fontStyle:"italic" }}>
                No debris in field
              </p>
            )}
            {/* Grapple button */}
            <button onClick={fireGrapple} disabled={!hasDebris || grappleOffline || phase !== "playing"}
              style={{ width:"100%", background: firing ? "rgba(74,222,128,0.2)" : hasDebris && !grappleOffline ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.03)",
                border:`1px solid ${firing ? "rgba(74,222,128,0.6)" : hasDebris && !grappleOffline ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)"}`,
                borderRadius:"4px", padding:"0.35rem", cursor: hasDebris && !grappleOffline ? "pointer" : "not-allowed",
                color: hasDebris && !grappleOffline ? "#4ade80" : "rgba(255,255,255,0.2)",
                fontSize:"0.6rem", fontFamily:"monospace", letterSpacing:"0.1em",
                transition:"all 0.1s" }}>
              {firing ? "GRAPPLING..." : grappleOffline ? "GRAPPLE OFFLINE" : "⬡ GRAPPLE ALL"}
            </button>
          </div>

          {/* Session totals */}
          <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", paddingTop:"0.3rem", display:"flex", flexDirection:"column", gap:"0.12rem" }}>
            <StatusRow label="COLLECTED" value={String(liveG.salvageCollected)} valueCol="rgba(74,222,128,0.65)" />
            <StatusRow label="SIGNALS LOST" value={liveG.wordsEscaped > 0 ? String(liveG.wordsEscaped) : "—"} valueCol={liveG.wordsEscaped > 0 ? "rgba(248,113,113,0.55)" : "rgba(255,255,255,0.2)"} />
            <StatusRow label="TOKENS" value={`${tokens}t`} valueCol="rgba(74,222,128,0.6)" />
          </div>
        </>
      )}
    </div>
  )
}

// ── Engineering Station ────────────────────────────────────────────────────
// Power system constants
const POWER_POOL   = 10  // total points to distribute
const POWER_SYSTEMS = [
  { id: "turret",  label: "TURRET",  icon: "⊕", desc: "fire rate",  col: "#a78bfa" },
  { id: "shields", label: "SHIELDS", icon: "◈", desc: "hull regen", col: "#4ade80" },
  { id: "engines", label: "ENGINES", icon: "▲", desc: "word speed", col: "#fb923c" },
  { id: "sensors", label: "SENSORS", icon: "◇", desc: "radar range",col: "#7dd3fc" },
] as const
type PowerKey = "turret" | "shields" | "engines" | "sensors"

// Read power levels from _stationState and apply effects to GState
// Called from the game loop every frame
// ── Crew Utility AI ────────────────────────────────────────────────────────
// Runs every 250ms. Each crew member evaluates state, scores actions, executes best.

function crewStat(g: GState, key: string, delta = 1) {
  g.crewStats[key] = (g.crewStats[key] ?? 0) + delta
}

// Minimum seconds between feed events per crew (enforce signal-to-noise)
const FEED_COOLDOWN_SEC = 8

function crewLog(crew: string, message: string, type = "action") {
  const now = Date.now()
  const last = _stationState.lastFeedTs[crew] ?? 0
  if (now - last < FEED_COOLDOWN_SEC * 1000) return  // rate limit
  _stationState.lastFeedTs[crew] = now
  _stationState.opsFeedBuffer.push({ crew, message, type, ts: now })
  if (_stationState.opsFeedBuffer.length > 25) _stationState.opsFeedBuffer.shift()
}

// Force-log regardless of cooldown (for truly critical events)
function crewLogForce(crew: string, message: string, type = "action") {
  _stationState.lastFeedTs[crew] = Date.now()
  _stationState.opsFeedBuffer.push({ crew, message, type, ts: Date.now() })
  if (_stationState.opsFeedBuffer.length > 25) _stationState.opsFeedBuffer.shift()
}

function setOperatorStatus(crew: string, action: string, detail?: string) {
  _stationState.operatorStatus[crew] = { action, detail, ts: Date.now() }
}

function setRoomAction(station: StationId, text: string, durationMs = 2000) {
  _stationState.roomActions[station] = { text, until: Date.now() + durationMs }
}

function getCrewAssignments(): Partial<Record<StationId, string>> {
  if (Date.now() - _stationState.crewCacheTime > 800) {
    try {
      const saved = localStorage.getItem("sb_crew_assign")
      _stationState.crewAssignCache = saved ? JSON.parse(saved) : {}
    } catch { _stationState.crewAssignCache = {} }
    _stationState.crewCacheTime = Date.now()
  }
  return _stationState.crewAssignCache
}

function runCrewAI(g: GState, now: number) {
  if (!g.running || g.paused) return
  const assign = getCrewAssignments()
  const entries = Object.entries(assign) as [StationId, string][]
  for (const [station, crew] of entries) {
    if (!crew || crew === "player") continue
    switch (crew) {
      case "capy":           runCapyAI(g, station, now); break
      case "veteran_gunner": runVeteranAI(g, station, now); break
      case "engineer_bot":   runEngineerAI(g, station, now); break
      case "salvager_bot":   runSalvagerAI(g, station, now); break
      case "scout_drone":    runScoutAI(g, station, now); break
    }
  }
}

// ── Capy (Bridge Operator) ─────────────────────────────────────────────────
let _capyAILast = 0
function runCapyAI(g: GState, station: StationId, now: number) {
  if (now - _capyAILast < 1800) return  // Capy evaluates every 1.8s
  _capyAILast = now
  // Priority 1: fire toward a word if at Turret station
  if (station === "turret") {
    const targets = g.words.filter(w => !w.fragment && w.type !== "powerup")
    if (targets.length > 0) {
      const target = targets.sort((a, b) => (b.elite ? 2 : 0) + (b.type === "bug" ? 1 : 0) - (a.elite ? 2 : 0) - (a.type === "bug" ? 1 : 0))[0]
      const missAngle = Math.random() < 0.25 ? (Math.random() - 0.5) * 0.6 : 0
      const ang = Math.atan2(target.y - g.py, target.x - g.px) + missAngle
      g.bullets.push({ x: g.px, y: g.py - 20, vx: Math.cos(ang)*10, vy: Math.sin(ang)*10, kind:"turret", col:"#86efac" })
      g.particles.push({ x: g.px, y: g.py - 24, vx: 0, vy: -0.7, life: 0.7, glyph: "🦫", col:"#86efac", sz:9, gravity:0 })
      crewStat(g, "capy_shots")
      setOperatorStatus("CAPY", target.elite ? "Engaging Elite" : "Suppressing Threat", target.text.slice(0, 12))
      setRoomAction(station, "ENGAGING")
      return
    }
  }
  // Priority 2: mark highest-value target if at Bridge
  if (station === "bridge" && _stationState.markedTargetId === null) {
    const candidates = g.words.filter(w => !w.fragment && w.type !== "powerup")
    if (candidates.length > 0) {
      // Score: elite = 30, bug = 15, boss-proximity bonus
      const scored = candidates.map(w => ({
        w, score: (w.elite ? 30 : 0) + (w.type === "bug" ? 15 : 0) + Math.max(0, (g.py - w.y) / 30)
      }))
      const best = scored.sort((a, b) => b.score - a.score)[0]
      if (best.score >= 15) {
        _stationState.markedTargetId = best.w.id
        _stationState.markedAt = now
        const label = best.w.elite ? `Elite-${best.w.id % 100}` : best.w.text.slice(0, 10)
        crewLogForce("CAPY", `Target Lock Acquired: ${label}`, "mark")
        setOperatorStatus("CAPY", "Target Locked", label)
        setRoomAction(station, "LOCKING")
        crewStat(g, "capy_marks")
        if (best.w.elite) crewStat(g, "capy_eliteMarks")
      }
    }
  }
}

// ── Veteran Gunner ─────────────────────────────────────────────────────────
let _vetAILast = 0
function runVeteranAI(g: GState, station: StationId, now: number) {
  if (now - _vetAILast < 850) return
  _vetAILast = now
  const targets = g.words.filter(w => !w.fragment && w.type !== "powerup")
  if (targets.length === 0) return
  // Priority scoring: marked > elite > bug > closest
  const marked = _stationState.markedTargetId
  let action = "Engaging target"; let logType = "engage"
  const best = targets.sort((a, b) => {
    const sa = (a.id === marked ? 100 : 0) + (a.elite ? 40 : 0) + (a.type === "bug" ? 20 : 0)
    const sb = (b.id === marked ? 100 : 0) + (b.elite ? 40 : 0) + (b.type === "bug" ? 20 : 0)
    return sb - sa
  })[0]
  const priority = best.id === marked ? "Marked Target" : best.elite ? "Elite Threat" : "Priority Threat"
  const dx = best.x - g.px, dy = best.y - g.py
  const ang = Math.atan2(dy, dx)
  g.bullets.push({ x: g.px, y: g.py - 20, vx: Math.cos(ang)*10.5, vy: Math.sin(ang)*10.5, kind:"turret", col:"#fbbf24" })
  g.particles.push({ x: g.px + Math.cos(ang)*8, y: g.py - 20 + Math.sin(ang)*8,
    vx: Math.cos(ang)*2, vy: Math.sin(ang)*2, life: 0.25, glyph:"·", col:"#fbbf24", gravity:0 })
  setOperatorStatus("VETERAN", "Engaging", priority)
  setRoomAction(station, "ENGAGING")
  crewStat(g, "veteran_shots")
}

// Track veteran kills via a sentinel — checked in kill path externally
// (kill detection calls crewStat directly when bullet.col === "#fbbf24")

// ── Engineer Bot ───────────────────────────────────────────────────────────
let _engAILast = 0
function runEngineerAI(g: GState, station: StationId, now: number) {
  if (now - _engAILast < 8000) return  // repairs every ~8s
  const damaged = (["bridge","turret","salvage","engineering"] as StationId[])
    .filter(r => (g.roomDamage[r] ?? 0) > 0)
    .sort((a, b) => (g.roomDamage[b] ?? 0) - (g.roomDamage[a] ?? 0))  // worst first
  if (damaged.length === 0) return
  _engAILast = now
  const target = damaged[0]
  g.roomDamage[target] = Math.max(0, (g.roomDamage[target] ?? 0) - 1)
  crewLogForce("ENGINEER", `${target.charAt(0).toUpperCase() + target.slice(1)} Restored`, "repair")
  setOperatorStatus("ENGINEER", "Repairing", target.toUpperCase())
  setRoomAction(station, "REPAIRING", 2500)
  setRoomAction(target, "REPAIRED", 1500)
  crewStat(g, "engineer_repairs")
  g.particles.push({ x: g.W/2, y: GH*0.45, vx: 0, vy: -0.5, life: 1.4,
    glyph: `⚙ ${target.toUpperCase()} REPAIRED`, col: "#4ade80", sz: 9, gravity: 0 })
}

// ── Salvager Bot ───────────────────────────────────────────────────────────
let _salvAILast = 0
function runSalvagerAI(g: GState, station: StationId, now: number) {
  if (now - _salvAILast < 3200) return
  if (g.salvage.length === 0) return
  _salvAILast = now
  // Salvager prefers uncorrupted items; will skip corrupted unless nothing else exists
  const uncorrupted = g.salvage.filter(s => !s.corrupted)
  const pool = uncorrupted.length > 0 ? uncorrupted : g.salvage
  const byPriority = [...pool].sort((a, b) => {
    const priority = { artifact: 3, fragment: 2, scrap: 1 }
    return priority[b.type] - priority[a.type]
  })
  const target = byPriority[0]
  g.salvage = g.salvage.filter(s => s.id !== target.id)
  if (target.corrupted) {
    // Salvager detects corruption and discards — no score change
    crewLog("SALVAGER", "Corrupted item quarantined", "recover")
    setOperatorStatus("SALVAGER", "Quarantine", "corrupted")
    g.particles.push({ x: target.x, y: target.y, vx: 0, vy: -0.9, life: 1.2, glyph: "⊗ CORRUPTED", col: "#f87171", sz: 9, gravity: 0 })
    return
  }
  const bonus = target.type === "artifact" ? 500 : target.type === "fragment" ? 150 : 50
  g.score += bonus; g.salvageCollected++
  if (target.type !== "scrap") g.fragmentsEarned++
  if (target.type === "artifact") crewLogForce("SALVAGER", "Artifact Recovered", "recover")
  else if (target.type === "fragment") crewLog("SALVAGER", "Signal Fragment Recovered", "recover")
  setOperatorStatus("SALVAGER", "Recovering", target.type.charAt(0).toUpperCase() + target.type.slice(1))
  setRoomAction(station, "RECOVERING", 1800)
  crewStat(g, "salvager_" + target.type)
  g.particles.push({ x: target.x, y: target.y, vx: 0, vy: -0.9, life: 1.4,
    glyph: `⬡ +${bonus}`, col: "#4ade80", sz: 10, gravity: 0 })
}

// ── Scout Drone ────────────────────────────────────────────────────────────
let _scoutAILast = 0
function runScoutAI(g: GState, station: StationId, now: number) {
  if (now - _scoutAILast < 4500) return
  _scoutAILast = now
  setRoomAction(station, "SCANNING", 1200)
  // Detect elites
  const elites = g.words.filter(w => w.elite && !w.fragment)
  if (elites.length > 0) {
    const e = elites[0]
    crewLog("SCOUT", `Elite Signature Detected`, "scan")
    setOperatorStatus("SCOUT", "Elite Detected", e.text.slice(0, 12))
    crewStat(g, "scout_threats")
    if (_stationState.markedTargetId === null) {
      _stationState.markedTargetId = e.id; _stationState.markedAt = now
    }
    return
  }
  const artifacts = g.salvage.filter(s => s.type === "artifact")
  if (artifacts.length > 0) {
    crewLog("SCOUT", `Artifact Signature Detected`, "scan")
    setOperatorStatus("SCOUT", "Artifact Located", "field debris")
    crewStat(g, "scout_artifacts")
    return
  }
  const threats = g.words.filter(w => w.type === "bug" && !w.fragment)
  setOperatorStatus("SCOUT", threats.length > 0 ? "Monitoring Threats" : "Scanning", threats.length > 0 ? `${threats.length} noise patterns` : undefined)
}

function applyPowerEffects(g: GState) {
  const engDmg = g.roomDamage.engineering ?? 0
  // Artifact: collective_mind — each assigned crew adds 5% boost (approximated as +0 power offset)
  const crewBonus = g.artifacts.includes("collective_mind")
    ? Math.floor(Object.values(_stationState.power).reduce((a, b) => a + b, 0) * 0.05)
    : 0
  g._powerTurret  = Math.max(0, _stationState.power.turret  - engDmg + crewBonus)
  g._powerShields = Math.max(0, _stationState.power.shields - engDmg + crewBonus)
  g._powerEngines = Math.max(0, _stationState.power.engines - engDmg + crewBonus)
  // Scout Drone crew anywhere = +3 sensors
  const scoutBonus = (() => { try { const ca = localStorage.getItem("sb_crew_assign"); return ca && Object.values(JSON.parse(ca)).includes("scout_drone") ? 3 : 0 } catch { return 0 } })()
  g._powerSensors = Math.max(0, _stationState.power.sensors - engDmg + crewBonus + scoutBonus)
}

// ── Artifact effect hooks — called from game events ────────────────────────

// ── Archive Corruption Effects — applied every frame ──────────────────────
const IDENTITY_DRIFT_CHARS: Record<string, string> = {
  o:"0", a:"@", e:"3", i:"!", l:"1", s:"$", t:"+", b:"6", g:"9", n:"η", r:"я"
}

function applyCorruptionPassive(g: GState, now: number) {
  if (!g.archiveMode || !g.archiveCorruption) return

  // IDENTITY DRIFT: characters in word text mutate periodically
  if ((g.archiveCorruption === "identity_drift" || g.archiveCorruption === "state_fragmentation") && g.words.length > 0) {
    // Mutate ~every 120 frames (2s at 60fps) — pick random word, random char
    if (Math.floor(now / 2000) % 7 < 1 && Math.random() < 0.15) {
      const w = g.words[Math.floor(Math.random() * g.words.length)]
      if (!w.fragment && w.type !== "powerup") {
        const idx  = Math.floor(Math.random() * w.text.length)
        const orig = w.text[idx].toLowerCase()
        const sub  = IDENTITY_DRIFT_CHARS[orig]
        if (sub) w.text = w.text.slice(0, idx) + (w.text[idx] === w.text[idx].toUpperCase() ? sub.toUpperCase() : sub) + w.text.slice(idx + 1)
      }
    }
  }

  // RADAR DEGRADATION: Bridge auto-damages every 22s; visual blindness begins immediately (draw layer)
  if (g.archiveCorruption === "radar_degradation") {
    if (g.archiveLastRadarDmg === 0) g.archiveLastRadarDmg = now
    if (now - g.archiveLastRadarDmg > 22000 && (g.roomDamage.bridge ?? 0) < 3) {
      g.roomDamage.bridge = (g.roomDamage.bridge ?? 0) + 1
      g.archiveLastRadarDmg = now
      const degradeLabels = ["", "MONITORING DEGRADED", "SIGNAL LOSS DETECTED", "OBSERVABILITY OFFLINE"]
      const lvl = g.roomDamage.bridge ?? 0
      g.particles.push({ x: g.W/2, y: GH*0.38, vx: 0, vy: -0.5, life: 2.2,
        glyph: degradeLabels[lvl] ?? "OBSERVABILITY DEGRADED", col: "#7dd3fc", sz: 9, gravity: 0 })
      g.shake = 5; g.accentFlash = 8; g.accentFlashCol = "#7dd3fc"
    }
  }

  // PACKET LOSS / RATE LIMITING: handled at shoot time (in main game loop), not here

  // RECURSIVE COLLAPSE: instability grows with kill count — modify word speed inline
  // (actual speed boost applied at spawn via archiveInstability field)
  if (g.archiveCorruption === "recursive_collapse" && g.archiveInstability > 0 && Math.floor(now / 6000) % 5 === 0 && Math.random() < 0.12) {
    // Periodic instability broadcast particle
    const lvl = Math.min(3, Math.floor(g.archiveInstability / 10))
    if (lvl > 0) {
      const col = lvl >= 3 ? "#f87171" : lvl >= 2 ? "#fb923c" : "#facc15"
      g.particles.push({ x: g.W/2, y: GH*0.38, vx: 0, vy: -0.4, life: 1.6,
        glyph: `INSTABILITY: ${["LOW","MODERATE","HIGH","CRITICAL"][lvl]}`, col, sz: 9, gravity: 0 })
    }
  }
}

// Called each frame in the game loop for passive artifact effects
function applyArtifactPassive(g: GState, now: number) {
  if (!g.artifacts.length) return
  // Salvage Magnet — debris drifts toward player
  if (g.artifacts.includes("salvage_magnet")) {
    g.salvage.forEach(s => {
      const dx = g.px - s.x, dy = (g.py - 20) - s.y
      const dist = Math.sqrt(dx*dx + dy*dy) || 1
      s.vx += (dx / dist) * 0.06; s.vy += (dy / dist) * 0.04
    })
  }
  // Power Surge — every 5 kills, +2 power for 3s (tracked via particle)
  // Ghost Protocol — handled by multiplying invuln duration on application
}

// Called when a word is killed
function applyArtifactOnKill(g: GState, word: Word, now: number) {
  if (!g.artifacts.length) return
  // Signal Echo — 15% chance nearest same-type word also dies
  if (g.artifacts.includes("signal_echo") && Math.random() < 0.15) {
    const same = g.words.filter(w => w.type === word.type && w.id !== word.id)
    if (same.length > 0) {
      const near = same.reduce((a, b) =>
        Math.hypot(b.x - word.x, b.y - word.y) < Math.hypot(a.x - word.x, a.y - word.y) ? b : a)
      // Schedule removal (can't splice mid-loop, so flag it)
      near.hp = 0; near.hitFlash = 99  // sentinel: will be collected next frame
    }
  }
  // Power Surge — every 5 kills, +2 to all power briefly
  if (g.artifacts.includes("power_surge")) {
    g._powerSurgeKills = (g._powerSurgeKills ?? 0) + 1
    if (g._powerSurgeKills % 5 === 0) {
      g.particles.push({ x: g.px, y: g.py - 28, vx: 0, vy: -0.7, life: 1.4,
        glyph: "POWER SURGE", col: "#fdba74", sz: 10, gravity: 0 })
      g._powerTurret  = (g._powerTurret  ?? 0) + 2
      g._powerShields = (g._powerShields ?? 0) + 2
      g._powerEngines = (g._powerEngines ?? 0) + 2
    }
  }
  // Resonance Cascade — auto-lock nearest enemy after killing locked target
  if (g.artifacts.includes("resonance_cascade") && _stationState.markedTargetId === null) {
    // Was just cleared (kill cleared it) → auto-lock next closest
    const next = g.words.filter(w => !w.fragment && w.type !== "powerup")
    if (next.length > 0) {
      const nearest = next.reduce((a, b) =>
        Math.hypot(b.x - g.px, b.y - g.py) < Math.hypot(a.x - g.px, a.y - g.py) ? b : a)
      _stationState.markedTargetId = nearest.id
      _stationState.markedAt = now
    }
  }
  // Quantum Targeting — guaranteed fragment drop from locked targets
  if (g.artifacts.includes("quantum_targeting") && word.id === _stationState.markedTargetId) {
    spawnSalvage(g, word.x, word.y, "fragment", now)
  }
}

// Called when player takes hull damage
function applyArtifactOnDamage(g: GState, now: number): boolean {
  // Hardened Bulkheads — absorb first room hit per sector
  if (g.artifacts.includes("hardened_bulkheads") && !g._hardenedUsed) {
    g._hardenedUsed = true
    g.particles.push({ x: g.px, y: g.py - 22, vx: 0, vy: -0.9, life: 1.4,
      glyph: "BULKHEADS HELD", col: "#4ade80", sz: 10, gravity: 0 })
    return true  // damage absorbed
  }
  // Reactive Armor — brief invuln on every hit
  if (g.artifacts.includes("reactive_armor")) {
    g.invuln = true; g.invulnEnd = now + 1500
  }
  return false
}

function EngineeringStationView({ liveG, phase }: { liveG: LiveGSnapshot; phase: string }) {
  const installedUpgrades = UPGRADES.filter(u => (liveG.upgrades[u.id] ?? 0) > 0)
  const systemCount = installedUpgrades.length
  const [power, setPower] = useState({ ...(_stationState.power) })
  const effectivePool = POWER_POOL + (liveG.engineeringPoolBonus ?? 0)
  const remaining = effectivePool - Object.values(power).reduce((a, b) => a + b, 0)
  // Active artifacts relevant to engineering
  const engArtifacts = liveG.artifacts.filter(id => ["overclock_core","battle_hardened","engine_of_war","power_surge","collective_mind"].includes(id))

  function adjustPower(key: PowerKey, delta: number) {
    setPower(prev => {
      const cur = prev[key]
      const next = Math.max(0, Math.min(10, cur + delta))
      const diff = next - cur
      // Check pool
      const used = Object.values(prev).reduce((a, b) => a + b, 0)
      if (diff > 0 && used + diff > effectivePool) return prev
      const updated = { ...prev, [key]: next }
      _stationState.power = updated
      return updated
    })
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"0.45rem" }}>
      <StatusRow label="ENGINEERING" value="ACTIVE" valueCol="#4ade80" />

      {/* Power allocation — the core mechanic */}
      <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", paddingTop:"0.35rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.3rem" }}>
          <span style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.5rem", letterSpacing:"0.12em" }}>POWER ALLOCATION</span>
          <span style={{ color: remaining === 0 ? "rgba(255,113,113,0.6)" : "rgba(150,107,236,0.6)", fontSize:"0.5rem" }}>
            {remaining}/{effectivePool} free{liveG.engineeringPoolBonus > 0 ? ` (+${liveG.engineeringPoolBonus})` : ""}
          </span>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.28rem" }}>
          {POWER_SYSTEMS.map(sys => {
            const val = power[sys.id]
            const pct = (val / POWER_POOL) * 100
            return (
              <div key={sys.id} style={{ display:"flex", alignItems:"center", gap:"0.35rem" }}>
                <span style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.56rem", width:"0.6rem" }}>{sys.icon}</span>
                <span style={{ color:"rgba(255,255,255,0.4)", fontSize:"0.52rem", width:"3.2rem", letterSpacing:"0.06em" }}>
                  {sys.label}
                </span>
                {/* Bar */}
                <div style={{ flex:1, height:"6px", background:"rgba(255,255,255,0.06)", borderRadius:"3px", position:"relative" }}>
                  <div style={{ height:"100%", width:`${pct}%`, background:sys.col, borderRadius:"3px",
                    boxShadow:`0 0 4px ${sys.col}66`, transition:"width 0.12s" }} />
                </div>
                {/* Controls */}
                <button onClick={() => adjustPower(sys.id, -1)}
                  style={{ background:"none", border:"1px solid rgba(255,255,255,0.12)", borderRadius:"2px",
                    color:"rgba(255,255,255,0.4)", fontSize:"0.6rem", padding:"0 0.3rem", cursor:"pointer", lineHeight:"1.2" }}>−</button>
                <span style={{ color:sys.col, fontSize:"0.6rem", width:"0.6rem", textAlign:"center", fontWeight:700 }}>{val}</span>
                <button onClick={() => adjustPower(sys.id, 1)}
                  style={{ background:"none", border:"1px solid rgba(255,255,255,0.12)", borderRadius:"2px",
                    color:"rgba(255,255,255,0.4)", fontSize:"0.6rem", padding:"0 0.3rem", cursor:"pointer", lineHeight:"1.2" }}>+</button>
              </div>
            )
          })}
        </div>
        <p style={{ color:"rgba(255,255,255,0.12)", fontSize:"0.48rem", margin:"0.3rem 0 0", fontStyle:"italic" }}>
          {POWER_POOL} pts · turret=fire rate · shields=regen · engines=word slow · sensors=radar
        </p>
      </div>

      {/* Installed systems compact list */}
      {systemCount > 0 && (
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", paddingTop:"0.3rem" }}>
          <span style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.5rem", letterSpacing:"0.1em" }}>SYSTEMS · {systemCount} online</span>
          <div style={{ display:"flex", gap:"0.15rem", flexWrap:"wrap", marginTop:"0.22rem" }}>
            {UPGRADES.map(u => {
              const lv = liveG.upgrades[u.id] ?? 0; if (!lv) return null
              const isShield = u.id === "shield_regen"
              return (
                <div key={u.id} title={`${u.name} ×${lv}`}
                  style={{ width:"12px", height:"8px", borderRadius:"1px",
                    background: isShield && liveG.shield ? "#4ade80" : "rgba(150,107,236,0.65)",
                    border:`1px solid rgba(150,107,236,0.35)`, boxShadow:"0 0 3px rgba(150,107,236,0.35)" }} />
              )
            })}
          </div>
        </div>
      )}

      {/* Active artifacts */}
      {liveG.artifacts.filter(id => !id.startsWith("_")).length > 0 && (
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", paddingTop:"0.3rem" }}>
          <span style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.5rem", letterSpacing:"0.1em" }}>
            ARTIFACTS · {liveG.artifacts.filter(id => !id.startsWith("_")).length} active
          </span>
          <div style={{ display:"flex", flexDirection:"column", gap:"0.12rem", marginTop:"0.2rem" }}>
            {liveG.artifacts.filter(id => !id.startsWith("_")).map(id => {
              const def = ARTIFACT_DEFS.find(a => a.id === id)
              if (!def) return null
              return (
                <div key={id} style={{ display:"flex", alignItems:"center", gap:"0.35rem" }}>
                  <span style={{ color:ARTIFACT_RARITY_COLORS[def.rarity], fontSize:"0.52rem",
                    fontFamily:"monospace" }}>{def.name}</span>
                  <span style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.48rem", fontStyle:"italic" }}>
                    {def.rarity}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shared status row ──────────────────────────────────────────────────────
function StatusRow({ label, value, valueCol }: { label: string; value: string; valueCol?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
      <span style={{ color: "rgba(255,255,255,0.25)", fontSize: "0.55rem", letterSpacing: "0.1em", flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ color: valueCol ?? "rgba(255,255,255,0.55)", fontSize: "0.62rem", fontWeight: 500, textAlign: "right" }}>
        {value}
      </span>
    </div>
  )
}

// ── Operations Feed ────────────────────────────────────────────────────────
const OPS_CREW_COLORS: Record<string, string> = {
  CAPY:     "#86efac",
  VETERAN:  "#fbbf24",
  ENGINEER: "#4ade80",
  SALVAGER: "#c4b5fd",
  SCOUT:    "#7dd3fc",
}
const OPS_TYPE_ICONS: Record<string, string> = {
  mark: "◎", kill: "✦", repair: "⚙", recover: "⬡", scan: "◇", engage: "⊕", elite: "★", action: "·",
}

// Operator label → crew type mapping for status display
const CREW_ROLE_MAP: Record<string, string> = {
  capy: "CAPY", veteran_gunner: "VETERAN", engineer_bot: "ENGINEER",
  salvager_bot: "SALVAGER", scout_drone: "SCOUT", player: "PLAYER",
}

function OperationsFeed({ entries, operatorStatus, crewAssign }: {
  entries: Array<{ id: number; crew: string; message: string; type: string; ts: number }>
  operatorStatus: Partial<Record<string, { action: string; detail?: string }>>
  crewAssign: Partial<Record<StationId, string | null>>
}) {
  // Active crew members for status panel
  const activeCrew = Object.values(crewAssign)
    .filter((c): c is string => !!c && c !== "player")
    .map(c => ({ key: c, label: CREW_ROLE_MAP[c] ?? c.toUpperCase() }))
    .filter((v, i, a) => a.findIndex(x => x.key === v.key) === i)  // dedupe

  return (
    <StationShell style={{ flex: "0 0 190px", minWidth: 0 }}>
      <StationHeader label="OPERATIONS" />
      <div style={{ padding: "0.35rem 0.55rem", display:"flex", flexDirection:"column", gap:"0" }}>

        {/* Operator Status — live intent per crew */}
        {activeCrew.length > 0 && (
          <div style={{ marginBottom:"0.35rem" }}>
            {activeCrew.map(({ key, label }) => {
              const status = operatorStatus[label]
              const col = OPS_CREW_COLORS[label] ?? "rgba(255,255,255,0.4)"
              return (
                <div key={key} style={{ padding:"0.18rem 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ color:col, fontSize:"0.52rem", fontWeight:700, fontFamily:"monospace" }}>{label}</span>
                    {status && <span style={{ color:"rgba(255,255,255,0.4)", fontSize:"0.48rem", fontFamily:"monospace" }}>
                      {status.action}
                    </span>}
                  </div>
                  {status?.detail && (
                    <span style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.48rem", fontFamily:"monospace",
                      paddingLeft:"0.3rem", display:"block" }}>
                      {status.detail}
                    </span>
                  )}
                  {!status && (
                    <span style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.48rem", fontFamily:"monospace",
                      paddingLeft:"0.3rem" }}>Standby</span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Critical Events feed — quiet, only meaningful events */}
        {entries.length > 0 && (
          <div>
            <span style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.48rem", letterSpacing:"0.12em" }}>INCIDENT LOG</span>
            <div style={{ display:"flex", flexDirection:"column", gap:"0", marginTop:"0.15rem" }}>
              {entries.slice(0, 8).map((e, i) => {
                const alpha = Math.max(0.3, 1 - (i / 8) * 0.65)
                const col   = OPS_CREW_COLORS[e.crew] ?? "rgba(255,255,255,0.4)"
                const icon  = OPS_TYPE_ICONS[e.type] ?? "·"
                return (
                  <div key={e.id} style={{ display:"flex", gap:"0.25rem", padding:"0.08rem 0",
                    opacity:alpha, borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
                    <span style={{ color:col, fontSize:"0.44rem", flexShrink:0, lineHeight:"1.3rem" }}>{icon}</span>
                    <div style={{ minWidth:0 }}>
                      <span style={{ color:col, fontSize:"0.46rem", fontFamily:"monospace", fontWeight:700 }}>[{e.crew}] </span>
                      <span style={{ color:"rgba(255,255,255,0.5)", fontSize:"0.48rem", fontFamily:"monospace" }}>{e.message}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeCrew.length === 0 && entries.length === 0 && (
          <p style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.5rem", fontStyle:"italic",
            fontFamily:"monospace", margin:"0.3rem 0" }}>
            Assign crew to activate operations
          </p>
        )}
      </div>
    </StationShell>
  )
}

// ── Command Mode Overlay ───────────────────────────────────────────────────
// TAB to open. Game freezes. Full mission control.
type CMTab = "signal" | "blueprint" | "crew" | "artifacts" | "archive" | "stats"

function CommandModeOverlay({ g, level, score, lives, liveG, crewStats, onResume, persistentSignal }: {
  g: GState; level: number; score: number; lives: number
  liveG: LiveGSnapshot; crewStats: Partial<Record<string, number>>
  onResume: () => void; persistentSignal: PersistentSignal
}) {
  const [tab, setTab] = useState<CMTab>("signal")
  const tabs: Array<{ id: CMTab; label: string }> = [
    { id: "signal",    label: "THE SIGNAL" },
    { id: "blueprint", label: "SHIP" },
    { id: "crew",      label: "CREW" },
    { id: "artifacts", label: "ARTIFACTS" },
    { id: "archive",   label: "SIGNAL ARCHIVE" },
    { id: "stats",     label: "STATISTICS" },
  ]

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); onResume() }
      if (e.key === "r" || e.key === "R") onResume()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onResume])

  return (
    <div style={{ position:"absolute", inset:0, background:"rgba(4,4,10,0.97)", zIndex:30,
      display:"flex", flexDirection:"column", fontFamily:"monospace", overflowY:"auto" }}>
      {/* Header */}
      <div style={{ borderBottom:"1px solid rgba(150,107,236,0.2)", padding:"0.55rem 1.2rem",
        display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:"0.8rem" }}>
          <span style={{ color:"rgba(150,107,236,0.7)", fontSize:"0.52rem", letterSpacing:"0.2em" }}>COMMAND MODE</span>
          <span style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.5rem" }}>·</span>
          <span style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.5rem" }}>SECTOR {level} · {score.toLocaleString()} PTS</span>
        </div>
        <button onClick={onResume} style={{ background:"rgba(150,107,236,0.15)", border:"1px solid rgba(150,107,236,0.3)",
          borderRadius:"4px", padding:"0.25rem 0.75rem", color:"#a78bfa", cursor:"pointer",
          fontSize:"0.6rem", fontFamily:"monospace", letterSpacing:"0.1em" }}>
          RESUME MISSION  [ESC]
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display:"flex", gap:"0", borderBottom:"1px solid rgba(255,255,255,0.06)", flexShrink:0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ background: tab === t.id ? "rgba(150,107,236,0.12)" : "transparent",
              border:"none", borderBottom: tab === t.id ? "2px solid #a78bfa" : "2px solid transparent",
              color: tab === t.id ? "#c4b5fd" : "rgba(255,255,255,0.3)",
              padding:"0.5rem 0.9rem", cursor:"pointer", fontSize:"0.58rem",
              fontFamily:"monospace", letterSpacing:"0.08em" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:"auto", padding:"1rem 1.2rem" }}>
        {tab === "signal"    && <CMSignal signal={persistentSignal} runScore={score} />}
        {tab === "blueprint" && <CMBlueprint g={g} lives={lives} liveG={liveG} />}
        {tab === "crew"      && <CMCrew crewStats={crewStats} />}
        {tab === "artifacts" && <CMArtifacts artifacts={g.artifacts} />}
        {tab === "archive"   && <CMSignalArchive />}
        {tab === "stats"     && <CMStats g={g} score={score} />}
      </div>
    </div>
  )
}

// ── CM: The Signal ─────────────────────────────────────────────────────────
const OPERATOR_DISPLAY: Record<string, { label: string; col: string; stats: Array<[string, string]> }> = {
  capy:           { label: "CAPY · Signal Analysis",    col: "#86efac", stats: [["capy_marks","Targets Marked"],["capy_assists","Assists"],["capy_eliteMarks","Elite Marks"],["capy_shots","Shots Fired"]] },
  veteran_gunner: { label: "VETERAN · Response Automation", col: "#fbbf24", stats: [["veteran_kills","Kills"],["veteran_eliteKills","Elite Kills"],["veteran_shots","Shots Fired"]] },
  engineer_bot:   { label: "ENGINEER · Reliability",    col: "#4ade80", stats: [["engineer_repairs","Repairs Completed"]] },
  salvager_bot:   { label: "SALVAGER · Knowledge Recovery", col: "#c4b5fd", stats: [["salvager_fragment","Fragments"],["salvager_artifact","Artifacts"],["salvager_scrap","Scrap"]] },
  scout_drone:    { label: "SCOUT · Observability",     col: "#7dd3fc", stats: [["scout_threats","Threats Detected"],["scout_artifacts","Artifacts Detected"]] },
}

function CMSignal({ signal, runScore }: { signal: PersistentSignal; runScore: number }) {
  const completion = signalArchiveCompletion(signal)
  const isNew      = signal.operationalAge === 0

  return (
    <div style={{ display:"flex", gap:"1.5rem", flexWrap:"wrap" }}>
      {/* Signal identity block */}
      <div style={{ minWidth:"180px" }}>
        <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.54rem", letterSpacing:"0.14em", margin:"0 0 0.6rem" }}>SIGNAL IDENTITY</p>

        {isNew ? (
          <div style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.62rem", fontStyle:"italic" }}>
            <p>Signal not yet initialized.</p>
            <p style={{ color:"rgba(150,107,236,0.5)", fontSize:"0.56rem" }}>Complete an expedition to establish the Signal.</p>
          </div>
        ) : (
          <>
            <div style={{ display:"grid", gap:"0.35rem", marginBottom:"1rem" }}>
              {[
                ["Operational Age",  `${signal.operationalAge} runs`],
                ["Recovered Intent", signal.recoveredIntent.toLocaleString()],
                ["Archive Completion", `${completion}% (${signal.clearedBosses.length}/${TOTAL_ARCHIVE_NODES} systems)`],
                ["Operators Active", signal.operatorsEver.length],
                ["Signal Founded",   signal.foundedAt > 0 ? new Date(signal.foundedAt).toLocaleDateString() : "Unknown"],
              ].map(([label, val]) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"0.22rem 0",
                  borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ color:"rgba(255,255,255,0.35)", fontSize:"0.58rem" }}>{label}</span>
                  <span style={{ color:"rgba(255,255,255,0.7)", fontSize:"0.6rem", fontWeight:600 }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Cleared bosses */}
            {signal.clearedBosses.length > 0 && (
              <div>
                <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.52rem", letterSpacing:"0.12em", margin:"0 0 0.3rem" }}>SYSTEMS CLEARED</p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"0.25rem" }}>
                  {signal.clearedBosses.map(b => (
                    <span key={b} style={{ color:"rgba(74,222,128,0.7)", fontSize:"0.52rem", fontFamily:"monospace",
                      background:"rgba(74,222,128,0.06)", border:"1px solid rgba(74,222,128,0.2)",
                      borderRadius:"3px", padding:"0.1rem 0.35rem" }}>{b}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Operator lifetime history */}
      {signal.operatorsEver.length > 0 && (
        <div style={{ flex:1, minWidth:"220px" }}>
          <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.54rem", letterSpacing:"0.14em", margin:"0 0 0.6rem" }}>OPERATOR LIFETIME HISTORY</p>
          <div style={{ display:"flex", flexDirection:"column", gap:"0.55rem" }}>
            {signal.operatorsEver.map(id => {
              const def    = OPERATOR_DISPLAY[id]; if (!def) return null
              const hist   = signal.operatorHistory[id] ?? { runsServed: 0 }
              const hasAny = Object.keys(hist).some(k => k !== "runsServed" && (hist[k] ?? 0) > 0)
              return (
                <div key={id} style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${def.col}22`,
                  borderRadius:"4px", padding:"0.4rem 0.6rem" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.18rem" }}>
                    <span style={{ color:def.col, fontSize:"0.58rem", fontWeight:700 }}>{def.label}</span>
                    <span style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.52rem" }}>{hist.runsServed} runs</span>
                  </div>
                  {hasAny && (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:"0.4rem" }}>
                      {def.stats.map(([key, label]) => {
                        const val = hist[key] ?? 0; if (!val) return null
                        return (
                          <div key={key} style={{ fontSize:"0.5rem" }}>
                            <span style={{ color:"rgba(255,255,255,0.25)" }}>{label} </span>
                            <span style={{ color:"rgba(255,255,255,0.6)", fontWeight:600 }}>{val.toLocaleString()}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Human Archive — recovered meaning from Archive expeditions */}
      <div style={{ flex:"1 1 200px", minWidth:"180px" }}>
        <CMHumanArchive signal={signal} />
      </div>
    </div>
  )
}

// ── CM: Ship Blueprint ─────────────────────────────────────────────────────
function CMBlueprint({ g, lives, liveG }: { g: GState; lives: number; liveG: LiveGSnapshot }) {
  const hullPct = Math.round((lives / MAX_LIVES) * 100)
  const crewAssign = getCrewAssignments()
  return (
    <div style={{ display:"flex", gap:"1.5rem", flexWrap:"wrap" }}>
      {/* Hull */}
      <div style={{ minWidth:"180px" }}>
        <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.54rem", letterSpacing:"0.14em", margin:"0 0 0.5rem" }}>HULL INTEGRITY</p>
        <p style={{ color: hullPct > 60 ? "#4ade80" : hullPct > 30 ? "#facc15" : "#f87171",
          fontSize:"2rem", fontWeight:700, margin:"0 0 0.35rem" }}>{hullPct}%</p>
        <p style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.58rem", margin:0 }}>{lives}/{MAX_LIVES} sections intact</p>

        <div style={{ marginTop:"1rem" }}>
          <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.54rem", letterSpacing:"0.14em", margin:"0 0 0.5rem" }}>ROOMS</p>
          {(["bridge","turret","salvage","engineering"] as StationId[]).map(r => {
            const dmg  = g.roomDamage[r] ?? 0
            const crew = crewAssign[r] ?? null
            const dmgCol = dmg > 0 ? DAMAGE_COLORS[dmg] : "#4ade80"
            return (
              <div key={r} style={{ display:"flex", justifyContent:"space-between", padding:"0.3rem 0",
                borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ color:"rgba(255,255,255,0.5)", fontSize:"0.6rem", textTransform:"uppercase" }}>{r}</span>
                <div style={{ display:"flex", gap:"0.6rem", alignItems:"center" }}>
                  {crew && <span style={{ color:OPS_CREW_COLORS[CREW_ROLE_MAP[crew] ?? ""] ?? "rgba(255,255,255,0.4)",
                    fontSize:"0.52rem" }}>{CREW_ROLE_MAP[crew] ?? crew}</span>}
                  <span style={{ color:dmgCol, fontSize:"0.52rem" }}>
                    {dmg === 0 ? "NOMINAL" : DAMAGE_LABELS[dmg]}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Power allocation */}
      <div style={{ minWidth:"140px" }}>
        <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.54rem", letterSpacing:"0.14em", margin:"0 0 0.5rem" }}>POWER SYSTEMS</p>
        {POWER_SYSTEMS.map(s => {
          const val = _stationState.power[s.id] ?? 0
          return (
            <div key={s.id} style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.3rem" }}>
              <span style={{ color:s.col, fontSize:"0.58rem" }}>{s.label}</span>
              <span style={{ color:"rgba(255,255,255,0.4)", fontSize:"0.58rem" }}>{val}</span>
            </div>
          )
        })}
      </div>

    </div>
  )
}

// ── CM: Crew ───────────────────────────────────────────────────────────────
function CMCrew({ crewStats }: { crewStats: Partial<Record<string, number>> }) {
  const crewAssign = getCrewAssignments()
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"0.8rem" }}>
      <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.54rem", letterSpacing:"0.14em", margin:0 }}>CREW MANIFEST</p>
      {CREW_TYPE_DEFS.map(def => {
        const assigned = Object.entries(crewAssign).find(([, v]) => v === def.id)
        if (!assigned && def.id !== "player") return null  // only show assigned crew
        const [station] = assigned ?? ["unassigned"]
        const label = CREW_ROLE_MAP[def.id] ?? def.id.toUpperCase()
        const col   = OPS_CREW_COLORS[label] ?? "rgba(255,255,255,0.4)"
        return (
          <div key={def.id} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)",
            borderRadius:"5px", padding:"0.6rem 0.8rem" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.2rem" }}>
              <span style={{ color:col, fontSize:"0.68rem", fontWeight:700 }}>{label}</span>
              <span style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.52rem" }}>{station.toUpperCase()}</span>
            </div>
            <p style={{ color:"rgba(255,255,255,0.4)", fontSize:"0.56rem", margin:"0 0 0.3rem" }}>{def.role} · {def.desc}</p>
          </div>
        )
      })}
    </div>
  )
}

// ── CM: Artifacts ──────────────────────────────────────────────────────────
function CMArtifacts({ artifacts }: { artifacts: string[] }) {
  const active = artifacts.filter(id => !id.startsWith("_"))
  return (
    <div>
      <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.54rem", letterSpacing:"0.14em", margin:"0 0 0.6rem" }}>
        ACTIVE ARTIFACTS · {active.length}
      </p>
      {active.length === 0 && (
        <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.6rem", fontStyle:"italic" }}>
          No artifacts acquired — clear a sector to access the reward screen.
        </p>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:"0.4rem" }}>
        {active.map(id => {
          const def = ARTIFACT_DEFS.find(a => a.id === id); if (!def) return null
          const col = ARTIFACT_RARITY_COLORS[def.rarity]
          return (
            <div key={id} style={{ background:`rgba(${def.rarity === "legendary" ? "250,204,21" : def.rarity === "rare" ? "167,139,250" : "255,255,255"},0.03)`,
              border:`1px solid ${col}33`, borderRadius:"4px", padding:"0.5rem 0.7rem" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.15rem" }}>
                <span style={{ color:col, fontSize:"0.65rem", fontWeight:700 }}>{def.name}</span>
                <span style={{ color:`${col}70`, fontSize:"0.46rem", border:`1px solid ${col}44`,
                  borderRadius:"2px", padding:"0.02rem 0.25rem", textTransform:"uppercase" }}>{def.rarity}</span>
              </div>
              <p style={{ color:"rgba(255,255,255,0.45)", fontSize:"0.58rem", margin:0 }}>{def.desc}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── CM: Human Archive ──────────────────────────────────────────────────────
// Shows recovery progress from all archive expeditions.
// Each category accumulates as nodes are cleared across the Signal's lifetime.
function CMHumanArchive({ signal }: { signal: PersistentSignal }) {
  const archive    = signal.humanArchive ?? {}
  const hasAny     = HUMAN_ARCHIVE_CATEGORIES.some(c => (archive[c] ?? 0) > 0)
  const totalPct   = Math.round(HUMAN_ARCHIVE_CATEGORIES.reduce((sum, c) => sum + (archive[c] ?? 0), 0) / HUMAN_ARCHIVE_CATEGORIES.length)
  // Find which node contributes to each category
  const categoryNode: Record<string, string> = {}
  Object.entries(RECOVERY_DEFS).forEach(([nodeId, def]) => { categoryNode[def.category] = nodeId })

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
        marginBottom:"0.7rem" }}>
        <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.54rem", letterSpacing:"0.14em", margin:0 }}>
          HUMAN ARCHIVE
        </p>
        {hasAny && (
          <span style={{ color:"rgba(196,181,253,0.5)", fontSize:"0.55rem" }}>
            {totalPct}% total recovery
          </span>
        )}
      </div>

      {!hasAny ? (
        <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.6rem", fontStyle:"italic", lineHeight:1.6 }}>
          No fragments recovered yet.<br/>
          Complete Archive expeditions to begin recovering what was preserved.
        </p>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:"0.45rem" }}>
          {HUMAN_ARCHIVE_CATEGORIES.map(cat => {
            const pct     = archive[cat] ?? 0
            const nodeId  = categoryNode[cat]
            const node    = nodeId ? SIGNAL_ARCHIVE_E1.find(n => n.id === nodeId) : null
            const isRecov = pct > 0
            return (
              <div key={cat} style={{ opacity: isRecov ? 1 : 0.35 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.18rem" }}>
                  <span style={{ color: isRecov ? "rgba(196,181,253,0.75)" : "rgba(255,255,255,0.2)",
                    fontSize:"0.58rem" }}>{cat}</span>
                  <div style={{ display:"flex", gap:"0.5rem", alignItems:"baseline" }}>
                    {node && isRecov && (
                      <span style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.48rem" }}>
                        {node.name}
                      </span>
                    )}
                    <span style={{ color: isRecov ? "rgba(196,181,253,0.65)" : "rgba(255,255,255,0.15)",
                      fontSize:"0.56rem", fontWeight: isRecov ? 600 : 400 }}>
                      {pct > 0 ? `${pct}%` : "—"}
                    </span>
                  </div>
                </div>
                <div style={{ height:"2px", background:"rgba(255,255,255,0.05)", borderRadius:"1px" }}>
                  {pct > 0 && (
                    <div style={{ height:"100%", width:`${pct}%`,
                      background:"rgba(196,181,253,0.55)", borderRadius:"1px",
                      boxShadow:"0 0 4px rgba(196,181,253,0.3)" }} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── CM: Signal Archive ─────────────────────────────────────────────────────
function CMSignalArchive() {
  const W = 480, H = 300
  const [selected, setSelected] = useState<SignalNode | null>(null)

  return (
    <div style={{ display:"flex", gap:"1rem", flexWrap:"wrap" }}>
      {/* Topology map */}
      <div style={{ flex:"1 1 300px", minWidth:280 }}>
        <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.54rem", letterSpacing:"0.14em", margin:"0 0 0.3rem" }}>
          EPOCH 1: STRUCTURED SYSTEMS
        </p>
        <p style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.5rem", margin:"0 0 0.6rem", fontStyle:"italic" }}>
          Infrastructure topology — click a node for system intel
        </p>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`}
          style={{ display:"block", background:"rgba(0,0,0,0.5)", borderRadius:"6px",
            border:"1px solid rgba(150,107,236,0.15)", cursor:"pointer" }}>
          {/* Edges */}
          {SIGNAL_ARCHIVE_E1.flatMap(node => node.connections.map(toId => {
            const to = SIGNAL_ARCHIVE_E1.find(n => n.id === toId); if (!to) return null
            return (
              <line key={`${node.id}-${toId}`}
                x1={node.x * W} y1={node.y * (H - 30) + 20}
                x2={to.x * W}   y2={to.y * (H - 30) + 20}
                stroke="rgba(150,107,236,0.2)" strokeWidth="1" strokeDasharray="4 5" />
            )
          }))}
          {/* Nodes */}
          {SIGNAL_ARCHIVE_E1.map(node => {
            const nx = node.x * W, ny = node.y * (H - 30) + 20
            const isSelected = selected?.id === node.id
            return (
              <g key={node.id} transform={`translate(${nx},${ny})`}
                onClick={() => setSelected(isSelected ? null : node)}
                style={{ cursor:"pointer" }}>
                <rect x={-56} y={-11} width={112} height={24} rx={4}
                  fill={isSelected ? "rgba(150,107,236,0.15)" : "rgba(10,10,20,0.95)"}
                  stroke={isSelected ? "#a78bfa" : "rgba(150,107,236,0.35)"} strokeWidth={isSelected ? 1.5 : 1} />
                <text x={0} y={3} textAnchor="middle"
                  fill={isSelected ? "#c4b5fd" : "#a78bfa"}
                  fontSize="6.5" fontFamily="monospace" fontWeight="bold">
                  {node.name}
                </text>
                <text x={0} y={11} textAnchor="middle"
                  fill="rgba(248,113,113,0.5)" fontSize="5.5" fontFamily="monospace">
                  {node.bossName}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* System intel panel */}
      <div style={{ flex:"0 0 200px", minWidth:160 }}>
        {selected ? (
          <div>
            <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.52rem", letterSpacing:"0.1em", margin:"0 0 0.5rem" }}>SYSTEM INTEL</p>
            <p style={{ color:"#a78bfa", fontSize:"0.72rem", fontWeight:700, margin:"0 0 0.2rem", fontFamily:"monospace" }}>
              {selected.name}
            </p>
            <p style={{ color:"rgba(248,113,113,0.65)", fontSize:"0.56rem", margin:"0 0 0.6rem" }}>
              {selected.theme}
            </p>
            <div style={{ background:"rgba(248,113,113,0.05)", border:"1px solid rgba(248,113,113,0.15)",
              borderRadius:"4px", padding:"0.4rem 0.5rem", marginBottom:"0.5rem" }}>
              <p style={{ color:"rgba(248,113,113,0.5)", fontSize:"0.48rem", letterSpacing:"0.1em", margin:"0 0 0.1rem" }}>BOSS PATTERN</p>
              <p style={{ color:"#f87171", fontSize:"0.6rem", fontWeight:700, margin:0 }}>{selected.bossName}</p>
              <p style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.52rem", margin:"0.15rem 0 0" }}>{selected.effect}</p>
            </div>
            <div>
              <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.48rem", letterSpacing:"0.1em", margin:"0 0 0.2rem" }}>SIGNAL PATTERNS</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"0.2rem" }}>
                {selected.words.map(w => (
                  <span key={w} style={{ color:"rgba(196,181,253,0.6)", fontSize:"0.52rem",
                    background:"rgba(150,107,236,0.06)", border:"1px solid rgba(150,107,236,0.15)",
                    borderRadius:"3px", padding:"0.1rem 0.3rem", fontFamily:"monospace" }}>
                    {w}
                  </span>
                ))}
              </div>
            </div>
            {selected.connections.length > 0 && (
              <div style={{ marginTop:"0.5rem" }}>
                <p style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.48rem", margin:"0 0 0.15rem" }}>DOWNSTREAM</p>
                {selected.connections.map(id => {
                  const node = SIGNAL_ARCHIVE_E1.find(n => n.id === id)
                  return node ? <p key={id} style={{ color:"rgba(150,107,236,0.5)", fontSize:"0.52rem", margin:"0.05rem 0" }}>→ {node.name}</p> : null
                })}
              </div>
            )}
          </div>
        ) : (
          <div>
            <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.52rem", letterSpacing:"0.1em", margin:"0 0 0.5rem" }}>SIGNAL ARCHIVE</p>
            <p style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.54rem", fontStyle:"italic", lineHeight:1.6 }}>
              The Signal has identified 9 failing infrastructure systems.
            </p>
            <p style={{ color:"rgba(150,107,236,0.4)", fontSize:"0.52rem", margin:"0.5rem 0", lineHeight:1.6 }}>
              Select a node to view system intel.
            </p>
            <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:"0.5rem", marginTop:"0.5rem" }}>
              <p style={{ color:"rgba(255,255,255,0.1)", fontSize:"0.5rem", fontStyle:"italic" }}>
                Selectable run mode: Season 1
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── CM: Statistics ─────────────────────────────────────────────────────────
function CMStats({ g, score }: { g: GState; score: number }) {
  const rows = [
    ["Score", score.toLocaleString()],
    ["Kills", g.kills],
    ["Max Combo", `×${g.maxCombo}`],
    ["Shots Fired", g.shotsFired],
    ["Words Escaped", g.wordsEscaped],
    ["Salvage Collected", g.salvageCollected],
    ["Fragments Earned", g.fragmentsEarned],
    ["Artifacts Active", g.artifacts.filter(id => !id.startsWith("_")).length],
    ["Engineering Bonus", `+${g.engineeringPoolBonus ?? 0} power`],
  ] as [string, string | number][]
  return (
    <div>
      <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.54rem", letterSpacing:"0.14em", margin:"0 0 0.6rem" }}>
        RUN STATISTICS
      </p>
      <div style={{ display:"flex", flexDirection:"column", gap:"0.2rem", maxWidth:"300px" }}>
        {rows.map(([label, val]) => (
          <div key={label} style={{ display:"flex", justifyContent:"space-between",
            padding:"0.25rem 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ color:"rgba(255,255,255,0.35)", fontSize:"0.6rem" }}>{label}</span>
            <span style={{ color:"rgba(255,255,255,0.65)", fontSize:"0.62rem", fontWeight:500 }}>{val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Archive Screen ─────────────────────────────────────────────────────────
// The Signal Archive is the backbone of progression. Every expedition routes through it.

const NODE_STATE_STYLE: Record<NodeState, { border: string; bg: string; textCol: string; labelCol: string }> = {
  unknown:   { border: "rgba(255,255,255,0.06)", bg: "rgba(255,255,255,0.01)", textCol: "rgba(255,255,255,0.12)", labelCol: "rgba(255,255,255,0.1)" },
  available: { border: "rgba(150,107,236,0.5)",  bg: "rgba(150,107,236,0.06)", textCol: "#c4b5fd",               labelCol: "rgba(150,107,236,0.6)" },
  completed: { border: "rgba(74,222,128,0.25)",  bg: "rgba(74,222,128,0.03)",  textCol: "rgba(74,222,128,0.55)", labelCol: "rgba(74,222,128,0.35)" },
  corrupted: { border: "rgba(248,113,113,0.4)",  bg: "rgba(248,113,113,0.05)", textCol: "#f87171",               labelCol: "rgba(248,113,113,0.5)" },
}

// Compute which nodes were newly unlocked when a given node was completed
function getNewlyUnlocked(completedId: string, nodeState: Record<string, NodeState>): string[] {
  const node = SIGNAL_ARCHIVE_E1.find(n => n.id === completedId)
  if (!node) return []
  return node.connections.filter(cid => nodeState[cid] === "available")
}

// Build post-expedition summary line
function buildArchiveSummary(completedId: string, nodeState: Record<string, NodeState>): string {
  const node = SIGNAL_ARCHIVE_E1.find(n => n.id === completedId)
  if (!node) return ""
  const unlocked = node.connections
    .map(cid => SIGNAL_ARCHIVE_E1.find(n => n.id === cid))
    .filter((n): n is SignalNode => !!n && nodeState[n.id] === "available")
  if (unlocked.length === 0) return `${node.name} severed.`
  const names = unlocked.map(n => n.name).join(" and ")
  return `${node.name} severed — ${names} ${unlocked.length > 1 ? "are" : "is"} now accessible.`
}

function ArchiveScreen({ signal, lastCompletedNodeId, onSelectNode }: {
  signal: PersistentSignal
  lastCompletedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const nodeState = signal.archiveNodeState ?? initialArchiveNodeState()
  const W = 560, H = 340

  // Newly unlocked nodes — pulse/glow to show they're freshly accessible
  const newlyUnlocked = lastCompletedNodeId ? getNewlyUnlocked(lastCompletedNodeId, nodeState) : []
  const summaryLine   = lastCompletedNodeId ? buildArchiveSummary(lastCompletedNodeId, nodeState) : null

  return (
    <div style={{ position:"absolute", inset:0, background:"rgba(4,4,10,0.97)", zIndex:10,
      display:"flex", flexDirection:"column", fontFamily:"monospace" }}>
      {/* Header */}
      <div style={{ borderBottom:"1px solid rgba(150,107,236,0.18)", padding:"0.55rem 1.2rem",
        display:"flex", flexDirection:"column", gap:"0.2rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <p style={{ color:"rgba(150,107,236,0.5)", fontSize:"0.5rem", letterSpacing:"0.22em", margin:"0 0 0.1rem" }}>SIGNAL ARCHIVE · EPOCH 1</p>
            <p style={{ color:"#c4b5fd", fontSize:"0.78rem", fontWeight:700, margin:0, letterSpacing:"0.1em" }}>STRUCTURED SYSTEMS</p>
          </div>
          <div style={{ textAlign:"right" }}>
            <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.5rem", margin:"0 0 0.1rem" }}>ARCHIVE COMPLETION</p>
            <p style={{ color:"rgba(74,222,128,0.7)", fontSize:"0.72rem", fontWeight:700, margin:0 }}>
              {signalArchiveCompletion(signal)}% · {signal.clearedBosses.length}/{TOTAL_ARCHIVE_NODES}
            </p>
          </div>
        </div>
        {/* Post-node summary — shows immediately after returning from an expedition */}
        {summaryLine && (
          <div style={{ background:"rgba(74,222,128,0.06)", border:"1px solid rgba(74,222,128,0.2)",
            borderRadius:"4px", padding:"0.28rem 0.6rem" }}>
            <span style={{ color:"rgba(74,222,128,0.8)", fontSize:"0.58rem", fontFamily:"monospace" }}>
              ◈ {summaryLine}
            </span>
            {newlyUnlocked.length > 0 && (
              <span style={{ color:"rgba(196,181,253,0.55)", fontSize:"0.54rem", marginLeft:"0.5rem" }}>
                Hover to view intel. Click to begin.
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main layout: topology + detail */}
      <div style={{ flex:1, display:"flex", gap:"0", overflow:"hidden" }}>
        {/* SVG topology */}
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxHeight:"100%", overflow:"visible" }}>
            {/* Edges */}
            {SIGNAL_ARCHIVE_E1.flatMap(node => node.connections.map(toId => {
              const to = SIGNAL_ARCHIVE_E1.find(n => n.id === toId); if (!to) return null
              const fromState = nodeState[node.id] ?? "unknown"
              const isActive  = fromState === "completed" || fromState === "available"
              return (
                <line key={`${node.id}-${toId}`}
                  x1={node.x * W} y1={node.y * (H - 40) + 24}
                  x2={to.x * W}   y2={to.y * (H - 40) + 24}
                  stroke={isActive ? "rgba(150,107,236,0.3)" : "rgba(255,255,255,0.06)"}
                  strokeWidth="1" strokeDasharray={isActive ? "none" : "3 5"} />
              )
            }))}
            {/* Nodes */}
            {SIGNAL_ARCHIVE_E1.map(node => {
              const ns       = nodeState[node.id] ?? "unknown"
              const style    = NODE_STATE_STYLE[ns]
              const nx       = node.x * W
              const ny       = node.y * (H - 40) + 24
              const cfg      = ARCHIVE_NODE_CFG[node.id]
              const isHover  = hoveredNode === node.id
              const canClick = ns === "available"
              const isNew    = newlyUnlocked.includes(node.id)  // just unlocked this return
              // Pulse animation for newly unlocked nodes — CSS animation via opacity
              const newPulse = isNew ? 0.7 + 0.3 * Math.abs(Math.sin(Date.now() / 500)) : 1
              return (
                <g key={node.id} transform={`translate(${nx},${ny})`}
                  onClick={() => canClick && onSelectNode(node.id)}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: canClick ? "pointer" : "default" }}>
                  {/* Glow ring for newly unlocked nodes */}
                  {isNew && (
                    <rect x={-64} y={-16} width={128} height={34} rx={6}
                      fill="none" stroke="rgba(150,107,236,0.6)" strokeWidth="1.5" strokeDasharray="4 3"
                      opacity={newPulse} />
                  )}
                  <rect x={-60} y={-12} width={120} height={26} rx={4}
                    fill={isNew ? "rgba(150,107,236,0.1)" : isHover && canClick ? "rgba(150,107,236,0.12)" : style.bg}
                    stroke={isNew ? "rgba(150,107,236,0.75)" : isHover && canClick ? "rgba(150,107,236,0.8)" : style.border}
                    strokeWidth={isNew || isHover ? 1.5 : 1} />
                  {/* Completion check */}
                  {ns === "completed" && <text x={-50} y={4} fontSize="8" fill="rgba(74,222,128,0.7)" fontFamily="monospace">✓</text>}
                  {/* Node name */}
                  <text x={ns === "completed" ? -36 : 0} y={2} textAnchor={ns === "completed" ? "start" : "middle"}
                    fontSize="6.5" fontFamily="monospace" fontWeight="bold" fill={isNew ? "#c4b5fd" : style.textCol}>
                    {ns === "unknown" ? "???" : node.name}
                  </text>
                  {/* Boss name */}
                  {ns !== "unknown" && cfg && (
                    <text x={0} y={11} textAnchor="middle" fontSize="5.5" fontFamily="monospace" fill={style.labelCol}>
                      {cfg.boss.name}
                    </text>
                  )}
                  {/* NEW badge — shown for freshly unlocked nodes */}
                  {isNew && (
                    <g>
                      <rect x={34} y={-22} width={22} height={10} rx={2} fill="rgba(150,107,236,0.9)" />
                      <text x={45} y={-14} textAnchor="middle" fontSize="5.5" fontFamily="monospace"
                        fontWeight="bold" fill="#ffffff">NEW</text>
                    </g>
                  )}
                  {/* AVAILABLE indicator — shown for all selectable nodes (dimmer than NEW) */}
                  {ns === "available" && !isNew && (
                    <text x={0} y={-15} textAnchor="middle" fontSize="5" fontFamily="monospace"
                      fill="rgba(150,107,236,0.55)">AVAILABLE</text>
                  )}
                </g>
              )
            })}
            {/* Epoch 2 teaser node — visible but locked when any Epoch 1 nodes are completed */}
            {signal.clearedBosses.length > 0 && (() => {
              const ep2x = 0.5 * W, ep2y = (H - 40) + 24 + 26
              return (
                <g>
                  <line x1={0.5 * W} y1={(1.0 * (H-40) + 24) + 13}
                        x2={ep2x}    y2={ep2y - 12}
                    stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="3 6" />
                  <rect x={ep2x - 60} y={ep2y - 11} width={120} height={22} rx={3}
                    fill="rgba(255,255,255,0.01)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                  <text x={ep2x} y={ep2y + 1} textAnchor="middle" fontSize="6" fontFamily="monospace"
                    fill="rgba(255,255,255,0.14)" fontWeight="bold">EPOCH 2: PLATFORM SPRAWL</text>
                  <text x={ep2x} y={ep2y + 9} textAnchor="middle" fontSize="5.5" fontFamily="monospace"
                    fill="rgba(255,255,255,0.08)">⊗ LOCKED</text>
                </g>
              )
            })()}
          </svg>
        </div>

        {/* Detail panel */}
        <div style={{ width:"200px", flexShrink:0, borderLeft:"1px solid rgba(255,255,255,0.06)",
          padding:"0.8rem 0.9rem", display:"flex", flexDirection:"column", gap:"0.5rem", overflowY:"auto" }}>
          {hoveredNode ? (() => {
            const node = SIGNAL_ARCHIVE_E1.find(n => n.id === hoveredNode)!
            const cfg  = ARCHIVE_NODE_CFG[hoveredNode]
            const ns   = nodeState[hoveredNode] ?? "unknown"
            const style= NODE_STATE_STYLE[ns]
            return (
              <>
                <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.48rem", letterSpacing:"0.14em", margin:0 }}>NODE INTEL</p>
                <div style={{ border:`1px solid ${style.border}`, borderRadius:"4px", padding:"0.45rem 0.5rem",
                  background:style.bg }}>
                  <p style={{ color:style.textCol, fontSize:"0.6rem", fontWeight:700, margin:"0 0 0.15rem" }}>
                    {ns === "unknown" ? "UNKNOWN SYSTEM" : node.name}
                  </p>
                  {ns !== "unknown" && cfg && (
                    <>
                      <p style={{ color:"rgba(255,255,255,0.35)", fontSize:"0.52rem", margin:"0 0 0.3rem" }}>{node.theme}</p>
                      <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.48rem", letterSpacing:"0.08em", margin:"0 0 0.1rem" }}>BOSS PATTERN</p>
                      <p style={{ color:cfg.boss.color, fontSize:"0.55rem", fontWeight:700, margin:"0 0 0.3rem" }}>{cfg.boss.name}</p>
                      <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.48rem", letterSpacing:"0.08em", margin:"0 0 0.1rem" }}>CORRUPTION</p>
                      <p style={{ color:"rgba(248,113,113,0.65)", fontSize:"0.52rem", margin:"0 0 0.3rem" }}>{cfg.corruption.desc}</p>
                      <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.48rem", letterSpacing:"0.08em", margin:"0 0 0.1rem" }}>DEPTH</p>
                      <p style={{ color:"rgba(255,255,255,0.5)", fontSize:"0.55rem", margin:0 }}>Level {cfg.depth}</p>
                    </>
                  )}
                </div>
                {ns === "available" && (
                  <button onClick={() => onSelectNode(hoveredNode)}
                    style={{ background:"rgba(150,107,236,0.15)", border:"1px solid rgba(150,107,236,0.5)",
                      borderRadius:"4px", padding:"0.4rem", color:"#c4b5fd", cursor:"pointer",
                      fontSize:"0.6rem", fontFamily:"monospace", letterSpacing:"0.1em" }}>
                    ENTER BRIEFING →
                  </button>
                )}
                {ns === "completed" && (
                  <p style={{ color:"rgba(74,222,128,0.5)", fontSize:"0.52rem", fontStyle:"italic" }}>System severed. Path continues.</p>
                )}
              </>
            )
          })() : (
            <p style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.54rem", fontStyle:"italic", lineHeight:1.6 }}>
              Hover a node to view system intel.<br/><br/>
              Select an available node to begin an expedition.
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", padding:"0.45rem 1.2rem",
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.5rem" }}>
          hover = intel · click available = briefing
        </span>
        <span style={{ color:"rgba(150,107,236,0.4)", fontSize:"0.5rem" }}>
          SIGNAL AGE: {signal.operationalAge} runs · INTENT: {signal.recoveredIntent.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

// ── Recovery Screen ────────────────────────────────────────────────────────
// Appears after clearing a node. Shows what was preserved inside the system.
// Sparse, still, meaningful — this is a pause, not a reward screen.

function RecoveryScreen({ def, signal, onContinue }: {
  def: RecoveryDef
  signal: PersistentSignal
  onContinue: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const prevProgress = signal.humanArchive?.[def.category] ?? 0
  const newProgress  = Math.min(100, prevProgress + def.percentContrib)

  // Brief delay before showing full content — let the silence breathe
  useEffect(() => {
    const id = setTimeout(() => setRevealed(true), 600)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && revealed) onContinue()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [revealed, onContinue])

  return (
    <div style={{ position:"absolute", inset:0, background:"rgba(2,3,8,0.99)", zIndex:10,
      display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"monospace",
      cursor: revealed ? "pointer" : "default" }}
      onClick={() => revealed && onContinue()}>
      <div style={{ maxWidth:"480px", width:"calc(100% - 2rem)", padding:"2rem" }}>

        {/* Recovery header */}
        <div style={{ marginBottom:"2rem", opacity: revealed ? 1 : 0, transition:"opacity 0.8s" }}>
          <p style={{ color:"rgba(150,107,236,0.45)", fontSize:"0.48rem", letterSpacing:"0.3em",
            margin:"0 0 0.5rem", textTransform:"uppercase" }}>
            RECOVERY DETECTED
          </p>
          <p style={{ color:"#c4b5fd", fontSize:"1.2rem", fontWeight:700, letterSpacing:"0.1em",
            margin:"0 0 0.15rem" }}>
            {def.fragmentName}
          </p>
          <p style={{ color:"rgba(150,107,236,0.35)", fontSize:"0.58rem", margin:0 }}>
            {def.category} · recovered from {Object.keys(RECOVERY_DEFS).find(k => RECOVERY_DEFS[k] === def) ? SIGNAL_ARCHIVE_E1.find(n => RECOVERY_DEFS[n.id] === def)?.name ?? "" : ""}
          </p>
        </div>

        {/* Before Collapse narrative — the emotional core */}
        <div style={{ marginBottom:"2rem", opacity: revealed ? 1 : 0, transition:"opacity 1.2s 0.3s" }}>
          <p style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.48rem", letterSpacing:"0.18em",
            margin:"0 0 0.6rem", textTransform:"uppercase" }}>
            BEFORE COLLAPSE
          </p>
          <p style={{ color:"rgba(255,255,255,0.65)", fontSize:"0.72rem", lineHeight:1.9,
            margin:0, fontStyle:"italic", borderLeft:"2px solid rgba(150,107,236,0.3)",
            paddingLeft:"0.9rem" }}>
            {def.beforeCollapse}
          </p>
        </div>

        {/* Human Archive progress */}
        <div style={{ opacity: revealed ? 1 : 0, transition:"opacity 1s 0.6s", marginBottom:"1.8rem" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
            marginBottom:"0.35rem" }}>
            <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.48rem", letterSpacing:"0.18em",
              margin:0, textTransform:"uppercase" }}>
              HUMAN ARCHIVE PROGRESS · {def.category}
            </p>
            <span style={{ color:"rgba(196,181,253,0.7)", fontSize:"0.6rem", fontWeight:700 }}>
              {prevProgress}% → {newProgress}%
            </span>
          </div>
          <div style={{ height:"3px", background:"rgba(255,255,255,0.05)", borderRadius:"2px" }}>
            {/* Previous progress — dim */}
            <div style={{ height:"100%", width:`${prevProgress}%`, background:"rgba(150,107,236,0.35)",
              borderRadius:"2px" }} />
          </div>
          <div style={{ height:"3px", marginTop:"3px", background:"rgba(255,255,255,0.04)",
            borderRadius:"2px", position:"relative" }}>
            {/* New progress gained — bright, with transition */}
            <div style={{ height:"100%", width:`${newProgress}%`, background:"rgba(196,181,253,0.7)",
              borderRadius:"2px", boxShadow:"0 0 8px rgba(196,181,253,0.4)",
              transition:"width 1s 0.8s ease-out" }} />
            {/* Gain marker */}
            {def.percentContrib > 0 && (
              <div style={{ position:"absolute", left:`${prevProgress}%`, top:"-8px",
                color:"rgba(196,181,253,0.6)", fontSize:"0.44rem", whiteSpace:"nowrap" }}>
                +{def.percentContrib}%
              </div>
            )}
          </div>
        </div>

        {/* Continue prompt */}
        <p style={{ color: revealed ? "rgba(255,255,255,0.2)" : "transparent",
          fontSize:"0.52rem", textAlign:"center", transition:"color 1s 1s",
          margin:0, letterSpacing:"0.1em" }}>
          [ click · space · enter ] to continue
        </p>

      </div>
    </div>
  )
}

// ── Epoch Complete Screen ──────────────────────────────────────────────────
function EpochCompleteScreen({ signal, fragmentsGained, newAge, onContinue }: {
  signal: PersistentSignal
  fragmentsGained: number
  newAge: number
  onContinue: () => void
}) {
  const completion = signalArchiveCompletion(signal)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") onContinue() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onContinue])

  return (
    <div style={{ position:"absolute", inset:0, background:"rgba(4,4,10,0.98)", zIndex:20,
      display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"monospace" }}>
      <div style={{ maxWidth:"420px", width:"calc(100% - 2rem)", textAlign:"center", padding:"2rem" }}>

        {/* Epoch marker */}
        <p style={{ color:"rgba(150,107,236,0.4)", fontSize:"0.5rem", letterSpacing:"0.3em",
          margin:"0 0 0.6rem" }}>EPOCH 1 · STRUCTURED SYSTEMS</p>

        {/* Primary headline */}
        <p style={{ color:"#4ade80", fontSize:"1.4rem", fontWeight:700, letterSpacing:"0.15em",
          margin:"0 0 0.2rem", textShadow:"0 0 30px rgba(74,222,128,0.4)" }}>
          NETWORK SEVERED
        </p>
        <p style={{ color:"rgba(255,255,255,0.4)", fontSize:"0.65rem", margin:"0 0 1.6rem",
          lineHeight:1.6 }}>
          The Signal has severed the Recursion Core.<br/>
          All structured systems are offline.
        </p>

        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.5rem", marginBottom:"1.8rem" }}>
          {[
            ["ARCHIVE COMPLETION", `${completion}%`],
            ["OPERATIONAL AGE",    `${newAge} runs`],
            ["RECOVERED INTENT",   fragmentsGained > 0 ? `+${fragmentsGained} this run` : signal.recoveredIntent.toLocaleString()],
            ["SYSTEMS SEVERED",    `${signal.clearedBosses.length}/${TOTAL_ARCHIVE_NODES}`],
          ].map(([label, val]) => (
            <div key={label} style={{ background:"rgba(74,222,128,0.04)",
              border:"1px solid rgba(74,222,128,0.12)", borderRadius:"5px", padding:"0.55rem 0.6rem" }}>
              <p style={{ color:"rgba(74,222,128,0.7)", fontSize:"0.75rem", fontWeight:700,
                margin:"0 0 0.12rem" }}>{val}</p>
              <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.48rem", letterSpacing:"0.1em",
                margin:0 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Epoch 2 teaser */}
        <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)",
          borderRadius:"5px", padding:"0.6rem 0.8rem", marginBottom:"1.4rem" }}>
          <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.5rem", letterSpacing:"0.14em",
            margin:"0 0 0.2rem" }}>NEXT EPOCH</p>
          <p style={{ color:"rgba(255,255,255,0.35)", fontSize:"0.65rem", fontWeight:700,
            margin:"0 0 0.1rem" }}>EPOCH 2: PLATFORM SPRAWL</p>
          <p style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.55rem", fontStyle:"italic", margin:0 }}>
            SaaS · Integrations · ETL · Workflows · Microservices
          </p>
          <p style={{ color:"rgba(150,107,236,0.35)", fontSize:"0.5rem", margin:"0.3rem 0 0" }}>
            Coming in a future update
          </p>
        </div>

        {/* Continue */}
        <button onClick={onContinue} style={{ width:"100%",
          background:"linear-gradient(135deg,rgba(74,222,128,0.2),rgba(74,222,128,0.1))",
          border:"1px solid rgba(74,222,128,0.35)", borderRadius:"6px", padding:"0.75rem",
          color:"rgba(74,222,128,0.9)", cursor:"pointer", fontSize:"0.75rem", fontWeight:700,
          fontFamily:"monospace", letterSpacing:"0.12em" }}>
          RETURN TO THE SIGNAL  [ENTER]
        </button>

      </div>
    </div>
  )
}

// ── Briefing Screen ────────────────────────────────────────────────────────
function BriefingScreen({ nodeId, signal, onLaunch, onBack }: {
  nodeId: string
  signal: PersistentSignal
  onLaunch: () => void
  onBack: () => void
}) {
  const node = SIGNAL_ARCHIVE_E1.find(n => n.id === nodeId)
  const cfg  = ARCHIVE_NODE_CFG[nodeId]
  if (!node || !cfg) return null
  const nodeState = signal.archiveNodeState ?? initialArchiveNodeState()
  const depth = cfg.depth
  const threatLabel = depth <= 2 ? "LOW" : depth <= 4 ? "MODERATE" : depth <= 6 ? "HIGH" : "CRITICAL"
  const threatCol   = depth <= 2 ? "#4ade80" : depth <= 4 ? "#facc15" : depth <= 6 ? "#fb923c" : "#f87171"

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Enter") onLaunch()
      if (e.key === "Escape") onBack()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onLaunch, onBack])

  return (
    <div style={{ position:"absolute", inset:0, background:"rgba(4,4,10,0.97)", zIndex:10,
      display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"monospace" }}>
      <div style={{ maxWidth:"460px", width:"calc(100% - 2rem)", padding:"1.6rem" }}>

        {/* Header */}
        <div style={{ marginBottom:"1.2rem" }}>
          <p style={{ color:"rgba(150,107,236,0.45)", fontSize:"0.5rem", letterSpacing:"0.22em", margin:"0 0 0.3rem" }}>
            EXPEDITION BRIEFING
          </p>
          <p style={{ color:"#c4b5fd", fontSize:"1.1rem", fontWeight:700, margin:"0 0 0.15rem", letterSpacing:"0.12em" }}>
            {node.name}
          </p>
          <p style={{ color:"rgba(255,255,255,0.35)", fontSize:"0.6rem", margin:0 }}>{node.theme}</p>
        </div>

        {/* Intel rows */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.5rem", marginBottom:"1rem" }}>
          {/* Threat level */}
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"5px", padding:"0.5rem 0.65rem" }}>
            <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.48rem", letterSpacing:"0.1em", margin:"0 0 0.18rem" }}>THREAT LEVEL</p>
            <p style={{ color:threatCol, fontSize:"0.72rem", fontWeight:700, margin:0 }}>{threatLabel}</p>
            <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.5rem", margin:"0.1rem 0 0" }}>Depth {depth}</p>
          </div>
          {/* Boss */}
          <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${cfg.boss.color}22`, borderRadius:"5px", padding:"0.5rem 0.65rem" }}>
            <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.48rem", letterSpacing:"0.1em", margin:"0 0 0.18rem" }}>BOSS PATTERN</p>
            <p style={{ color:cfg.boss.color, fontSize:"0.65rem", fontWeight:700, margin:0 }}>{cfg.boss.name}</p>
            <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.5rem", margin:"0.1rem 0 0" }}>HP: {cfg.boss.hp}</p>
          </div>
          {/* Corruption */}
          <div style={{ background:"rgba(248,113,113,0.04)", border:"1px solid rgba(248,113,113,0.15)", borderRadius:"5px", padding:"0.5rem 0.65rem", gridColumn:"1/-1" }}>
            <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.48rem", letterSpacing:"0.1em", margin:"0 0 0.18rem" }}>ACTIVE CORRUPTION</p>
            <p style={{ color:"rgba(248,113,113,0.8)", fontSize:"0.62rem", fontWeight:700, margin:"0 0 0.1rem" }}>
              {cfg.corruption.id.replace(/_/g, " ").toUpperCase()}
            </p>
            <p style={{ color:"rgba(255,255,255,0.4)", fontSize:"0.56rem", margin:0 }}>{cfg.corruption.desc}</p>
          </div>
        </div>

        {/* Signal vocabulary */}
        <div style={{ marginBottom:"1rem" }}>
          <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.48rem", letterSpacing:"0.12em", margin:"0 0 0.3rem" }}>SIGNAL VOCABULARY</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"0.25rem" }}>
            {node.words.map(w => (
              <span key={w} style={{ color:"rgba(196,181,253,0.6)", fontSize:"0.54rem",
                background:"rgba(150,107,236,0.06)", border:"1px solid rgba(150,107,236,0.15)",
                borderRadius:"3px", padding:"0.1rem 0.32rem" }}>{w}</span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display:"flex", gap:"0.5rem" }}>
          <button onClick={onBack} style={{ background:"transparent",
            border:"1px solid rgba(255,255,255,0.12)", borderRadius:"5px", padding:"0.6rem 1rem",
            color:"rgba(255,255,255,0.35)", cursor:"pointer", fontSize:"0.62rem", fontFamily:"monospace" }}>
            ← ARCHIVE  [ESC]
          </button>
          <button onClick={onLaunch} style={{ flex:1, background:"linear-gradient(135deg,#7c3aed,#6d28d9)",
            border:"none", borderRadius:"5px", padding:"0.7rem", color:"#fff", cursor:"pointer",
            fontSize:"0.8rem", fontWeight:700, fontFamily:"monospace", letterSpacing:"0.1em",
            boxShadow:"0 0 20px rgba(124,58,237,0.4)" }}>
            LAUNCH EXPEDITION  [ENTER]
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reward Screen ──────────────────────────────────────────────────────────
function RewardScreen({ options, level, onPick, artifacts }: {
  options: RewardOption[]
  level: number
  onPick: (id: string) => void
  artifacts: string[]
}) {
  const sectorNames: Record<number, string> = {
    1: "THE RECURSION", 2: "THE DRIFT", 3: "THE FRAGMENT", 4: "THE COLLAPSE",
  }
  const bossCleared = BOSSES[Math.min(level - 2, BOSSES.length - 1)]
  const borderCol   = bossCleared ? `${bossCleared.color}44` : "rgba(150,107,236,0.3)"
  const accentCol   = bossCleared ? bossCleared.color : "#966bec"

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const n = parseInt(e.key)
      if (n >= 1 && n <= options.length) { e.preventDefault(); onPick(options[n-1].id) }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [options, onPick])

  return (
    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
      background:"rgba(5,5,12,0.97)", zIndex:10 }}>
      <div style={{ maxWidth:"420px", width:"100%", padding:"1.5rem" }}>

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:"1.2rem" }}>
          <p style={{ color:`${accentCol}80`, fontSize:"0.52rem", fontFamily:"monospace",
            letterSpacing:"0.3em", margin:"0 0 0.4rem" }}>·· SECTOR REWARD ··</p>
          <p style={{ color:accentCol, fontSize:"0.72rem", fontFamily:"monospace",
            letterSpacing:"0.15em", margin:"0 0 0.25rem", fontWeight:700 }}>
            {sectorNames[level - 1] ?? "SECTOR"} · CLEARED
          </p>
          <p style={{ color:"rgba(255,255,255,0.25)", fontSize:"0.6rem", fontFamily:"monospace", margin:0 }}>
            Choose one enhancement for the next sector
          </p>
        </div>

        {/* Reward cards */}
        <div style={{ display:"flex", flexDirection:"column", gap:"0.5rem", marginBottom:"1rem" }}>
          {options.map((opt, i) => {
            const rarityCol = ARTIFACT_RARITY_COLORS[opt.rarity]
            const isArtifact = opt.type === "artifact"
            return (
              <button key={opt.id} onClick={() => onPick(opt.id)}
                style={{ display:"flex", gap:"0.8rem", alignItems:"flex-start",
                  background:`rgba(${opt.rarity === "legendary" ? "250,204,21" : opt.rarity === "rare" ? "167,139,250" : "255,255,255"},0.04)`,
                  border:`1px solid ${rarityCol}44`,
                  borderRadius:"6px", padding:"0.7rem 0.9rem",
                  cursor:"pointer", textAlign:"left", width:"100%",
                  transition:"border-color 0.15s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = `${rarityCol}88`)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = `${rarityCol}44`)}>
                <span style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.62rem", fontFamily:"monospace",
                  flexShrink:0, lineHeight:"1.4rem" }}>[{i+1}]</span>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.2rem" }}>
                    <span style={{ color:rarityCol, fontSize:"0.72rem", fontFamily:"monospace", fontWeight:700 }}>
                      {opt.label}
                    </span>
                    <span style={{ color:`${rarityCol}80`, fontSize:"0.48rem", fontFamily:"monospace",
                      border:`1px solid ${rarityCol}44`, borderRadius:"2px", padding:"0.05rem 0.3rem",
                      textTransform:"uppercase", letterSpacing:"0.1em" }}>
                      {opt.rarity}
                    </span>
                    {isArtifact && <span style={{ color:"rgba(255,255,255,0.18)", fontSize:"0.48rem", fontFamily:"monospace" }}>ARTIFACT</span>}
                  </div>
                  <p style={{ color:"rgba(212,211,215,0.6)", fontSize:"0.62rem", margin:0, fontFamily:"monospace", lineHeight:1.5 }}>
                    {opt.desc}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Active artifacts mini-list */}
        {artifacts.length > 0 && (
          <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:"0.6rem" }}>
            <p style={{ color:"rgba(255,255,255,0.2)", fontSize:"0.52rem", fontFamily:"monospace",
              letterSpacing:"0.14em", margin:"0 0 0.35rem" }}>ACTIVE ARTIFACTS</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:"0.25rem" }}>
              {artifacts.filter(id => !id.startsWith("_")).map(id => {
                const def = ARTIFACT_DEFS.find(a => a.id === id)
                if (!def) return null
                return (
                  <span key={id} style={{ color:ARTIFACT_RARITY_COLORS[def.rarity],
                    fontSize:"0.52rem", fontFamily:"monospace",
                    background:`rgba(${def.rarity === "legendary" ? "250,204,21" : def.rarity === "rare" ? "167,139,250" : "148,163,184"},0.08)`,
                    border:`1px solid ${ARTIFACT_RARITY_COLORS[def.rarity]}33`,
                    borderRadius:"3px", padding:"0.1rem 0.35rem" }}>
                    {def.name}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        <p style={{ color:"rgba(255,255,255,0.15)", fontSize:"0.55rem", textAlign:"center",
          fontFamily:"monospace", margin:"0.8rem 0 0" }}>
          1 · 2 · 3 select
        </p>
      </div>
    </div>
  )
}
