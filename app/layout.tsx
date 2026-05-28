import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Spec Blaster",
  description: "Shoot vague specs before they blow up your sprint. Survive 4 bosses, unlock upgrades, go endless.",
  openGraph: {
    title: "Spec Blaster",
    description: "Shoot vague specs before they blow up your sprint. Survive 4 bosses, unlock upgrades, go endless.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Spec Blaster",
    description: "Shoot vague specs before they blow up your sprint.",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}