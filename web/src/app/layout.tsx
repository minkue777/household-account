import type { Metadata } from 'next'
import './globals.css'
import { CategoryProvider } from '@/contexts/CategoryContext'
import { CalendarStyleProvider } from '@/contexts/CalendarStyleContext'
import { ThemeProvider } from '@/contexts/ThemeContext'

export const metadata: Metadata = {
  title: '또니망고네 가계부',
  description: '가족 지출 관리 앱',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
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
