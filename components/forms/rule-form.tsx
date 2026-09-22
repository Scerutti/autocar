'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, CircleCheck, Repeat, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/confirm-provider'
import { IntervalPicker } from '@/components/interval-picker'
import { Button } from '@/components/ui/button'
import { FieldGroup, Segmented } from '@/components/ui/choice'
import { Field, FormError, Input } from '@/components/ui/form'
import { useData } from '@/components/providers/data-provider'
import { deleteRule, restoreRule, saveRule } from '@/lib/db'
import { formatDate, formatKm, formatNumber, parseNumberInput } from '@/lib/format'
import { defaultWarnings, describeRemaining, describeRuleInterval, getRuleState } from '@/lib/maintenance'
import { INTERVAL_PRESETS, RULE_PRESETS, type Car, type MaintenanceRule, type RulePreset, type TimeInterval } from '@/lib/types'
import { removeWithUndo, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'
import { cn } from '@/lib/utils'
import { LinkButton, RuleProgress, StatusBadge } from '../common'

const numOrEmpty = (n: number | null | undefined) => (n == null ? '' : String(n))

export function RuleForm({ car, rule }: { car: Car; rule?: MaintenanceRule }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { uid, today } = useData()
  const { saving, error, setError, run } = useSaver()

  // Los de GNC sólo tienen sentido si el auto tiene equipo.
  const presets = RULE_PRESETS.filter(p => !p.requires || car.fuelTypes.includes(p.requires))

  const [name, setName] = useState(rule?.name ?? '')
  const [repeat, setRepeat] = useState(rule?.repeat ?? true)
  const [intervalKm, setIntervalKm] = useState(numOrEmpty(rule?.intervalKm))
  const [intervalTime, setIntervalTime] = useState<TimeInterval | null>(rule?.intervalTime ?? null)
  const [lastKm, setLastKm] = useState(numOrEmpty(rule ? rule.lastDoneKm : car.currentKm))
  const [lastDate, setLastDate] = useState(rule?.lastDoneDate ?? today)
  // Márgenes de aviso: vacío = automático según el intervalo.
  const [warnKm, setWarnKm] = useState(rule ? String(rule.warnKm) : '')
  const [warnDays, setWarnDays] = useState(rule ? String(rule.warnDays) : '')
  // Cambia al aplicar un preset para que el selector de tiempo se reinicie con el valor nuevo.
  const [pickerKey, setPickerKey] = useState(0)

  const kmInterval = parseNumberInput(intervalKm) || null
  const auto = defaultWarnings(kmInterval, intervalTime)
  const draft = {
    intervalKm: kmInterval,
    intervalTime,
    repeat,
    // Si no se repite, se cuenta desde los km actuales.
    lastDoneKm: kmInterval ? (repeat ? parseNumberInput(lastKm) : (rule?.lastDoneKm ?? car.currentKm)) : null,
    lastDoneDate: lastDate || null,
    warnKm: parseNumberInput(warnKm) ?? auto.warnKm,
    warnDays: parseNumberInput(warnDays) ?? auto.warnDays,
  }
  const preview = getRuleState(draft, car, today)
  const remaining = describeRemaining(preview)
  const nextText = [
    preview.nextKm != null ? `a los ${formatKm(preview.nextKm)}` : null,
    preview.nextDate ? `el ${formatDate(preview.nextDate)}` : null,
  ]
    .filter(Boolean)
    .join(' o ')

  function applyPreset(p: RulePreset) {
    setName(p.name)
    setRepeat(p.repeat)
    setIntervalKm(numOrEmpty(p.intervalKm))
    setIntervalTime(p.intervalTime)
    if (!p.repeat) setLastDate(today)
    setWarnKm('')
    setWarnDays('')
    setPickerKey(k => k + 1)
  }

  function changeRepeat(value: 'yes' | 'no') {
    setRepeat(value === 'yes')
    setIntervalTime(null)
    if (value === 'no') setLastDate(today)
    setPickerKey(k => k + 1)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Poné un nombre (por ejemplo "Service").')
    if (!draft.intervalKm && !draft.intervalTime) {
      return setError(repeat ? 'Elegí cada cuánto tiempo y/o cada cuántos km.' : 'Elegí dentro de cuánto tiempo y/o cuántos km.')
    }
    if (draft.intervalKm && draft.lastDoneKm == null) return setError('Indicá a qué km se hizo la última vez.')
    if (!draft.lastDoneDate) return setError(repeat ? 'Indicá la fecha de la última vez.' : 'Indicá desde qué fecha se cuenta.')
    if (draft.lastDoneDate > today) return setError('La fecha no puede ser futura.')

    const confirmed = await confirm({
      title: rule ? `¿Guardar los cambios de "${name.trim()}"?` : `¿Agregar "${name.trim()}"?`,
      description: 'Revisá que los datos estén bien.',
      details: [
        { label: 'Se repite', value: repeat ? 'Sí' : 'No, una sola vez' },
        { label: repeat ? 'Cada' : 'Dentro de', value: describeRuleInterval(draft).replace(/^(Cada|Una sola vez, dentro de) /, '') },
        {
          label: repeat ? 'Última vez' : 'Desde',
          value: [formatDate(draft.lastDoneDate), repeat && draft.lastDoneKm != null ? formatKm(draft.lastDoneKm) : null].filter(Boolean).join(' · '),
        },
        ...(nextText ? [{ label: 'Te toca', value: nextText }] : []),
        {
          label: 'Te avisamos',
          value: [draft.intervalKm ? `${formatNumber(draft.warnKm)} km` : null, draft.intervalTime ? `${draft.warnDays} días` : null]
            .filter(Boolean)
            .join(' o ')
            .concat(' antes'),
        },
      ],
      confirmLabel: rule ? 'Sí, guardar' : 'Sí, agregar',
      icon: repeat ? Repeat : CalendarClock,
    })
    if (!confirmed) return

    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(saveRule(uid, { carId: car.id, name: name.trim(), ...draft }, rule?.id))
    })
    if (!ok) return
    toastSaved(rule ? 'Mantenimiento guardado' : 'Mantenimiento agregado', status, nextText ? `${name.trim()}: te toca ${nextText}` : undefined)
    router.replace(`/autos/${car.id}`)
  }

  async function handleDelete() {
    if (!rule) return
    const confirmed = await confirm({
      tone: 'danger',
      title: `¿Borrar "${rule.name}"?`,
      description: 'Dejamos de avisarte de este mantenimiento. Los trabajos que ya cargaste no se borran.',
      confirmLabel: 'Sí, borrar',
    })
    if (!confirmed) return
    router.replace(`/autos/${car.id}`)
    removeWithUndo({
      message: `"${rule.name}" borrado`,
      remove: () => deleteRule(uid, rule.id),
      restore: () => restoreRule(uid, rule),
    })
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-7" noValidate>
      {rule && (
        <LinkButton href={`/autos/${car.id}/trabajos/nuevo?regla=${rule.id}`} size="lg" className="h-11 w-full gap-2">
          <CircleCheck /> Lo hice: registrar el trabajo
        </LinkButton>
      )}
      {!rule && (
        <div>
          <p className="mb-2 text-sm font-medium">Elegí uno común o cargalo a mano</p>
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPreset(p)}
                aria-pressed={name === p.name}
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
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Service, VTV, Volver al taller…" required />
      </Field>

      <FieldGroup label="¿Se repite?">
        <Segmented
          value={repeat ? 'yes' : 'no'}
          onChange={changeRepeat}
          options={[
            { value: 'yes', label: 'Sí, cada cierto tiempo', icon: Repeat },
            { value: 'no', label: 'No, una sola vez', icon: CalendarClock },
          ]}
        />
      </FieldGroup>

      <FieldGroup
        label={repeat ? '¿Cada cuánto tiempo?' : '¿Dentro de cuánto tiempo?'}
        hint={repeat ? 'Si también completás los km, te avisamos con lo que llegue primero.' : 'Por ejemplo, cuando el mecánico te dice "volvé en 3 semanas".'}
      >
        <IntervalPicker
          key={pickerKey}
          value={intervalTime}
          onChange={setIntervalTime}
          presets={repeat ? INTERVAL_PRESETS.repeat : INTERVAL_PRESETS.once}
          noneLabel="Sólo por km"
          aria-label={repeat ? 'Cada cuánto tiempo' : 'Dentro de cuánto tiempo'}
        />
      </FieldGroup>

      <Field label={repeat ? '¿Cada cuántos km?' : '¿Dentro de cuántos km?'} hint="Opcional si ya elegiste un tiempo">
        <Input value={intervalKm} onChange={e => setIntervalKm(e.target.value)} inputMode="numeric" placeholder={repeat ? '5000' : '1000'} />
      </Field>

      <div>
        <p className="text-sm font-medium">{repeat ? 'Última vez que se hizo' : 'Desde cuándo se cuenta'}</p>
        <p className="mb-2 text-xs text-muted-foreground">
          {repeat ? 'Si no te acordás, poné una fecha y km aproximados.' : 'Normalmente hoy, o el día que fuiste al taller.'}
        </p>
        <div className="grid grid-cols-2 gap-4">
          {repeat && draft.intervalKm ? (
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
        <summary className="cursor-pointer text-sm font-medium">Cuándo avisar (opcional)</summary>
        <p className="mt-2 text-xs text-muted-foreground">Si lo dejás vacío, lo calculamos según cada cuánto es.</p>
        <div className="mt-4 grid grid-cols-2 gap-4">
          {draft.intervalKm ? (
            <Field label={<span className="text-xs text-muted-foreground">Km antes</span>}>
              <Input value={warnKm} onChange={e => setWarnKm(e.target.value)} inputMode="numeric" placeholder={String(auto.warnKm)} />
            </Field>
          ) : null}
          {draft.intervalTime ? (
            <Field label={<span className="text-xs text-muted-foreground">Días antes</span>}>
              <Input value={warnDays} onChange={e => setWarnDays(e.target.value)} inputMode="numeric" placeholder={String(auto.warnDays)} />
            </Field>
          ) : null}
        </div>
      </details>

      {preview.status !== 'unknown' && (
        <div className="rounded-xl border border-white/8 bg-background/30 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium">Próximo {name || 'vencimiento'}</p>
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
            {preview.estimatedKmDate && <p>A tu ritmo de uso llegás a esos km aprox. el {formatDate(preview.estimatedKmDate)}</p>}
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
