import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

const isDev = process.env.NODE_ENV === 'development'
/** trim: un espacio o salto de línea colado en la variable de Vercel dejaría el header inválido. */
const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim()
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()

/**
 * Donde Firebase abre el iframe oculto del login: el authDomain (puede ser el propio dominio, vía el rewrite
 * de /__/auth) y el <proyecto>.firebaseapp.com al que apunta ese rewrite. Sin variables, cualquier firebaseapp.com.
 */
const authFrames = [authDomain && `https://${authDomain}`, projectId && `https://${projectId}.firebaseapp.com`].filter(Boolean)

/**
 * CSP sin nonce (las páginas son estáticas): por eso script-src lleva 'unsafe-inline' para la hidratación de Next.
 * - script-src: 'wasm-unsafe-eval' porque yoga-layout (lo usa @react-pdf para el PDF) compila WebAssembly;
 *   apis.google.com para gapi (login con Google de Firebase Auth); 'unsafe-eval' sólo en desarrollo (trazas de
 *   error de React).
 * - style-src 'unsafe-inline': los style={...} de React son estilos inline.
 * - img-src: fotos de los autos (Cloudinary) y avatar de la cuenta de Google (googleusercontent).
 * - connect-src: googleapis (Firestore con sus streams, identitytoolkit/securetoken del login), subida firmada
 *   de fotos a Cloudinary y, en desarrollo, ws/wss para el HMR de Next.
 * - frame-src: el iframe del login de Firebase (authFrames).
 * - worker-src: el service worker de los push (/sw.js).
 */
const csp = [
  "default-src 'self'",
  [
    "script-src 'self' 'unsafe-inline'",
    "'wasm-unsafe-eval'",
    'https://apis.google.com',
    isDev && "'unsafe-eval'",
  ],
  "style-src 'self' 'unsafe-inline'",
  [
    "img-src 'self' data: blob:",
    'https://res.cloudinary.com',
    'https://*.googleusercontent.com',
  ],
  "font-src 'self' data:",
  [
    "connect-src 'self' data:",
    'https://*.googleapis.com',
    'https://api.cloudinary.com',
    isDev && 'ws: wss:',
  ],
  [
    'frame-src',
    "'self'",
    ...(authFrames.length ? authFrames : ['https://*.firebaseapp.com']),
  ],
  "worker-src 'self' blob:",
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

/** Lo que la app no usa (las fotos se eligen con <input type=file>, no con la cámara). web-share queda permitido: lo usa el PDF. */
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

/**
 * - env: versión y commit del deploy, para el pie de Ajustes. VERCEL_GIT_COMMIT_SHA sólo existe en los builds de Vercel.
 * - turbopack.root: hay un pnpm-lock.yaml suelto en la carpeta del usuario; se fija la raíz al proyecto.
 * - rewrites: sirve el handler de login de Firebase (/__/auth) desde el mismo dominio de la app, así el login con
 *   Google funciona en Safari/iOS (sin cookies de terceros) cuando NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN apunta al
 *   dominio de la app en producción.
 * - headers: la CSP general no se aplica a /__/auth (código de Google con sus propias necesidades); la entrada de
 *   /sw.js va última para que su CSP pise la general.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  env: {
    APP_VERSION: version,
    APP_COMMIT: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7),
  },
  turbopack: { root: import.meta.dirname },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    if (!projectId) return []
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
        source: '/((?!__/auth/).*)',
        headers: [{ key: 'Content-Security-Policy', value: csp }],
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
