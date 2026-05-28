import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function GET() {
  const sb = getClient()
  if (!sb) return NextResponse.json({ scores: [] })
  const { data, error } = await sb
    .from("scores")
    .select("id, handle, score, level, kills, created_at")
    .order("score", { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ scores: [] }, { status: 500 })
  return NextResponse.json({ scores: data })
}

export async function POST(req: Request) {
  const sb = getClient()
  if (!sb) return NextResponse.json({ ok: false }, { status: 503 })
  const { handle, score, level, kills } = await req.json()
  if (!handle || typeof score !== "number") return NextResponse.json({ ok: false }, { status: 400 })
  const { error } = await sb.from("scores").insert({ handle, score, level, kills })
  if (error) return NextResponse.json({ ok: false }, { status: 500 })
  return NextResponse.json({ ok: true })
}
