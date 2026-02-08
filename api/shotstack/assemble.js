const { assemble } = require("../../lib/assemble");

module.exports = function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      errors: [{ code: "METHOD_NOT_ALLOWED", path: "", message: "Only POST is allowed" }],
    });
  }

  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const result = assemble(body);

    if (!result.ok) {
      return res.status(result.status || 400).json({
        ok: false,
        errors: result.errors,
        ...(result.warnings && { warnings: result.warnings }),
        ...(result.debug && { debug: result.debug }),
      });
    }

    return res.status(200).json({
      ok: true,
      payload: result.payload,
      debug: result.debug,
    });
  } catch (e) {
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
