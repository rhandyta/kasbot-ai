const metrics = {
  counters: {
    http_requests: 0,
    http_errors: 0,
    bot_messages: 0,
    ocr_requests: 0,
    ocr_timeouts: 0,
    ocr_errors: 0,
    ai_requests: 0,
    ai_cache_hits: 0,
    ai_errors: 0,
    db_errors: 0,
  },
  gauges: {
    last_ocr_ms: 0,
    last_ai_ms: 0,
  },
};

function inc(name, by = 1) {
  if (metrics.counters[name] === undefined) metrics.counters[name] = 0;
  metrics.counters[name] += by;
}

function setGauge(name, value) {
  metrics.gauges[name] = value;
}

async function time(name, fn) {
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    setGauge(name, Math.round(elapsedMs));
  }
}

module.exports = { metrics, inc, setGauge, time };
