import { Loading } from '@/components/common'

/**
 * Las pantallas de un auto son rutas dinámicas: sin esto, al tocar un auto, "+ Trabajo", "+ Carga", etc.
 * la pantalla queda quieta hasta que responde el servidor. Con loading.tsx cambia al instante.
 */
export default function CarLoading() {
  return <Loading />
}
