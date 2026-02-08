// ----------------------------- Helpers -----------------------------

function r3(n) {
  return Math.round(n * 1000) / 1000;
}

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function trimUrl(u) {
  if (typeof u !== "string") return u;
  return u.trim().replace(/,+$/, "");
}

function clipEnd(c) {
  return c.start + c.length;
}

function overlaps(a0, a1, b0, b1) {
  return Math.max(a0, b0) < Math.min(a1, b1);
}

const DEFAULT_CONSTANTS = Object.freeze({
  OPEN_LOGO_LENGTH: 1.5,
  OPEN_PROPERTY_LENGTH: 3.0,
  OPEN_OVERLAP: 1.0,
  WALK_XFADE: 1.0,
  CTA_TO_LOGO_OVERLAP: 1.0,
  CLOSE_LOGO_LENGTH: 3.0,
});

// ----------------------------- Normalizer -----------------------------

function normalizeInputs(raw) {
  const errors = [];
  const warnings = [];

  const input = raw && typeof raw === "object" ? JSON.parse(JSON.stringify(raw)) : {};

  const required = [
    "brand_logo_url",
    "property_address_url",
    "avatar_intro_video",
    "avatar_cta_video",
    "walkthrough_voiceover",
    "walkthrough_footages",
    "transcription",
  ];

  for (const k of required) {
    if (!(k in input)) errors.push({ code: "MISSING_FIELD", path: `inputs.${k}`, message: `Missing ${k}` });
  }
  if (errors.length) return { ok: false, errors, warnings, normalized: null };

  input.brand_logo_url = trimUrl(input.brand_logo_url);
  input.property_address_url = trimUrl(input.property_address_url);

  input.avatar_intro_video = input.avatar_intro_video || {};
  input.avatar_intro_video.url = trimUrl(input.avatar_intro_video.url);
  input.avatar_intro_video.duration = toNumber(input.avatar_intro_video.duration);

  input.avatar_cta_video = input.avatar_cta_video || {};
  input.avatar_cta_video.url = trimUrl(input.avatar_cta_video.url);
  input.avatar_cta_video.duration = toNumber(input.avatar_cta_video.duration);

  input.walkthrough_voiceover = input.walkthrough_voiceover || {};
  if (!input.walkthrough_voiceover.public_url && input.walkthrough_voiceover.url) {
    input.walkthrough_voiceover.public_url = input.walkthrough_voiceover.url;
    warnings.push({ code: "COPIED_PUBLIC_URL", path: "inputs.walkthrough_voiceover.public_url", message: "Copied from url" });
  }
  input.walkthrough_voiceover.public_url = trimUrl(input.walkthrough_voiceover.public_url);
  input.walkthrough_voiceover.audio_duration_seconds = toNumber(input.walkthrough_voiceover.audio_duration_seconds);

  if (!isFiniteNumber(input.avatar_intro_video.duration)) errors.push({ code: "BAD_NUMBER", path: "inputs.avatar_intro_video.duration", message: "Must be a number" });
  if (!isFiniteNumber(input.avatar_cta_video.duration)) errors.push({ code: "BAD_NUMBER", path: "inputs.avatar_cta_video.duration", message: "Must be a number" });
  if (!isFiniteNumber(input.walkthrough_voiceover.audio_duration_seconds)) errors.push({ code: "BAD_NUMBER", path: "inputs.walkthrough_voiceover.audio_duration_seconds", message: "Must be a number" });

  if (!Array.isArray(input.walkthrough_footages)) {
    errors.push({ code: "BAD_TYPE", path: "inputs.walkthrough_footages", message: "Must be array" });
  } else {
    input.walkthrough_footages = input.walkthrough_footages.map((f, i) => {
      const out = Object.assign({}, f);
      out.video_url = trimUrl(out.video_url);
      out.duration = isFiniteNumber(toNumber(out.duration)) ? toNumber(out.duration) : 5.0;
      if (!f.id) warnings.push({ code: "MISSING_ID", path: `inputs.walkthrough_footages[${i}].id`, message: "Missing id" });
      return out;
    });
  }

  if (!Array.isArray(input.transcription)) {
    errors.push({ code: "BAD_TYPE", path: "inputs.transcription", message: "Must be array" });
  } else {
    input.transcription = input.transcription.map((w, i) => {
      const out = Object.assign({}, w);
      out.start = toNumber(out.start);
      out.end = toNumber(out.end);
      if (!isFiniteNumber(out.start) || !isFiniteNumber(out.end)) {
        errors.push({ code: "BAD_NUMBER", path: `inputs.transcription[${i}]`, message: "start/end must be numbers (ms)" });
      }
      return out;
    });
  }

  if (errors.length) return { ok: false, errors, warnings, normalized: null };
  return { ok: true, errors: [], warnings, normalized: input };
}

// ----------------------------- Alignment merger (fallback fill) -----------------------------

function buildSegmentWindows(inputs, alignment) {
  const footages = inputs.walkthrough_footages;
  const audioDur = inputs.walkthrough_voiceover.audio_duration_seconds;

  const byId = new Map();
  if (alignment && Array.isArray(alignment.segment_windows)) {
    for (const s of alignment.segment_windows) {
      if (s && typeof s.id === "string") byId.set(s.id, s);
    }
  }

  let lastKnownEnd = 0.0;

  const windows = footages.map((f, idx) => {
    const s = byId.get(f.id) || null;

    let startSec = s && isFiniteNumber(toNumber(s.segment_start_sec)) ? toNumber(s.segment_start_sec) : null;
    let endSec = s && isFiniteNumber(toNumber(s.segment_end_sec)) ? toNumber(s.segment_end_sec) : null;

    const ok = startSec != null && endSec != null && endSec >= startSec;

    if (!ok) {
      const remainingTime = Math.max(0, audioDur - lastKnownEnd);
      const remainingSegments = footages.length - idx;
      const est = remainingSegments > 0 ? remainingTime / remainingSegments : 0.5;

      startSec = lastKnownEnd;
      endSec = startSec + est;
    }

    startSec = Math.max(0, Math.min(startSec, audioDur));
    endSec = Math.max(startSec, Math.min(endSec, audioDur));

    lastKnownEnd = endSec;

    return {
      id: f.id,
      segment_start_sec: r3(startSec),
      segment_end_sec: r3(endSec),
    };
  });

  return windows;
}

// ----------------------------- Planning -----------------------------

function planOpener(inputs, constants) {
  const c = Object.assign({}, DEFAULT_CONSTANTS, constants || {});
  const logoStart = 0.0;
  const propStart = c.OPEN_LOGO_LENGTH - c.OPEN_OVERLAP;
  const introStart = (propStart + c.OPEN_PROPERTY_LENGTH) - c.OPEN_OVERLAP;

  const introLen = inputs.avatar_intro_video.duration;

  const INTRO_END = introStart + introLen;
  const VO_START = INTRO_END;

  return {
    opener_plan: {
      logo: {
        track: 1,
        start: r3(logoStart),
        length: r3(c.OPEN_LOGO_LENGTH),
        asset: { type: "image", src: inputs.brand_logo_url },
        transition: { in: "fade", out: "fade" },
      },
      property: {
        track: 2,
        start: r3(propStart),
        length: r3(c.OPEN_PROPERTY_LENGTH),
        asset: { type: "image", src: inputs.property_address_url },
        transition: { in: "fade", out: "fade" },
      },
      intro: {
        track: 1,
        start: r3(introStart),
        length: r3(introLen),
        asset: { type: "video", src: inputs.avatar_intro_video.url },
        transition: { in: "fade", out: "fade" },
      },
    },
    INTRO_END: r3(INTRO_END),
    VO_START: r3(VO_START),
  };
}

function planWalkthrough(inputs, VO_START, segmentWindows, constants) {
  const c = Object.assign({}, DEFAULT_CONSTANTS, constants || {});
  const audioDur = inputs.walkthrough_voiceover.audio_duration_seconds;
  const VO_END = VO_START + audioDur;

  const plan = [];
  let prevEnd = null;

  for (let i = 0; i < inputs.walkthrough_footages.length; i++) {
    const f = inputs.walkthrough_footages[i];
    const seg = segmentWindows[i];

    const ABS_SEG_START = VO_START + seg.segment_start_sec;
    const ABS_SEG_END = VO_START + seg.segment_end_sec;

    let start, end;
    if (i === 0) {
      start = Math.max(VO_START - c.WALK_XFADE, ABS_SEG_START);
      end = ABS_SEG_END + c.WALK_XFADE / 2;
    } else {
      start = prevEnd - c.WALK_XFADE;
      end = ABS_SEG_END + c.WALK_XFADE / 2;
    }

    const isLast = i === inputs.walkthrough_footages.length - 1;
    if (isLast) end = VO_END;

    let requiredLen = end - start;

    const track = i % 2 === 0 ? 1 : 2;

    const sourceDur = f.duration || 5.0;
    const asset = { type: "video", src: f.video_url, volume: 0 };

    if (requiredLen > sourceDur) {
      let speed = sourceDur / requiredLen;
      if (speed < 0.5) {
        speed = 0.5;
        requiredLen = sourceDur / speed;
        end = start + requiredLen;
      }
      asset.speed = r3(speed);
    }

    const transition = isLast ? { in: "fade" } : { in: "fade", out: "fade" };

    plan.push({
      id: f.id,
      track,
      start: r3(start),
      length: r3(requiredLen),
      asset,
      transition,
    });

    prevEnd = end;
  }

  return {
    VO_END: r3(VO_END),
    walkthrough_plan: plan,
    last_walkthrough_track: plan.length ? plan[plan.length - 1].track : 1,
  };
}

function planOutro(inputs, VO_END, lastWalkTrack, constants) {
  const c = Object.assign({}, DEFAULT_CONSTANTS, constants || {});
  const CTA_START = VO_END;
  const CTA_LEN = inputs.avatar_cta_video.duration;

  const ctaTrack = lastWalkTrack === 1 ? 2 : 1;
  const logoTrack = ctaTrack === 1 ? 2 : 1;

  return {
    CTA_START: r3(CTA_START),
    cta_plan: {
      track: ctaTrack,
      start: r3(CTA_START),
      length: r3(CTA_LEN),
      asset: { type: "video", src: inputs.avatar_cta_video.url },
    },
    closing_logo_plan: {
      track: logoTrack,
      start: r3(CTA_START + CTA_LEN - c.CTA_TO_LOGO_OVERLAP),
      length: r3(c.CLOSE_LOGO_LENGTH),
      asset: { type: "image", src: inputs.brand_logo_url },
      transition: { in: "fade", out: "fade" },
    },
  };
}

function compileShotstack(inputs, opener, walkthrough, outro) {
  const t1 = [];
  const t2 = [];
  const t3 = [];

  t1.push({ start: opener.opener_plan.logo.start, length: opener.opener_plan.logo.length, asset: opener.opener_plan.logo.asset, transition: opener.opener_plan.logo.transition });
  t2.push({ start: opener.opener_plan.property.start, length: opener.opener_plan.property.length, asset: opener.opener_plan.property.asset, transition: opener.opener_plan.property.transition });
  t1.push({ start: opener.opener_plan.intro.start, length: opener.opener_plan.intro.length, asset: opener.opener_plan.intro.asset, transition: opener.opener_plan.intro.transition });

  for (const c of walkthrough.walkthrough_plan) {
    const clip = { start: c.start, length: c.length, asset: c.asset };
    if (c.transition) clip.transition = c.transition;
    if (c.track === 1) t1.push(clip);
    else t2.push(clip);
  }

  const ctaClip = { start: outro.cta_plan.start, length: outro.cta_plan.length, asset: outro.cta_plan.asset };
  const closeClip = { start: outro.closing_logo_plan.start, length: outro.closing_logo_plan.length, asset: outro.closing_logo_plan.asset, transition: outro.closing_logo_plan.transition };

  if (outro.cta_plan.track === 1) t1.push(ctaClip);
  else t2.push(ctaClip);

  if (outro.closing_logo_plan.track === 1) t1.push(closeClip);
  else t2.push(closeClip);

  t3.push({
    start: opener.VO_START,
    length: inputs.walkthrough_voiceover.audio_duration_seconds,
    asset: { type: "audio", src: inputs.walkthrough_voiceover.public_url },
  });

  t1.sort((a, b) => a.start - b.start);
  t2.sort((a, b) => a.start - b.start);

  return {
    timeline: {
      background: "#000000",
      tracks: [{ clips: t1 }, { clips: t2 }, { clips: t3 }],
    },
    output: { format: "mp4", resolution: "hd" },
  };
}

// ----------------------------- Validator -----------------------------

function validateShotstack(inputs, payload, options) {
  const eps = options && isFiniteNumber(options.epsSeconds) ? options.epsSeconds : 0.001;
  const errors = [];
  const add = (code, path, message) => errors.push({ code, path, message });

  const nearEq = (a, b) => Math.abs(a - b) <= eps;

  if (!payload || typeof payload !== "object") {
    add("SCHEMA_BAD_TYPE", "payload", "Payload must be object");
    return { ok: false, errors };
  }

  const tracks = payload.timeline && payload.timeline.tracks;
  if (!Array.isArray(tracks) || tracks.length !== 3) {
    add("SCHEMA_BAD_TRACKS", "payload.timeline.tracks", "tracks must be array length 3");
    return { ok: false, errors };
  }

  const INTRO_URL = inputs.avatar_intro_video.url;
  const CTA_URL = inputs.avatar_cta_video.url;
  const VO_URL = inputs.walkthrough_voiceover.public_url;

  const allClips = [];
  for (let ti = 0; ti < 3; ti++) {
    const t = tracks[ti];
    if (!t || !Array.isArray(t.clips)) {
      add("SCHEMA_BAD_TRACK", `payload.timeline.tracks[${ti}]`, "Track clips must be array");
      continue;
    }
    for (let ci = 0; ci < t.clips.length; ci++) {
      const c = t.clips[ci];
      allClips.push({ c, ti, ci });
    }
  }

  const intro = allClips.find((x) => x.c && x.c.asset && x.c.asset.type === "video" && x.c.asset.src === INTRO_URL);
  const cta = allClips.find((x) => x.c && x.c.asset && x.c.asset.type === "video" && x.c.asset.src === CTA_URL);
  const audio = allClips.find((x) => x.c && x.c.asset && x.c.asset.type === "audio" && x.c.asset.src === VO_URL);

  if (!intro) add("INTRO_NOT_FOUND", "inputs.avatar_intro_video.url", "Intro clip not found in payload (exact URL match required)");
  if (!cta) add("CTA_NOT_FOUND", "inputs.avatar_cta_video.url", "CTA clip not found in payload (exact URL match required)");
  if (!audio) add("AUDIO_NOT_FOUND", "inputs.walkthrough_voiceover.public_url", "Audio clip not found in payload (exact URL match required)");

  if (intro && audio) {
    const introEnd = intro.c.start + intro.c.length;
    if (!nearEq(audio.c.start, introEnd)) add("VO_START_MISMATCH", "payload.timeline.tracks[2].clips[0].start", "VO_START must equal INTRO_END within tolerance");
  }

  if (audio && cta) {
    const voEnd = audio.c.start + audio.c.length;
    if (!nearEq(cta.c.start, voEnd)) add("CTA_START_MISMATCH", `payload.timeline.tracks[${cta.ti}].clips[${cta.ci}].start`, "CTA.start must equal VO_END within tolerance");
  }

  for (let ti = 0; ti < 2; ti++) {
    const sorted = (tracks[ti].clips || []).slice().sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].start + sorted[i - 1].length - eps) {
        add(ti === 0 ? "COLLISION_TRACK_1" : "COLLISION_TRACK_2", `payload.timeline.tracks[${ti}]`, "Collision detected within same track");
        break;
      }
    }
  }

  const footageUrls = inputs.walkthrough_footages.map((f) => f.video_url);
  const videoClips = allClips.filter((x) => x.c && x.c.asset && x.c.asset.type === "video");

  const walkClips = videoClips.filter((x) => x.c.asset.src !== INTRO_URL && x.c.asset.src !== CTA_URL);

  if (walkClips.length !== footageUrls.length) {
    add("WALKTHROUGH_COUNT_MISMATCH", "inputs.walkthrough_footages", `Payload walkthrough clips=${walkClips.length} but inputs=${footageUrls.length}`);
  }

  for (const x of walkClips) {
    if (footageUrls.indexOf(x.c.asset.src) === -1) {
      add("WALKTHROUGH_URL_NOT_IN_INPUTS", `payload.timeline.tracks[${x.ti}].clips[${x.ci}].asset.src`, "Walkthrough src not found in inputs.walkthrough_footages[].video_url");
    }
  }

  const seen = new Set(walkClips.map((x) => x.c.asset.src));
  for (let i = 0; i < footageUrls.length; i++) {
    if (!seen.has(footageUrls[i])) {
      add("WALKTHROUGH_ASSET_NOT_FOUND", `inputs.walkthrough_footages[${i}].video_url`, "Expected footage URL not found among walkthrough clips");
    }
  }

  if (cta) {
    const ctaStart = cta.c.start;
    const walksBeforeCTA = walkClips.filter((x) => x.c.start < ctaStart);
    if (walksBeforeCTA.length) {
      let last = walksBeforeCTA[0];
      for (const x of walksBeforeCTA) {
        if (x.c.start + x.c.length > last.c.start + last.c.length) last = x;
      }
      if (last.c.transition && last.c.transition.out) {
        add("LAST_WALK_HAS_FADE_OUT", `payload.timeline.tracks[${last.ti}].clips[${last.ci}].transition.out`, "Last walkthrough must hard cut to CTA (no fade-out)");
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ----------------------------- Logging -----------------------------

const LOG_PREFIX = "[assemble]";

function logStep(step, data) {
  console.log(LOG_PREFIX, step, JSON.stringify(data));
}

// ----------------------------- Assemble (single entry) -----------------------------

function assemble(body) {
  const rawInputs = body.inputs;
  const alignment = body.alignment || {};
  const constants = body.constants || {};

  const norm = normalizeInputs(rawInputs);
  if (!norm.ok) {
    logStep("normalize_failed", { errorCount: norm.errors.length, codes: norm.errors.map((e) => e.code) });
    return { ok: false, status: 400, errors: norm.errors, warnings: norm.warnings };
  }

  const inputs = norm.normalized;
  const segmentWindows = buildSegmentWindows(inputs, alignment);
  logStep("segment_windows", { count: segmentWindows.length, ids: segmentWindows.map((s) => s.id) });

  const opener = planOpener(inputs, constants);
  const walkthrough = planWalkthrough(inputs, opener.VO_START, segmentWindows, constants);
  const outro = planOutro(inputs, walkthrough.VO_END, walkthrough.last_walkthrough_track, constants);

  const payload = compileShotstack(inputs, opener, walkthrough, outro);

  const check = validateShotstack(inputs, payload, { epsSeconds: 0.001 });
  if (!check.ok) {
    logStep("validate_failed", { errorCount: check.errors.length, codes: check.errors.map((e) => e.code) });
    return {
      ok: false,
      status: 422,
      errors: check.errors,
      debug: {
        VO_START: opener.VO_START,
        VO_END: walkthrough.VO_END,
        CTA_START: outro.CTA_START,
      },
    };
  }

  logStep("assemble_ok", { VO_START: opener.VO_START, VO_END: walkthrough.VO_END, CTA_START: outro.CTA_START });
  return {
    ok: true,
    payload,
    debug: {
      VO_START: opener.VO_START,
      VO_END: walkthrough.VO_END,
      CTA_START: outro.CTA_START,
      segment_windows: segmentWindows,
      warnings: norm.warnings,
    },
  };
}

module.exports = {
  normalizeInputs,
  buildSegmentWindows,
  planOpener,
  planWalkthrough,
  planOutro,
  compileShotstack,
  validateShotstack,
  assemble,
};
