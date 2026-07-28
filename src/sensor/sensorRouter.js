import { Router } from "express";
import { getLatestReading, getHistory, getStats } from "./sensorController.js";

const router = Router();

router.get("/latest", getLatestReading);
router.get("/history", getHistory);
router.get("/stats", getStats);

export default router;