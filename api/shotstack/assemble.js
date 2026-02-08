const { assemble } = require("../../lib/assemble");

const LOG_PREFIX = "[shotstack/assemble]";

function log(level, msg, data = {}) {
  const entry = { timestamp: new Date().toISOString(), msg, ...data };
  if (level === "error") console.error(LOG_PREFIX, JSON.stringify(entry));
  else console.log(LOG_PREFIX, JSON.stringify(entry));
}

/**
 * Converts flat request body to nested { inputs, alignment, constants } shape.
 * Accepts either flat (top-level keys) or nested (body.inputs) format.
 */
function normalizeBody(body) {
  if (body && typeof body.inputs === "object" && body.inputs !== null) {
    return body;
  }
  const flat = body || {};
  const walkthroughFootages = flat.walkthrough_footages ?? flat.walthrough_footages;
  return {
    inputs: {
      brand_logo_url: flat.brand_logo_url,
      property_address_url: flat.property_address_url,
      avatar_intro_video: {
        url: flat.avatar_intro_video_url,
        duration: flat.avatar_intro_video_duration,
      },
      avatar_cta_video: {
        url: flat.avatar_cta_video_url,
        duration: flat.avatar_cta_video_duration,
      },
      walkthrough_voiceover: {
        url: flat.walkthrough_voiceover_url,
        public_url: flat.walkthrough_voiceover_url,
        audio_duration_seconds: flat.walkthrough_voiceover_duration,
      },
      walkthrough_footages: (Array.isArray(walkthroughFootages) ? walkthroughFootages : []).map((f) =>
        typeof f === "object" && f !== null
          ? { ...f, video_url: f.video_url ?? f.url }
          : f
      ),
      transcription: Array.isArray(flat.transcription) ? flat.transcription : flat.transcription ?? [],
    },
    alignment: flat.alignment ?? {},
    constants: flat.constants ?? {},
  };
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
    const normalizedBody = normalizeBody(body);
    const result = assemble(normalizedBody);

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
