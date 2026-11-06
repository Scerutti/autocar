'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, CircleCheck, CircleX, Clock, MailX, Users } from 'lucide-react'
import { EmptyState, LinkButton, Loading, NotFound, PageBody, PageHeader } from '@/components/common'
import { inviterName, useInviteResponse } from '@/components/invites/invite-card'
import { useData } from '@/components/providers/data-provider'
import { Button } from '@/components/ui/button'
import { toISODate } from '@/lib/dates'
import { getInvite } from '@/lib/db'
import { formatDate } from '@/lib/format'
import { canonicalEmail, inviteEmailKey, isInviteOpen, maskEmail } from '@/lib/sharing'
import { errorMessage } from '@/lib/toast'
import type { Invite } from '@/lib/types'

/** Lo que dio la lectura de la invitación: la invitación (null si no existe), que las reglas la negaron o un error. */
type Loaded = { invite: Invite | null } | { denied: true } | { error: string }

/** El id viene de la URL: si no se puede decodificar, se usa tal cual. */
function decodeId(raw: string) {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function BackHome() {
  return (
    <LinkButton href="/" variant="outline" size="lg">
      <ArrowLeft /> Ir al inicio
    </LinkButton>
  )
}

/**
 * El link que manda el dueño (`/invitaciones/{carId}_{mail canónico}`). Lee la invitación una vez con `getInvite`:
 * si las reglas la niegan, es de otra cuenta (o ya no existe) y se muestra el mail tapado que sale del id. Si es para
 * mí y se puede responder, Aceptar y Rechazar, los dos con confirmación; al aceptar, va al auto apenas aparece.
 */
export default function InvitePage() {
  const { inviteId: raw } = useParams<{ inviteId: string }>()
  const id = decodeId(raw)
  const router = useRouter()
  const { email, carById } = useData()
  const { accept, decline } = useInviteResponse()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    let alive = true
    getInvite(id)
      .then(invite => alive && setLoaded({ invite }))
      .catch(e => {
        if (!alive) return
        if ((e as { code?: string }).code === 'permission-denied') setLoaded({ denied: true })
        else setLoaded({ error: errorMessage(e) })
      })
    return () => {
      alive = false
    }
  }, [id])

  const invite = loaded && 'invite' in loaded ? loaded.invite : null
  const joined = invite != null && carById.has(invite.carId)

  useEffect(() => {
    if (accepted && invite && joined) router.replace(`/autos/${invite.carId}`)
  }, [accepted, invite, joined, router])

  const header = <PageHeader back="/" title="Invitación" />
  if (!loaded) return <Loading />
  if ('error' in loaded) {
    return (
      <>
        {header}
        <PageBody>
          <EmptyState icon={MailX} title="No pudimos abrir la invitación" description={loaded.error} action={<BackHome />} />
        </PageBody>
      </>
    )
  }

  const mine = email ? canonicalEmail(email) : ''
  const key = invite?.emailKey ?? inviteEmailKey(id)
  if ('denied' in loaded || (invite && invite.emailKey !== mine)) {
    const forMe = key === mine
    return (
      <>
        {header}
        <PageBody>
          <EmptyState
            icon={MailX}
            title={forMe ? 'Esta invitación ya no existe' : 'Esta invitación es para otra cuenta'}
            description={
              forMe
                ? 'Puede que se haya borrado el auto. Pedile al dueño que te invite de nuevo.'
                : `Esta invitación es para ${maskEmail(key)} y entraste con otra cuenta.`
            }
            action={<BackHome />}
          />
        </PageBody>
      </>
    )
  }
  if (!invite) return <NotFound what="la invitación" />

  const owner = inviterName(invite)
  const carLink = (
    <LinkButton href={`/autos/${invite.carId}`} size="lg">
      Ir al auto
    </LinkButton>
  )

  async function respond(action: (invite: Invite) => Promise<boolean>, next: Invite['status']) {
    if (!invite) return
    setBusy(true)
    try {
      if (!(await action(invite))) return
      setLoaded({ invite: { ...invite, status: next } })
      if (next === 'accepted') setAccepted(true)
    } finally {
      setBusy(false)
    }
  }

  let content: React.ReactNode
  if (invite.status === 'accepted') {
    content = joined ? (
      <EmptyState icon={CircleCheck} title={`Ya compartís el ${invite.carLabel}`} action={carLink} />
    ) : accepted ? (
      <Loading label="Abriendo el auto…" />
    ) : (
      <EmptyState
        icon={CircleCheck}
        title="Ya aceptaste esta invitación"
        description={`Si saliste del auto, ${owner} te tiene que invitar de nuevo.`}
        action={<BackHome />}
      />
    )
  } else if (invite.status === 'declined') {
    content = (
      <EmptyState icon={CircleX} title="Rechazaste esta invitación" description={`${owner} te puede volver a invitar.`} action={<BackHome />} />
    )
  } else if (invite.status === 'revoked') {
    content = <EmptyState icon={MailX} title={`${owner} canceló esta invitación`} action={<BackHome />} />
  } else if (!isInviteOpen(invite, new Date())) {
    content = (
      <EmptyState
        icon={Clock}
        title="Esta invitación venció"
        description={`Pedile a ${owner} que te la mande de nuevo.`}
        action={<BackHome />}
      />
    )
  } else {
    content = (
      <section className="mx-auto max-w-md rounded-2xl border border-white/8 bg-card/60 p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Users className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">
          {owner} te invitó a compartir su {invite.carLabel}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Si aceptás, vas a ver todo el auto y vas a poder cargar combustible, km y trabajos. Los trabajos que cargues
          esperan su aprobación.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Vence el {formatDate(toISODate(invite.expiresAt))}.</p>
        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="h-11 flex-1 gap-1.5" disabled={busy} onClick={() => void respond(decline, 'declined')}>
            <CircleX /> Rechazar
          </Button>
          <Button className="h-11 flex-1 gap-1.5" disabled={busy} onClick={() => void respond(accept, 'accepted')}>
            <CircleCheck /> Aceptar
          </Button>
        </div>
      </section>
    )
  }

  return (
    <>
      {header}
      <PageBody>{content}</PageBody>
    </>
  )
}
