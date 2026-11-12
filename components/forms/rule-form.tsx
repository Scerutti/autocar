'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarClock, CircleCheck, Repeat, Trash2, Wrench } from 'lucide-react'
import { useConfirm } from '@/components/confirm-provider'
import { IntervalPicker } from '@/components/interval-picker'
import { Button } from '@/components/ui/button'
import { FieldGroup, Segmented } from '@/components/ui/choice'
import { Field, FormError, Input } from '@/components/ui/form'
import { useCar, useData } from '@/components/providers/data-provider'
import { deleteRule, newChildId, restoreRule, saveRule, type RuleInput } from '@/lib/db'
import { formatDate, formatDayMonth, formatKm, formatNumber, parseNumberInput } from '@/lib/format'
import {
  defaultWarnings,
  describeRemaining,
  describeRuleInterval,
  formatLastDoneKm,
  getRuleState,
  MISSING_LAST_KM,
  missingLastKm,
  projectRule,
  type RuleProjection,
} from '@/lib/maintenance'
import { draftSeed, newOutboxId, originalFields, outboxEntry, type OutboxEntryOf } from '@/lib/outbox'
import { isCarOwner } from '@/lib/sharing'
import { INTERVAL_PRESETS, RULE_PRESETS, type Car, type Job, type MaintenanceRule, type RulePreset, type TimeInterval } from '@/lib/types'
import { removeWithUndo, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'
import { cn } from '@/lib/utils'
import { LinkButton, RuleProgress, StatusBadge, carName } from '../common'

const numOrEmpty = (n: number | null | undefined) => (n == null ? '' : String(n))

/**
 * Respuesta a "¿Se repite?": `repeat` (cada cierto tiempo), `once` (una sola vez, con aviso: "volvé en 3 semanas") o
 * `done` (ya está hecho y no hay que volver, sólo en el alta): eso no es un mantenimiento, se carga como trabajo.
 */
type RepeatMode = 'repeat' | 'once' | 'done'

/** Aviso para quien ve un auto compartido: el plan de mantenimiento es del dueño. */
export const OWNER_ONLY_PLAN = 'Solo el dueño puede cambiar el plan.'

/**
 * "Según el trabajo «Service» del 12/03" o "Cumplido con el trabajo «Volver al taller» del 12/03", con link al trabajo:
 * el trabajo aprobado que manda en el mantenimiento (`lastDoneJobId` o `completedByJobId` de la proyección). null si
 * manda la base.
 */
function RulingJobNotice({
  car,
  projection,
  jobs,
}: {
  car: Car
  projection: RuleProjection & Pick<MaintenanceRule, 'intervalKm'>
  jobs: Job[]
}) {
  const id = projection.completedByJobId ?? projection.lastDoneJobId
  const job = id ? jobs.find(j => j.id === id) : null
  if (!job) return null
  const missingKm = !projection.completedByJobId && missingLastKm(projection)
  return (
    <Link
      href={`/autos/${car.id}/trabajos/${job.id}`}
      className="block rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-3 text-sm transition hover:bg-primary/10"
    >
      <span className="font-medium">
        {projection.completedByJobId ? 'Cumplido con' : 'Según'} el trabajo «{job.title}» del {formatDayMonth(job.date)}
      </span>
      {!projection.completedByJobId && (
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {[formatDate(job.date), formatLastDoneKm(projection)].filter(Boolean).join(' · ')}
        </span>
      )}
      {missingKm && <span className="mt-0.5 block text-xs text-warning">{MISSING_LAST_KM}: cargalo en el trabajo.</span>}
    </Link>
  )
}

/** Un mantenimiento de un auto que me compartieron: su estado, sin acciones. */
function RuleDetails({ car, rule }: { car: Car; rule: MaintenanceRule }) {
  const { rules, jobs } = useCar(car.id)
  const state = rules.find(r => r.rule.id === rule.id)?.state
  const remaining = state ? describeRemaining(state) : null
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-3 text-sm text-muted-foreground">{OWNER_ONLY_PLAN}</p>
      <RulingJobNotice car={car} projection={rule} jobs={jobs} />
      {missingLastKm(rule) && !rule.lastDoneJobId && (
        <p className="rounded-xl border border-warning/25 bg-warning/5 px-3.5 py-3 text-sm text-warning">
          {MISSING_LAST_KM}: hasta que {car.ownerName ?? 'el dueño'} lo complete, se calcula sólo por fecha.
        </p>
      )}
      {state && state.status !== 'unknown' && (
        <div className="rounded-xl border border-white/8 bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium">Próximo {rule.name}</p>
            <StatusBadge status={state.status} />
          </div>
          <RuleProgress progress={state.progress} status={state.status} />
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            {state.nextKm != null && (
              <p>
                A los {formatKm(state.nextKm)} · {remaining?.km}
              </p>
            )}
            {state.nextDate && (
              <p>
                El {formatDate(state.nextDate)} · {remaining?.date}
              </p>
            )}
          </div>
        </div>
      )}
      <dl className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8 bg-card/60">
        {[
          { label: 'Cada cuánto', value: describeRuleInterval(rule) },
          {
            label: rule.repeat ? 'Última vez' : 'Desde',
            value: [rule.lastDoneDate ? formatDate(rule.lastDoneDate) : null, rule.repeat ? formatLastDoneKm(rule) : null]
              .filter(Boolean)
              .join(' · ') || '—',
          },
        ].map(r => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
            <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
            <dd className="min-w-0 text-right font-medium">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Alta y edición de un mantenimiento. A quien no es el dueño se le muestra sólo su estado (`RuleDetails`). `draft`: un
 * mantenimiento de la bandeja que el servidor no guardó (`?borrador=`), para corregirlo y volver a guardarlo.
 */
export function RuleForm({ car, rule, draft }: { car: Car; rule?: MaintenanceRule; draft?: OutboxEntryOf<'rule'> | null }) {
  const { uid } = useData()
  if (!isCarOwner(car, uid)) return rule ? <RuleDetails car={car} rule={rule} /> : null
  return <RuleEditor car={car} rule={rule} draft={draft ?? null} />
}

/**
 * Formulario del mantenimiento. Los presets de GNC sólo aparecen si el auto tiene equipo. En el alta, "Ya está hecho"
 * (`done`) oculta el plazo, la base y los avisos, y ofrece cargarlo como trabajo con el nombre (`?titulo=`): no se
 * crea un mantenimiento sin plazo. Márgenes de aviso
 * vacíos = automáticos según el intervalo. Si no se repite, se cuenta desde los km actuales. `pickerKey` cambia al
 * aplicar un preset para que el selector de tiempo se reinicie con el valor nuevo.
 * La "última vez" que se carga acá es la base (`baseKm`, `baseDate`): cuenta si no hay un trabajo aprobado que lo
 * marque desde esa fecha. El estado (la vista previa y lo que se guarda) sale de la proyección con la base del
 * formulario (`projectRule`): si un trabajo manda, se muestra "Según el trabajo «X» del dd/mm" con su km (estimado,
 * si el trabajo no tiene) y la base queda como dato secundario, que puede quedar vacío. Sin un trabajo que mande, la
 * fecha es obligatoria y, si es por km, también el km.
 * Al guardar, los cambios se miden contra el mantenimiento como estaba al abrir el formulario (`original`): lo que otro
 * dispositivo cambió mientras tanto en otros campos no se pisa, y si no cambió nada no se escribe ("Sin cambios").
 * Con un borrador (`draft`), los campos arrancan con lo que se había cargado (`draftSeed`): al editar, el mantenimiento
 * como está ahora con los cambios del borrador encima, y se mide contra el de ahora. Lo guardado va a la bandeja
 * (`settle` con la entrada; la misma del borrador, si hay) con el id del mantenimiento generado antes de escribir.
 */
function RuleEditor({ car, rule, draft: outboxDraft }: { car: Car; rule?: MaintenanceRule; draft: OutboxEntryOf<'rule'> | null }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { actor, uid, today } = useData()
  const { jobs, readings } = useCar(car.id)
  const { saving, error, setError, run } = useSaver()

  const presets = RULE_PRESETS.filter(p => !p.requires || car.fuelTypes.includes(p.requires))

  const seed: RuleInput | undefined = draftSeed(rule, outboxDraft)
  const [name, setName] = useState(seed?.name ?? '')
  const [mode, setMode] = useState<RepeatMode>(seed?.repeat === false ? 'once' : 'repeat')
  const repeat = mode !== 'once'
  const done = mode === 'done'
  const [intervalKm, setIntervalKm] = useState(numOrEmpty(seed?.intervalKm))
  const [intervalTime, setIntervalTime] = useState<TimeInterval | null>(seed?.intervalTime ?? null)
  const [lastKm, setLastKm] = useState(numOrEmpty(seed ? seed.baseKm : car.currentKm))
  const [lastDate, setLastDate] = useState(seed ? (seed.baseDate ?? '') : today)
  const [warnKm, setWarnKm] = useState(seed ? String(seed.warnKm) : '')
  const [warnDays, setWarnDays] = useState(seed ? String(seed.warnDays) : '')
  const [pickerKey, setPickerKey] = useState(0)
  const [original] = useState(rule)

  const kmInterval = parseNumberInput(intervalKm) || null
  const auto = defaultWarnings(kmInterval, intervalTime)
  const baseKm = kmInterval ? (repeat ? parseNumberInput(lastKm) : (rule?.baseKm ?? car.currentKm)) : null
  const form = {
    carId: car.id,
    intervalKm: kmInterval,
    intervalTime,
    repeat,
    baseKm,
    baseDate: lastDate || null,
    warnKm: parseNumberInput(warnKm) ?? auto.warnKm,
    warnDays: parseNumberInput(warnDays) ?? auto.warnDays,
  }
  const projection = projectRule({ ...form, id: rule?.id ?? '' }, jobs, readings)
  const ruled = projection.lastDoneJobId != null || projection.completedByJobId != null
  const preview = getRuleState({ ...form, ...projection }, car, today)
  const remaining = describeRemaining(preview)
  const nextText = [
    preview.nextKm != null ? `a los ${formatKm(preview.nextKm)}` : null,
    preview.nextDate ? `el ${formatDate(preview.nextDate)}` : null,
  ]
    .filter(Boolean)
    .join(' o ')

  function applyPreset(p: RulePreset) {
    setName(p.name)
    setMode(p.repeat ? 'repeat' : 'once')
    setIntervalKm(numOrEmpty(p.intervalKm))
    setIntervalTime(p.intervalTime)
    if (!p.repeat) setLastDate(today)
    setWarnKm('')
    setWarnDays('')
    setPickerKey(k => k + 1)
  }

  function changeMode(value: RepeatMode) {
    setMode(value)
    setError(null)
    if (value === 'done') return
    setIntervalTime(null)
    if (value === 'once') setLastDate(today)
    setPickerKey(k => k + 1)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (done) return
    if (!name.trim()) return setError('Poné un nombre (por ejemplo "Service").')
    if (!form.intervalKm && !form.intervalTime) {
      return setError(repeat ? 'Elegí cada cuánto tiempo y/o cada cuántos km.' : 'Elegí dentro de cuánto tiempo y/o cuántos km.')
    }
    if (!ruled && form.intervalKm && form.baseKm == null) return setError('Indicá a qué km se hizo la última vez.')
    if (!ruled && !form.baseDate) return setError(repeat ? 'Indicá la fecha de la última vez.' : 'Indicá desde qué fecha se cuenta.')
    if (form.baseDate && form.baseDate > today) return setError('La fecha no puede ser futura.')
    const rulingJob = ruled ? jobs.find(j => j.id === (projection.completedByJobId ?? projection.lastDoneJobId)) : null

    const confirmed = await confirm({
      title: rule ? `¿Guardar los cambios de "${name.trim()}"?` : `¿Agregar "${name.trim()}"?`,
      description: 'Revisá que los datos estén bien.',
      details: [
        { label: 'Se repite', value: repeat ? 'Sí' : 'No, una vez con aviso' },
        { label: repeat ? 'Cada' : 'Dentro de', value: describeRuleInterval(form).replace(/^(Cada|Una sola vez, dentro de) /, '') },
        ...(rulingJob
          ? [
              {
                label: projection.completedByJobId ? 'Cumplido con' : 'Según el trabajo',
                value: `«${rulingJob.title}» del ${formatDate(rulingJob.date)}`,
              },
            ]
          : []),
        ...(projection.completedByJobId
          ? []
          : [
              {
                label: repeat ? 'Última vez' : 'Desde',
                value:
                  [
                    projection.lastDoneDate ? formatDate(projection.lastDoneDate) : null,
                    repeat && form.intervalKm ? formatLastDoneKm(projection) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—',
              },
            ]),
        ...(nextText ? [{ label: 'Te toca', value: nextText }] : []),
        {
          label: 'Te avisamos',
          value: [form.intervalKm ? `${formatNumber(form.warnKm)} km` : null, form.intervalTime ? `${form.warnDays} días` : null]
            .filter(Boolean)
            .join(' o ')
            .concat(' antes'),
        },
      ],
      confirmLabel: rule ? 'Sí, guardar' : 'Sí, agregar',
      icon: repeat ? Repeat : CalendarClock,
    })
    if (!confirmed) return

    const data: RuleInput = { ...form, name: name.trim() }
    const ruleId = rule?.id ?? outboxDraft?.payload.recordId ?? newChildId(car.id, 'rules')
    const entry = outboxEntry({
      id: outboxDraft?.id ?? newOutboxId(),
      carId: car.id,
      carLabel: carName(car),
      write: { kind: 'rule', payload: { recordId: ruleId, data, original: original ? originalFields(original, data) : null } },
    })
    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(saveRule(actor, { jobs, readings }, data, original, ruleId), { uid, entry })
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
      remove: () => deleteRule(actor, rule.carId, rule.id),
      restore: () => restoreRule(actor, rule),
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
          value={mode}
          onChange={changeMode}
          options={[
            { value: 'repeat', label: 'Sí, cada cierto tiempo', icon: Repeat },
            { value: 'once', label: 'Una vez, con aviso', icon: CalendarClock },
            ...(rule ? [] : [{ value: 'done' as const, label: 'Ya está hecho', icon: CircleCheck }]),
          ]}
        />
      </FieldGroup>

      {done ? (
        <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-sm font-medium">Si ya está hecho y no hay que volver, cargalo como trabajo.</p>
          <p className="text-xs text-muted-foreground">
            Queda en el historial del auto y suma en los gastos. Un mantenimiento es para que te avisemos cuándo te toca.
          </p>
          <LinkButton
            href={`/autos/${car.id}/trabajos/nuevo${name.trim() ? `?titulo=${encodeURIComponent(name.trim())}` : ''}`}
            size="lg"
            className="h-11 w-full gap-2"
          >
            <Wrench /> Cargar el trabajo
          </LinkButton>
        </div>
      ) : (
        <>
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

          <div className="space-y-3">
            <RulingJobNotice car={car} projection={{ ...projection, intervalKm: form.intervalKm }} jobs={jobs} />
            <div>
              <p className="text-sm font-medium">{repeat ? 'Última vez (si no hay trabajos)' : 'Desde cuándo se cuenta'}</p>
              <p className="mb-2 text-xs text-muted-foreground">
                {ruled
                  ? 'Cuenta sólo si se borra ese trabajo o se le saca este mantenimiento.'
                  : repeat
                    ? 'Si no te acordás, poné una fecha y km aproximados. Cuando registres un trabajo que lo incluya, manda el trabajo.'
                    : 'Normalmente hoy, o el día que fuiste al taller.'}
              </p>
              <div className="grid grid-cols-2 gap-4">
                {repeat && form.intervalKm ? (
                  <Field
                    label={<span className="text-xs text-muted-foreground">A los km</span>}
                    hint={!ruled && form.baseKm == null ? MISSING_LAST_KM : undefined}
                  >
                    <Input value={lastKm} onChange={e => setLastKm(e.target.value)} inputMode="numeric" />
                  </Field>
                ) : null}
                <Field label={<span className="text-xs text-muted-foreground">Fecha</span>}>
                  <Input type="date" value={lastDate} max={today} onChange={e => setLastDate(e.target.value)} />
                </Field>
              </div>
            </div>
          </div>

          <details className="rounded-xl border border-white/8 p-4">
            <summary className="cursor-pointer text-sm font-medium">Cuándo avisar (opcional)</summary>
            <p className="mt-2 text-xs text-muted-foreground">Si lo dejás vacío, lo calculamos según cada cuánto es.</p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              {form.intervalKm ? (
                <Field label={<span className="text-xs text-muted-foreground">Km antes</span>}>
                  <Input value={warnKm} onChange={e => setWarnKm(e.target.value)} inputMode="numeric" placeholder={String(auto.warnKm)} />
                </Field>
              ) : null}
              {form.intervalTime ? (
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
        </>
      )}

      <FormError>{error}</FormError>

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        {!done && (
          <Button type="submit" disabled={saving} className="h-11 flex-1">
            {saving ? 'Guardando…' : rule ? 'Guardar cambios' : 'Agregar'}
          </Button>
        )}
      </div>

      {rule && (
        <Button type="button" variant="ghost" className="w-full gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={saving}>
          <Trash2 /> Borrar mantenimiento
        </Button>
      )}
    </form>
  )
}
