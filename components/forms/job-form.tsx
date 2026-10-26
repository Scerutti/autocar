'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, CircleCheck, CircleX, Trash2, Wrench } from 'lucide-react'
import { CATEGORY_ICONS, CreatedBy, JobStatusBadge, ReadOnlyDetails } from '@/components/activity'
import { useConfirm } from '@/components/confirm-provider'
import { IntervalPicker } from '@/components/interval-picker'
import { Button } from '@/components/ui/button'
import { ChoiceChips, FieldGroup } from '@/components/ui/choice'
import { Checkbox, Field, FormError, Input, Textarea } from '@/components/ui/form'
import { useCar, useData } from '@/components/providers/data-provider'
import { addInterval, toISODate } from '@/lib/dates'
import { approveJob, deleteJob, rejectJob, restoreJob, saveJob, type FollowUp } from '@/lib/db'
import { formatDate, formatInterval, formatKm, formatMoney, parseNumberInput, toNumberInput } from '@/lib/format'
import { entryKmWarning } from '@/lib/odometer'
import { authorLabel, canEditJob, isApproved, isCarOwner } from '@/lib/sharing'
import { errorMessage, toast } from '@/lib/toast'
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

/**
 * Aprobar o rechazar el trabajo que cargó un miembro (lo hace el dueño), con su confirmación. Aprobar aplica los
 * efectos con los mantenimientos y el km que tiene la app en ese momento. Cada acción devuelve true si se hizo.
 */
export function useJobReview() {
  const confirm = useConfirm()
  const { actor, uid, rulesByCar, odometer } = useData()

  async function approve(car: Car, job: Job) {
    const rules = rulesByCar.get(car.id) ?? []
    const done = rules.filter(r => job.ruleIds.includes(r.rule.id)).map(r => r.rule.name)
    const confirmed = await confirm({
      title: '¿Aprobar este trabajo?',
      description: 'Pasa a contar en gastos y reportes, y quien lo cargó ya no lo puede editar.',
      details: [
        { label: 'Qué se hizo', value: job.title },
        { label: 'Cargado por', value: authorLabel(job, car, uid) },
        { label: 'Fecha', value: formatDate(job.date) },
        ...(job.km != null ? [{ label: 'Km', value: formatKm(job.km) }] : []),
        { label: 'Costo', value: formatMoney(job.cost) },
        ...(done.length ? [{ label: 'Marca como hecho', value: done.join(', ') }] : []),
      ],
      confirmLabel: 'Sí, aprobar',
      icon: CircleCheck,
    })
    if (!confirmed) return false
    try {
      const status = await settle(approveJob(actor, { car, rules: rules.map(r => r.rule), readings: odometer }, job))
      toastSaved('Trabajo aprobado', status, job.title)
      return true
    } catch (e) {
      toast.error('No se pudo aprobar', { description: errorMessage(e) })
      return false
    }
  }

  async function reject(car: Car, job: Job) {
    const confirmed = await confirm({
      tone: 'danger',
      title: '¿Rechazar este trabajo?',
      description: `${job.title} · ${formatDate(job.date)} · ${formatMoney(job.cost)}. No cuenta en gastos ni marca mantenimientos. Quien lo cargó (${authorLabel(job, car, uid)}) lo puede corregir y volver a mandar, o borrarlo.`,
      confirmLabel: 'Sí, rechazar',
      icon: CircleX,
    })
    if (!confirmed) return false
    try {
      const status = await settle(rejectJob(actor, { car, readings: odometer }, job))
      toastSaved('Trabajo rechazado', status, job.title)
      return true
    } catch (e) {
      toast.error('No se pudo rechazar', { description: errorMessage(e) })
      return false
    }
  }

  return { approve, reject }
}

/** Aviso con Aprobar y Rechazar arriba del trabajo pendiente que cargó un miembro, para el dueño. */
function ReviewCard({ car, job }: { car: Car; job: Job }) {
  const router = useRouter()
  const { approve, reject } = useJobReview()
  const back = () => router.replace(`/autos/${car.id}?tab=trabajos`)
  return (
    <div className="rounded-2xl border border-warning/25 bg-warning/5 p-4">
      <p className="text-sm font-medium">Este trabajo espera tu aprobación</p>
      <p className="mt-1 text-xs text-muted-foreground">Hasta que lo apruebes no cuenta en gastos ni marca los mantenimientos.</p>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" className="gap-1.5" onClick={async () => (await approve(car, job)) && back()}>
          <CircleCheck /> Aprobar
        </Button>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={async () => (await reject(car, job)) && back()}>
          <CircleX /> Rechazar
        </Button>
      </div>
    </div>
  )
}

/** Un trabajo que no puedo editar: de otra persona, o mío ya aprobado en un auto que me compartieron. */
function JobDetails({ car, job }: { car: Car; job: Job }) {
  const { uid } = useData()
  const { rules } = useCar(car.id)
  const done = rules.filter(r => job.ruleIds.includes(r.rule.id)).map(r => r.rule.name)
  return (
    <ReadOnlyDetails
      car={car}
      record={job}
      badge={<JobStatusBadge job={job} />}
      notice={job.createdBy === uid && isApproved(job) ? 'Ya está aprobado: sólo el dueño del auto lo puede cambiar.' : undefined}
      rows={[
        { label: 'Qué se hizo', value: job.title },
        { label: 'Categoría', value: JOB_CATEGORY_LABELS[job.category] },
        { label: 'Fecha', value: formatDate(job.date) },
        ...(job.km != null ? [{ label: 'Km', value: formatKm(job.km) }] : []),
        { label: 'Costo', value: formatMoney(job.cost) },
        ...(job.workshop ? [{ label: 'Taller', value: job.workshop }] : []),
        ...(done.length ? [{ label: 'Mantenimientos', value: done.join(', ') }] : []),
        ...(job.notes ? [{ label: 'Notas', value: job.notes }] : []),
      ]}
    />
  )
}

/**
 * Alta y edición de un trabajo. Si el trabajo no se puede editar (`canEditJob`), se muestra en modo solo lectura.
 */
export function JobForm({ car, job, preselectedRuleId }: { car: Car; job?: Job; preselectedRuleId?: string | null }) {
  const { uid } = useData()
  if (job && !canEditJob(car, uid, job)) return <JobDetails car={car} job={job} />
  return <JobEditor car={car} job={job} preselectedRuleId={preselectedRuleId} />
}

/**
 * Formulario del trabajo. Los mantenimientos que se repiten vuelven a contar desde este trabajo; los de una sola
 * vez quedan cumplidos. "Volver al taller en…" sólo aparece al cargar un trabajo nuevo, y sólo al dueño: crea un
 * mantenimiento, y el plan es del dueño. Lo que carga o corrige un miembro queda pendiente hasta que el dueño lo
 * aprueba; al dueño, un trabajo pendiente le muestra Aprobar y Rechazar.
 */
function JobEditor({ car, job, preselectedRuleId }: { car: Car; job?: Job; preselectedRuleId?: string | null }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { actor, uid, today, odometer } = useData()
  const { rules } = useCar(car.id)
  const { saving, error, setError, run } = useSaver()
  const owner = isCarOwner(car, uid)
  const ownerName = car.ownerName ?? 'el dueño'

  const preRule = rules.find(r => r.rule.id === preselectedRuleId)?.rule
  const [date, setDate] = useState(job?.date ?? toISODate(new Date()))
  const [km, setKm] = useState(job ? (job.km != null ? String(job.km) : '') : String(car.currentKm))
  const [title, setTitle] = useState(job?.title ?? preRule?.name ?? '')
  const [category, setCategory] = useState<JobCategory>(
    job?.category ?? CATEGORY_FOR_RULE.find(([re]) => preRule && re.test(preRule.name))?.[1] ?? 'service',
  )
  const [cost, setCost] = useState(job ? toNumberInput(job.cost) : '')
  const [workshop, setWorkshop] = useState(job?.workshop ?? '')
  const [notes, setNotes] = useState(job?.notes ?? '')
  const [ruleIds, setRuleIds] = useState<string[]>(job?.ruleIds ?? (preRule ? [preRule.id] : []))
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
    if (owner && comeBack && !comeBackIn) return setError('Elegí en cuánto tiempo tenés que volver al taller.')

    const followUp: FollowUp | null =
      owner && comeBack && comeBackIn ? { name: `Volver al taller: ${title.trim()}`, intervalTime: comeBackIn } : null
    const done = rules.filter(r => ruleIds.includes(r.rule.id)).map(r => r.rule)
    const reset = done.filter(r => r.repeat).map(r => r.name)
    const completed = done.filter(r => !r.repeat).map(r => r.name)
    const applies = owner && (!job || isApproved(job))
    const confirmed = await confirm({
      title: owner
        ? job
          ? '¿Guardar los cambios del trabajo?'
          : '¿Guardar este trabajo?'
        : job
          ? '¿Volver a mandar el trabajo?'
          : '¿Mandar este trabajo?',
      description: owner
        ? 'Revisá que los datos estén bien.'
        : `Queda pendiente hasta que ${ownerName} lo apruebe: recién ahí cuenta en gastos y marca los mantenimientos.`,
      details: [
        { label: 'Qué se hizo', value: title.trim() },
        { label: 'Categoría', value: JOB_CATEGORY_LABELS[category] },
        { label: 'Fecha', value: formatDate(date) },
        ...(kmNum != null ? [{ label: 'Km', value: formatKm(kmNum) }] : []),
        { label: 'Costo', value: formatMoney(costNum) },
        ...(workshop.trim() ? [{ label: 'Taller', value: workshop.trim() }] : []),
        ...(reset.length ? [{ label: applies ? 'Reinicia' : 'Al aprobarlo reinicia', value: reset.join(', ') }] : []),
        ...(completed.length ? [{ label: applies ? 'Da por cumplido' : 'Al aprobarlo cumple', value: completed.join(', ') }] : []),
        ...(followUp
          ? [{ label: 'Volver al taller', value: `El ${formatDate(addInterval(date, followUp.intervalTime))} (en ${formatInterval(followUp.intervalTime)})` }]
          : []),
      ],
      warning: entryKmWarning({ date, km: kmNum, isNew: !job }, car),
      confirmLabel: owner ? 'Sí, guardar' : 'Sí, mandar',
      icon: Wrench,
    })
    if (!confirmed) return

    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(
        saveJob(
          actor,
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
          job,
          followUp,
        ),
      )
    })
    if (!ok) return
    const note = applies
      ? [
          reset.length ? `Se reinició: ${reset.join(', ')}` : null,
          completed.length ? `Cumplido: ${completed.join(', ')}` : null,
          !reset.length && !completed.length ? formatMoney(costNum) : null,
          followUp ? `Te avisamos para volver el ${formatDate(addInterval(date, followUp.intervalTime))}` : null,
        ]
          .filter(Boolean)
          .join('. ')
      : owner
        ? 'Sigue esperando tu aprobación.'
        : `Queda pendiente hasta que ${ownerName} lo apruebe.`
    toastSaved(owner ? (job ? 'Trabajo actualizado' : 'Trabajo guardado') : 'Trabajo enviado', status, note)
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
      remove: () => deleteJob(actor, { car, readings: odometer }, job),
      restore: () => restoreJob(actor, { car, readings: odometer }, job),
    })
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-7" noValidate>
      {job && (
        <div className="flex flex-wrap items-center justify-between gap-2 empty:hidden">
          <CreatedBy record={job} car={car} />
          <JobStatusBadge job={job} />
        </div>
      )}
      {job && owner && job.status === 'pending' && <ReviewCard car={car} job={job} />}
      {job && !owner && job.status === 'rejected' && (
        <p className="rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-muted-foreground">
          {ownerName} rechazó este trabajo. Corregilo y volvé a mandarlo, o borralo.
        </p>
      )}

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
            {owner
              ? 'Lo marcamos como hecho en esta fecha y km: los que se repiten vuelven a contar desde hoy y los de una sola vez se dan por cumplidos.'
              : `Cuando ${ownerName} apruebe el trabajo, los marcamos como hechos en esta fecha y km.`}
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

      {!job && owner && (
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
          {saving ? 'Guardando…' : owner ? (job ? 'Guardar cambios' : 'Guardar trabajo') : job ? 'Volver a mandar' : 'Mandar trabajo'}
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
