import * as React from 'react'
import { CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

const control =
  'w-full rounded-xl border border-input bg-background/60 px-3.5 text-base text-foreground outline-none transition placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 aria-invalid:border-destructive sm:text-sm'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(control, 'h-11', className)} {...props} />
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(control, 'min-h-20 py-2.5', className)} {...props} />
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: string | null
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  )
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/40 p-3 transition has-checked:border-primary/40 has-checked:bg-primary/5',
        className,
      )}
    >
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" {...props} />
      <span className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  )
}

/** Error de un formulario (validación o al guardar), junto al botón. Se anuncia a lectores de pantalla. */
export function FormError({ children, className }: { children?: React.ReactNode; className?: string }) {
  if (!children) return null
  return (
    <p
      role="alert"
      className={cn('flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive', className)}
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
