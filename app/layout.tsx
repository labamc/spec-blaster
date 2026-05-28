import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Spec Blaster",
  description: "Shoot scope landmines before they blow up your sprint",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}