/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hay un pnpm-lock.yaml suelto en la carpeta del usuario; fijamos la raíz al proyecto.
  turbopack: { root: import.meta.dirname },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    if (!projectId) return []
    // Sirve el handler de login de Firebase desde el mismo dominio de la app.
    // Así el login con Google funciona en Safari/iOS (sin cookies de terceros) cuando
    // NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN apunta al dominio de la app en producción.
    return [{ source: '/__/auth/:path*', destination: `https://${projectId}.firebaseapp.com/__/auth/:path*` }]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]
  },
}

export default nextConfig
