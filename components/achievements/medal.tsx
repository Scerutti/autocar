'use client'

import { useId } from 'react'
import {
  Armchair,
  BellRing,
  BookMarked,
  BookOpen,
  Cake,
  CalendarCheck,
  Droplet,
  Droplets,
  FileCheck,
  Fuel,
  Gauge,
  Hammer,
  IdCard,
  Leaf,
  Lock,
  NotebookPen,
  ReceiptText,
  Route,
  Settings,
  ShieldCheck,
  Trophy,
  Wallet,
  Warehouse,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { AchievementCategory, AchievementState } from '@/lib/achievements'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = {
  arrancamos: Gauge,
  'primeros-auxilios': Wrench,
  'primera-parada': Fuel,
  'de-estreno': IdCard,
  'un-mes-sobre-ruedas': CalendarCheck,
  'costumbre-de-garaje': Warehouse,
  'copiloto-fiel': Armchair,
  'un-anio-de-ruta': Route,
  'corazon-sano': Droplet,
  'manos-a-la-obra': Hammer,
  'de-mecanico-a-experto': Settings,
  'historial-de-confianza': BookMarked,
  'mejor-prevenir': ShieldCheck,
  'nunca-mas-de-sorpresa': BellRing,
  'tanque-bajo-control': Droplets,
  'consumidor-consciente': Leaf,
  'cada-gota-cuenta': Fuel,
  'ni-un-peso-perdido': Wallet,
  'cuentas-claras': ReceiptText,
  'memoria-de-elefante': NotebookPen,
  'papeles-en-orden': FileCheck,
  'un-viejo-conocido': Cake,
  'una-historia-sobre-ruedas': BookOpen,
}

// Tonos decorativos del centro de la medalla, uno por categoría.
const CORE: Record<AchievementCategory, [string, string]> = {
  inicio: ['#a78bfa', '#5b21b6'],
  constancia: ['#4fb6ff', '#1d4ed8'],
  mantenimiento: ['#fb923c', '#c2410c'],
  combustible: ['#22d3ee', '#0e7490'],
  gastos: ['#34d399', '#047857'],
  historial: ['#f472b6', '#9d174d'],
}

const GOLD: [string, string, string] = ['#fde68a', '#f5b829', '#b45309']
const STEEL: [string, string, string] = ['#4b525b', '#363b42', '#24282d']

/** Borde festoneado: 16 lóbulos alrededor del centro (viewBox 0 0 100 100). */
const ROSETTE = Array.from({ length: 32 }, (_, i) => {
  const angle = (Math.PI * 2 * i) / 32 - Math.PI / 2
  const r = i % 2 === 0 ? 49 : 44.5
  return `${(50 + r * Math.cos(angle)).toFixed(2)},${(50 + r * Math.sin(angle)).toFixed(2)}`
}).join(' ')

export function achievementIcon(id: string): LucideIcon {
  return ICONS[id] ?? Trophy
}

/**
 * Medalla de un logro. Desbloqueado: borde dorado y centro de color. En progreso: centro con un
 * toque de color. Pendiente: gris con candado. El tamaño lo da `className` (p. ej. "size-16").
 */
export function Medal({
  id,
  category,
  state,
  className,
}: {
  id: string
  category: AchievementCategory
  state: AchievementState
  className?: string
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const Icon = achievementIcon(id)
  const unlocked = state === 'unlocked'
  const rim = unlocked ? GOLD : STEEL
  const [coreFrom, coreTo] = CORE[category]

  return (
    <div aria-hidden className={cn('relative aspect-square shrink-0', className)}>
      <svg viewBox="0 0 100 100" className={cn('size-full', unlocked && 'drop-shadow-[0_6px_14px_rgba(245,184,41,0.28)]')}>
        <defs>
          <linearGradient id={`rim${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={rim[0]} />
            <stop offset="50%" stopColor={rim[1]} />
            <stop offset="100%" stopColor={rim[2]} />
          </linearGradient>
          <linearGradient id={`core${uid}`} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor={unlocked ? coreFrom : '#2c3138'} />
            <stop offset="100%" stopColor={unlocked ? coreTo : '#1a1d22'} />
          </linearGradient>
        </defs>
        <polygon points={ROSETTE} fill={`url(#rim${uid})`} stroke={`url(#rim${uid})`} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="50" cy="50" r="36" fill={`url(#core${uid})`} />
        {state === 'in-progress' && <circle cx="50" cy="50" r="36" fill={coreTo} opacity="0.35" />}
        <circle cx="50" cy="50" r="36" fill="none" stroke="white" strokeOpacity={unlocked ? 0.35 : 0.08} strokeWidth="1.5" />
        <circle cx="50" cy="50" r="30.5" fill="none" stroke="white" strokeOpacity={unlocked ? 0.18 : 0.05} strokeWidth="1" />
        {unlocked && <ellipse cx="40" cy="32" rx="18" ry="9" fill="white" opacity="0.14" transform="rotate(-25 40 32)" />}
      </svg>
      <Icon
        strokeWidth={2.2}
        className={cn(
          'absolute left-1/2 top-1/2 size-[36%] -translate-x-1/2 -translate-y-1/2',
          unlocked ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]' : state === 'in-progress' ? 'text-white/70' : 'text-white/35',
        )}
      />
      {state === 'locked' && (
        <span className="absolute -bottom-0.5 -right-0.5 flex size-[34%] items-center justify-center rounded-full border border-white/10 bg-background text-muted-foreground">
          <Lock className="size-[55%]" />
        </span>
      )}
    </div>
  )
}
