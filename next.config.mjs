import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

const isDev = process.env.NODE_ENV === 'development'
// trim: un espacio o salto de línea colado en la variable de Vercel dejaría el header inválido.
const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim()
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()

// Donde Firebase abre el iframe oculto del login: el authDomain (puede ser el propio dominio, vía el rewrite
// de /__/auth) y el <proyecto>.firebaseapp.com al que apunta ese rewrite. Sin variables, cualquier firebaseapp.com.
const authFrames = [authDomain && `https://${authDomain}`, projectId && `https://${projectId}.firebaseapp.com`].filter(Boolean)

// CSP sin nonce (las páginas son estáticas): por eso script-src lleva 'unsafe-inline' para la hidratación de Next.
const csp = [
  "default-src 'self'",
  [
    "script-src 'self' 'unsafe-inline'",
    // yoga-layout (lo usa @react-pdf para armar el PDF) compila WebAssembly.
    "'wasm-unsafe-eval'",
    // gapi: lo carga Firebase Auth para el login con Google.
    'https://apis.google.com',
    // React usa eval en desarrollo para las trazas de error.
    isDev && "'unsafe-eval'",
  ],
  // Los style={...} de React son estilos inline.
  "style-src 'self' 'unsafe-inline'",
  [
    "img-src 'self' data: blob:",
    // Fotos de los autos.
    'https://res.cloudinary.com',
    // Avatar de la cuenta de Google.
    'https://*.googleusercontent.com',
  ],
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    // Firestore (incluidos los streams), identitytoolkit/securetoken del login y www.googleapis.com.
    'https://*.googleapis.com',
    // Subida firmada de fotos.
    'https://api.cloudinary.com',
    // HMR de Next en desarrollo.
    isDev && 'ws: wss:',
  ],
  ['frame-src', "'self'", ...(authFrames.length ? authFrames : ['https://*.firebaseapp.com'])],
  // Service worker de los push (/sw.js).
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  !isDev && 'upgrade-insecure-requests',
]
  .filter(Boolean)
  .map(d => (Array.isArray(d) ? d.filter(Boolean).join(' ') : d))
  .join('; ')

// Lo que la app no usa (las fotos se eligen con <input type=file>, no con la cámara). web-share queda permitido: lo usa el PDF.
const permissionsPolicy = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'hid=()',
  'midi=()',
  'display-capture=()',
  'accelerometer=()',
  'gyroscope=()',
  'magnetometer=()',
  'browsing-topics=()',
].join(', ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Versión y commit del deploy, para el pie de Ajustes. VERCEL_GIT_COMMIT_SHA sólo existe en los builds de Vercel.
  env: {
    APP_VERSION: version,
    APP_COMMIT: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7),
  },
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
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: permissionsPolicy },
        ],
      },
      {
        // Todo menos el handler de login de Firebase (/__/auth, servido por el rewrite): es código de Google con sus propias necesidades.
        source: '/((?!__/auth/).*)',
        headers: [{ key: 'Content-Security-Policy', value: csp }],
      },
      {
        // Va última para que su CSP pise la general.
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
