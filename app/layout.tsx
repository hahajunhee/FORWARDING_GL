import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '부킹 관리 시스템',
  description: '포워더 부킹 통합 관리',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
