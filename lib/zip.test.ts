import { describe, expect, it } from 'vitest'
import { crc32, zipFiles } from './zip'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Lee las entradas del directorio central de un zip sin comprimir: nombre, CRC y contenido. */
function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = zip.length - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries: { name: string; crc: number; content: string; flags: number }[] = []
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const flags = view.getUint16(at + 8, true)
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength))
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50)
    const localName = view.getUint16(localOffset + 26, true)
    const start = localOffset + 30 + localName
    entries.push({ name, crc, flags, content: decoder.decode(zip.subarray(start, start + size)) })
    at += 46 + nameLength
  }
  return entries
}

describe('crc32', () => {
  it('da el CRC-32 estándar', () => {
    expect(crc32(encoder.encode(''))).toBe(0)
    expect(crc32(encoder.encode('hello'))).toBe(0x3610a686)
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('zipFiles', () => {
  it('arma un zip con los archivos en orden, sus nombres en UTF-8 y su contenido', () => {
    const zip = zipFiles(
      [
        { name: 'datos.json', data: encoder.encode('{"a":1}') },
        { name: 'mantenimientos año.csv', data: encoder.encode('Nombre;Año\r\nService;2025\r\n') },
      ],
      new Date(2026, 10, 6, 10, 30, 0),
    )
    const entries = readZip(zip)
    expect(entries.map(e => e.name)).toEqual(['datos.json', 'mantenimientos año.csv'])
    expect(entries[0].content).toBe('{"a":1}')
    expect(entries[1].content).toBe('Nombre;Año\r\nService;2025\r\n')
    expect(entries[0].crc).toBe(crc32(encoder.encode('{"a":1}')))
    expect(entries.every(e => e.flags === 0x0800)).toBe(true)
  })

  it('sin archivos da un zip vacío válido', () => {
    const zip = zipFiles([], new Date(2026, 0, 1))
    expect(zip.length).toBe(22)
    expect(readZip(zip)).toEqual([])
  })
})
