'use client'

import { useState } from 'react'
import { CircleCheck, CircleX, Users } from 'lucide-react'
import { useConfirm } from '@/components/confirm-provider'
import { useData } from '@/components/providers/data-provider'
import { Button } from '@/components/ui/button'
import { toISODate } from '@/lib/dates'
import { acceptInvite, declineInvite } from '@/lib/db'
import { formatDate } from '@/lib/format'
import { errorMessage, toast } from '@/lib/toast'
import type { Invite } from '@/lib/types'
import { settle, toastSaved } from '@/lib/use-saver'

/** "Juan" o, si la invitación no tiene el nombre del dueño, "Alguien". */
export const inviterName = (invite: Pick<Invite, 'ownerName'>) => invite.ownerName ?? 'Alguien'

/**
 * Aceptar o rechazar una invitación, siempre con confirmación. Devuelven true si se respondió. Si las reglas lo
 * deniegan (venció, la cancelaron o ya se respondió), avisa con un toast.
 */
export function useInviteResponse() {
  const confirm = useConfirm()
  const { actor, email } = useData()

  async function accept(invite: Invite) {
    const confirmed = await confirm({
      title: '¿Aceptar la invitación?',
      description: `Vas a ver todo el ${invite.carLabel} de ${inviterName(invite)} y vas a poder cargar combustible, km y trabajos. Los trabajos que cargues esperan su aprobación. Podés salir cuando quieras.`,
      details: [
        { label: 'Auto', value: invite.carLabel },
        { label: 'Dueño', value: inviterName(invite) },
      ],
      confirmLabel: 'Sí, aceptar',
      icon: CircleCheck,
    })
    if (!confirmed) return false
    try {
      const status = await settle(acceptInvite(actor, invite, email), 'No se pudo aceptar la invitación')
      toastSaved(`Ya compartís el ${invite.carLabel}`, status)
      return true
    } catch (e) {
      toast.error('No se pudo aceptar la invitación', { description: errorMessage(e) })
      return false
    }
  }

  async function decline(invite: Invite) {
    const confirmed = await confirm({
      tone: 'danger',
      title: '¿Rechazar la invitación?',
      description: `No vas a ver el ${invite.carLabel}. ${inviterName(invite)} te puede volver a invitar.`,
      confirmLabel: 'Sí, rechazar',
      icon: CircleX,
    })
    if (!confirmed) return false
    try {
      const status = await settle(declineInvite(actor, invite), 'No se pudo rechazar la invitación')
      toastSaved('Invitación rechazada', status)
      return true
    } catch (e) {
      toast.error('No se pudo rechazar la invitación', { description: errorMessage(e) })
      return false
    }
  }

  return { accept, decline }
}

/**
 * Tarjeta de una invitación que me mandaron (Inicio): "Juan te invitó a compartir su Ford Ka 2015", con Aceptar y
 * Rechazar, los dos con confirmación.
 */
export function InviteCard({ invite }: { invite: Invite }) {
  const { accept, decline } = useInviteResponse()
  const [busy, setBusy] = useState(false)

  async function respond(action: (invite: Invite) => Promise<boolean>) {
    setBusy(true)
    try {
      await action(invite)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Users className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {inviterName(invite)} te invitó a compartir su {invite.carLabel}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">Vence el {formatDate(toISODate(invite.expiresAt))}.</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button className="h-9 gap-1.5" disabled={busy} onClick={() => void respond(accept)}>
          <CircleCheck /> Aceptar
        </Button>
        <Button variant="outline" className="h-9 gap-1.5" disabled={busy} onClick={() => void respond(decline)}>
          <CircleX /> Rechazar
        </Button>
      </div>
    </div>
  )
}
