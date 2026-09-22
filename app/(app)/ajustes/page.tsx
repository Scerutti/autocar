'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, CalendarDays, LogOut, Send, Share, Smartphone } from 'lucide-react'
import { useConfirm } from '@/components/confirm-provider'
import { Button } from '@/components/ui/button'
import { ChoiceChips, FieldGroup } from '@/components/ui/choice'
import { Checkbox } from '@/components/ui/form'
import { initials } from '@/components/app-shell'
import { PageBody, PageHeader } from '@/components/common'
import { useAuth } from '@/components/providers/auth-provider'
import { useData } from '@/components/providers/data-provider'
import { saveSettings } from '@/lib/db'
import { everyWeekday, WEEKDAYS } from '@/lib/format'
import { currentSubscription, disablePush, enablePush, pushSupport, type PushSupport } from '@/lib/push-client'
import { errorMessage, toast } from '@/lib/toast'
import type { UserSettings } from '@/lib/types'

// Lunes primero, como en el calendario argentino.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_OPTIONS = WEEK_ORDER.map(i => ({ value: String(i), label: WEEKDAYS[i].slice(0, 3), ariaLabel: WEEKDAYS[i] }))

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/8 bg-card/60 p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Notifications() {
  const { uid, settings } = useData()
  const { getToken } = useAuth()
  const confirm = useConfirm()
  const [support, setSupport] = useState<PushSupport | null>(null)
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const reminder = settings.reminder

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
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo enviar')
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

  // Se confirma antes de guardar; con id fijo el toast se reemplaza en vez de apilarse.
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

  return (
    <Section title="Notificaciones" description="Te avisamos de mantenimientos por vencer y te pedimos los km una vez por semana.">
      <div className="space-y-6">
        {support === 'needs-install' && (
          <div className="flex gap-3 rounded-xl border border-warning/20 bg-warning/5 p-4 text-sm">
            <Smartphone aria-hidden className="size-5 shrink-0 text-warning" />
            <p>
              En iPhone las notificaciones funcionan sólo con la app instalada: tocá <Share className="inline size-4" /> <b>Compartir</b> y después{' '}
              <b>Agregar a inicio</b>. Abrila desde el ícono y volvé a esta pantalla.
            </p>
          </div>
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
      </div>
    </Section>
  )
}

export default function SettingsPage() {
  const { user, signOut } = useAuth()
  const confirm = useConfirm()

  async function handleSignOut() {
    const confirmed = await confirm({
      title: '¿Cerrar sesión?',
      description: 'Tus datos quedan guardados. Para volver a entrar vas a necesitar tu cuenta de Google.',
      confirmLabel: 'Sí, cerrar sesión',
      icon: LogOut,
    })
    if (!confirmed) return
    await signOut()
    toast.info('Cerraste sesión')
  }

  return (
    <>
      <PageHeader title="Ajustes" />
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
            <Button variant="outline" onClick={() => void handleSignOut()} className="gap-2">
              <LogOut /> Salir
            </Button>
          </div>
        </Section>
        <Notifications />
      </PageBody>
    </>
  )
}
