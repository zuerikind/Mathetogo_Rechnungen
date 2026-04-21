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
  InvoicePayload,
} from "@/lib/invoice";

type InvoicePDFProps = {
  payload: InvoicePayload;
  issueDate: Date;
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
  logo: {
    width: 160,
    height: 38,
    marginBottom: 10,
  },
  heading: {
    fontSize: 32,
    color: "#0F6E56",
    fontWeight: "bold",
    textAlign: "right",
  },
  brandTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 4,
  },
  muted: {
    color: "#4a4a4a",
  },
  section: {
    marginTop: 24,
  },
  studentLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    color: "#0F6E56",
    marginBottom: 4,
  },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottom: "1 solid #DDE2E0",
    borderTop: "1 solid #DDE2E0",
    fontWeight: "bold",
    color: "#0F6E56",
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
    marginLeft: "56%",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalLabel: { color: "#4a4a4a" },
  grandTotal: {
    fontWeight: "bold",
    color: "#0F6E56",
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
  small: {
    marginTop: 10,
    fontSize: 9,
    color: "#6a6a6a",
  },
});

export function InvoicePDF({ payload, issueDate }: InvoicePDFProps) {
  const tutor = payload.tutor;
  const dueDate = new Date(issueDate);
  dueDate.setDate(issueDate.getDate() + 30);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.row}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image
              src={`${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/mathetogo-logo-clean.png`}
              style={styles.logo}
            />
            <Text style={styles.brandTitle}>{tutor.name}</Text>
            <Text>{tutor.address}</Text>
            <Text>{tutor.email}</Text>
            <Text>{tutor.phone}</Text>
          </View>
          <View>
            <Text style={styles.heading}>Rechnung</Text>
            <Text>Rechnungsnr.: {payload.invoiceNumber}</Text>
            <Text>Datum: {formatDate(issueDate)}</Text>
            <Text>Zeitraum: {payload.periodLabel}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.studentLabel}>An:</Text>
          <Text>{payload.student.name}</Text>
          {payload.student.email ? <Text>{payload.student.email}</Text> : null}
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
              <Text style={styles.colAmount}>{session.amountCHF.toFixed(2)}</Text>
            </View>
          ))}
          <View style={styles.totalsWrap}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text>{formatAmount(payload.totalCHF)}</Text>
            </View>
            <View style={[styles.totalRow, styles.grandTotal]}>
              <Text>TOTAL</Text>
              <Text>{formatAmount(payload.totalCHF)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>
            Bitte überweisen Sie den Betrag bis {formatDate(dueDate)} auf
            folgendes Konto:
          </Text>
          <Text>{tutor.bankName}</Text>
          <Text>{tutor.iban}</Text>
          <Text style={{ marginTop: 8 }}>Vielen Dank für Ihr Vertrauen!</Text>
          <Text style={styles.small}>
            Privatperson — keine Mehrwertsteuer
          </Text>
        </View>
      </Page>
    </Document>
  );
}
