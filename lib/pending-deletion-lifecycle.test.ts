import { describe, expect, it } from "vitest";
import {
  afterCalendarEventSeen,
  afterDeletionPending,
  afterDeletionRejected,
  CALENDAR_EVENT_SEEN_RESET,
  DELETION_CANDIDATE_WHERE,
  isDeletionCandidate,
} from "./pending-deletion-lifecycle";

/**
 * Regression: ein abgelehnter Loeschvorschlag hielt nur bis zum naechsten Sync.
 *
 * "Behalten" setzte pendingDeletionAt auf null — und genau danach sucht der Sync
 * seine Kandidaten. Der Fall stand beim naechsten Lauf wieder da, jedes Mal
 * aufs Neue. Die zweite Marke deletionRejectedAt haelt den Entscheid fest.
 */

const T0 = new Date("2026-08-01T10:00:00Z");
const T1 = new Date("2026-08-02T10:00:00Z");

describe("isDeletionCandidate", () => {
  it("unberuehrte Lektion ist Kandidat", () => {
    expect(isDeletionCandidate({ pendingDeletionAt: null, deletionRejectedAt: null })).toBe(true);
  });

  it("bereits vorgemerkte wird nicht erneut geprueft", () => {
    expect(isDeletionCandidate({ pendingDeletionAt: T0, deletionRejectedAt: null })).toBe(false);
  });

  it("abgelehnte ist kein Kandidat mehr", () => {
    expect(isDeletionCandidate({ pendingDeletionAt: null, deletionRejectedAt: T0 })).toBe(false);
  });

  it("spiegelt den Prisma-Filter des Syncs", () => {
    // Die beiden gehoeren zusammen geaendert — dasselbe Paar-Muster wie
    // isDelivered / DELIVERED_INVOICE_WHERE.
    expect(DELETION_CANDIDATE_WHERE).toEqual({
      pendingDeletionAt: null,
      deletionRejectedAt: null,
    });
    expect(isDeletionCandidate(DELETION_CANDIDATE_WHERE)).toBe(true);
  });
});

describe("Lebenszyklus einer Loeschvormerkung", () => {
  it("abgelehnte Loeschung ueberlebt den naechsten Sync", () => {
    // 1. Kalendereintrag verschwindet -> vorgemerkt
    let session = afterDeletionPending(T0);
    expect(session.pendingDeletionAt).toEqual(T0);

    // 2. Nutzer waehlt "Behalten"
    session = afterDeletionRejected(T1);
    expect(session.pendingDeletionAt).toBeNull();
    expect(session.deletionRejectedAt).toEqual(T1);

    // 3. Naechster Sync: der Termin fehlt weiterhin im Kalender — trotzdem kein
    //    Kandidat. Vorher wurde hier erneut vorgemerkt.
    expect(isDeletionCandidate(session)).toBe(false);

    // 4. Und beim uebernaechsten auch nicht.
    expect(isDeletionCandidate(session)).toBe(false);
  });

  it("der Entscheid faellt weg, sobald der Termin wieder auftaucht", () => {
    const abgelehnt = afterDeletionRejected(T1);
    // Der Upsert des Syncs setzt beim wiedergesehenen Termin beide Marken zurueck.
    const wiedergesehen = { ...abgelehnt, ...CALENDAR_EVENT_SEEN_RESET };
    expect(wiedergesehen.pendingDeletionAt).toBeNull();
    expect(wiedergesehen.deletionRejectedAt).toBeNull();
    expect(isDeletionCandidate(wiedergesehen)).toBe(true);
  });

  it("verschwindet er danach erneut, ist es ein neuer Vorgang", () => {
    const zyklus1 = afterDeletionRejected(T0);
    const wiedergesehen = { ...zyklus1, ...CALENDAR_EVENT_SEEN_RESET };
    expect(isDeletionCandidate(wiedergesehen)).toBe(true);

    const zyklus2 = afterDeletionPending(T1);
    expect(zyklus2.pendingDeletionAt).toEqual(T1);
    expect(zyklus2.deletionRejectedAt).toBeNull();
  });

  it("eine offene Vormerkung wird durch das Wiedersehen aufgehoben", () => {
    const vorgemerkt = afterDeletionPending(T0);
    const wiedergesehen = { ...vorgemerkt, ...CALENDAR_EVENT_SEEN_RESET };
    expect(wiedergesehen.pendingDeletionAt).toBeNull();
  });

  it("afterCalendarEventSeen entspricht dem Reset-Objekt", () => {
    expect(afterCalendarEventSeen()).toEqual(CALENDAR_EVENT_SEEN_RESET);
  });

  it("das Vormerken loescht einen frueheren Entscheid nicht versehentlich mit", () => {
    // afterDeletionPending wird nur auf Kandidaten angewendet — dort ist
    // deletionRejectedAt ohnehin null. Der Rueckgabewert haelt das ausdruecklich fest.
    expect(afterDeletionPending(T0).deletionRejectedAt).toBeNull();
  });
});
