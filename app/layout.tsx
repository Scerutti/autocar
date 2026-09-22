import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Providers } from '@/components/providers/providers'
import './globals.css'

// Íconos: app/favicon.ico y app/apple-icon.png (convenciones de Next); los de la PWA van en app/manifest.ts.
export const metadata: Metadata = {
  title: { default: 'AutoCar — Mantenimiento simple', template: '%s · AutoCar' },
  description: 'Llevá el mantenimiento de tus autos al día, sin sorpresas.',
  applicationName: 'AutoCar',
  appleWebApp: { capable: true, title: 'AutoCar', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0b0d0f',
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es-AR" className="dark">
      <body className="antialiased">
        <Providers>{children}</Providers>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
