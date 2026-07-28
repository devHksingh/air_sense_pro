import cron from "node-cron";
import axios from "axios";
import SensorReading from "../sensor/sensorModel.js";
import { configDotenv } from "dotenv";

configDotenv();

// ───────────────────────── Job 1: delete readings older than 16 days ─────────────────────────
// Runs once daily at 22:05 IST — inside your requested 10:00–11:50 PM window,
// and deliberately a few minutes after the ESP32's own maintenance phase
// begins (22:00), so it doesn't race the device's SD-card backlog drain.
function scheduleCleanupJob() {
  cron.schedule(
    "5 22 * * *",
    async () => {
      try {
        const cutoff = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000);
        const result = await SensorReading.deleteMany({ ts: { $lt: cutoff } });
        console.log(`[cron] Cleanup: deleted ${result.deletedCount} readings older than 16 days`);
      } catch (err) {
        console.error("[cron] Cleanup job failed:", err.message);
      }
    },
    { timezone: "Asia/Kolkata" }
  );
  console.log("[cron] Cleanup job scheduled: daily at 22:05 IST");
}

// ───────────────────────── Job 2: self-ping to prevent Render free-tier sleep ─────────────────────────
// Render's free tier spins a service down after ~15 min of no inbound
// traffic. Pinging our own /api/health every 10 minutes keeps it warm.
// RENDER_EXTERNAL_URL is auto-injected by Render on web services — no need
// to set it manually. Falls back to SELF_URL from .env for other hosts,
// and skips entirely (harmless) if neither is set, e.g. local development.
function scheduleKeepAliveJob() {
  const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;

  if (!selfUrl) {
    console.log("[cron] Keep-alive job skipped — no RENDER_EXTERNAL_URL or SELF_URL set");
    return;
  }

  cron.schedule("*/10 * * * *", async () => {
    try {
      await axios.get(`${selfUrl}/api/health`, { timeout: 10000 });
      console.log("[cron] Keep-alive ping sent");
    } catch (err) {
      console.error("[cron] Keep-alive ping failed:", err.message);
    }
  });
  console.log(`[cron] Keep-alive job scheduled: every 10 min, pinging ${selfUrl}/api/health`);
}

export function startCronJobs() {
  scheduleCleanupJob();
  scheduleKeepAliveJob();
}