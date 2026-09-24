import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { RuleStatus } from '@/lib/maintenance'
import type { ServiceReport } from '@/lib/report'

// PDF "Historial de mantenimiento". Se carga recién al exportar (import dinámico), así la librería
// de PDF no pesa en el resto de la app. Fondo blanco para que se imprima bien; la franja navy lleva
// el logo, que tiene partes blancas.

const C = {
  navy: '#0a111c',
  blue: '#1a9cfb',
  ink: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  soft: '#f8fafc',
}

const STATUS_COLORS: Record<RuleStatus, { fg: string; bg: string }> = {
  ok: { fg: '#047857', bg: '#ecfdf5' },
  soon: { fg: '#b45309', bg: '#fffbeb' },
  overdue: { fg: '#b91c1c', bg: '#fef2f2' },
  unknown: { fg: C.muted, bg: '#f1f5f9' },
}

export const REPORT_DISCLAIMER =
  'Este informe se generó con AutoCar a partir de los datos que cargó el titular del vehículo. Es un resumen informativo: no es una factura ni un comprobante fiscal, no reemplaza la documentación emitida por talleres o concesionarias y no certifica el estado mecánico del vehículo.'

const s = StyleSheet.create({
  // Sin lineHeight en la página: con eso react-pdf no dibuja el pie (fixed), y en textos sueltos deja huecos.
  page: { paddingTop: 32, paddingHorizontal: 36, paddingBottom: 78, fontFamily: 'Helvetica', fontSize: 9.5, color: C.ink },
  header: {
    backgroundColor: C.navy,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { color: '#ffffff', fontSize: 9.5, fontFamily: 'Helvetica-Bold', letterSpacing: 1.2, textAlign: 'right' },
  headerSub: { color: C.faint, fontSize: 8, marginTop: 2, textAlign: 'right' },
  carName: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 20, lineHeight: 1.2 },
  carDetail: { color: C.muted, marginTop: 2 },
  stats: { flexDirection: 'row', marginTop: 12, gap: 8 },
  stat: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 6, paddingVertical: 7, paddingHorizontal: 9 },
  statLabel: { fontSize: 7, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  sectionTitle: {
    marginTop: 22,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1.5,
    borderBottomColor: C.blue,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  sectionText: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.blue, letterSpacing: 1.2, textTransform: 'uppercase' },
  sectionNote: { fontSize: 8, color: C.muted },
  thead: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.line },
  th: { fontSize: 7, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.line },
  bold: { fontFamily: 'Helvetica-Bold' },
  muted: { color: C.muted },
  pill: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, alignSelf: 'flex-start' },
  notes: { marginTop: 5, backgroundColor: C.soft, borderLeftWidth: 2, borderLeftColor: C.blue, paddingVertical: 5, paddingHorizontal: 7 },
  notesLabel: { fontSize: 7, color: C.muted, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  total: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'baseline', marginTop: 8, gap: 10 },
  empty: { color: C.muted, marginTop: 6 },
  footer: {
    position: 'absolute',
    left: 36,
    right: 36,
    bottom: 26,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.line,
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  disclaimer: { width: 430, fontSize: 6.8, color: C.muted, lineHeight: 1.4 },
  pageNumber: { flex: 1, fontSize: 7.5, color: C.muted, textAlign: 'right' },
})

// Anchos de las columnas de la tabla de trabajos
const W = { date: 96, cost: 72 }
const R = { name: 140, last: 112, status: 58 }

function SectionTitle({ children, note }: { children: string; note?: string }) {
  return (
    <View style={s.sectionTitle} minPresenceAhead={60}>
      <Text style={s.sectionText}>{children}</Text>
      {note ? <Text style={s.sectionNote}>{note}</Text> : null}
    </View>
  )
}

export function ServiceReportPdf({ report, origin }: { report: ServiceReport; origin: string }) {
  const showCosts = report.total != null
  const stats = [
    { label: 'Km actuales', value: report.currentKm },
    { label: 'Combustible', value: report.fuel },
    { label: 'Trabajos', value: String(report.jobs.length) },
    ...(showCosts ? [{ label: 'Invertido', value: report.total! }] : []),
  ]

  return (
    <Document
      title={`Historial de mantenimiento - ${report.carName}`}
      author="AutoCar"
      subject="Historial de mantenimiento del vehículo"
      creator="AutoCar"
      producer="AutoCar"
      language="es-AR"
    >
      <Page size="A4" style={s.page}>
        {/* Pie en todas las páginas */}
        <View style={s.footer} fixed>
          <Text style={s.disclaimer}>{REPORT_DISCLAIMER}</Text>
          <Text style={s.pageNumber} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
        <View style={s.header}>
          <View style={s.brand}>
            <Image src={`${origin}/brand/mark.png`} style={{ width: 30, height: 30, marginRight: 8 }} />
            <Image src={`${origin}/brand/wordmark.png`} style={{ width: 80, height: 15 }} />
          </View>
          <View>
            <Text style={s.headerTitle}>HISTORIAL DE MANTENIMIENTO</Text>
            <Text style={s.headerSub}>Emitido el {report.issuedOn}</Text>
          </View>
        </View>

        <Text style={s.carName}>{report.carName}</Text>
        {report.carDetail ? <Text style={s.carDetail}>{report.carDetail}</Text> : null}
        <View style={s.stats}>
          {stats.map(st => (
            <View key={st.label} style={s.stat}>
              <Text style={s.statLabel}>{st.label}</Text>
              <Text style={s.statValue}>{st.value}</Text>
            </View>
          ))}
        </View>

        {report.rules.length > 0 && (
          <View>
            <SectionTitle>Estado de los mantenimientos</SectionTitle>
            <View style={s.thead}>
              <Text style={[s.th, { width: R.name }]}>Mantenimiento</Text>
              <Text style={[s.th, { width: R.last }]}>Última vez</Text>
              <Text style={[s.th, { flex: 1 }]}>Próximo</Text>
              <Text style={[s.th, { width: R.status }]}>Estado</Text>
            </View>
            {report.rules.map((r, i) => (
              <View key={`${r.name}-${i}`} style={s.row} wrap={false}>
                <Text style={[s.bold, { width: R.name, paddingRight: 8 }]}>{r.name}</Text>
                <View style={{ width: R.last, paddingRight: 8 }}>
                  <Text style={s.muted}>{r.lastDate ?? '—'}</Text>
                  {r.lastKm ? <Text style={[s.muted, { fontSize: 8 }]}>{r.lastKm}</Text> : null}
                </View>
                <Text style={{ flex: 1, paddingRight: 8 }}>{r.next ?? '—'}</Text>
                <View style={{ width: R.status }}>
                  <Text style={[s.pill, { color: STATUS_COLORS[r.status].fg, backgroundColor: STATUS_COLORS[r.status].bg }]}>
                    {r.statusLabel}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <SectionTitle note={report.periodLabel}>Trabajos realizados</SectionTitle>
        {report.jobs.length === 0 ? (
          <Text style={s.empty}>No hay trabajos registrados en el período elegido.</Text>
        ) : (
          <View>
            <View style={s.thead}>
              <Text style={[s.th, { width: W.date }]}>Fecha</Text>
              <Text style={[s.th, { flex: 1 }]}>Trabajo</Text>
              {showCosts && <Text style={[s.th, { width: W.cost, textAlign: 'right' }]}>Costo</Text>}
            </View>
            {report.jobs.map(j => (
              <View key={j.id} style={s.row} wrap={false}>
                <View style={{ width: W.date, paddingRight: 8 }}>
                  <Text style={s.bold}>{j.date}</Text>
                  {j.km ? <Text style={[s.muted, { fontSize: 8 }]}>{j.km}</Text> : null}
                </View>
                <View style={{ flex: 1, paddingRight: showCosts ? 10 : 0 }}>
                  <Text style={[s.bold, { fontSize: 10.5 }]}>{j.title}</Text>
                  <Text style={[s.muted, { fontSize: 8.5 }]}>{[j.category, j.workshop].filter(Boolean).join(' · ')}</Text>
                  {j.notes ? (
                    <View style={s.notes}>
                      <Text style={s.notesLabel}>Observaciones</Text>
                      <Text>{j.notes}</Text>
                    </View>
                  ) : null}
                </View>
                {showCosts && <Text style={[s.bold, { width: W.cost, textAlign: 'right' }]}>{j.cost}</Text>}
              </View>
            ))}
            {showCosts && (
              <View style={s.total} wrap={false}>
                <Text style={s.muted}>Total del período</Text>
                <Text style={[s.bold, { fontSize: 12 }]}>{report.total}</Text>
              </View>
            )}
          </View>
        )}

      </Page>
    </Document>
  )
}
