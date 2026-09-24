'use client'

import { useEffect, useState } from 'react'
import { Download, FileText, Share2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { ChoiceChips, FieldGroup } from '@/components/ui/choice'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox, Field, FormError, Input } from '@/components/ui/form'
import { useCar, useData } from '@/components/providers/data-provider'
import { carName } from '@/components/common'
import { buildServiceReport, reportFileName, reportFrom, type ReportPeriod } from '@/lib/report'
import { errorMessage, toast } from '@/lib/toast'
import type { Car } from '@/lib/types'
import { cn } from '@/lib/utils'

const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: '1y', label: 'Último año' },
  { value: '3y', label: 'Últimos 3 años' },
  { value: 'custom', label: 'Desde una fecha' },
]

type Step = { kind: 'options' } | { kind: 'generating' } | { kind: 'ready'; file: File; url: string; jobs: number }

/**
 * Exportar el historial de trabajos en PDF (p. ej. para mostrarlo al vender el auto).
 * En dos pasos: primero las opciones y se genera; después Compartir/Descargar con un toque nuevo,
 * porque el navegador sólo deja compartir justo después de que el usuario toca algo.
 */
export function ExportReportDialog({ car, open, onClose }: { car: Car; open: boolean; onClose: () => void }) {
  const { today } = useData()
  const { jobs, rules } = useCar(car.id)
  const [showCosts, setShowCosts] = useState(false)
  const [period, setPeriod] = useState<ReportPeriod>('all')
  const [from, setFrom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'options' })

  const readyUrl = step.kind === 'ready' ? step.url : null
  useEffect(() => () => {
    if (readyUrl) URL.revokeObjectURL(readyUrl)
  }, [readyUrl])

  const start = reportFrom({ period, from }, today)
  const included = jobs.filter(j => !start || j.date >= start).length
  const canShare = step.kind === 'ready' && typeof navigator !== 'undefined' && Boolean(navigator.canShare?.({ files: [step.file] }))

  function close() {
    onClose()
    setStep({ kind: 'options' })
    setError(null)
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault()
    if (period === 'custom' && !from) return setError('Elegí desde qué fecha.')
    if (period === 'custom' && from > today) return setError('La fecha no puede ser futura.')
    setError(null)
    setStep({ kind: 'generating' })
    try {
      // La librería de PDF se descarga recién acá: no pesa en el resto de la app.
      const [{ pdf }, { ServiceReportPdf }] = await Promise.all([import('@react-pdf/renderer'), import('./service-report-pdf')])
      const report = buildServiceReport({ car, jobs, rules, options: { showCosts, period, from }, today })
      const blob = await pdf(<ServiceReportPdf report={report} origin={window.location.origin} />).toBlob()
      const file = new File([blob], reportFileName(car, today), { type: 'application/pdf' })
      setStep({ kind: 'ready', file, url: URL.createObjectURL(blob), jobs: report.jobs.length })
    } catch (err) {
      console.error('PDF del historial', err)
      setStep({ kind: 'options' })
      setError(`No se pudo armar el PDF. ${errorMessage(err)}`)
    }
  }

  async function share(file: File) {
    try {
      await navigator.share({ files: [file], title: `Historial de ${carName(car)}` })
    } catch (err) {
      // Cerrar el menú de compartir no es un error.
      if ((err as Error).name !== 'AbortError') toast.error('No se pudo compartir', { description: 'Probá con Descargar.' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exportar historial en PDF</DialogTitle>
          <DialogDescription>
            {carName(car)}: los trabajos que le hiciste y el estado de sus mantenimientos. Sirve para mostrarlo, por ejemplo, si lo vendés.
          </DialogDescription>
        </DialogHeader>

        {step.kind === 'ready' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-success/25 bg-success/5 p-4">
              <FileText aria-hidden className="size-8 shrink-0 text-success" />
              <div className="min-w-0">
                <p className="font-medium">Tu PDF está listo</p>
                <p className="truncate text-xs text-muted-foreground">
                  {step.jobs} {step.jobs === 1 ? 'trabajo' : 'trabajos'} · {showCosts ? 'con costos' : 'sin costos'}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {canShare && (
                <Button size="lg" className="h-11 gap-2" onClick={() => void share(step.file)}>
                  <Share2 /> Compartir (WhatsApp, mail…)
                </Button>
              )}
              <a
                href={step.url}
                download={step.file.name}
                className={cn(buttonVariants({ size: 'lg', variant: canShare ? 'outline' : 'default' }), 'h-11 gap-2')}
              >
                <Download /> Descargar PDF
              </a>
              <Button variant="ghost" onClick={() => setStep({ kind: 'options' })}>
                Cambiar opciones
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={generate} className="space-y-5" noValidate>
            <FieldGroup label="¿Qué período?" hint={`Entran ${included} de ${jobs.length} ${jobs.length === 1 ? 'trabajo' : 'trabajos'}.`}>
              <ChoiceChips value={period} onChange={setPeriod} options={PERIOD_OPTIONS} aria-label="Período" className="grid grid-cols-2 gap-2" />
            </FieldGroup>
            {period === 'custom' && (
              <Field label="Desde">
                <Input type="date" value={from} max={today} onChange={e => setFrom(e.target.value)} />
              </Field>
            )}
            <Checkbox
              checked={showCosts}
              onChange={e => setShowCosts(e.target.checked)}
              label="Mostrar lo que costó cada trabajo"
              description="Si es para vender el auto, quizás prefieras no mostrarlo."
            />
            <FormError>{error}</FormError>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="h-11 flex-1" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" className="h-11 flex-1 gap-2" disabled={step.kind === 'generating'}>
                <FileText /> {step.kind === 'generating' ? 'Armando el PDF…' : 'Generar PDF'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
