import { prisma } from "@/lib/prisma";

export type TutorProfileData = {
  name: string;
  email: string;
  address: string;
  phone: string;
  iban: string;
  bankName: string;
};

function envFallback(): TutorProfileData {
  return {
    name: process.env.TUTOR_NAME ?? "Max Mustermann",
    email: process.env.TUTOR_EMAIL ?? "max@example.ch",
    address: process.env.TUTOR_ADDRESS ?? "Musterstrasse 1, 8000 Zürich",
    phone: process.env.TUTOR_PHONE ?? "+41 79 000 00 00",
    iban: process.env.TUTOR_IBAN ?? "CH00 0000 0000 0000 0000 0",
    bankName: process.env.TUTOR_BANK_NAME ?? "Zürcher Kantonalbank",
  };
}

export async function getTutorProfile(): Promise<TutorProfileData> {
  try {
    const profile = await prisma.tutorProfile.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default", ...envFallback() },
    });
    return {
      name: profile.name,
      email: profile.email,
      address: profile.address,
      phone: profile.phone,
      iban: profile.iban,
      bankName: profile.bankName,
    };
  } catch {
    return envFallback();
  }
}
