'use client'

import type { ReactNode } from 'react'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// Opciones a la vista en lugar de desplegables: más fáciles de entender y de tocar en el celular.
// Base UI da el comportamiento de radio accesible: flechas para moverse, un solo tab stop, roles ARIA.

export interface Choice<T extends string> {
  value: T
  label: ReactNode
  icon?: LucideIcon
  /** Nombre completo para lectores de pantalla cuando el label es corto (p. ej. "Mié"). */
  ariaLabel?: string
}

interface ChoiceGroupProps<T extends string> {
  value: T | null
  onChange: (value: T) => void
  options: Choice<T>[]
  className?: string
  'aria-label'?: string
  disabled?: boolean
}

/** Botones pegados, para 2-4 opciones cortas ("Súper | Premium"). */
export function Segmented<T extends string>({ value, onChange, options, className, disabled, ...aria }: ChoiceGroupProps<T>) {
  return (
    <RadioGroup
      value={value}
      onValueChange={v => onChange(v as T)}
      disabled={disabled}
      aria-label={aria['aria-label']}
      className={cn('grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-muted p-1', className)}
    >
      {options.map(o => (
        <Radio.Root
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          className="flex min-h-9 cursor-pointer select-none items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-center text-sm font-medium leading-tight text-muted-foreground outline-none transition data-unchecked:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm data-checked:ring-1 data-checked:ring-white/15 data-disabled:opacity-50 [&_svg]:size-4"
        >
          {o.icon && <o.icon aria-hidden />}
          {o.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  )
}

/** Grilla de opciones con ícono ("Service", "Frenos"…) o chips de texto ("1 mes", "6 meses"). */
export function ChoiceChips<T extends string>({ value, onChange, options, className, disabled, ...aria }: ChoiceGroupProps<T>) {
  return (
    <RadioGroup
      value={value}
      onValueChange={v => onChange(v as T)}
      disabled={disabled}
      aria-label={aria['aria-label']}
      className={cn('flex flex-wrap gap-2', className)}
    >
      {options.map(o => (
        <Radio.Root
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          className="flex min-h-10 cursor-pointer select-none items-center justify-center gap-2 rounded-xl border border-white/10 bg-background/40 px-3.5 py-2 text-sm text-muted-foreground outline-none transition data-unchecked:hover:border-white/20 data-unchecked:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-checked:border-primary/50 data-checked:bg-primary/10 data-checked:font-medium data-checked:text-primary data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0"
        >
          {o.icon && <o.icon aria-hidden />}
          {o.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  )
}

/**
 * Título + ayuda para un grupo de opciones. Usa fieldset/legend (no <label>, que con varias
 * opciones adentro seleccionaría la primera al tocar el título).
 */
export function FieldGroup({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <fieldset className={cn('mx-0 flex min-w-0 flex-col gap-2 border-0 p-0', className)}>
      <legend className="mb-2 p-0 text-sm font-medium">{label}</legend>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  )
}
