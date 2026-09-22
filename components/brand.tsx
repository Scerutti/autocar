/* eslint-disable @next/next/no-img-element -- imágenes ya optimizadas por scripts/brand-assets.mjs */
import { cn } from '@/lib/utils'

// Logo de AutoCar. Los archivos se generan desde assets/brand/autocar-logo.png con `npm run brand`.
// width/height reservan el espacio y evitan saltos de layout mientras carga.

/** Isotipo (auto + checklist). Decorativo por defecto: pasar `alt` si va solo. */
export function BrandMark({ className, alt = '' }: { className?: string; alt?: string }) {
  return <img src="/brand/mark.webp" alt={alt} width={160} height={160} className={cn('size-9 shrink-0', className)} />
}

/** "AutoCar" con la tipografía del logo. */
export function BrandWordmark({ className }: { className?: string }) {
  return <img src="/brand/wordmark.webp" alt="AutoCar" width={381} height={72} className={cn('h-5 w-auto', className)} />
}

/** Logo completo (isotipo + nombre). */
export function BrandLogo({ className, loading }: { className?: string; loading?: 'lazy' | 'eager' }) {
  return (
    <img
      src="/brand/logo.webp"
      alt="AutoCar"
      width={520}
      height={456}
      loading={loading}
      className={cn('h-auto w-48', className)}
    />
  )
}
