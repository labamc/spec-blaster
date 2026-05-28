import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Spec Blaster",
  description: "You are The Signal — the last coherent carrier of human meaning navigating semantic collapse. Navigate 4 sectors, build your crew, survive infinite recursion.",
  openGraph: {
    title: "Spec Blaster",
    description: "You are The Signal. Navigate semantic collapse. Protect the last coherent meaning.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Spec Blaster",
    description: "You are The Signal. Navigate semantic collapse.",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}