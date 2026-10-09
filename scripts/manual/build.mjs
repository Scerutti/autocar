// Genera el PDF del manual de usuario con @react-pdf/renderer (la misma librería del informe de la app).
// Uso: npm run manual → docs/manual-de-usuario.pdf. El texto está en content.mjs y las capturas en img/.
// Dos pasadas: la primera anota en qué página cae cada título; la segunda arma el índice y el encabezado.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToFile } from '@react-pdf/renderer'
import { CHAPTERS, META } from './content.mjs'

const h = React.createElement
const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(DIR, '..', '..')
// Las capturas están en img/; el logo sale de public/brand (lo genera npm run brand).
const IMG_PATH = f => (f.endsWith('.png') ? path.join(ROOT, 'public', 'brand', f) : path.join(DIR, 'img', f))
// Con rutas de Windows ("C:\…") react-pdf intenta un fetch: se le pasa el contenido.
const IMG = f => ({ data: fs.readFileSync(IMG_PATH(f)), format: f.endsWith('.png') ? 'png' : 'jpg' })
const OUT = path.join(ROOT, 'docs', 'manual-de-usuario.pdf')

// Sin cortes de palabra: las reglas de guionado por defecto son del inglés.
Font.registerHyphenationCallback(word => [word])

const C = {
  navy: '#0a111c',
  blue: '#1a9cfb',
  blueDark: '#0b6fbf',
  ink: '#0f172a',
  body: '#1e293b',
  muted: '#64748b',
  line: '#dbe3ec',
  soft: '#f3f7fb',
}

const M = { top: 70, bottom: 66, side: 58 }

const s = StyleSheet.create({
  page: { paddingTop: M.top, paddingBottom: M.bottom, paddingHorizontal: M.side, fontFamily: 'Helvetica', fontSize: 10.5, color: C.body },
  // Tapa
  cover: { fontFamily: 'Helvetica', color: C.ink },
  coverBand: { backgroundColor: C.navy, height: 330, alignItems: 'center', justifyContent: 'center' },
  coverMark: { width: 120, height: 120 },
  coverWordmark: { width: 230, height: 43, marginTop: 18 },
  coverBody: { paddingHorizontal: 64, paddingTop: 56 },
  coverKicker: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.blueDark, letterSpacing: 2, textTransform: 'uppercase' },
  coverTitle: { fontSize: 34, fontFamily: 'Helvetica-Bold', color: C.ink, marginTop: 10 },
  coverSub: { fontSize: 13, color: C.muted, marginTop: 8 },
  coverRule: { width: 56, height: 3, backgroundColor: C.blue, marginTop: 26, marginBottom: 26 },
  coverRow: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.line },
  coverLabel: { width: 170, fontSize: 10, color: C.muted },
  coverValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.ink },
  coverFoot: { position: 'absolute', left: 64, right: 64, bottom: 44, fontSize: 8.5, color: C.muted },
  // Encabezado y pie
  header: { position: 'absolute', top: 30, left: M.side, right: M.side, flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 7, borderBottomWidth: 0.75, borderBottomColor: C.line },
  headerText: { fontSize: 8.5, color: C.muted },
  headerBrand: { fontSize: 8.5, color: C.ink, fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 28, left: M.side, right: M.side, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 7, borderTopWidth: 0.75, borderTopColor: C.line },
  footerText: { fontSize: 8.5, color: C.muted },
  // Índice
  tocTitle: { fontSize: 24, fontFamily: 'Helvetica-Bold', color: C.ink, marginBottom: 18 },
  tocRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 9 },
  tocSubRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4, paddingLeft: 22 },
  tocNum: { width: 22, fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.blueDark },
  tocText: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.ink },
  tocSubNum: { width: 28, fontSize: 9.5, color: C.muted },
  tocSubText: { fontSize: 9.5, color: C.body },
  tocLeader: { flexGrow: 1, marginHorizontal: 6, marginBottom: 3, borderBottomWidth: 1, borderBottomColor: C.line, borderBottomStyle: 'dotted' },
  tocPage: { fontSize: 10, color: C.ink, width: 18, textAlign: 'right' },
  historyTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 34, marginBottom: 6 },
  // Capítulos
  chapterKicker: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.blueDark, letterSpacing: 2, textTransform: 'uppercase' },
  chapterTitle: { fontSize: 24, fontFamily: 'Helvetica-Bold', color: C.ink, marginTop: 6 },
  chapterRule: { height: 2, backgroundColor: C.blue, width: 48, marginTop: 12, marginBottom: 18 },
  h2: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.ink, marginTop: 16, marginBottom: 6 },
  p: { marginBottom: 8 },
  bold: { fontFamily: 'Helvetica-Bold', color: C.ink },
  item: { flexDirection: 'row', marginBottom: 4 },
  stepNum: { width: 22, height: 16, fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.blueDark },
  bullet: { width: 14, color: C.blueDark },
  itemText: { flex: 1 },
  list: { marginBottom: 6, marginTop: 2 },
  note: { flexDirection: 'row', backgroundColor: C.soft, borderLeftWidth: 3, borderLeftColor: C.blue, paddingVertical: 8, paddingHorizontal: 10, marginTop: 4, marginBottom: 10 },
  noteLabel: { fontFamily: 'Helvetica-Bold', color: C.blueDark, width: 38, fontSize: 10 },
  noteText: { flex: 1, fontSize: 10 },
  table: { borderWidth: 0.75, borderColor: C.line, marginTop: 4, marginBottom: 12 },
  tr: { flexDirection: 'row', borderTopWidth: 0.75, borderTopColor: C.line },
  thRow: { flexDirection: 'row', backgroundColor: C.soft },
  th: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingVertical: 6, paddingHorizontal: 8 },
  td: { fontSize: 10, paddingVertical: 6, paddingHorizontal: 8 },
  defTerm: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.ink, paddingVertical: 6, paddingHorizontal: 8 },
  figure: { alignItems: 'center', marginTop: 6, marginBottom: 12 },
  figRow: { flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 6, marginBottom: 12 },
  figCol: { alignItems: 'center', width: 175 },
  img: { borderWidth: 0.75, borderColor: C.line, borderRadius: 6 },
  caption: { fontSize: 8.5, color: C.muted, marginTop: 5, textAlign: 'center', fontFamily: 'Helvetica-Oblique' },
  q: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.ink, marginBottom: 3 },
  qa: { marginBottom: 12 },
})

// "Tocar **Agregar**" → texto con negritas.
function rich(text) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part, i) =>
    part.startsWith('**') ? h(Text, { key: i, style: s.bold }, part.slice(2, -2)) : part,
  )
}

const IMAGE_SIZES = {} // ancho/alto en px de cada captura (se leen del JPG)
async function readSizes() {
  for (const f of [...fs.readdirSync(path.join(DIR, 'img')), 'mark.png', 'wordmark.png']) {
    const b = fs.readFileSync(IMG_PATH(f))
    if (f.endsWith('.png')) IMAGE_SIZES[f] = [b.readUInt32BE(16), b.readUInt32BE(20)]
    else {
      // Busca el marcador SOF0/SOF2 del JPG.
      let i = 2
      while (i < b.length) {
        const marker = b[i + 1]
        const len = b.readUInt16BE(i + 2)
        if (marker === 0xc0 || marker === 0xc2) {
          IMAGE_SIZES[f] = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]
          break
        }
        i += 2 + len
      }
    }
  }
}

function img(file, width) {
  const [w, hgt] = IMAGE_SIZES[file]
  return h(Image, { src: IMG(file), style: [s.img, { width, height: (width * hgt) / w }] })
}

function renderBlocks(chapter, ctx) {
  let sub = 0
  const out = []
  const blocks = chapter.blocks
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.h) {
      sub++
      const id = `${chapter.id}.${sub}`
      const label = `${chapter.n}.${sub}  ${b.h}`
      const title = h(Text, { style: s.h2, render: ({ pageNumber }) => (ctx.record(id, pageNumber), label) })
      // El subtítulo nunca queda solo al pie de una página: va junto con el bloque que le sigue.
      const next = blocks[i + 1] && !blocks[i + 1].h ? renderBlock(blocks[++i], i, ctx) : null
      out.push(h(View, { key: i, wrap: false }, title, next))
      continue
    }
    out.push(renderBlock(b, i, ctx))
  }
  return out
}

function renderBlock(b, i, ctx) {
  {
    if (b.p) return h(Text, { key: i, style: s.p }, rich(b.p))
    if (b.steps || b.bullets) {
      const items = b.steps ?? b.bullets
      // Los pasos van juntos en la misma página; las viñetas pueden cortarse.
      return h(View, { key: i, style: s.list, wrap: !b.steps }, items.map((t, j) =>
        h(View, { key: j, style: s.item, wrap: false },
          b.steps ? h(Text, { style: s.stepNum }, `${j + 1}.`) : h(Text, { style: s.bullet }, '•'),
          h(Text, { style: s.itemText }, rich(t)),
        ),
      ))
    }
    if (b.note) {
      return h(View, { key: i, style: s.note, wrap: false }, h(Text, { style: s.noteLabel }, 'Nota'), h(Text, { style: s.noteText }, rich(b.note)))
    }
    if (b.table) {
      const { head, rows, widths } = b.table
      const col = j => ({ width: `${widths[j]}%` })
      return h(View, { key: i, style: s.table },
        h(View, { style: s.thRow, wrap: false }, head.map((t, j) => h(Text, { key: j, style: [s.th, col(j)] }, t))),
        rows.map((r, k) => h(View, { key: k, style: s.tr, wrap: false }, r.map((t, j) => h(Text, { key: j, style: [s.td, col(j)] }, rich(t))))),
      )
    }
    if (b.defs) {
      return h(View, { key: i, style: s.table },
        b.defs.map(([term, def], k) =>
          h(View, { key: k, style: [k === 0 ? { flexDirection: 'row' } : s.tr], wrap: false },
            h(Text, { style: [s.defTerm, { width: '30%', backgroundColor: C.soft }] }, term),
            h(Text, { style: [s.td, { width: '70%' }] }, rich(def)),
          ),
        ),
      )
    }
    if (b.fig) {
      const n = ++ctx.figure
      return h(View, { key: i, style: s.figure, wrap: false }, img(b.fig, b.width ?? 175), h(Text, { style: s.caption }, `Figura ${n}. ${b.caption}`))
    }
    if (b.figs) {
      const width = b.width ?? 175
      return h(View, { key: i, style: [s.figRow, { gap: b.figs.length > 2 ? 14 : 22 }], wrap: false }, b.figs.map((f, j) => {
        const n = ++ctx.figure
        return h(View, { key: j, style: [s.figCol, { width }] }, img(f.fig, width), h(Text, { style: s.caption }, `Figura ${n}. ${f.caption}`))
      }))
    }
    if (b.qa) {
      return h(View, { key: i, style: s.qa, wrap: false }, h(Text, { style: s.q }, b.qa[0]), h(Text, null, rich(b.qa[1])))
    }
    throw new Error(`Bloque desconocido: ${JSON.stringify(b)}`)
  }
}

const appLine = `Versión ${META.manualVersion} del manual · AutoCar ${META.appVersion}`

function Cover() {
  const row = (label, value) => h(View, { style: s.coverRow }, h(Text, { style: s.coverLabel }, label), h(Text, { style: s.coverValue }, value))
  return h(Page, { size: 'A4', style: s.cover },
    h(View, { style: s.coverBand }, h(Image, { src: IMG('mark.png'), style: s.coverMark }), h(Image, { src: IMG('wordmark.png'), style: s.coverWordmark })),
    h(View, { style: s.coverBody },
      h(Text, { style: s.coverKicker }, 'Documentación'),
      h(Text, { style: s.coverTitle }, META.title),
      h(Text, { style: s.coverSub }, 'Guía para registrar y planificar el mantenimiento del vehículo.'),
      h(View, { style: s.coverRule }),
      row('Versión del manual', META.manualVersion),
      row('Versión de la aplicación', `AutoCar ${META.appVersion}`),
      row('Fecha', META.date),
      row('Dirección de la aplicación', META.url),
    ),
    h(Text, { style: s.coverFoot }, 'Las funciones y pantallas descriptas corresponden a la versión de la aplicación indicada. Versiones posteriores pueden presentar diferencias.'),
  )
}

function Toc({ pages }) {
  const pg = id => (pages[id] != null ? String(pages[id]) : '')
  return h(View, null,
    h(Text, { style: s.tocTitle }, 'Índice'),
    CHAPTERS.map(ch => {
      let sub = 0
      return h(View, { key: ch.id, wrap: false },
        h(View, { style: s.tocRow }, h(Text, { style: s.tocNum }, String(ch.n)), h(Text, { style: s.tocText }, ch.title), h(View, { style: s.tocLeader }), h(Text, { style: s.tocPage }, pg(ch.id))),
        ch.blocks.filter(b => b.h).map(b => {
          sub++
          return h(View, { key: sub, style: s.tocSubRow }, h(Text, { style: s.tocSubNum }, `${ch.n}.${sub}`), h(Text, { style: s.tocSubText }, b.h), h(View, { style: s.tocLeader }), h(Text, { style: s.tocPage }, pg(`${ch.id}.${sub}`)))
        }),
      )
    }),
    h(Text, { style: s.historyTitle }, 'Historial de versiones'),
    h(View, { style: s.table },
      h(View, { style: s.thRow }, ['Versión', 'Fecha', 'Cambios'].map((t, j) => h(Text, { key: j, style: [s.th, { width: ['16%', '24%', '60%'][j] }] }, t))),
      META.history.map(([version, date, changes]) =>
        h(View, { key: version, style: s.tr, wrap: false },
          h(Text, { style: [s.td, { width: '16%' }] }, version),
          h(Text, { style: [s.td, { width: '24%' }] }, date),
          h(Text, { style: [s.td, { width: '60%' }] }, changes),
        ),
      ),
    ),
  )
}

function ManualDoc({ pages, record }) {
  const ctx = { figure: 0, record }
  const chapterAt = page => {
    let current = null
    for (const ch of CHAPTERS) if (pages[ch.id] != null && pages[ch.id] <= page) current = ch
    return current
  }
  return h(Document, { title: `AutoCar - ${META.title}`, author: 'AutoCar', subject: appLine, language: 'es-AR' },
    Cover(),
    h(Page, { size: 'A4', style: s.page },
      h(View, { fixed: true, style: s.header },
        h(Text, { style: s.headerBrand }, `AutoCar · ${META.title}`),
        h(Text, { style: s.headerText, render: ({ pageNumber }) => { const ch = chapterAt(pageNumber); return ch ? `${ch.n}. ${ch.title}` : 'Índice' } }),
      ),
      h(View, { fixed: true, style: s.footer },
        h(Text, { style: s.footerText }, `${appLine} · ${META.date}`),
        h(Text, { style: s.footerText, render: ({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}` }),
      ),
      Toc({ pages }),
      CHAPTERS.map(ch => h(View, { key: ch.id, break: true },
        h(Text, { style: s.chapterKicker }, `Capítulo ${ch.n}`),
        h(Text, { style: s.chapterTitle, render: ({ pageNumber }) => (record(ch.id, pageNumber), ch.title) }),
        h(View, { style: s.chapterRule }),
        renderBlocks(ch, ctx),
      )),
    ),
  )
}

CHAPTERS.forEach((ch, i) => (ch.n = i + 1))
await readSizes()

// render se llama varias veces mientras se arma el layout: vale la última llamada. Se repite hasta que
// el índice no cambie (agregar números de página al índice podría mover algún título).
let pages = {}
for (let pass = 1; ; pass++) {
  const found = {}
  await renderToFile(ManualDoc({ pages, record: (id, p) => (found[id] = p) }), OUT)
  const stable = Object.keys(found).every(k => found[k] === pages[k])
  pages = found
  if (stable) break
  if (pass === 4) throw new Error('El índice no se estabiliza')
}
console.log(`Manual generado: ${path.relative(ROOT, OUT)}`)
