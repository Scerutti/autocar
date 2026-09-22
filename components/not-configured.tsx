import { BrandLogo } from '@/components/brand'

export function NotConfigured() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-white/8 bg-card/60 p-8 text-center">
        <BrandLogo className="mx-auto w-32" />
        <h1 className="mt-6 text-xl font-semibold">Falta configurar Firebase</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Completá las variables <code className="text-primary">NEXT_PUBLIC_FIREBASE_*</code> en{' '}
          <code className="text-primary">.env.local</code> y reiniciá el servidor.
        </p>
      </div>
    </div>
  )
}
