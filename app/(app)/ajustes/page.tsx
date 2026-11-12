'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, BellOff, CalendarDays, ChevronRight, Download, LogOut, Send, Share, Smartphone, Sparkles, Trash2, UserX } from 'lucide-react'
import { useConfirm } from '@/components/confirm-provider'
import { DismissibleHint } from '@/components/dismissible-hint'
import { useNovedades } from '@/components/novedades/use-novedades'
import { PendingBell } from '@/components/pending/pending-bell'
import { Button, buttonVariants } from '@/components/ui/button'
import { ChoiceChips, FieldGroup } from '@/components/ui/choice'
import { Checkbox, Field, Input } from '@/components/ui/form'
import { initials } from '@/components/app-shell'
import { PageBody, PageHeader, SignOutLabel } from '@/components/common'
import { useAuth } from '@/components/providers/auth-provider'
import { useData } from '@/components/providers/data-provider'
import { accountDeleteOutcome, DELETE_ACCOUNT_WORD, isDeleteConfirmed, type AccountDeleteOutcome, type BlockingCar } from '@/lib/account'
import { readExportExtras, saveSettings, setAccountClosing } from '@/lib/db'
import { buildExportZip, exportFileName } from '@/lib/export'
import { everyWeekday, WEEKDAYS } from '@/lib/format'
import { currentSubscription, disablePush, enablePush, pushSupport, type PushSupport } from '@/lib/push-client'
import { errorMessage, toast } from '@/lib/toast'
import type { UserSettings } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Lunes primero, como en el calendario argentino. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_OPTIONS = WEEK_ORDER.map(i => ({ value: String(i), label: WEEKDAYS[i].slice(0, 3), ariaLabel: WEEKDAYS[i] }))

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-card/60 p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

/**
 * Notificaciones push del dispositivo, recordatorio semanal de km y avisos de autos compartidos.
 * Si el servidor falla, la prueba puede no responder JSON (p. ej. una página de error de Vercel).
 * El toast del recordatorio usa un id fijo para reemplazarse en vez de apilarse.
 */
function Notifications() {
  const { uid, settings } = useData()
  const { getToken } = useAuth()
  const confirm = useConfirm()
  const [support, setSupport] = useState<PushSupport | null>(null)
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const reminder = settings.reminder
  const sharedCars = settings.sharedCars !== false

  useEffect(() => {
    const s = pushSupport()
    setSupport(s)
    if (s === 'supported') currentSubscription().then(sub => setSubscribed(Boolean(sub)))
  }, [])

  async function toggle() {
    const confirmed = subscribed
      ? await confirm({
          title: '¿Desactivar las notificaciones en este dispositivo?',
          description: 'No te van a llegar más avisos de vencimientos ni el recordatorio para cargar los km.',
          confirmLabel: 'Sí, desactivar',
          icon: BellOff,
        })
      : await confirm({
          title: '¿Activar las notificaciones en este dispositivo?',
          description: reminder.enabled
            ? `Te vamos a avisar cuando se acerque un mantenimiento y te vamos a pedir los km ${everyWeekday(reminder.weekday)} a la mañana.`
            : 'Te vamos a avisar cuando se acerque un mantenimiento.',
          warning: 'Después el navegador te va a preguntar si permitís las notificaciones: tocá "Permitir".',
          confirmLabel: 'Sí, activar',
          icon: Bell,
        })
    if (!confirmed) return

    setBusy(true)
    try {
      if (subscribed) {
        await disablePush(uid)
        setSubscribed(false)
        toast.info('Notificaciones desactivadas en este dispositivo')
      } else {
        await enablePush(uid)
        setSubscribed(true)
        toast.success('Notificaciones activadas', { description: 'Este dispositivo va a recibir los avisos.' })
      }
    } catch (e) {
      toast.error(subscribed ? 'No se pudieron desactivar' : 'No se pudieron activar', { description: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    try {
      const res = await fetch('/api/push/test', { method: 'POST', headers: { Authorization: `Bearer ${await getToken()}` } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `El servidor tuvo un problema (error ${res.status}). Probá de nuevo en un rato.`)
      if (json.sent) {
        toast.success('Notificación de prueba enviada', {
          description: `Llegó a ${json.sent} dispositivo${json.sent === 1 ? '' : 's'}.`,
        })
      } else {
        toast.warning('No hay dispositivos registrados', { description: 'Activá las notificaciones en este dispositivo.' })
      }
    } catch (e) {
      toast.error('No se pudo enviar la prueba', { description: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  function saveReminder(next: UserSettings['reminder'], message: string) {
    saveSettings(uid, { reminder: next }).catch(e => toast.error('No se pudo guardar el recordatorio', { description: errorMessage(e) }))
    toast.success(message, { id: 'reminder' })
  }

  async function toggleReminder(enabled: boolean) {
    const confirmed = await confirm(
      enabled
        ? {
            title: '¿Activar el recordatorio semanal?',
            description: `Te vamos a pedir los km de cada auto ${everyWeekday(reminder.weekday)} a la mañana.`,
            confirmLabel: 'Sí, activar',
            icon: CalendarDays,
          }
        : {
            title: '¿Desactivar el recordatorio semanal?',
            description: 'No te vamos a pedir más los km. Los avisos de mantenimientos siguen llegando.',
            confirmLabel: 'Sí, desactivar',
            icon: CalendarDays,
          },
    )
    if (!confirmed) return
    saveReminder({ ...reminder, enabled }, enabled ? `Recordatorio activado: ${everyWeekday(reminder.weekday)}` : 'Recordatorio semanal desactivado')
  }

  async function changeDay(value: string) {
    const weekday = Number(value)
    if (weekday === reminder.weekday) return
    const confirmed = await confirm({
      title: `¿Cambiar el recordatorio a ${everyWeekday(weekday)}?`,
      description: `Vas a recibir el aviso para cargar los km ${everyWeekday(weekday)} a la mañana (alrededor de las 9), en vez de ${everyWeekday(reminder.weekday)}.`,
      confirmLabel: 'Sí, cambiar',
      icon: CalendarDays,
    })
    if (!confirmed) return
    saveReminder({ ...reminder, weekday }, `Te vamos a pedir los km ${everyWeekday(weekday)}`)
  }

  async function toggleSharedCars(enabled: boolean) {
    const confirmed = await confirm(
      enabled
        ? {
            title: '¿Recibir avisos de los autos que te compartieron?',
            description: 'Te vamos a avisar de sus vencimientos y recordatorios igual que en tus autos.',
            confirmLabel: 'Sí, activar',
            icon: Bell,
          }
        : {
            title: '¿Silenciar los autos que te compartieron?',
            description: 'No te van a llegar avisos de vencimientos ni recordatorios de esos autos. Los de tus propios autos siguen llegando.',
            confirmLabel: 'Sí, silenciar',
            icon: BellOff,
          },
    )
    if (!confirmed) return
    saveSettings(uid, { sharedCars: enabled }).catch(e => toast.error('No se pudo guardar el ajuste', { description: errorMessage(e) }))
    toast.success(enabled ? 'Avisos de autos compartidos activados' : 'Autos compartidos silenciados', { id: 'shared-cars' })
  }

  return (
    <Section title="Notificaciones" description="Te avisamos de mantenimientos por vencer y te pedimos los km una vez por semana.">
      <div className="space-y-6">
        {support === 'needs-install' && (
          <DismissibleHint id="instalar-iphone" icon={Smartphone}>
            <p>
              En iPhone las notificaciones funcionan sólo con la app instalada: tocá <Share className="inline size-4" /> <b>Compartir</b> y después{' '}
              <b>Agregar a inicio</b>. Abrila desde el ícono y volvé a esta pantalla.
            </p>
          </DismissibleHint>
        )}
        {support === 'unsupported' && <p className="text-sm text-muted-foreground">Este navegador no soporta notificaciones push.</p>}
        {support === 'supported' && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={toggle} disabled={busy || subscribed == null} className="gap-2" variant={subscribed ? 'outline' : 'default'} size="lg">
              {subscribed ? <BellOff /> : <Bell />}
              {subscribed ? 'Desactivar en este dispositivo' : 'Activar notificaciones'}
            </Button>
            {subscribed && (
              <Button onClick={test} disabled={busy} variant="ghost" size="lg" className="gap-2">
                <Send /> Probar
              </Button>
            )}
          </div>
        )}

        <Checkbox
          checked={reminder.enabled}
          onChange={e => void toggleReminder(e.target.checked)}
          label="Recordatorio semanal de km"
          description="Un aviso por auto para que cargues el kilometraje."
        />
        {reminder.enabled && (
          <FieldGroup label="¿Qué día te lo mandamos?" hint="Llega a la mañana, alrededor de las 9.">
            <ChoiceChips
              value={String(reminder.weekday)}
              onChange={changeDay}
              options={DAY_OPTIONS}
              aria-label="Día del recordatorio"
              className="grid grid-cols-7 gap-1.5 [&>*]:px-0"
            />
          </FieldGroup>
        )}

        <Checkbox
          checked={sharedCars}
          onChange={e => void toggleSharedCars(e.target.checked)}
          label="Avisos de autos compartidos"
          description="Vencimientos y recordatorios de los autos que otra persona compartió con vos."
        />
      </div>
    </Section>
  )
}

/**
 * "Descargar mis datos": arma en el navegador un zip con todo lo que la app tiene en memoria (`buildExportZip`: un JSON
 * completo y una planilla por colección) y ofrece el link para bajarlo. El link (y no una descarga automática) porque
 * en iOS una descarga que no sale de un toque puede no arrancar.
 */
function DataExport() {
  const data = useData()
  const confirm = useConfirm()
  const [file, setFile] = useState<{ name: string; url: string } | null>(null)

  const readyUrl = file?.url ?? null
  useEffect(() => () => {
    if (readyUrl) URL.revokeObjectURL(readyUrl)
  }, [readyUrl])

  async function prepare() {
    const confirmed = await confirm({
      title: '¿Preparar tus datos para descargar?',
      description:
        'Vas a bajar un archivo .zip con tus autos, mantenimientos, trabajos, cargas, km, logros, invitaciones, dispositivos con notificaciones y avisos: un archivo JSON con todo y una planilla (CSV) por cada cosa, que se abre con Excel o Google Sheets.',
      confirmLabel: 'Sí, preparar',
      icon: Download,
    })
    if (!confirmed) return
    try {
      const extras = await readExportExtras(data.uid)
      const now = new Date()
      const zip = buildExportZip(
        {
          ...extras,
          uid: data.uid,
          email: data.email,
          settings: data.settings,
          cars: data.cars,
          rules: data.rules,
          jobs: data.jobs,
          fuel: data.fuel,
          odometer: data.odometer,
          achievements: data.achievements,
          invites: data.invites,
          myInvites: data.myInvites,
        },
        now,
      )
      setFile({ name: exportFileName(data.today), url: URL.createObjectURL(new Blob([zip], { type: 'application/zip' })) })
    } catch (e) {
      console.error('Export de datos', e)
      toast.error('No se pudieron preparar tus datos', { description: errorMessage(e) })
    }
  }

  return (
    <Section title="Tus datos" description="Bajate una copia de todo lo que cargaste en la app.">
      {file ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <a href={file.url} download={file.name} className={cn(buttonVariants({ size: 'lg' }), 'h-11 gap-2')}>
            <Download /> Descargar {file.name}
          </a>
          <Button variant="ghost" size="lg" className="h-11" onClick={() => setFile(null)}>
            Listo
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="lg" className="gap-2" onClick={() => void prepare()}>
          <Download /> Descargar mis datos
        </Button>
      )}
    </Section>
  )
}

/** Reintentos automáticos de `DELETE /api/account` cuando falla después de sacar la cuenta de `allowlist` (`closed`). */
const CLOSED_RETRIES = 2

/**
 * "Borrar mi cuenta": hay que escribir "BORRAR" (`isDeleteConfirmed`) y después confirmar. Llama a `DELETE /api/account`
 * con `setAccountClosing` prendido (así esta pestaña no vuelve a crear lo que el servidor borra). Si tiene autos
 * compartidos (409), muestra cuáles y cómo resolverlos, sin borrar nada. Si sale bien, cierra la sesión y vuelve al
 * login con un aviso. Si falla después de que el servidor la sacó de `allowlist` (`closed`), no desmarca
 * `setAccountClosing` (la app ya no puede usar la cuenta): reintenta `CLOSED_RETRIES` veces y, si sigue fallando,
 * cierra la sesión y explica que hay que entrar y volver a borrarla.
 */
function DeleteAccount() {
  const { getToken, signOut } = useAuth()
  const confirm = useConfirm()
  const router = useRouter()
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState<BlockingCar[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function requestDeletion(): Promise<AccountDeleteOutcome> {
    try {
      const res = await fetch('/api/account', { method: 'DELETE', headers: { Authorization: `Bearer ${await getToken()}` } })
      return accountDeleteOutcome(res.status, await res.json().catch(() => ({})))
    } catch (e) {
      return { kind: 'error', message: errorMessage(e), closed: false }
    }
  }

  async function remove() {
    if (!isDeleteConfirmed(word)) return
    const confirmed = await confirm({
      title: '¿Borrar tu cuenta para siempre?',
      description:
        'Se borran tus autos con todo su historial, tus fotos, tus logros, tus ajustes y tus invitaciones. Lo que cargaste en autos de otras personas queda en su historial, sin tu nombre, y un auto que le pasaste a otra persona conserva su foto. No se puede deshacer.',
      warning: 'Si querés guardar una copia, primero tocá "Descargar mis datos".',
      confirmLabel: 'Sí, borrar mi cuenta',
      tone: 'danger',
      icon: UserX,
    })
    if (!confirmed) return

    setBusy(true)
    setError(null)
    setBlocked(null)
    setAccountClosing(true)
    let outcome = await requestDeletion()
    for (let retry = 0; outcome.kind === 'error' && outcome.closed && retry < CLOSED_RETRIES; retry++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      outcome = await requestDeletion()
    }

    if (outcome.kind === 'deleted') {
      await signOut({ skipConfirm: true }).catch(() => undefined)
      router.replace('/login')
      setAccountClosing(false)
      toast.success('Tu cuenta se borró', { description: 'Borramos tus datos y tus fotos. Gracias por usar AutoCar.' })
      return
    }
    if (outcome.kind === 'error' && outcome.closed) {
      await signOut({ skipConfirm: true }).catch(() => undefined)
      router.replace('/login')
      setAccountClosing(false)
      toast.error('No se terminó de borrar tu cuenta', {
        description: 'Tus datos ya se borraron casi todos. Volvé a entrar y tocá otra vez "Borrar mi cuenta" para terminar.',
        timeout: 0,
      })
      return
    }
    setAccountClosing(false)
    setBusy(false)
    if (outcome.kind === 'blocked') {
      setBlocked(outcome.cars)
      return
    }
    setError(outcome.message)
    toast.error('No se pudo borrar la cuenta', { description: outcome.message })
  }

  return (
    <Section
      title="Borrar mi cuenta"
      description="Borra tus autos con todo su historial, tus fotos, tus logros y tus ajustes. Lo que cargaste en autos de otras personas queda, sin tu nombre. No se puede deshacer."
    >
      <div className="space-y-4">
        {blocked && (
          <div role="alert" className="rounded-md border border-warning/30 bg-warning/5 p-4 text-sm">
            <p className="font-medium">Primero resolvé tus autos compartidos</p>
            <p className="mt-1 text-muted-foreground">
              Estos autos son tuyos y los compartís con otras personas. Borrar la cuenta se llevaría lo que cargaron ellas. En cada uno, entrá a{' '}
              <b>Editar → Compartir</b> y pasáselo a un miembro (<b>Pasarle el auto</b>), sacá a los miembros o borrá el auto.
            </p>
            <ul className="mt-3 space-y-1">
              {blocked.map(car => (
                <li key={car.id}>
                  <Link href={`/autos/${encodeURIComponent(car.id)}/editar`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    {car.label} <ChevronRight className="size-4" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field label={`Para confirmar, escribí ${DELETE_ACCOUNT_WORD}`} error={error}>
          <Input value={word} onChange={e => setWord(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} />
        </Field>
        <Button variant="destructive" size="lg" className="gap-2" disabled={busy || !isDeleteConfirmed(word)} onClick={() => void remove()}>
          <Trash2 /> {busy ? 'Borrando tu cuenta…' : 'Borrar mi cuenta'}
        </Button>
      </div>
    </Section>
  )
}

/** Entrada a la sección de novedades, con un punto si hay alguna sin ver. */
function NovedadesLink() {
  const { unseen } = useNovedades()
  return (
    <Link href="/novedades" className="flex items-center gap-3 rounded-md border border-line bg-card/60 p-5 hover:bg-card/80">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Sparkles className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 font-semibold">
          Novedades
          {unseen.length > 0 && <span className="size-2 rounded-full bg-primary" aria-label="Hay novedades sin ver" />}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Qué hay de nuevo en cada versión de la app.</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

export default function SettingsPage() {
  const { user, signOut, signingOut } = useAuth()

  async function handleSignOut() {
    const result = await signOut({
      confirm: {
        title: '¿Cerrar sesión?',
        description:
          'Tus datos quedan guardados en tu cuenta y se borran de este dispositivo. Para volver a entrar vas a necesitar tu cuenta de Google.',
        confirmLabel: 'Sí, cerrar sesión',
        icon: LogOut,
      },
    })
    if (result === 'signed-out') toast.info('Cerraste sesión')
  }

  return (
    <>
      <PageHeader title="Ajustes" actions={<PendingBell />} />
      <PageBody className="mx-auto max-w-2xl space-y-5">
        <Section title="Cuenta">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {user?.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="size-10 rounded-full" />
              ) : (
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                  {initials(user?.displayName)}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate font-medium">{user?.displayName}</p>
                <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => void handleSignOut()} disabled={signingOut != null} className="gap-2">
              <SignOutLabel phase={signingOut} icon />
            </Button>
          </div>
        </Section>
        <Notifications />
        <NovedadesLink />
        <DataExport />
        <DeleteAccount />
        <footer className="pt-2 text-center text-xs text-muted-foreground">
          AutoCar v{process.env.APP_VERSION}
          {process.env.APP_COMMIT && <span className="font-mono"> · {process.env.APP_COMMIT}</span>}
        </footer>
      </PageBody>
    </>
  )
}
