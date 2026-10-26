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
import { approveJob, deleteJob, rejectJob, restoreJob, saveJob, type FollowUp, type JobInput } from '@/lib/db'
import { formatDate, formatInterval, formatKm, formatMoney, formatNumber, parseNumberInput, toNumberInput } from '@/lib/format'
import { describeProjectionChange, formatLastDoneKm, isCompleted, jobChangeDiff, jobDoneKm, kmRulesOf } from '@/lib/maintenance'
import { entryKmWarning, linkedReadingId } from '@/lib/odometer'
import { authorLabel, canEditJob, isApproved, isCarOwner } from '@/lib/sharing'
import { errorMessage, toast } from '@/lib/toast'
import { INTERVAL_PRESETS, JOB_CATEGORY_LABELS, type Car, type Job, type JobCategory, type MaintenanceRule, type OdometerReading, type TimeInterval } from '@/lib/types'
import { removeWithUndo, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'
import { CompletedBadge, StatusBadge } from '../common'

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

/** «Service», «Service» y «Correa», «A», «B» y «C». */
function quotedList(names: string[]) {
  const quoted = names.map(n => `«${n}»`)
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} y ${quoted[quoted.length - 1]}` : (quoted[0] ?? '')
}

/**
 * Lo que necesitan las escrituras de un trabajo (`saveJob`, `approveJob`, `deleteJob`…): el auto, todos sus
 * mantenimientos (también los cumplidos), sus trabajos y las lecturas de km que tiene la app.
 */
function jobContext(car: Car, rules: MaintenanceRule[], jobs: Job[], readings: OdometerReading[]) {
  return { car, rules: rules.filter(r => r.carId === car.id), jobs: jobs.filter(j => j.carId === car.id), readings }
}

/** «Service pasa a…», una por línea: cómo quedan los mantenimientos después de cambiar o borrar un trabajo aprobado. */
function ruleChangeLines(rules: MaintenanceRule[], changes: ReturnType<typeof jobChangeDiff>) {
  const lines = changes.flatMap(c => {
    const rule = rules.find(r => r.id === c.ruleId)
    return rule ? [describeProjectionChange(rule, c.patch)] : []
  })
  return lines.length ? lines.map((line, i) => <span key={i} className="block">{line}</span>) : null
}

/**
 * Aprobar o rechazar el trabajo que cargó un miembro (lo hace el dueño), con su confirmación. Aprobar recalcula los
 * mantenimientos con las lecturas que tiene la app en ese momento: si el trabajo no tiene km y marca un mantenimiento
 * por km, el km estimado a la fecha del trabajo. Cada acción devuelve true si se hizo.
 * Se aprueba o se rechaza la versión que se mostró en la confirmación (`approveJob`, `rejectJob`): si el miembro la
 * editó mientras tanto, falla con "El trabajo cambió mientras lo revisabas". Si ya estaba aprobado (o rechazado) desde
 * otro dispositivo, cuenta como hecho. Si el rechazo de las reglas llega después de `settle` (sin conexión), el aviso
 * sale en un toast "No se pudo aprobar" o "No se pudo rechazar".
 */
export function useJobReview() {
  const confirm = useConfirm()
  const { actor, uid, rules: allRules, jobs, odometer } = useData()

  async function approve(car: Car, job: Job) {
    const ctx = jobContext(car, allRules, jobs, odometer)
    const done = ctx.rules.filter(r => job.ruleIds.includes(r.id) && !isCompleted(r)).map(r => r.name)
    const estimate = job.km == null && kmRulesOf(ctx.rules, job.ruleIds).length ? jobDoneKm(job, odometer) : null
    const confirmed = await confirm({
      title: '¿Aprobar este trabajo?',
      description: 'Pasa a contar en gastos y reportes, y quien lo cargó ya no lo puede editar.',
      details: [
        { label: 'Qué se hizo', value: job.title },
        { label: 'Cargado por', value: authorLabel(job, car, uid) },
        { label: 'Fecha', value: formatDate(job.date) },
        ...(job.km != null
          ? [{ label: 'Km', value: formatKm(job.km) }]
          : estimate
            ? [{ label: 'Km (estimado)', value: `≈ ${formatKm(estimate.km)}` }]
            : []),
        { label: 'Costo', value: formatMoney(job.cost) },
        ...(done.length ? [{ label: 'Marca como hecho', value: done.join(', ') }] : []),
      ],
      confirmLabel: 'Sí, aprobar',
      icon: CircleCheck,
    })
    if (!confirmed) return false
    try {
      const status = await settle(approveJob(actor, ctx, job), 'No se pudo aprobar')
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
      const status = await settle(rejectJob(actor, jobContext(car, allRules, jobs, odometer), job), 'No se pudo rechazar')
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
  const { allRules } = useCar(car.id)
  const done = allRules.filter(r => job.ruleIds.includes(r.id)).map(r => r.name)
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
 * vez quedan cumplidos. Para marcar se ofrecen los activos y, al editar, los que cumplió este mismo trabajo (marcados:
 * desmarcarlo los vuelve a activar); los que cumplió otro trabajo no aparecen. Al editar o borrar un trabajo aprobado,
 * la confirmación dice cómo quedan los mantenimientos que cambian (`jobChangeDiff`).
 * "Volver al taller en…" sólo aparece al cargar un trabajo nuevo, y sólo al dueño: crea un
 * mantenimiento, y el plan es del dueño. Lo que carga o corrige un miembro queda pendiente hasta que el dueño lo
 * aprueba; al dueño, un trabajo pendiente le muestra Aprobar y Rechazar.
 * El km arranca vacío (no se inventa el de hoy). Si se marca un mantenimiento por km y queda vacío, el campo muestra
 * el km estimado a la fecha (`jobDoneKm`) como sugerencia: el trabajo se guarda sin km y el mantenimiento toma ese
 * estimado marcado como tal. Sin estimación (fecha anterior a la primera lectura), el km es
 * obligatorio.
 * Al guardar, los cambios se miden contra el trabajo como estaba al abrir el formulario (`original`): lo que otro
 * dispositivo cambió mientras tanto en otros campos no se pisa, y si no cambió nada no se escribe ("Sin cambios").
 */
function JobEditor({ car, job, preselectedRuleId }: { car: Car; job?: Job; preselectedRuleId?: string | null }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { actor, uid, today, odometer } = useData()
  const { rules, allRules, jobs, readings } = useCar(car.id)
  const { saving, error, setError, run } = useSaver()
  const owner = isCarOwner(car, uid)
  const ownerName = car.ownerName ?? 'el dueño'
  const ctx = { car, rules: allRules, jobs, readings: odometer }
  const completedHere = job ? allRules.filter(r => r.completedByJobId === job.id) : []
  const selectable = [...rules.map(r => r.rule), ...completedHere]

  const preRule = rules.find(r => r.rule.id === preselectedRuleId)?.rule
  const [date, setDate] = useState(job?.date ?? toISODate(new Date()))
  const [km, setKm] = useState(job?.km != null ? String(job.km) : '')
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
  const [original] = useState(job)

  const kmNum = parseNumberInput(km)
  const kmRules = kmRulesOf(selectable, ruleIds)
  const estimate = kmRules.length && kmNum == null ? jobDoneKm({ id: job?.id, carId: car.id, date, km: null }, readings) : null

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
    const costNum = parseNumberInput(cost)
    if (!title.trim()) return setError('Poné qué se hizo.')
    if (costNum == null || costNum < 0) return setError('Ingresá cuánto salió (0 si fue gratis).')
    if (kmNum != null && (kmNum < 0 || !Number.isInteger(kmNum))) return setError('Los km no son válidos.')
    if (date > today) return setError('La fecha no puede ser futura.')
    if (kmRules.length && kmNum == null && !estimate) {
      return setError(`Para reiniciar ${quotedList(kmRules.map(r => r.name))} necesitamos los km de ese día.`)
    }
    if (owner && comeBack && !comeBackIn) return setError('Elegí en cuánto tiempo tenés que volver al taller.')

    const followUp: FollowUp | null =
      owner && comeBack && comeBackIn ? { name: `Volver al taller: ${title.trim()}`, intervalTime: comeBackIn } : null
    const input: JobInput = {
      carId: car.id,
      date,
      km: kmNum,
      title: title.trim(),
      category,
      cost: costNum,
      workshop: workshop.trim() || null,
      notes: notes.trim() || null,
      ruleIds,
    }
    const done = selectable.filter(r => ruleIds.includes(r.id))
    const reset = done.filter(r => r.repeat).map(r => r.name)
    const completed = done.filter(r => !r.repeat).map(r => r.name)
    const applies = owner && (!job || isApproved(job))
    const changes =
      owner && job && isApproved(job)
        ? ruleChangeLines(allRules, jobChangeDiff({ rules: allRules, jobs, readings: odometer, before: job, after: { ...job, ...input } }))
        : null
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
        ...(kmNum != null
          ? [{ label: 'Km', value: formatKm(kmNum) }]
          : estimate
            ? [{ label: 'Km (estimado)', value: `≈ ${formatKm(estimate.km)}` }]
            : []),
        { label: 'Costo', value: formatMoney(costNum) },
        ...(workshop.trim() ? [{ label: 'Taller', value: workshop.trim() }] : []),
        ...(job && applies
          ? changes
            ? [{ label: 'Mantenimientos', value: changes }]
            : []
          : [
              ...(reset.length ? [{ label: applies ? 'Reinicia' : 'Al aprobarlo reinicia', value: reset.join(', ') }] : []),
              ...(completed.length ? [{ label: applies ? 'Da por cumplido' : 'Al aprobarlo cumple', value: completed.join(', ') }] : []),
            ]),
        ...(followUp
          ? [{ label: 'Volver al taller', value: `El ${formatDate(addInterval(date, followUp.intervalTime))} (en ${formatInterval(followUp.intervalTime)})` }]
          : []),
      ],
      warning: entryKmWarning({ date, km: kmNum, isNew: !job, readingId: job ? linkedReadingId('job', job.id) : null }, car, readings),
      confirmLabel: owner ? 'Sí, guardar' : 'Sí, mandar',
      icon: Wrench,
    })
    if (!confirmed) return

    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(saveJob(actor, ctx, input, original, followUp))
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
    const changes = isApproved(job)
      ? ruleChangeLines(allRules, jobChangeDiff({ rules: allRules, jobs, readings: odometer, before: job, after: null }))
      : null
    const confirmed = await confirm({
      tone: 'danger',
      title: '¿Borrar este trabajo?',
      description: `${job.title} · ${formatDate(job.date)} · ${formatMoney(job.cost)}.${changes ? ' Los mantenimientos vuelven a como estaban antes de este trabajo.' : ''}`,
      details: changes ? [{ label: 'Mantenimientos', value: changes }] : undefined,
      confirmLabel: 'Sí, borrar',
    })
    if (!confirmed) return
    router.replace(`/autos/${car.id}?tab=trabajos`)
    removeWithUndo({
      message: 'Trabajo borrado',
      remove: () => deleteJob(actor, ctx, job),
      restore: () => restoreJob(actor, ctx, job),
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
        <Field
          label="Km"
          hint={
            estimate
              ? '≈ estimado con tus registros; corregilo si lo sabés'
              : kmRules.length && kmNum == null
                ? `Hace falta para reiniciar ${quotedList(kmRules.map(r => r.name))}`
                : 'Opcional'
          }
        >
          <Input
            value={km}
            onChange={e => setKm(e.target.value)}
            inputMode="numeric"
            placeholder={estimate ? `≈ ${formatNumber(estimate.km)}` : undefined}
          />
        </Field>
        <Field label="Costo ($)" className="col-span-2 sm:col-span-1">
          <Input value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal" placeholder="148500" required />
        </Field>
        <Field label="Taller" hint="Opcional" className="col-span-2 sm:col-span-1">
          <Input value={workshop} onChange={e => setWorkshop(e.target.value)} placeholder="Lubricentro Don José" />
        </Field>
      </div>

      {selectable.length > 0 && (
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
                  rule.repeat ? formatLastDoneKm(rule) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
            {completedHere.map(rule => (
              <Checkbox
                key={rule.id}
                checked={ruleIds.includes(rule.id)}
                onChange={e => toggleRule(rule.id, rule.name, e.target.checked)}
                label={
                  <span className="flex items-center gap-2">
                    {rule.name} <CompletedBadge />
                  </span>
                }
                description="Lo cumplió este trabajo. Si lo desmarcás, vuelve a estar activo."
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
