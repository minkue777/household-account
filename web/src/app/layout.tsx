import type { Metadata, Viewport } from 'next'
import './globals.css'
import { CategoryProvider } from '@/contexts/CategoryContext'
import { CalendarStyleProvider } from '@/contexts/CalendarStyleContext'
import { ThemeProvider } from '@/contexts/ThemeContext'

export const metadata: Metadata = {
  title: '또니망고네 가계부',
  description: '가족 지출 관리 앱',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '또니망고네 가계부',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <CalendarStyleProvider>
            <CategoryProvider>
              {children}
            </CategoryProvider>
          </CalendarStyleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
