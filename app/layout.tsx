import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Spec Blaster",
  description: "Shoot scope landmines before they blow up your sprint",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#14141a", color: "#fff" }}>
        {children}
      </body>
    </html>
  )
}