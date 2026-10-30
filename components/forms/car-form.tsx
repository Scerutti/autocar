'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, CarFront, Copy, KeyRound, MailX, RotateCw, Send, Trash2, UserCog, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { carName } from '@/components/common'
import { useConfirm } from '@/components/confirm-provider'
import { Button } from '@/components/ui/button'
import { FieldGroup, Segmented } from '@/components/ui/choice'
import { Field, FormError, Input } from '@/components/ui/form'
import { useAuth } from '@/components/providers/auth-provider'
import { useCar, useData } from '@/components/providers/data-provider'
import { cloudinaryUrl } from '@/lib/cloudinary-url'
import { deleteImage, PhotoError, preparePhoto, uploadImage } from '@/lib/cloudinary-client'
import { PHOTO_MAX_INPUT_MB } from '@/lib/photo-limits'
import { toISODate } from '@/lib/dates'
import {
  createCar,
  deleteCar,
  inviteMember,
  newCarId,
  removeMember,
  revokeInvite,
  setMemberRole,
  transferCar,
  updateCar,
  type CarInput,
} from '@/lib/db'
import { formatDate, formatKm, parseNumberInput } from '@/lib/format'
import {
  INVITE_DAYS,
  MAX_MEMBERS,
  carMembers,
  isCarOwner,
  isInviteOpen,
  memberError,
  memberRole,
  normalizeEmail,
  type CarMember,
} from '@/lib/sharing'
import type { Car, FuelType, Invite, MemberRole } from '@/lib/types'
import { errorMessage, toast } from '@/lib/toast'
import { runInBackground, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'

/** Un auto anda a nafta, a nafta + GNC o a gasoil (no existen los que andan sólo a GNC). */
type FuelChoice = 'nafta' | 'dual' | 'gasoil'

const FUEL_CHOICES: Record<FuelChoice, { label: string; fuelTypes: FuelType[] }> = {
  nafta: { label: 'Sólo nafta', fuelTypes: ['nafta'] },
  dual: { label: 'Nafta + GNC', fuelTypes: ['nafta', 'gnc'] },
  gasoil: { label: 'Gasoil', fuelTypes: ['gasoil'] },
}
const FUEL_OPTIONS = (Object.keys(FUEL_CHOICES) as FuelChoice[]).map(c => ({ value: c, label: FUEL_CHOICES[c].label }))

const toChoice = (f: FuelType[]): FuelChoice => (f.includes('gasoil') ? 'gasoil' : f.includes('gnc') ? 'dual' : 'nafta')

/**
 * Alta y edición de un auto. La foto se revisa y achica apenas se elige: si no sirve, el aviso aparece ahí mismo.
 * Borrar fotos en Cloudinary es "mejor esfuerzo": si falla, no frena el guardado. Si el servidor rechaza el
 * guardado (enseguida o al volver la señal), se borra la foto nueva para que no quede huérfana. La foto vieja se
 * borra recién cuando el servidor confirma (si rechaza el cambio, el auto la sigue usando), y sin esperarlo: sin
 * señal el guardado quedaría colgado hasta que vuelva.
 */
export function CarForm({ car }: { car?: Car }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { getToken } = useAuth()
  const { actor, uid } = useData()
  const { saving, error, setError, run } = useSaver()
  const fileRef = useRef<HTMLInputElement>(null)

  const [brand, setBrand] = useState(car?.brand ?? '')
  const [model, setModel] = useState(car?.model ?? '')
  const [version, setVersion] = useState(car?.version ?? '')
  const [year, setYear] = useState(car?.year ? String(car.year) : '')
  const [plate, setPlate] = useState(car?.plate ?? '')
  const [fuel, setFuel] = useState<FuelChoice>(car ? toChoice(car.fuelTypes) : 'nafta')
  const [km, setKm] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

  const currentPhoto = photoPreview ?? (!removePhoto && car?.photoUrl ? cloudinaryUrl(car.photoUrl, 'c_fill,g_auto,w_900,h_506') : null)

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoError(null)
    setPreparing(true)
    try {
      const prepared = await preparePhoto(file)
      setPhoto(prepared)
      setPhotoPreview(URL.createObjectURL(prepared))
      setRemovePhoto(false)
    } catch (err) {
      setPhotoError(err instanceof PhotoError ? err.message : 'No pudimos abrir esta foto. Probá con otra.')
    } finally {
      setPreparing(false)
    }
  }

  function clearPhoto() {
    setPhoto(null)
    setPhotoPreview(null)
    setPhotoError(null)
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
      fuelTypes: FUEL_CHOICES[fuel].fuelTypes,
    }
    const photoLabel = photo ? (car?.photoUrl ? 'Se cambia' : 'Sí') : removePhoto ? 'Se quita' : currentPhoto ? 'Sí' : 'Sin foto'
    const previousFuel = car ? toChoice(car.fuelTypes) : fuel
    const confirmed = await confirm({
      title: car ? '¿Guardar los cambios?' : '¿Agregar este auto?',
      description: 'Revisá que los datos estén bien.',
      details: [
        { label: 'Auto', value: [data.brand, data.model, data.version].filter(Boolean).join(' ') },
        ...(data.year ? [{ label: 'Año', value: String(data.year) }] : []),
        ...(data.plate ? [{ label: 'Patente', value: data.plate }] : []),
        { label: 'Combustible', value: FUEL_CHOICES[fuel].label },
        ...(!car ? [{ label: 'Km actuales', value: formatKm(kmNum!) }] : []),
        { label: 'Foto', value: photoLabel },
      ],
      warning:
        previousFuel !== fuel
          ? `Cambiás el combustible de ${FUEL_CHOICES[previousFuel].label} a ${FUEL_CHOICES[fuel].label}. Las cargas que ya tenés quedan en el historial.`
          : undefined,
      confirmLabel: car ? 'Sí, guardar' : 'Sí, agregar',
      icon: CarFront,
    })
    if (!confirmed) return

    const ok = await run(async () => {
      const oldPublicId = car?.photoPublicId ?? null
      const dropImage = (publicId: string) => getToken().then(t => deleteImage(publicId, t)).catch(() => {})
      let uploadedId: string | null = null
      if (photo) {
        setStatus('Subiendo foto…')
        const token = await getToken()
        const up = await uploadImage(photo, token)
        uploadedId = up.publicId
        data.photoUrl = up.url
        data.photoPublicId = up.publicId
      } else if (removePhoto) {
        data.photoUrl = null
        data.photoPublicId = null
      }
      setStatus('Guardando…')
      const carId = car?.id ?? newCarId()
      const write: Promise<unknown> = car ? updateCar(actor, car.id, data) : createCar(actor, data, kmNum!, carId)
      const newPublicId = uploadedId
      if (newPublicId) write.catch(() => dropImage(newPublicId))
      const saved: SaveStatus = await settle(write)
      if (oldPublicId && (photo || removePhoto)) write.then(() => dropImage(oldPublicId), () => {})
      if (car) toastSaved('Cambios guardados', saved)
      else toastSaved('Auto agregado', saved, 'Ahora sumale los mantenimientos: service, VTV, seguro…')
      router.replace(`/autos/${carId}`)
    })
    if (!ok) setStatus(null)
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <form onSubmit={submit} className="space-y-6" noValidate>
        <div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
          {currentPhoto ? (
            <div className="relative overflow-hidden rounded-2xl border border-white/8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={currentPhoto} alt="Foto del auto" className="aspect-video w-full object-cover" />
              <div className="absolute bottom-3 right-3 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="gap-1.5 bg-black/60 backdrop-blur"
                  onClick={() => fileRef.current?.click()}
                  disabled={preparing}
                >
                  <Camera /> {preparing ? 'Preparando…' : 'Cambiar'}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  className="bg-black/60 backdrop-blur"
                  aria-label="Quitar foto"
                  onClick={clearPhoto}
                  disabled={preparing}
                >
                  <X />
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={preparing}
              className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:pointer-events-none"
            >
              <div className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.06]">
                <CarFront className="size-6" />
              </div>
              <span className="flex items-center gap-2 text-sm font-medium">
                <Camera className="size-4" /> {preparing ? 'Preparando la foto…' : 'Agregar foto del auto'}
              </span>
              <span className="text-xs">Hasta {PHOTO_MAX_INPUT_MB} MB</span>
            </button>
          )}
          <FormError className="mt-3">{photoError}</FormError>
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

        <FieldGroup label="Combustible" hint="Si tiene equipo de GNC, elegí Nafta + GNC. Si es diésel, elegí Gasoil.">
          <Segmented value={fuel} onChange={setFuel} options={FUEL_OPTIONS} />
        </FieldGroup>

        <FormError>{error}</FormError>

        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving || preparing} className="h-11 flex-1">
            {saving ? (status ?? 'Guardando…') : car ? 'Guardar cambios' : 'Agregar auto'}
          </Button>
        </div>
      </form>

      {car && isCarOwner(car, uid) && <ShareSection car={car} />}
      {car && <DeleteCarSection car={car} disabled={saving} />}
    </div>
  )
}

/** Cómo se llama cada rol en Compartir y qué puede hacer el miembro con ese rol. */
const ROLES: Record<MemberRole, { label: string; help: string }> = {
  editor: { label: 'Puede cargar', help: 'Carga combustible, km y trabajos. Sus trabajos esperan tu aprobación.' },
  trusted: { label: 'Sin aprobación', help: 'Carga combustible, km y trabajos. Sus trabajos nuevos cuentan sin esperar tu aprobación.' },
  viewer: { label: 'Solo mira', help: 'Ve el auto y su historial, pero no puede cargar ni cambiar nada.' },
}

const ROLE_OPTIONS = (Object.keys(ROLES) as MemberRole[]).map(r => ({ value: r, label: ROLES[r].label }))

/** Link de una invitación: la página `/invitaciones/{id}` de esta app. */
const inviteUrl = (invite: Invite) => `${window.location.origin}/invitaciones/${encodeURIComponent(invite.id)}`

/**
 * Compartir el auto (sólo el dueño, al editarlo). Se invita por mail y la otra persona tiene que aceptar: hasta
 * entonces no ve nada del auto. La lista muestra los miembros (nombre y mail, con "Sacar"), las invitaciones
 * pendientes (vencen a los `INVITE_DAYS` días; "Compartir", "Copiar link" y "Cancelar") y las rechazadas o vencidas,
 * que se pueden volver a mandar. El tope (`MAX_MEMBERS`) cuenta miembros e invitaciones pendientes. Cada cambio se
 * guarda apenas se confirma, sin esperar a "Guardar cambios". No se manda ningún mail: "Compartir" abre el menú de
 * compartir del celular y, si el navegador no lo tiene, copia el mensaje con el link. A un miembro por uid se le puede
 * pasar el auto ("Pasarle el auto"): yo quedo como miembro y vuelvo al detalle del auto. A un miembro por uid también se
 * le elige el rol (`ROLES`), con un control segmentado que se aplica al confirmar; uno sólo por el mail viejo no tiene
 * perfil, es `editor` y no muestra el control.
 */
function ShareSection({ car }: { car: Car }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { actor, email, invites } = useData()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const name = carName(car)
  const now = new Date()
  const members = carMembers(car)
  const carInvites = invites.filter(i => i.carId === car.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const open = carInvites.filter(i => isInviteOpen(i, now))
  const closed = carInvites.filter(i => i.status === 'declined' || (i.status === 'pending' && !isInviteOpen(i, now)))
  const full = (car.memberUids?.length ?? 0) + open.length >= MAX_MEMBERS

  async function invite(mail: string) {
    const problem = memberError(car, invites, mail, { ownerEmail: email, now: new Date() })
    if (problem) {
      setError(problem)
      return false
    }
    setError(null)
    const confirmed = await confirm({
      title: '¿Invitar a este mail?',
      description: `Le llega una invitación que tiene que aceptar entrando a la app con ese mail. Hasta que acepte no ve nada del auto. Si no la responde, vence en ${INVITE_DAYS} días.`,
      details: [
        { label: 'Mail', value: mail },
        { label: 'Auto', value: name },
      ],
      confirmLabel: 'Sí, invitar',
      icon: UserPlus,
    })
    if (!confirmed) return false
    setBusy(true)
    try {
      const status = await settle(inviteMember(actor, car, mail), 'No se pudo invitar')
      toastSaved('Invitación creada', status, `Mandale el link a ${mail} para que la acepte.`)
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (await invite(normalizeEmail(value))) setValue('')
  }

  async function remove(member: CarMember) {
    const who = member.name ?? member.email
    const confirmed = await confirm({
      tone: 'danger',
      title: `¿Sacar a ${who} del auto?`,
      description: `Deja de ver tu ${name}. Lo que cargó queda en el historial. Para volver, lo tenés que invitar de nuevo.`,
      confirmLabel: 'Sí, sacar',
      icon: UserMinus,
    })
    if (!confirmed) return
    try {
      const status = await settle(removeMember(actor, car, member))
      toastSaved(`Ya no lo compartís con ${who}`, status)
    } catch (err) {
      toast.error('No se pudo sacar a esa persona', { description: errorMessage(err) })
    }
  }

  async function transfer(member: CarMember) {
    const who = member.name ?? member.email
    const confirmed = await confirm({
      tone: 'danger',
      title: `¿Pasarle el auto a ${who}?`,
      description: `${who} pasa a ser el dueño de tu ${name}: maneja el plan de mantenimiento y aprueba los trabajos. Vos quedás como miembro: seguís viendo el auto y cargando, y tus trabajos esperan su aprobación. Se cancelan las invitaciones. Para recuperarlo, te lo tiene que pasar de nuevo.`,
      details: [
        { label: 'Nuevo dueño', value: who },
        { label: 'Auto', value: name },
      ],
      confirmLabel: 'Sí, pasárselo',
      icon: KeyRound,
    })
    if (!confirmed) return
    setBusy(true)
    try {
      const status = await settle(transferCar(actor, { invites }, car, member, email), 'No se pudo pasar el auto')
      toastSaved(`${who} es el nuevo dueño`, status, 'Seguís en el auto como miembro.')
      router.replace(`/autos/${car.id}`)
    } catch (err) {
      toast.error('No se pudo pasar el auto', { description: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(member: CarMember, role: MemberRole) {
    if (!member.uid || role === memberRole(car, member.uid)) return
    const who = member.name ?? member.email
    const confirmed = await confirm({
      title: `¿Cambiar lo que puede hacer ${who}?`,
      description: ROLES[role].help,
      details: [
        { label: 'Persona', value: who },
        { label: 'Ahora', value: ROLES[role].label },
      ],
      confirmLabel: 'Sí, cambiar',
      icon: UserCog,
    })
    if (!confirmed) return
    setBusy(true)
    try {
      const status = await settle(setMemberRole(actor, car, member.uid, role), 'No se pudo cambiar el rol')
      toastSaved(`${who}: ${ROLES[role].label.toLowerCase()}`, status)
    } catch (err) {
      toast.error('No se pudo cambiar el rol', { description: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  async function revoke(target: Invite) {
    const confirmed = await confirm({
      tone: 'danger',
      title: '¿Cancelar la invitación?',
      description: `El link deja de servir y ${target.email} no va a poder aceptarla. Lo podés volver a invitar cuando quieras.`,
      confirmLabel: 'Sí, cancelar',
      cancelLabel: 'No',
      icon: MailX,
    })
    if (!confirmed) return
    try {
      const status = await settle(revokeInvite(actor, target))
      toastSaved('Invitación cancelada', status)
    } catch (err) {
      toast.error('No se pudo cancelar la invitación', { description: errorMessage(err) })
    }
  }

  async function share(target: Invite) {
    const text = `Te invito a compartir mi ${name} en AutoCar. Entrá con tu cuenta de Google (${target.email}) y aceptá la invitación:`
    const url = inviteUrl(target)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'AutoCar', text, url })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') toast.error('No se pudo compartir', { description: errorMessage(err) })
      }
      return
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`)
      toast.success('Copiamos el mensaje', { description: 'Pegalo en WhatsApp o donde quieras.' })
    } catch (err) {
      toast.error('No se pudo copiar el mensaje', { description: errorMessage(err) })
    }
  }

  async function copy(target: Invite) {
    try {
      await navigator.clipboard.writeText(inviteUrl(target))
      toast.success('Copiamos el link', { description: 'Pegalo en WhatsApp o donde quieras.' })
    } catch (err) {
      toast.error('No se pudo copiar el link', { description: errorMessage(err) })
    }
  }

  const rows = members.length + open.length + closed.length

  return (
    <section className="rounded-2xl border border-white/8 bg-card/60 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Users aria-hidden className="size-4 text-primary" /> Compartir
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Invitá hasta {MAX_MEMBERS} personas. Cuando aceptan, ven el auto y cargan combustible, km y trabajos. Los trabajos
        esperan tu aprobación. Después podés cambiar qué puede hacer cada uno.
      </p>

      {rows > 0 && (
        <ul className="mt-3 divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8">
          {members.map(m => (
            <li key={m.uid ?? m.email} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{m.name ?? m.email}</p>
                {m.name && <p className="truncate text-xs text-muted-foreground">{m.email}</p>}
              </div>
              {m.uid && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Pasarle el auto a ${m.name ?? m.email}`}
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => void transfer(m)}
                >
                  <KeyRound /> Pasarle el auto
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Sacar a ${m.name ?? m.email}`}
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                onClick={() => void remove(m)}
              >
                <UserMinus /> Sacar
              </Button>
              {m.uid && (
                <Segmented
                  value={memberRole(car, m.uid)}
                  onChange={role => void changeRole(m, role)}
                  options={ROLE_OPTIONS}
                  aria-label={`Qué puede hacer ${m.name ?? m.email}`}
                  disabled={busy}
                  className="w-full"
                />
              )}
            </li>
          ))}
          {open.map(i => (
            <li key={i.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{i.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Invitación pendiente · vence el {formatDate(toISODate(i.expiresAt))}
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Compartir la invitación de ${i.email}`} onClick={() => void share(i)}>
                <Send />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Copiar el link de la invitación de ${i.email}`} onClick={() => void copy(i)}>
                <Copy />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Cancelar la invitación de ${i.email}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => void revoke(i)}
              >
                <X />
              </Button>
            </li>
          ))}
          {closed.map(i => (
            <li key={i.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted-foreground">{i.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {i.status === 'declined' ? 'Rechazó la invitación' : 'La invitación venció'}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={full || busy} onClick={() => void invite(i.email)}>
                <RotateCw /> Invitar de nuevo
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
        <Field
          label="Mail"
          hint={
            full
              ? `Ya compartiste el auto o mandaste invitaciones a ${MAX_MEMBERS} personas.`
              : 'El mail con el que la persona entra con Google. Tiene que aceptar la invitación.'
          }
        >
          <Input
            type="email"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="nombre@gmail.com"
            autoCapitalize="none"
            autoComplete="off"
            disabled={full || busy}
          />
        </Field>
        <FormError>{error}</FormError>
        <Button type="submit" size="sm" className="gap-1.5" disabled={full || busy || !value.trim()}>
          <UserPlus /> {busy ? 'Invitando…' : 'Invitar'}
        </Button>
      </form>
    </section>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Borrar un auto borra todo su historial y la foto: no se puede deshacer. Primero sale de la pantalla del
 * auto, para no mostrar "no encontrado" mientras se borra.
 */
function DeleteCarSection({ car, disabled }: { car: Car; disabled: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { getToken } = useAuth()
  const { actor } = useData()
  const { allRules, jobs, fuel, readings } = useCar(car.id)
  const name = `${car.brand} ${car.model}`

  async function handleDelete() {
    const counts = [
      [allRules.length, 'mantenimiento', 'mantenimientos'],
      [jobs.length, 'trabajo', 'trabajos'],
      [fuel.length, 'carga', 'cargas'],
      [readings.length, 'registro de km', 'registros de km'],
    ] as const
    const present = counts.filter(([n]) => n > 0)
    const related = present.map(([n, one, many]) => plural(n, one, many))
    const verb = present.length === 1 && present[0][0] === 1 ? 'se borra' : 'se borran'
    const list = related.length > 1 ? `${related.slice(0, -1).join(', ')} y ${related.at(-1)}` : related[0]
    const confirmed = await confirm({
      tone: 'danger',
      title: `¿Borrar ${name}?`,
      description: `${related.length ? `También ${verb} ${list}` : 'También se borra todo su historial'}${car.photoUrl ? ' y la foto' : ''}. No se puede deshacer.`,
      confirmLabel: 'Sí, borrar todo',
    })
    if (!confirmed) return

    router.replace('/')
    runInBackground(
      (async () => {
        await deleteCar(actor, car.id, {
          rules: allRules.map(r => r.id),
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
