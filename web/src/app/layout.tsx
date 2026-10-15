import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './globals.css'
import AppProviders from '@/components/AppProviders'
import { isFirebaseEmulatorSuiteConfigured } from '@/platform/firebase/firebaseEmulatorConfig'

const startupFont = localFont({
  src: '../assets/fonts/Jua-Regular.woff2',
  variable: '--font-startup-title',
  display: 'swap',
})

export const metadata: Metadata = {
  title: '모두의 가계부',
  description: '가족 지출 관리 앱',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '모두의 가계부',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'household-native-startup': 'content-ready-v1',
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
    <html lang="ko" className={startupFont.variable}>
      <head>
        <link rel="apple-touch-icon" href="/icons/household-v3-apple-touch.png" />
        <link rel="icon" type="image/png" href="/icons/household-v3-192.png" />
        {!isFirebaseEmulatorSuiteConfigured() && <>
          <link rel="preconnect" href="https://securetoken.googleapis.com" crossOrigin="anonymous" />
          <link rel="preconnect" href="https://firestore.googleapis.com" />
        </>}
      </head>
      <body className="min-h-screen">
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  )
}
