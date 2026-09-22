'use client'

import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// Desplegable propio (Base UI) en vez del <select> nativo: en Windows el nativo abre una lista
// blanca con texto gris claro, ilegible con el tema oscuro.

export function Select<T extends string | number>({
  value,
  onChange,
  items,
  className,
  'aria-label': ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  items: { value: T; label: string }[]
  className?: string
  'aria-label'?: string
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={v => v != null && onChange(v as T)} items={items}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex h-11 min-w-24 cursor-pointer items-center justify-between gap-2 rounded-xl border border-input bg-background/60 px-3.5 text-sm outline-none transition hover:border-white/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 data-popup-open:border-ring',
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="text-muted-foreground">
          <ChevronsUpDown className="size-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner className="z-50 outline-none" sideOffset={6}>
          <SelectPrimitive.Popup className="min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-xl border border-white/10 bg-popover p-1 text-popover-foreground shadow-2xl shadow-black/50 outline-none transition-[scale,opacity] duration-150 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 data-[side=none]:data-starting-style:scale-100 motion-reduce:transition-none">
            <SelectPrimitive.List className="max-h-[var(--available-height)] overflow-y-auto">
              {items.map(item => (
                <SelectPrimitive.Item
                  key={String(item.value)}
                  value={item.value}
                  className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-lg py-2 pl-2.5 pr-4 text-sm outline-none select-none data-highlighted:bg-white/[0.07]"
                >
                  <SelectPrimitive.ItemIndicator className="col-start-1 text-primary">
                    <Check className="size-4" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText className="col-start-2">{item.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
