'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CarFront, Plus, Wrench } from 'lucide-react'
import { ActivityList, mergeActivity } from '@/components/activity'
import { CarFilter } from '@/components/car-filter'
import { EmptyState, LinkButton, PageBody, PageHeader, carName } from '@/components/common'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { buttonVariants } from '@/components/ui/button'
import { Segmented } from '@/components/ui/choice'
import { useData } from '@/components/providers/data-provider'
import { formatMoney, MONTHS_SHORT } from '@/lib/format'

type Kind = 'jobs' | 'fuel' | 'all'

export default function JobsPage() {
  const { cars, jobs, fuel, carById } = useData()
  const [carId, setCarId] = useState('all')
  const [kind, setKind] = useState<Kind>('jobs')

  const byCar = <T extends { carId: string }>(xs: T[]) => (carId === 'all' ? xs : xs.filter(x => x.carId === carId))
  const items = mergeActivity(kind === 'fuel' ? [] : byCar(jobs), kind === 'jobs' ? [] : byCar(fuel))

  const groups = new Map<string, typeof items>()
  for (const a of items) {
    const key = a.item.date.slice(0, 7)
    groups.set(key, [...(groups.get(key) ?? []), a])
  }
  const amount = (a: (typeof items)[number]) => (a.kind === 'job' ? a.item.cost : a.item.total)

  const targetCar = carId !== 'all' ? carById.get(carId) : cars.length === 1 ? cars[0] : null
  const newHref = (id: string) => (kind === 'fuel' ? `/autos/${id}/combustible/nuevo` : `/autos/${id}/trabajos/nuevo`)

  return (
    <>
      <PageHeader
        title="Historial"
        subtitle="Trabajos y cargas de combustible."
        actions={
          cars.length > 0 &&
          (targetCar ? (
            <LinkButton href={newHref(targetCar.id)} size="icon" aria-label="Agregar" className="size-9">
              <Plus />
            </LinkButton>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="Agregar" className={buttonVariants({ size: 'icon', className: 'size-9' })}>
                <Plus />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>¿Para qué auto?</DropdownMenuLabel>
                  {cars.map(c => (
                    <DropdownMenuLinkItem key={c.id} render={<Link href={newHref(c.id)} />}>
                      <CarFront /> {carName(c)}
                    </DropdownMenuLinkItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ))
        }
      />
      <PageBody className="space-y-5">
        <CarFilter cars={cars} value={carId} onChange={setCarId} />
        <Segmented
          value={kind}
          onChange={setKind}
          className="max-w-sm"
          options={[
            { value: 'jobs', label: 'Trabajos' },
            { value: 'fuel', label: 'Combustible' },
            { value: 'all', label: 'Todo' },
          ]}
        />
        {items.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title={kind === 'fuel' ? 'Sin cargas registradas' : 'Sin trabajos registrados'}
            description={cars.length ? 'Tocá + para agregar el primero.' : 'Primero agregá un auto desde el inicio.'}
          />
        ) : (
          [...groups.entries()].map(([ym, list]) => (
            <section key={ym}>
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <h3 className="font-semibold">
                  {MONTHS_SHORT[Number(ym.slice(5)) - 1]} {ym.slice(0, 4)}
                </h3>
                <span className="tabular-nums text-muted-foreground">{formatMoney(list.reduce((s, a) => s + amount(a), 0))}</span>
              </div>
              <ActivityList items={list} carById={carById} showCar={carId === 'all' && cars.length > 1} />
            </section>
          ))
        )}
      </PageBody>
    </>
  )
}
