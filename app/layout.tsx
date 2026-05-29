'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import './globals.css'

const navItems = [
  {
    group: 'Main',
    items: [
      { label: 'Clients', href: '/', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
      { label: 'Scorecard', href: '/scorecard', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    ]
  },
  {
    group: 'SEO Tools',
    items: [
      { label: 'Page Generator',     href: '/page-content-generator', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
      { label: 'Blog Generator',     href: '/blog-generator',         icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
      { label: 'GBP Posting',        href: '/gbp-posting',            icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z' },
      { label: 'SEO Monthly Reports',   href: '/seo-monthly-reports',       icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { label: 'SEO Assessment',         href: '/seo-assessment',             icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
      { label: 'Content Calendar',       href: '/content-calendar',           icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
      { label: 'AEO Auditor',            href: '/aeo-auditor',                icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    ]
  },
  {
    group: 'Ads Tools',
    items: [
      { label: 'Daily Client Reports', href: '/daily-client-reports', icon: 'M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
    ]
  },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ display: 'flex', minHeight: '100vh', background: '#f5f5f4' }}>

          {/* Sidebar */}
          <aside style={{
            width: collapsed ? '52px' : '196px',
            background: '#18181b',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            transition: 'width 0.2s ease',
            overflow: 'hidden',
          }}>
            {/* Logo */}
            <div style={{ padding: '16px 12px 12px', borderBottom: '0.5px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 }}>
              {!collapsed && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>Fencepost</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1, whiteSpace: 'nowrap' }}>Internal tools</div>
                </div>
              )}
              <button onClick={() => setCollapsed(c => !c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 2, marginLeft: collapsed ? 'auto' : 0, marginRight: collapsed ? 'auto' : 0, display: 'flex', alignItems: 'center' }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>

            {/* Nav */}
            <nav style={{ padding: '8px 6px', flex: 1 }}>
              {navItems.map(group => (
                <div key={group.group}>
                  {!collapsed && (
                    <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase', letterSpacing: '.09em', padding: '10px 6px 3px' }}>
                      {group.group}
                    </div>
                  )}
                  {group.items.map(item => {
                    const active = pathname === item.href
                    return (
                      <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px',
                          borderRadius: 6, marginBottom: 1, cursor: 'pointer',
                          fontSize: 12, color: active ? '#fff' : 'rgba(255,255,255,0.45)',
                          background: active ? 'rgba(255,255,255,0.09)' : 'transparent',
                          justifyContent: collapsed ? 'center' : 'flex-start',
                          fontWeight: active ? 500 : 400,
                        }}>
                          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={item.icon} />
                          </svg>
                          {!collapsed && (
                            <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
                          )}
                        </div>
                      </Link>
                    )
                  })}
                </div>
              ))}
            </nav>
          </aside>

          {/* Main content */}
          <main style={{ flex: 1, overflow: 'auto' }}>
            {children}
          </main>

        </div>
      </body>
    </html>
  )
}
