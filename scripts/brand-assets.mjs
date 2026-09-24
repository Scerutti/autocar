// Genera los assets de marca a partir del logo original (assets/brand/autocar-logo.png).
// Uso: npm run brand
//
// - public/brand/{logo,mark,wordmark}.webp: logo con fondo transparente para usar dentro de la app.
// - public/brand/{mark,wordmark}.png: lo mismo en PNG para el PDF del historial.
// - public/icon-*.png y app/apple-icon.png: íconos de la PWA / pantalla de inicio.
// El favicon (app/favicon.ico) es el provisto por diseño y no se genera acá.

import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const SOURCE = 'assets/brand/autocar-logo.png'
const BG = [10, 17, 28] // #0a111c, fondo navy del logo

// Regiones del logo original (1254×1254), medidas sobre el contenido
const MARK = { left: 322, top: 201, width: 610, height: 556 }
const WORDMARK = { left: 190, top: 802, width: 874, height: 165 }
const FULL = { left: 190, top: 201, width: 874, height: 766 }

/**
 * "Color to alpha": convierte el fondo navy en transparencia calculando, para cada píxel,
 * el alfa mínimo que reproduce exactamente su color sobre ese fondo. Así los bordes
 * suavizados no quedan con halo.
 * Sólo cuenta lo más claro que el fondo: el fondo es tan oscuro que el grano de la imagen
 * "más oscuro que el navy" daría alfas altos. Las zonas oscuras del auto (vidrios) quedan
 * transparentes, que sobre el fondo oscuro de la app se ven igual.
 */
async function transparentSource() {
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const out = Buffer.alloc(info.width * info.height * 4)
  for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
    let a = 0
    for (let c = 0; c < 3; c++) {
      const v = data[p + c]
      const b = BG[c]
      if (v > b) a = Math.max(a, (v - b) / (255 - b))
    }
    if (a < 0.04) continue // grano del fondo → transparente
    for (let c = 0; c < 3; c++) {
      const fg = BG[c] + (data[p + c] - BG[c]) / a
      out[q + c] = Math.max(0, Math.min(255, Math.round(fg)))
    }
    out[q + 3] = Math.round(a * 255)
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png()
}

const region = async (img, r) => sharp(await img.clone().extract(r).toBuffer())

/** Cuadrado del tamaño dado con la marca centrada ocupando `fill` del ancho. */
async function tile(mark, size, { fill, radius = 0, background = true }) {
  const markW = Math.round(size * fill)
  const markBuf = await mark.clone().resize({ width: markW }).png().toBuffer()
  const { height: markH } = await sharp(markBuf).metadata()
  const svgBg = background
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius * size}" fill="rgb(${BG.join(',')})"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"/>`
  return sharp(Buffer.from(svgBg)).composite([
    { input: markBuf, left: Math.round((size - markW) / 2), top: Math.round((size - markH) / 2) },
  ])
}

async function main() {
  await mkdir('public/brand', { recursive: true })
  const img = await transparentSource()
  const mark = await region(img, MARK)
  const wordmark = await region(img, WORDMARK)
  const full = await region(img, FULL)

  // Para usar dentro de la app (fondo transparente)
  await full.clone().resize({ width: 520 }).webp({ quality: 90, alphaQuality: 90, effort: 6 }).toFile('public/brand/logo.webp')
  await wordmark.clone().resize({ height: 72 }).webp({ quality: 90, alphaQuality: 90, effort: 6 }).toFile('public/brand/wordmark.webp')
  await (await tile(mark, 160, { fill: 0.96, background: false })).webp({ quality: 90, alphaQuality: 90, effort: 6 }).toFile('public/brand/mark.webp')

  // Para el PDF del historial (react-pdf acepta PNG/JPG, no WebP); más grandes para que se vean nítidos al imprimir
  await (await tile(mark, 256, { fill: 0.96, background: false })).png().toFile('public/brand/mark.png')
  await wordmark.clone().resize({ height: 120 }).png().toFile('public/brand/wordmark.png')

  // Íconos de la PWA: esquinas redondeadas y transparentes ("any")
  for (const size of [192, 512]) {
    await (await tile(mark, size, { fill: 0.74, radius: 0.225 })).png().toFile(`public/icon-${size}x${size}.png`)
  }
  // Maskable: fondo completo y la marca dentro de la zona segura (círculo del 80%)
  await (await tile(mark, 512, { fill: 0.56 })).png().toFile('public/icon-maskable-512x512.png')
  // iOS redondea las esquinas solo y no admite transparencia
  await (await tile(mark, 180, { fill: 0.7 })).png().toFile('app/apple-icon.png')

  console.log('Assets de marca generados')
}

await main()
