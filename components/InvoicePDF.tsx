import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  formatAmount,
  formatDate,
  formatDuration,
  getInvoiceDueDate,
  InvoicePayload,
} from "@/lib/invoice";

type InvoicePDFProps = {
  payload: InvoicePayload;
  issueDate: Date;
  logoSrc?: string;
  paymentSlipSrc?: string;
  paymentSlipWidthPt?: number;
  paymentSlipHeightPt?: number;
};

/** Akzent / Raster: neutrales Schweizer Grau-Blau (kein kräftiges UI-Blau). */
const ACCENT = "#c3c6ca";
const BORDER = "#aeb2b8";
const TEXT_MUTED = "#4a4d52";
const TABLE_HEADER_BG = "#f0f1f3";
const TABLE_ALT = "#f7f8f9";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: "#1a1c1e",
    paddingTop: 42,
    paddingBottom: 40,
    paddingHorizontal: 48,
    lineHeight: 1.45,
  },
  /** Kopf: zwei feste Spalten ohne `gap` (react-pdf). */
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerLeft: {
    width: 300,
    paddingRight: 16,
  },
  headerRight: {
    width: 190,
    alignItems: "flex-end",
  },
  logo: {
    width: 148,
    objectFit: "contain",
    marginBottom: 12,
  },
  brandTitle: {
    fontSize: 11,
    fontWeight: "bold",
    letterSpacing: 0.2,
    marginBottom: 3,
  },
  addressLine: {
    color: TEXT_MUTED,
    marginBottom: 1,
  },
  heading: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#2c2e31",
    textAlign: "right",
    letterSpacing: 0.5,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
    paddingBottom: 8,
    width: "100%",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "baseline",
    marginBottom: 4,
    width: "100%",
  },
  metaLabel: {
    width: 102,
    textAlign: "right",
    marginRight: 10,
    color: TEXT_MUTED,
    fontSize: 9.5,
  },
  metaValue: {
    width: 130,
    textAlign: "right",
    fontWeight: "bold",
    fontSize: 9.5,
  },
  recipientBlock: {
    marginTop: 22,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: ACCENT,
  },
  recipientLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: TEXT_MUTED,
    marginBottom: 4,
  },
  recipientName: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 2,
  },
  recipientDetail: {
    fontSize: 9.5,
    color: TEXT_MUTED,
  },
  section: {
    marginTop: 20,
  },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 9,
    paddingHorizontal: 8,
    backgroundColor: TABLE_HEADER_BG,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    fontWeight: "bold",
    fontSize: 9,
    color: "#2c2e31",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: ACCENT,
    fontSize: 9.5,
  },
  altRow: {
    backgroundColor: TABLE_ALT,
  },
  colDate: { width: 76 },
  colDuration: { width: 62 },
  colSubject: { width: 218 },
  colAmount: { width: 104, textAlign: "right" },
  totalsSection: {
    marginTop: 14,
    alignSelf: "flex-end",
    width: 248,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalLabel: {
    color: TEXT_MUTED,
    fontSize: 9.5,
    maxWidth: 155,
  },
  totalValue: {
    fontSize: 9.5,
    textAlign: "right",
  },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: ACCENT,
    fontWeight: "bold",
    fontSize: 11,
    color: "#2c2e31",
  },
  footer: {
    marginTop: 26,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 12,
  },
  footerLead: {
    color: "#2c2e31",
    marginBottom: 6,
    fontSize: 9.5,
  },
  bankLine: {
    marginBottom: 2,
    fontSize: 9.5,
  },
  paymentSlip: {
    marginTop: 12,
  },
  legalNote: {
    marginTop: 14,
    fontSize: 8,
    color: TEXT_MUTED,
    lineHeight: 1.35,
  },
});

export function InvoicePDF({
  payload,
  issueDate,
  logoSrc,
  paymentSlipSrc,
  paymentSlipWidthPt,
  paymentSlipHeightPt,
}: InvoicePDFProps) {
  const tutor = payload.tutor;
  const dueDate = getInvoiceDueDate(payload.year, payload.month);
  const hasPaymentSlip = Boolean(paymentSlipSrc);
  const paymentSlipStyle =
    paymentSlipSrc && paymentSlipWidthPt && paymentSlipHeightPt
      ? { ...styles.paymentSlip, width: paymentSlipWidthPt, height: paymentSlipHeightPt }
      : styles.paymentSlip;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {logoSrc ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoSrc} style={styles.logo} />
            ) : null}
            <Text style={styles.brandTitle}>{tutor.name}</Text>
            <Text style={styles.addressLine}>{tutor.address}</Text>
            <Text style={styles.addressLine}>{tutor.email}</Text>
            <Text style={styles.addressLine}>{tutor.phone}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.heading}>Rechnung</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Rechnungsnr.:</Text>
              <Text style={styles.metaValue}>{payload.invoiceNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Rechnungsdatum:</Text>
              <Text style={styles.metaValue}>{formatDate(issueDate)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Leistungszeitraum:</Text>
              <Text style={styles.metaValue}>{payload.periodLabel}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Fällig am:</Text>
              <Text style={styles.metaValue}>{formatDate(dueDate)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.recipientBlock}>
          <Text style={styles.recipientLabel}>Rechnungsempfänger</Text>
          <Text style={styles.recipientName}>{payload.student.name}</Text>
          {payload.student.email ? (
            <Text style={styles.recipientDetail}>{payload.student.email}</Text>
          ) : null}
          <Text style={styles.recipientDetail}>
            Fach: {payload.student.subject} · Währung: {payload.student.currency}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.tableHeader}>
            <Text style={styles.colDate}>Datum</Text>
            <Text style={styles.colDuration}>Dauer</Text>
            <Text style={styles.colSubject}>Leistung / Fach</Text>
            <Text style={styles.colAmount}>Betrag</Text>
          </View>
          {payload.sessions.map((session, index) => (
            <View
              key={session.id}
              style={[styles.tableRow, ...(index % 2 === 1 ? [styles.altRow] : [])]}
            >
              <Text style={styles.colDate}>{formatDate(session.date)}</Text>
              <Text style={styles.colDuration}>
                {formatDuration(session.durationMin)}
              </Text>
              <Text style={styles.colSubject}>Nachhilfe · {payload.student.subject}</Text>
              <Text style={styles.colAmount}>{formatAmount(session.amountCHF)}</Text>
            </View>
          ))}
          {payload.subscriptionLines.map((line, i) => (
            <View
              key={line.id}
              style={[
                styles.tableRow,
                ...((payload.sessions.length + i) % 2 === 1 ? [styles.altRow] : []),
              ]}
            >
              <Text style={styles.colDate}>—</Text>
              <Text style={styles.colDuration}>—</Text>
              <Text style={styles.colSubject}>{line.description}</Text>
              <Text style={styles.colAmount}>{formatAmount(line.amountCHF)}</Text>
            </View>
          ))}
          <View style={styles.totalsSection}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Zwischensumme Nachhilfe</Text>
              <Text style={styles.totalValue}>{formatAmount(payload.sessionsSubtotalCHF)}</Text>
            </View>
            {payload.subscriptionLines.map((line) => (
              <View key={`tot-${line.id}`} style={styles.totalRow}>
                <Text style={styles.totalLabel}>{line.description}</Text>
                <Text style={styles.totalValue}>{formatAmount(line.amountCHF)}</Text>
              </View>
            ))}
            <View style={styles.grandTotal}>
              <Text>Total</Text>
              <Text>{formatAmount(payload.totalCHF)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerLead}>
            Der Abrechnungszeitraum {payload.periodLabel} ist abgeschlossen. Nachfolgend die
            Übersicht der erbrachten Lektionen und des fälligen Betrags.
          </Text>
          {hasPaymentSlip ? (
            <Text style={styles.footerLead}>
              Bitte begleichen Sie den Betrag bis spätestens {formatDate(dueDate)}. Alle Angaben
              für die Überweisung entnehmen Sie dem QR-Zahlteil unten.
            </Text>
          ) : (
            <>
              <Text style={styles.footerLead}>
                Bitte überweisen Sie den Betrag bis spätestens {formatDate(dueDate)} auf folgendes
                Konto:
              </Text>
              <Text style={styles.bankLine}>{tutor.bankName}</Text>
              <Text style={styles.bankLine}>{tutor.iban}</Text>
            </>
          )}
          {paymentSlipSrc ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={paymentSlipSrc} style={paymentSlipStyle} />
          ) : null}
          <Text style={{ marginTop: 8, fontSize: 9.5 }}>
            Bei Fragen können Sie sich jederzeit an mich wenden.
          </Text>
          <Text style={{ marginTop: 3, fontSize: 9.5 }}>Vielen Dank für Ihr Vertrauen.</Text>
          <Text style={styles.legalNote}>
            Die ausgewiesenen Beträge verstehen sich in Schweizer Franken (CHF). Soweit keine
            Mehrwertsteuer ausgewiesen ist, unterliegen die Leistungen der Steuerbefreiung nach
            Art. 10 Abs. 1 MWSTG (nicht steuerbar).
          </Text>
        </View>
      </Page>
    </Document>
  );
}
