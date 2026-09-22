'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, CarFront, Trash2, X } from 'lucide-react'
import { useConfirm } from '@/components/confirm-provider'
import { Button } from '@/components/ui/button'
import { FieldGroup, Segmented } from '@/components/ui/choice'
import { Field, FormError, Input } from '@/components/ui/form'
import { useAuth } from '@/components/providers/auth-provider'
import { useCar, useData } from '@/components/providers/data-provider'
import { cloudinaryUrl } from '@/lib/cloudinary-url'
import { deleteImage, uploadImage } from '@/lib/cloudinary-client'
import { createCar, deleteCar, newId, updateCar, type CarInput } from '@/lib/db'
import { formatKm, parseNumberInput } from '@/lib/format'
import type { Car, FuelType } from '@/lib/types'
import { toast } from '@/lib/toast'
import { runInBackground, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'

// Un auto anda a nafta o a nafta + GNC (no existen los que andan sólo a GNC).
type FuelChoice = 'nafta' | 'dual'

const toChoice = (f: FuelType[]): FuelChoice => (f.includes('gnc') ? 'dual' : 'nafta')
const fromChoice = (c: FuelChoice): FuelType[] => (c === 'dual' ? ['nafta', 'gnc'] : ['nafta'])
const FUEL_CHOICE_LABELS: Record<FuelChoice, string> = { nafta: 'Sólo nafta', dual: 'Nafta + GNC' }

export function CarForm({ car }: { car?: Car }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { getToken } = useAuth()
  const { uid } = useData()
  const { saving, error, setError, run } = useSaver()
  const fileRef = useRef<HTMLInputElement>(null)

  const [brand, setBrand] = useState(car?.brand ?? '')
  const [model, setModel] = useState(car?.model ?? '')
  const [version, setVersion] = useState(car?.version ?? '')
  const [year, setYear] = useState(car?.year ? String(car.year) : '')
  const [plate, setPlate] = useState(car?.plate ?? '')
  const [fuel, setFuel] = useState<FuelChoice>(car ? toChoice(car.fuelTypes) : 'nafta')
  const [km, setKm] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

  const currentPhoto = photoPreview ?? (!removePhoto && car?.photoUrl ? cloudinaryUrl(car.photoUrl, 'c_fill,g_auto,w_900,h_506') : null)

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('El archivo tiene que ser una imagen.')
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
    setRemovePhoto(false)
    e.target.value = ''
  }

  function clearPhoto() {
    setPhotoFile(null)
    setPhotoPreview(null)
    setRemovePhoto(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const yearNum = year ? Number(year) : null
    const kmNum = parseNumberInput(km)
    if (!brand.trim() || !model.trim()) return setError('Completá marca y modelo.')
    if (yearNum != null && (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear() + 1)) {
      return setError('El año no es válido.')
    }
    if (!car && (kmNum == null || kmNum < 0 || !Number.isInteger(kmNum))) return setError('Ingresá los km actuales.')

    const data: CarInput = {
      brand: brand.trim(),
      model: model.trim(),
      version: version.trim() || null,
      year: yearNum,
      plate: plate.trim().toUpperCase() || null,
      fuelTypes: fromChoice(fuel),
    }
    const photoLabel = photoFile ? (car?.photoUrl ? 'Se cambia' : 'Sí') : removePhoto ? 'Se quita' : currentPhoto ? 'Sí' : 'Sin foto'
    const confirmed = await confirm({
      title: car ? '¿Guardar los cambios?' : '¿Agregar este auto?',
      description: 'Revisá que los datos estén bien.',
      details: [
        { label: 'Auto', value: [data.brand, data.model, data.version].filter(Boolean).join(' ') },
        ...(data.year ? [{ label: 'Año', value: String(data.year) }] : []),
        ...(data.plate ? [{ label: 'Patente', value: data.plate }] : []),
        { label: 'Combustible', value: FUEL_CHOICE_LABELS[fuel] },
        ...(!car ? [{ label: 'Km actuales', value: formatKm(kmNum!) }] : []),
        { label: 'Foto', value: photoLabel },
      ],
      confirmLabel: car ? 'Sí, guardar' : 'Sí, agregar',
      icon: CarFront,
    })
    if (!confirmed) return

    const ok = await run(async () => {
      const oldPublicId = car?.photoPublicId ?? null
      if (photoFile) {
        setStatus('Subiendo foto…')
        const token = await getToken()
        const up = await uploadImage(photoFile, token)
        data.photoUrl = up.url
        data.photoPublicId = up.publicId
      } else if (removePhoto) {
        data.photoUrl = null
        data.photoPublicId = null
      }
      setStatus('Guardando…')
      const carId = car?.id ?? newId(uid, 'cars')
      const saved: SaveStatus = car
        ? await settle(updateCar(uid, car.id, data))
        : await settle(createCar(uid, data, kmNum!, carId))
      if (oldPublicId && (photoFile || removePhoto)) void deleteImage(oldPublicId, await getToken())
      if (car) toastSaved('Cambios guardados', saved)
      else toastSaved('Auto agregado', saved, 'Ahora sumale los mantenimientos: service, VTV, seguro…')
      router.replace(`/autos/${carId}`)
    })
    if (!ok) setStatus(null)
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-6" noValidate>
      <div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
        {currentPhoto ? (
          <div className="relative overflow-hidden rounded-2xl border border-white/8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentPhoto} alt="Foto del auto" className="aspect-video w-full object-cover" />
            <div className="absolute bottom-3 right-3 flex gap-2">
              <Button type="button" size="sm" variant="secondary" className="gap-1.5 bg-black/60 backdrop-blur" onClick={() => fileRef.current?.click()}>
                <Camera /> Cambiar
              </Button>
              <Button type="button" size="icon-sm" variant="secondary" className="bg-black/60 backdrop-blur" aria-label="Quitar foto" onClick={clearPhoto}>
                <X />
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          >
            <div className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.06]">
              <CarFront className="size-6" />
            </div>
            <span className="flex items-center gap-2 text-sm font-medium">
              <Camera className="size-4" /> Agregar foto del auto
            </span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Marca">
          <Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Ford" autoCapitalize="words" required />
        </Field>
        <Field label="Modelo">
          <Input value={model} onChange={e => setModel(e.target.value)} placeholder="Focus" autoCapitalize="words" required />
        </Field>
        <Field label="Versión" hint="Opcional">
          <Input value={version} onChange={e => setVersion(e.target.value)} placeholder="SE 2.0" />
        </Field>
        <Field label="Año" hint="Opcional">
          <Input value={year} onChange={e => setYear(e.target.value)} inputMode="numeric" placeholder="2018" maxLength={4} />
        </Field>
        <Field label="Patente" hint="Opcional" className="col-span-2 sm:col-span-1">
          <Input value={plate} onChange={e => setPlate(e.target.value)} placeholder="AC 123 CD" autoCapitalize="characters" />
        </Field>
        {!car && (
          <Field label="Km actuales" hint="Los que marca el tablero hoy" className="col-span-2 sm:col-span-1">
            <Input value={km} onChange={e => setKm(e.target.value)} inputMode="numeric" placeholder="86420" required />
          </Field>
        )}
      </div>

      <FieldGroup label="Combustible" hint="Si el auto tiene equipo de GNC, elegí Nafta + GNC.">
        <Segmented
          value={fuel}
          onChange={setFuel}
          options={[
            { value: 'nafta', label: FUEL_CHOICE_LABELS.nafta },
            { value: 'dual', label: FUEL_CHOICE_LABELS.dual },
          ]}
        />
      </FieldGroup>

      <FormError>{error}</FormError>

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving} className="h-11 flex-1">
          {saving ? (status ?? 'Guardando…') : car ? 'Guardar cambios' : 'Agregar auto'}
        </Button>
      </div>

      {car && <DeleteCarSection car={car} disabled={saving} />}
    </form>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Borrar un auto borra todo su historial y la foto: no se puede deshacer. */
function DeleteCarSection({ car, disabled }: { car: Car; disabled: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { getToken } = useAuth()
  const { uid } = useData()
  const { rules, jobs, fuel, readings } = useCar(car.id)
  const name = `${car.brand} ${car.model}`

  async function handleDelete() {
    const counts = [
      [rules.length, 'mantenimiento', 'mantenimientos'],
      [jobs.length, 'trabajo', 'trabajos'],
      [fuel.length, 'carga', 'cargas'],
      [readings.length, 'registro de km', 'registros de km'],
    ] as const
    const present = counts.filter(([n]) => n > 0)
    const related = present.map(([n, one, many]) => plural(n, one, many))
    // "se borra 1 registro" / "se borran 2 trabajos y 1 carga"
    const verb = present.length === 1 && present[0][0] === 1 ? 'se borra' : 'se borran'
    const list = related.length > 1 ? `${related.slice(0, -1).join(', ')} y ${related.at(-1)}` : related[0]
    const confirmed = await confirm({
      tone: 'danger',
      title: `¿Borrar ${name}?`,
      description: `${related.length ? `También ${verb} ${list}` : 'También se borra todo su historial'}${car.photoUrl ? ' y la foto' : ''}. No se puede deshacer.`,
      confirmLabel: 'Sí, borrar todo',
    })
    if (!confirmed) return

    // Primero salimos de la pantalla del auto para no mostrar "no encontrado" mientras se borra.
    router.replace('/')
    runInBackground(
      (async () => {
        await deleteCar(uid, car.id, {
          rules: rules.map(r => r.rule.id),
          jobs: jobs.map(j => j.id),
          fuel: fuel.map(f => f.id),
          odometer: readings.map(r => r.id),
        })
        if (car.photoPublicId) await deleteImage(car.photoPublicId, await getToken())
      })(),
      `No se pudo borrar ${name}`,
    )
    toast.success(`${name} borrado`)
  }

  return (
    <div className="rounded-2xl border border-destructive/20 bg-destructive/[0.04] p-4">
      <p className="text-sm font-medium">Borrar auto</p>
      <p className="mt-1 text-xs text-muted-foreground">Se borra el auto con todo su historial. No se puede deshacer.</p>
      <Button type="button" variant="destructive" size="sm" className="mt-3 gap-1.5" onClick={handleDelete} disabled={disabled}>
        <Trash2 /> Borrar {name}
      </Button>
    </div>
  )
}
