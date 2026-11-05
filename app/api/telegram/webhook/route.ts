import { NextRequest, NextResponse } from "next/server";
import { answerCallback, notify, type TgUpdate } from "@/lib/tutor24-autopilot";
import { createWebhook } from "@/lib/tutor24-webhook";
import { lastPasses, queueCommand, readLaptop } from "@/lib/tutor24-watch-db";

export const runtime = "nodejs";

/**
 * Telegram ruft diese Adresse fuer jede Nachricht an den Bot auf (setWebhook mit secret_token).
 * Ohne Anmeldung erreichbar (middleware.ts); geschuetzt durch den geheimen Kopf, den nur Telegram kennt.
 * Logik: lib/tutor24-webhook.ts
 */
export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!secret || !chatId || req.headers.get("x-telegram-bot-api-secret-token") !== secret)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update) return NextResponse.json({ ok: true });
  const handle = createWebhook({
    chatId,
    now: () => new Date(),
    laptop: readLaptop,
    passes: () => lastPasses(20),
    queue: queueCommand,
    reply: (html) => notify(html, chatId, true),
    answerCallback,
  });
  try {
    console.log(`[telegram] ${update.update_id}: ${await handle(update)}`);
  } catch (err) {
    // 200 trotzdem: sonst stellt Telegram dasselbe Update immer wieder zu.
    console.error("[telegram]", err);
  }
  return NextResponse.json({ ok: true });
}
