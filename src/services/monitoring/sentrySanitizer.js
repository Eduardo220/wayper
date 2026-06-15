const MAX_DEPTH = 10;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 60;
const MAX_STRING_LENGTH = 2000;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SECRET_TEXT_PATTERN =
  /\b(password|senha|refresh[_. -]?token|access[_. -]?token|id[_. -]?token|token|authorization|api[_. -]?key|credential|secret)\b\s*[:=]\s*(?:Bearer\s+[A-Za-z0-9._~+/=-]+|"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;
const PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}\b/g;
const LOCATION_TEXT_PATTERN =
  /\b(latitude|longitude|lat|lng|lon)"?\s*[:=]\s*-?\d{1,3}(?:\.\d+)?/gi;
const COORDINATE_PAIR_PATTERN =
  /-?\d{1,2}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#]+)(?:\?[^\s#]*)?/gi;

const SECRET_KEY_PATTERN =
  /(password|senha|token|refresh.?token|access.?token|id.?token|authorization|cookie|credential|secret|api.?key|firebase.?user|provider.?data|auth.?payload)/i;
const COORDINATE_KEYS = new Set([
  "lat",
  "latitude",
  "lng",
  "lon",
  "longitude",
  "coordinate",
  "coordinates",
  "coords",
]);
const ROUTE_KEYS = new Set([
  "path",
  "rawpath",
  "trustedpath",
  "renderpath",
  "displaypath",
  "route",
  "routepoints",
  "points",
  "segments",
  "geometry",
  "geojson",
  "polyline",
  "zonecoords",
]);
const RAW_PAYLOAD_KEYS = new Set([
  "snapshot",
  "activerun",
  "firebaseuser",
  "ndjson",
  "archive",
  "zip",
  "image",
  "base64",
  "blob",
  "payload",
]);
const IDENTIFIER_KEYS = new Set([
  "runid",
  "localrunid",
  "remoterunid",
  "activerunid",
  "runids",
  "userid",
  "userids",
  "uid",
]);

function normalizedKey(key) {
  return String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function redactString(value) {
  return String(value)
    .replace(URL_QUERY_PATTERN, "$1")
    .replace(SECRET_TEXT_PATTERN, "$1=[redacted_secret]")
    .replace(LOCATION_TEXT_PATTERN, "$1=[redacted_location]")
    .replace(COORDINATE_PAIR_PATTERN, "[redacted_location_pair]")
    .replace(EMAIL_PATTERN, "[redacted_email]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(JWT_PATTERN, "[redacted_token]")
    .replace(PHONE_PATTERN, "[redacted_phone]")
    .slice(0, MAX_STRING_LENGTH);
}

function summarizeRedactedValue(value, label) {
  if (Array.isArray(value)) return `[redacted_${label}:${value.length}]`;
  if (value && typeof value === "object") {
    const count = Object.keys(value).length;
    return `[redacted_${label}:${count}]`;
  }
  return `[redacted_${label}]`;
}

export function anonymizeIdentifier(value, prefix = "anon") {
  const input = String(value || "");
  if (!input) return null;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  const digest = [first, second]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return `${prefix}_${digest}`;
}

function sanitizeError(error, depth) {
  return {
    name: redactString(error?.name || "Error"),
    message: redactString(error?.message || String(error)),
    stack: typeof error?.stack === "string"
      ? redactString(error.stack).slice(0, 8000)
      : undefined,
    cause: error?.cause ? sanitizeValue(error.cause, "cause", depth + 1) : undefined,
  };
}

function sanitizeValue(value, key = "", depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  const keyName = normalizedKey(key);

  if (SECRET_KEY_PATTERN.test(String(key))) return "[redacted_secret]";
  if (COORDINATE_KEYS.has(keyName)) return summarizeRedactedValue(value, "location");
  if (ROUTE_KEYS.has(keyName)) return summarizeRedactedValue(value, "route");
  if (RAW_PAYLOAD_KEYS.has(keyName)) return summarizeRedactedValue(value, "payload");
  if (IDENTIFIER_KEYS.has(keyName)) {
    const prefix = keyName.includes("run") ? "run" : "user";
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((identifier) => anonymizeIdentifier(identifier, prefix));
    }
    return anonymizeIdentifier(value, prefix);
  }

  if (value instanceof Error) return sanitizeError(value, depth);
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (depth >= MAX_DEPTH) return "[max_depth]";

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
  }

  if (Array.isArray(value)) {
    const output = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, key, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      output.push({ truncatedItems: value.length - MAX_ARRAY_ITEMS });
    }
    return output;
  }

  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  const output = {};
  entries.forEach(([entryKey, entryValue]) => {
    output[entryKey] = sanitizeValue(entryValue, entryKey, depth + 1, seen);
  });
  if (Object.keys(value).length > MAX_OBJECT_KEYS) {
    output.truncatedKeys = Object.keys(value).length - MAX_OBJECT_KEYS;
  }
  return output;
}

export function sanitizeSentryContext(context = {}) {
  return sanitizeValue(context, "", 0, new WeakSet()) || {};
}

export function sanitizeSentryBreadcrumb(breadcrumb = {}) {
  const sanitized = sanitizeSentryContext(breadcrumb);
  return {
    ...sanitized,
    message: redactString(sanitized.message || breadcrumb.message || ""),
    data: sanitizeSentryContext(breadcrumb.data || {}),
  };
}

export function sanitizeSentryEvent(event = {}) {
  const sanitized = sanitizeSentryContext(event);

  if (event.user) {
    const safeUserId = String(event.user.id || "").startsWith("anon_")
      ? String(event.user.id)
      : anonymizeIdentifier(event.user.id || event.user.uid, "anon");
    sanitized.user = safeUserId ? { id: safeUserId } : undefined;
  }

  if (Array.isArray(event.breadcrumbs)) {
    sanitized.breadcrumbs = event.breadcrumbs.map(sanitizeSentryBreadcrumb);
  }

  if (event.request) {
    sanitized.request = sanitizeSentryContext({
      method: event.request.method,
      url: event.request.url ? String(event.request.url).split("?")[0] : undefined,
      headers: event.request.headers,
    });
  }

  return sanitized;
}

export default {
  anonymizeIdentifier,
  sanitizeSentryBreadcrumb,
  sanitizeSentryContext,
  sanitizeSentryEvent,
};
