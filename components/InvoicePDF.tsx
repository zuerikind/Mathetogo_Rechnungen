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

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 11,
    color: "#1a1a1a",
    padding: 40,
    lineHeight: 1.4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
  },
  leftColumn: {
    width: "58%",
    paddingRight: 10,
  },
  rightColumn: {
    width: "42%",
    alignItems: "flex-end",
  },
  logo: {
    width: 140,
    height: 34,
    marginBottom: 10,
    marginLeft: -12,
  },
  heading: {
    fontSize: 27,
    color: "#4A7FC1",
    fontWeight: "bold",
    textAlign: "right",
    lineHeight: 1.1,
    marginBottom: 10,
  },
  brandTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 4,
  },
  muted: {
    color: "#4a4a4a",
  },
  invoiceMetaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
    marginBottom: 1,
  },
  invoiceMetaWrap: {
    marginTop: 2,
  },
  invoiceMetaLabel: {
    color: "#6a6a6a",
  },
  invoiceMetaValue: {
    fontWeight: "bold",
    color: "#1f2937",
  },
  section: {
    marginTop: 24,
  },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottom: "1 solid #DDE2E0",
    borderTop: "1 solid #DDE2E0",
    fontWeight: "bold",
    color: "#4A7FC1",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottom: "1 solid #EEF1F0",
  },
  altRow: {
    backgroundColor: "#F7F9F8",
  },
  colDate: { width: "22%" },
  colDuration: { width: "18%" },
  colSubject: { width: "38%" },
  colAmount: { width: "22%", textAlign: "right" },
  totalsWrap: {
    marginTop: 10,
    marginLeft: "54%",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalLabel: { color: "#4a4a4a" },
  grandTotal: {
    fontWeight: "bold",
    color: "#4A7FC1",
    fontSize: 12,
    borderTop: "1 solid #DDE2E0",
    paddingTop: 6,
    marginTop: 2,
  },
  footer: {
    marginTop: 28,
    borderTop: "1 solid #DDE2E0",
    paddingTop: 12,
  },
  footerLead: {
    color: "#1f2937",
    marginBottom: 6,
  },
  bankLine: {
    marginBottom: 2,
  },
  paymentSlip: {
    marginTop: 12,
  },
  small: {
    marginTop: 10,
    fontSize: 9,
    color: "#6a6a6a",
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
        <View style={styles.row}>
          <View style={styles.leftColumn}>
            {logoSrc ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoSrc} style={styles.logo} />
            ) : null}
            <Text style={styles.brandTitle}>{tutor.name}</Text>
            <Text>{tutor.address}</Text>
            <Text>{tutor.email}</Text>
            <Text>{tutor.phone}</Text>
          </View>
          <View style={styles.rightColumn}>
            <Text style={styles.heading}>Rechnung</Text>
            <View style={styles.invoiceMetaWrap}>
              <View style={styles.invoiceMetaRow}>
                <Text style={styles.invoiceMetaLabel}>Datum:</Text>
                <Text style={styles.invoiceMetaValue}>{formatDate(issueDate)}</Text>
              </View>
              <View style={styles.invoiceMetaRow}>
                <Text style={styles.invoiceMetaLabel}>Zeitraum:</Text>
                <Text style={styles.invoiceMetaValue}>{payload.periodLabel}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.tableHeader}>
            <Text style={styles.colDate}>Datum</Text>
            <Text style={styles.colDuration}>Dauer</Text>
            <Text style={styles.colSubject}>Fach</Text>
            <Text style={styles.colAmount}>Betrag (CHF)</Text>
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
              <Text style={styles.colSubject}>{payload.student.subject}</Text>
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
          <View style={styles.totalsWrap}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Zwischensumme Nachhilfe</Text>
              <Text>{formatAmount(payload.sessionsSubtotalCHF)}</Text>
            </View>
            {payload.subscriptionLines.map((line) => (
              <View key={`tot-${line.id}`} style={styles.totalRow}>
                <Text style={styles.totalLabel}>{line.description}</Text>
                <Text>{formatAmount(line.amountCHF)}</Text>
              </View>
            ))}
            <View style={[styles.totalRow, styles.grandTotal]}>
              <Text>TOTAL</Text>
              <Text>{formatAmount(payload.totalCHF)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerLead}>
            Der Abrechnungszeitraum {payload.periodLabel} ist abgeschlossen. Unten finden Sie die
            Übersicht der geleisteten Stunden und den fälligen Betrag.
          </Text>
          {hasPaymentSlip ? (
            <Text style={styles.footerLead}>
              Bitte begleichen Sie den Betrag bis spätestens {formatDate(dueDate)}. Alle Angaben für
              die Überweisung entnehmen Sie bitte dem QR-Zahlteil unten.
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
          <Text style={{ marginTop: 8 }}>
            Falls Sie Fragen haben, können Sie sich jederzeit gerne bei mir melden.
          </Text>
          <Text style={{ marginTop: 4 }}>Vielen Dank für Ihr Vertrauen!</Text>
        </View>
      </Page>
    </Document>
  );
}
