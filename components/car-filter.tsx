'use client'

import type { Car } from '@/lib/types'
import { cn } from '@/lib/utils'
import { carName } from './common'

/** Chips para filtrar por auto; "all" = todos. */
export function CarFilter({ cars, value, onChange }: { cars: Car[]; value: string; onChange: (v: string) => void }) {
  if (cars.length < 2) return null
  const options = [{ id: 'all', label: 'Todos' }, ...cars.map(c => ({ id: c.id, label: carName(c) }))]
  return (
    <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            'shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition',
            value === o.id
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-white/10 text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
