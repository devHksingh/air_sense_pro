import createHttpError from "http-errors";
import SensorReading from "./sensorModel.js";

// GET /api/sensor/latest
const getLatestReading = async (req, res, next) => {
  try {
    const latest = await SensorReading.findOne().sort({ ts: -1 }).lean();

    if (!latest) {
      return next(createHttpError(404, "No sensor readings found yet"));
    }

    res.status(200).json({
      success: true,
      message: "Latest sensor reading fetched",
      data: latest,
    });
  } catch (err) {
    next(createHttpError(500, "Failed to fetch latest reading"));
  }
};

// GET /api/sensor/history?from=<ISO date>&to=<ISO date>&limit=<n>
const getHistory = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit <= 0) limit = 200;
    if (limit > 1000) limit = 1000; // hard cap to protect the API/dashboard from an accidental huge query

    const filter = {};
    if (from || to) {
      filter.ts = {};
      if (from) filter.ts.$gte = new Date(from);
      if (to) filter.ts.$lte = new Date(to);
    }

    const history = await SensorReading.find(filter)
      .sort({ ts: 1 }) // ascending — natural order for charting on the dashboard
      .limit(limit)
      .lean();

    res.status(200).json({
      success: true,
      message: "Sensor history fetched",
      count: history.length,
      data: history,
    });
  } catch (err) {
    next(createHttpError(500, "Failed to fetch sensor history"));
  }
};

// GET /api/sensor/stats?from=<ISO date>&to=<ISO date>
const getStats = async (req, res, next) => {
  try {
    const { from, to } = req.query;

    const matchStage = {};
    if (from || to) {
      matchStage.ts = {};
      if (from) matchStage.ts.$gte = new Date(from);
      if (to) matchStage.ts.$lte = new Date(to);
    }

    const fields = ["bmeTemp", "bmeHum", "bmePres", "ahtTemp", "ahtHum", "eco2", "tvoc"];
    const groupStage = { _id: null, count: { $sum: 1 } };
    fields.forEach((f) => {
      groupStage[`${f}_min`] = { $min: `$${f}` };
      groupStage[`${f}_max`] = { $max: `$${f}` };
      groupStage[`${f}_avg`] = { $avg: `$${f}` };
    });

    const pipeline = [];
    if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });
    pipeline.push({ $group: groupStage });

    const result = await SensorReading.aggregate(pipeline);

    if (result.length === 0) {
      return next(createHttpError(404, "No sensor readings found for the given range"));
    }

    const { _id, count, ...stats } = result[0];

    // reshape flat {field_min, field_max, field_avg} into {field: {min, max, avg}}
    const shaped = {};
    fields.forEach((f) => {
      shaped[f] = {
        min: stats[`${f}_min`],
        max: stats[`${f}_max`],
        avg: stats[`${f}_avg`] != null ? Number(stats[`${f}_avg`].toFixed(2)) : null,
      };
    });

    res.status(200).json({
      success: true,
      message: "Sensor stats computed",
      count,
      data: shaped,
    });
  } catch (err) {
    next(createHttpError(500, "Failed to compute sensor stats"));
  }
};

export { getLatestReading, getHistory, getStats };