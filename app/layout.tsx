import './globals.css'
import SidebarClient from './SidebarClient'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <SidebarClient>{children}</SidebarClient>
      </body>
    </html>
  )
}
