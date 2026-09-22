'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Trash2, Wrench } from 'lucide-react'
import { CATEGORY_ICONS } from '@/components/activity'
import { useConfirm } from '@/components/confirm-provider'
import { IntervalPicker } from '@/components/interval-picker'
import { Button } from '@/components/ui/button'
import { ChoiceChips, FieldGroup } from '@/components/ui/choice'
import { Checkbox, Field, FormError, Input, Textarea } from '@/components/ui/form'
import { useCar, useData } from '@/components/providers/data-provider'
import { addInterval, toISODate } from '@/lib/dates'
import { deleteJob, restoreJob, saveJob, type FollowUp } from '@/lib/db'
import { formatDate, formatInterval, formatKm, formatMoney, parseNumberInput } from '@/lib/format'
import { INTERVAL_PRESETS, JOB_CATEGORY_LABELS, type Car, type Job, type JobCategory, type TimeInterval } from '@/lib/types'
import { removeWithUndo, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'
import { StatusBadge } from '../common'

const CATEGORY_FOR_RULE: [RegExp, JobCategory][] = [
  [/service|aceite|filtro/i, 'service'],
  [/cubierta|neum|rotaci/i, 'cubiertas'],
  [/fren/i, 'frenos'],
  [/vtv|seguro|patente|oblea|hidr/i, 'documentacion'],
  [/bater|el[eé]ctr/i, 'electricidad'],
]

const CATEGORY_OPTIONS = (Object.keys(JOB_CATEGORY_LABELS) as JobCategory[]).map(value => ({
  value,
  label: JOB_CATEGORY_LABELS[value],
  icon: CATEGORY_ICONS[value],
}))

export function JobForm({ car, job, preselectedRuleId }: { car: Car; job?: Job; preselectedRuleId?: string | null }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { uid, today, odometer } = useData()
  const { rules } = useCar(car.id)
  const { saving, error, setError, run } = useSaver()

  const preRule = rules.find(r => r.rule.id === preselectedRuleId)?.rule
  const [date, setDate] = useState(job?.date ?? toISODate(new Date()))
  const [km, setKm] = useState(job ? (job.km != null ? String(job.km) : '') : String(car.currentKm))
  const [title, setTitle] = useState(job?.title ?? preRule?.name ?? '')
  const [category, setCategory] = useState<JobCategory>(
    job?.category ?? CATEGORY_FOR_RULE.find(([re]) => preRule && re.test(preRule.name))?.[1] ?? 'service',
  )
  const [cost, setCost] = useState(job ? String(job.cost) : '')
  const [workshop, setWorkshop] = useState(job?.workshop ?? '')
  const [notes, setNotes] = useState(job?.notes ?? '')
  const [ruleIds, setRuleIds] = useState<string[]>(job?.ruleIds ?? (preRule ? [preRule.id] : []))
  // "Volver al taller en…" (sólo al cargar un trabajo nuevo).
  const [comeBack, setComeBack] = useState(false)
  const [comeBackIn, setComeBackIn] = useState<TimeInterval | null>({ amount: 1, unit: 'month' })

  function toggleRule(id: string, name: string, checked: boolean) {
    setRuleIds(ids => (checked ? [...ids, id] : ids.filter(x => x !== id)))
    if (checked && !title.trim()) {
      setTitle(name)
      const cat = CATEGORY_FOR_RULE.find(([re]) => re.test(name))?.[1]
      if (cat) setCategory(cat)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const kmNum = parseNumberInput(km)
    const costNum = parseNumberInput(cost)
    if (!title.trim()) return setError('Poné qué se hizo.')
    if (costNum == null || costNum < 0) return setError('Ingresá cuánto salió (0 si fue gratis).')
    if (kmNum != null && (kmNum < 0 || !Number.isInteger(kmNum))) return setError('Los km no son válidos.')
    if (date > today) return setError('La fecha no puede ser futura.')
    if (comeBack && !comeBackIn) return setError('Elegí en cuánto tiempo tenés que volver al taller.')

    const followUp: FollowUp | null =
      comeBack && comeBackIn ? { name: `Volver al taller: ${title.trim()}`, intervalTime: comeBackIn } : null
    // Los que se repiten vuelven a contar desde este trabajo; los de una sola vez quedan cumplidos.
    const done = rules.filter(r => ruleIds.includes(r.rule.id)).map(r => r.rule)
    const reset = done.filter(r => r.repeat).map(r => r.name)
    const completed = done.filter(r => !r.repeat).map(r => r.name)
    const confirmed = await confirm({
      title: job ? '¿Guardar los cambios del trabajo?' : '¿Guardar este trabajo?',
      description: 'Revisá que los datos estén bien.',
      details: [
        { label: 'Qué se hizo', value: title.trim() },
        { label: 'Categoría', value: JOB_CATEGORY_LABELS[category] },
        { label: 'Fecha', value: formatDate(date) },
        ...(kmNum != null ? [{ label: 'Km', value: formatKm(kmNum) }] : []),
        { label: 'Costo', value: formatMoney(costNum) },
        ...(workshop.trim() ? [{ label: 'Taller', value: workshop.trim() }] : []),
        ...(reset.length ? [{ label: 'Reinicia', value: reset.join(', ') }] : []),
        ...(completed.length ? [{ label: 'Da por cumplido', value: completed.join(', ') }] : []),
        ...(followUp
          ? [{ label: 'Volver al taller', value: `El ${formatDate(addInterval(date, followUp.intervalTime))} (en ${formatInterval(followUp.intervalTime)})` }]
          : []),
      ],
      confirmLabel: 'Sí, guardar',
      icon: Wrench,
    })
    if (!confirmed) return

    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(
        saveJob(
          uid,
          { car, rules: rules.map(r => r.rule), readings: odometer },
          {
            carId: car.id,
            date,
            km: kmNum,
            title: title.trim(),
            category,
            cost: costNum,
            workshop: workshop.trim() || null,
            notes: notes.trim() || null,
            ruleIds,
          },
          job?.id,
          followUp,
        ),
      )
    })
    if (!ok) return
    const note = [
      reset.length ? `Se reinició: ${reset.join(', ')}` : null,
      completed.length ? `Cumplido: ${completed.join(', ')}` : null,
      !reset.length && !completed.length ? formatMoney(costNum) : null,
      followUp ? `Te avisamos para volver el ${formatDate(addInterval(date, followUp.intervalTime))}` : null,
    ]
      .filter(Boolean)
      .join('. ')
    toastSaved(job ? 'Trabajo actualizado' : 'Trabajo guardado', status, note)
    router.replace(`/autos/${car.id}?tab=trabajos`)
  }

  async function handleDelete() {
    if (!job) return
    const confirmed = await confirm({
      tone: 'danger',
      title: '¿Borrar este trabajo?',
      description: `${job.title} · ${formatDate(job.date)} · ${formatMoney(job.cost)}. Los mantenimientos que reinició quedan como están.`,
      confirmLabel: 'Sí, borrar',
    })
    if (!confirmed) return
    router.replace(`/autos/${car.id}?tab=trabajos`)
    removeWithUndo({
      message: 'Trabajo borrado',
      remove: () => deleteJob(uid, job.id),
      restore: () => restoreJob(uid, job),
    })
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-7" noValidate>
      <Field label="Qué se hizo">
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Cambio de aceite y filtros" required />
      </Field>

      <FieldGroup label="Categoría">
        <ChoiceChips value={category} onChange={setCategory} options={CATEGORY_OPTIONS} className="grid grid-cols-2 sm:grid-cols-4" />
      </FieldGroup>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Fecha">
          <Input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} required />
        </Field>
        <Field label="Km" hint="Opcional">
          <Input value={km} onChange={e => setKm(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Costo ($)" className="col-span-2 sm:col-span-1">
          <Input value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal" placeholder="148500" required />
        </Field>
        <Field label="Taller" hint="Opcional" className="col-span-2 sm:col-span-1">
          <Input value={workshop} onChange={e => setWorkshop(e.target.value)} placeholder="Lubricentro Don José" />
        </Field>
      </div>

      {rules.length > 0 && (
        <div>
          <p className="text-sm font-medium">¿Este trabajo incluye algún mantenimiento?</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Lo marcamos como hecho en esta fecha y km: los que se repiten vuelven a contar desde hoy y los de una sola vez se dan por cumplidos.
          </p>
          <div className="grid gap-2">
            {rules.map(({ rule, state }) => (
              <Checkbox
                key={rule.id}
                checked={ruleIds.includes(rule.id)}
                onChange={e => toggleRule(rule.id, rule.name, e.target.checked)}
                label={
                  <span className="flex items-center gap-2">
                    {rule.name} <StatusBadge status={state.status} />
                  </span>
                }
                description={[
                  rule.lastDoneDate ? `${rule.repeat ? 'Última vez' : 'Desde'}: ${formatDate(rule.lastDoneDate)}` : null,
                  rule.repeat && rule.lastDoneKm != null ? formatKm(rule.lastDoneKm) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </div>
        </div>
      )}

      {!job && (
        <div className="space-y-3">
          <Checkbox
            checked={comeBack}
            onChange={e => setComeBack(e.target.checked)}
            label={
              <span className="flex items-center gap-2">
                <CalendarClock aria-hidden className="size-4 text-primary" /> ¿Tenés que volver al taller?
              </span>
            }
            description="Por ejemplo, si te dijeron que vuelvas en 3 semanas para un control. Te lo recordamos."
          />
          {comeBack && (
            <FieldGroup label="¿En cuánto tiempo?" hint={comeBackIn ? `Te avisamos para volver el ${formatDate(addInterval(date, comeBackIn))}.` : undefined}>
              <IntervalPicker value={comeBackIn} onChange={setComeBackIn} presets={INTERVAL_PRESETS.once} aria-label="En cuánto tiempo volver" />
            </FieldGroup>
          )}
        </div>
      )}

      <Field label="Notas" hint="Opcional">
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Aceite 5W30 sintético, filtro de aire…" />
      </Field>

      <FormError>{error}</FormError>

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving} className="h-11 flex-1">
          {saving ? 'Guardando…' : job ? 'Guardar cambios' : 'Guardar trabajo'}
        </Button>
      </div>

      {job && (
        <Button type="button" variant="ghost" className="w-full gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={saving}>
          <Trash2 /> Borrar trabajo
        </Button>
      )}
    </form>
  )
}
