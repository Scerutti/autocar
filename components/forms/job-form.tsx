'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, FormError, Input, Select, Textarea } from '@/components/ui/form'
import { useCar, useData } from '@/components/providers/data-provider'
import { toISODate } from '@/lib/dates'
import { deleteJob, restoreJob, saveJob } from '@/lib/db'
import { formatDate, formatKm, formatMoney, parseNumberInput } from '@/lib/format'
import { JOB_CATEGORY_LABELS, type Car, type Job, type JobCategory } from '@/lib/types'
import { removeWithUndo, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'
import { StatusBadge } from '../common'

const CATEGORY_FOR_RULE: [RegExp, JobCategory][] = [
  [/service|aceite|filtro/i, 'service'],
  [/cubierta|neum|rotaci/i, 'cubiertas'],
  [/fren/i, 'frenos'],
  [/vtv|seguro|patente|oblea|hidr/i, 'documentacion'],
  [/bater|el[eé]ctr/i, 'electricidad'],
]

export function JobForm({ car, job, preselectedRuleId }: { car: Car; job?: Job; preselectedRuleId?: string | null }) {
  const router = useRouter()
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
        ),
      )
    })
    if (!ok) return
    const reset = rules.filter(r => ruleIds.includes(r.rule.id)).map(r => r.rule.name)
    toastSaved(
      job ? 'Trabajo actualizado' : 'Trabajo guardado',
      status,
      reset.length ? `Se reinició: ${reset.join(', ')}` : formatMoney(costNum),
    )
    router.replace(`/autos/${car.id}?tab=trabajos`)
  }

  function handleDelete() {
    if (!job) return
    router.replace(`/autos/${car.id}?tab=trabajos`)
    removeWithUndo({
      message: 'Trabajo borrado',
      remove: () => deleteJob(uid, job.id),
      restore: () => restoreJob(uid, job),
    })
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-6">
      <Field label="Qué se hizo">
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Cambio de aceite y filtros" required />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Fecha">
          <Input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} required />
        </Field>
        <Field label="Km" hint="Opcional">
          <Input value={km} onChange={e => setKm(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Costo ($)">
          <Input value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal" placeholder="148500" required />
        </Field>
        <Field label="Categoría">
          <Select value={category} onChange={e => setCategory(e.target.value as JobCategory)}>
            {Object.entries(JOB_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {rules.length > 0 && (
        <div>
          <p className="text-sm font-medium">¿Este trabajo incluye algún mantenimiento?</p>
          <p className="mb-3 text-xs text-muted-foreground">Lo marcamos como hecho en esta fecha y km, y se reinicia el contador.</p>
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
                  rule.lastDoneDate ? `Última vez: ${formatDate(rule.lastDoneDate)}` : null,
                  rule.lastDoneKm != null ? formatKm(rule.lastDoneKm) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </div>
        </div>
      )}

      <Field label="Taller" hint="Opcional">
        <Input value={workshop} onChange={e => setWorkshop(e.target.value)} placeholder="Lubricentro Don José" />
      </Field>
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
