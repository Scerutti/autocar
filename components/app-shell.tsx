'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Settings, Wallet, Wrench } from 'lucide-react'
import { BrandMark, BrandWordmark } from '@/components/brand'
import { useAuth } from '@/components/providers/auth-provider'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/', label: 'Inicio', icon: LayoutDashboard },
  { href: '/trabajos', label: 'Trabajos', icon: Wrench },
  { href: '/gastos', label: 'Gastos', icon: Wallet },
  { href: '/ajustes', label: 'Ajustes', icon: Settings },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/' || pathname.startsWith('/autos')
  return pathname.startsWith(href)
}

export function initials(name: string | null | undefined) {
  return (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuth()

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh max-w-7xl">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-white/8 px-5 py-7 lg:flex">
          <Link href="/" aria-label="AutoCar, ir al inicio" className="flex items-center gap-2.5 px-1">
            <BrandMark className="size-11" />
            <BrandWordmark className="h-[19px]" />
          </Link>
          <nav aria-label="Principal" className="mt-9 flex flex-col gap-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(pathname, href) ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                  isActive(pathname, href)
                    ? 'bg-white/8 text-foreground'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
                )}
              >
                <Icon className={cn('size-4', isActive(pathname, href) && 'text-primary')} />
                {label}
              </Link>
            ))}
          </nav>
          {user && (
            <Link href="/ajustes" className="mt-auto rounded-2xl border border-white/8 bg-white/[0.03] p-4 hover:bg-white/[0.05]">
              <div className="flex items-center gap-3">
                {user.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="size-9 rounded-full" />
                ) : (
                  <div className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {initials(user.displayName)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.displayName ?? 'Mi cuenta'}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
            </Link>
          )}
        </aside>

        <main className="w-full min-w-0 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-10">{children}</main>
      </div>

      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-10 border-t border-white/8 bg-background/95 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={cn(
                'flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px]',
                isActive(pathname, href) ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}
