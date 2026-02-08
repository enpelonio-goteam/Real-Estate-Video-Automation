const { assemble } = require("../../lib/assemble");

const LOG_PREFIX = "[shotstack/assemble]";

function log(level, msg, data = {}) {
  const entry = { timestamp: new Date().toISOString(), msg, ...data };
  if (level === "error") console.error(LOG_PREFIX, JSON.stringify(entry));
  else console.log(LOG_PREFIX, JSON.stringify(entry));
}

module.exports = function handler(req, res) {
  const body = typeof req.body === "object" && req.body !== null ? req.body : {};
  log("info", "request_start", {
    method: req.method,
    hasBody: !!req.body,
    bodyKeys: Object.keys(body),
    body,
  });

  if (req.method !== "POST") {
    log("info", "rejected_method", { method: req.method });
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      errors: [{ code: "METHOD_NOT_ALLOWED", path: "", message: "Only POST is allowed" }],
    });
  }

  try {
    const result = assemble(body);

    if (!result.ok) {
      log("info", "assemble_failed", {
        status: result.status || 400,
        errorCount: result.errors?.length ?? 0,
        errorCodes: result.errors?.map((e) => e.code) ?? [],
      });
      return res.status(result.status || 400).json({
        ok: false,
        errors: result.errors,
        ...(result.warnings && { warnings: result.warnings }),
        ...(result.debug && { debug: result.debug }),
      });
    }

    const trackSummary = result.payload?.timeline?.tracks?.map((t, i) => ({
      track: i + 1,
      clipCount: t.clips?.length ?? 0,
    }));
    log("info", "assemble_ok", {
      VO_START: result.debug?.VO_START,
      VO_END: result.debug?.VO_END,
      CTA_START: result.debug?.CTA_START,
      trackSummary,
    });
    return res.status(200).json({
      ok: true,
      payload: result.payload,
      debug: result.debug,
    });
  } catch (e) {
    log("error", "internal_error", {
      message: e?.message,
      stack: e?.stack,
    });
    return res.status(500).json({
      ok: false,
      errors: [
        {
          code: "INTERNAL_ERROR",
          path: "",
          message: e && e.message ? e.message : "Unknown error",
        },
      ],
    });
  }
};
