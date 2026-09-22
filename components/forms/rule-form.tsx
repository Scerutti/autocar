'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CircleCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FormError, Input } from '@/components/ui/form'
import { useData } from '@/components/providers/data-provider'
import { toISODate } from '@/lib/dates'
import { deleteRule, restoreRule, saveRule } from '@/lib/db'
import { formatDate, formatKm, parseNumberInput } from '@/lib/format'
import { describeRemaining, getRuleState, summarizeRule } from '@/lib/maintenance'
import { RULE_PRESETS, type Car, type MaintenanceRule } from '@/lib/types'
import { removeWithUndo, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'
import { cn } from '@/lib/utils'
import { LinkButton, RuleProgress, StatusBadge } from '../common'

const numOrEmpty = (n: number | null | undefined) => (n == null ? '' : String(n))

export function RuleForm({ car, rule }: { car: Car; rule?: MaintenanceRule }) {
  const router = useRouter()
  const { uid, today } = useData()
  const { saving, error, setError, run } = useSaver()

  const [name, setName] = useState(rule?.name ?? '')
  const [intervalKm, setIntervalKm] = useState(numOrEmpty(rule?.intervalKm))
  const [intervalMonths, setIntervalMonths] = useState(numOrEmpty(rule?.intervalMonths))
  const [lastKm, setLastKm] = useState(numOrEmpty(rule ? rule.lastDoneKm : car.currentKm))
  const [lastDate, setLastDate] = useState(rule?.lastDoneDate ?? toISODate(new Date()))
  const [warnKm, setWarnKm] = useState(String(rule?.warnKm ?? 500))
  const [warnDays, setWarnDays] = useState(String(rule?.warnDays ?? 30))

  const draft = {
    intervalKm: parseNumberInput(intervalKm),
    intervalMonths: parseNumberInput(intervalMonths),
    lastDoneKm: parseNumberInput(lastKm),
    lastDoneDate: lastDate || null,
    warnKm: parseNumberInput(warnKm) ?? 500,
    warnDays: parseNumberInput(warnDays) ?? 30,
  }
  const preview = getRuleState(draft, car, today)
  const remaining = describeRemaining(preview)

  function applyPreset(i: number) {
    const p = RULE_PRESETS[i]
    setName(p.name)
    setIntervalKm(numOrEmpty(p.intervalKm))
    setIntervalMonths(numOrEmpty(p.intervalMonths))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Poné un nombre (por ejemplo "Service").')
    if (!draft.intervalKm && !draft.intervalMonths) return setError('Indicá cada cuántos km y/o cada cuántos meses.')
    if (draft.intervalKm && draft.lastDoneKm == null) return setError('Indicá a qué km se hizo la última vez.')
    if (draft.intervalMonths && !draft.lastDoneDate) return setError('Indicá la fecha de la última vez.')
    if (draft.lastDoneDate && draft.lastDoneDate > today) return setError('La última vez no puede ser una fecha futura.')

    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(
        saveRule(
          uid,
          {
            carId: car.id,
            name: name.trim(),
            intervalKm: draft.intervalKm || null,
            intervalMonths: draft.intervalMonths || null,
            lastDoneKm: draft.intervalKm ? draft.lastDoneKm : null,
            lastDoneDate: draft.lastDoneDate,
            warnKm: draft.warnKm,
            warnDays: draft.warnDays,
          },
          rule?.id,
        ),
      )
    })
    if (!ok) return
    toastSaved(rule ? 'Mantenimiento guardado' : 'Mantenimiento agregado', status, summarizeRule(name.trim(), preview))
    router.replace(`/autos/${car.id}`)
  }

  function handleDelete() {
    if (!rule) return
    router.replace(`/autos/${car.id}`)
    removeWithUndo({
      message: `"${rule.name}" borrado`,
      remove: () => deleteRule(uid, rule.id),
      restore: () => restoreRule(uid, rule),
    })
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-6">
      {rule && (
        <LinkButton
          href={`/autos/${car.id}/trabajos/nuevo?regla=${rule.id}`}
          size="lg"
          className="h-11 w-full gap-2"
        >
          <CircleCheck /> Lo hice: registrar el trabajo
        </LinkButton>
      )}
      {!rule && (
        <div>
          <p className="mb-2 text-sm font-medium">Elegí uno común o cargalo a mano</p>
          <div className="flex flex-wrap gap-2">
            {RULE_PRESETS.map((p, i) => (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPreset(i)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition',
                  name === p.name
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-white/10 text-muted-foreground hover:text-foreground',
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <Field label="Nombre">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Service, VTV, Seguro…" required />
      </Field>

      <div>
        <p className="text-sm font-medium">Cada cuánto</p>
        <p className="mb-2 text-xs text-muted-foreground">Completá uno o los dos: vence con lo que ocurra primero.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label={<span className="text-xs text-muted-foreground">Kilómetros</span>}>
            <Input value={intervalKm} onChange={e => setIntervalKm(e.target.value)} inputMode="numeric" placeholder="5000" />
          </Field>
          <Field label={<span className="text-xs text-muted-foreground">Meses</span>}>
            <Input value={intervalMonths} onChange={e => setIntervalMonths(e.target.value)} inputMode="numeric" placeholder="12" />
          </Field>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium">Última vez que se hizo</p>
        <p className="mb-2 text-xs text-muted-foreground">Si no te acordás, poné una fecha y km aproximados.</p>
        <div className="grid grid-cols-2 gap-4">
          {draft.intervalKm ? (
            <Field label={<span className="text-xs text-muted-foreground">A los km</span>}>
              <Input value={lastKm} onChange={e => setLastKm(e.target.value)} inputMode="numeric" />
            </Field>
          ) : null}
          <Field label={<span className="text-xs text-muted-foreground">Fecha</span>}>
            <Input type="date" value={lastDate} max={today} onChange={e => setLastDate(e.target.value)} />
          </Field>
        </div>
      </div>

      <details className="rounded-xl border border-white/8 p-4">
        <summary className="cursor-pointer text-sm font-medium">Cuándo avisar</summary>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field label={<span className="text-xs text-muted-foreground">Km antes</span>}>
            <Input value={warnKm} onChange={e => setWarnKm(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label={<span className="text-xs text-muted-foreground">Días antes</span>}>
            <Input value={warnDays} onChange={e => setWarnDays(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
      </details>

      {preview.status !== 'unknown' && (
        <div className="rounded-xl border border-white/8 bg-background/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">Próximo {name || 'vencimiento'}</p>
            <StatusBadge status={preview.status} />
          </div>
          <RuleProgress progress={preview.progress} status={preview.status} />
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            {preview.nextKm != null && (
              <p>
                A los {formatKm(preview.nextKm)} · {remaining.km}
              </p>
            )}
            {preview.nextDate && (
              <p>
                El {formatDate(preview.nextDate)} · {remaining.date}
              </p>
            )}
            {preview.estimatedKmDate && (
              <p>A tu ritmo de uso llegás a esos km aprox. el {formatDate(preview.estimatedKmDate)}</p>
            )}
          </div>
        </div>
      )}

      <FormError>{error}</FormError>

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving} className="h-11 flex-1">
          {saving ? 'Guardando…' : rule ? 'Guardar cambios' : 'Agregar'}
        </Button>
      </div>

      {rule && (
        <Button type="button" variant="ghost" className="w-full gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={saving}>
          <Trash2 /> Borrar mantenimiento
        </Button>
      )}
    </form>
  )
}
