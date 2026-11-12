import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import type { Metadata, Viewport } from 'next'
import { Barlow, Barlow_Semi_Condensed } from 'next/font/google'
import { Providers } from '@/components/providers/providers'
import './globals.css'

/** Fuente de la interfaz (`font-sans`, la del body). */
const barlow = Barlow({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-barlow',
})

/** Fuente de los números grandes y los títulos (`font-display`): km, montos, odómetro, h1. */
const barlowSemiCondensed = Barlow_Semi_Condensed({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-barlow-semi-condensed',
})

/** Íconos: app/favicon.ico y app/apple-icon.png (convenciones de Next); los de la PWA van en app/manifest.ts. */
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
    <html lang="es-AR" className={`dark ${barlow.variable} ${barlowSemiCondensed.variable}`}>
      <body className="antialiased">
        <Providers>{children}</Providers>
        {process.env.NODE_ENV === 'production' && (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        )}
      </body>
    </html>
  )
}
