const RESEND_API_URL = "https://api.resend.com/emails";
const MAX_REQUEST_BYTES = 15 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const MAX_RECIPIENTS = 10;
const MAX_BODY_CHARS = 200_000;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(providedHash);
  const b = new Uint8Array(expectedHash);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

function normalizeRecipients(value, fieldName = "to") {
  const values = Array.isArray(value) ? value : [value];
  const addresses = values
    .flatMap((part) => String(part ?? "").split(","))
    .map((address) => address.trim())
    .filter(Boolean);
  if (!addresses.length || addresses.length > MAX_RECIPIENTS) {
    throw new HttpError(`${fieldName} must contain 1-${MAX_RECIPIENTS} addresses`, 400);
  }
  for (const address of addresses) {
    if (address.length > 254 || /[\r\n<>]/.test(address) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      throw new HttpError(`Invalid email address in ${fieldName}`, 400);
    }
  }
  return addresses;
}

function cleanHeader(value, fieldName, maxLength) {
  const result = String(value ?? "").trim();
  if (!result || result.length > maxLength || /[\r\n\0]/.test(result)) {
    throw new HttpError(`Invalid ${fieldName}`, 400);
  }
  return result;
}

function optionalRecipients(value, fieldName) {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeRecipients(value, fieldName);
}

function sanitizeFilename(filename) {
  const result = String(filename ?? "")
    .replace(/[\\/\r\n\0"]/g, "_")
    .trim();
  if (!result || result.length > 255) throw new HttpError("Invalid attachment filename", 400);
  return result;
}

function decodedBase64Size(content) {
  if (typeof content !== "string" || !content.length || content.length % 4 !== 0) {
    throw new HttpError("Attachment content must be standard Base64", 400);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
    throw new HttpError("Attachment content must be standard Base64", 400);
  }
  const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
  return (content.length / 4) * 3 - padding;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function normalizeJsonAttachments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError("attachments must be an array", 400);
  if (value.length > MAX_ATTACHMENTS) throw new HttpError(`Maximum ${MAX_ATTACHMENTS} attachments`, 400);

  let totalBytes = 0;
  return value.map((attachment) => {
    if (!attachment || typeof attachment !== "object") throw new HttpError("Invalid attachment", 400);
    const content = attachment.content_base64 ?? attachment.content;
    const size = decodedBase64Size(content);
    totalBytes += size;
    if (totalBytes > MAX_ATTACHMENT_BYTES) throw new HttpError("Attachments exceed the 10 MiB total limit", 413);
    return {
      filename: sanitizeFilename(attachment.filename),
      content,
      content_type: String(attachment.content_type ?? "application/octet-stream").slice(0, 127),
    };
  });
}

async function normalizeFormAttachments(form) {
  const files = [...form.getAll("attachment"), ...form.getAll("attachments")]
    .filter((value) => value && typeof value.arrayBuffer === "function" && typeof value.name === "string");
  if (files.length > MAX_ATTACHMENTS) throw new HttpError(`Maximum ${MAX_ATTACHMENTS} attachments`, 400);

  let totalBytes = 0;
  const attachments = [];
  for (const file of files) {
    totalBytes += file.size;
    if (totalBytes > MAX_ATTACHMENT_BYTES) throw new HttpError("Attachments exceed the 10 MiB total limit", 413);
    attachments.push({
      filename: sanitizeFilename(file.name),
      content: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      content_type: (file.type || "application/octet-stream").slice(0, 127),
    });
  }
  return attachments;
}

function formValue(form, key) {
  const value = form.get(key);
  return value === null ? undefined : String(value);
}

async function readMessage(request, url) {
  if (request.method === "GET") {
    return {
      to: url.searchParams.get("to"),
      cc: url.searchParams.get("cc") ?? undefined,
      bcc: url.searchParams.get("bcc") ?? undefined,
      reply_to: url.searchParams.get("reply_to") ?? undefined,
      subject: url.searchParams.get("subject"),
      text: url.searchParams.get("text") ?? undefined,
      html: url.searchParams.get("html") ?? undefined,
      attachments: [],
    };
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) throw new HttpError("Request exceeds the 15 MiB limit", 413);

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) {
      throw new HttpError("Request exceeds the 15 MiB limit", 413);
    }
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new HttpError("Request body must be valid JSON", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError("Request body must be a JSON object", 400);
    return { ...body, attachments: await normalizeJsonAttachments(body.attachments) };
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return {
      to: formValue(form, "to"),
      cc: formValue(form, "cc"),
      bcc: formValue(form, "bcc"),
      reply_to: formValue(form, "reply_to"),
      subject: formValue(form, "subject"),
      text: formValue(form, "text"),
      html: formValue(form, "html"),
      attachments: await normalizeFormAttachments(form),
    };
  }

  throw new HttpError("POST requires application/json or multipart/form-data", 415);
}

function buildPayload(message, from) {
  const to = normalizeRecipients(message.to);
  const subject = cleanHeader(message.subject, "subject", 255);
  const text = message.text === undefined ? undefined : String(message.text);
  const html = message.html === undefined ? undefined : String(message.html);
  if ((!text || !text.trim()) && (!html || !html.trim())) {
    throw new HttpError("Provide non-empty text or html content", 400);
  }
  if ((text?.length || 0) > MAX_BODY_CHARS || (html?.length || 0) > MAX_BODY_CHARS) {
    throw new HttpError("Email content exceeds the 200,000 character limit", 413);
  }

  const payload = { from, to, subject };
  if (text !== undefined) payload.text = text;
  if (html !== undefined) payload.html = html;
  for (const field of ["cc", "bcc"]) {
    const recipients = optionalRecipients(message[field], field);
    if (recipients) payload[field] = recipients;
  }
  if (message.reply_to) payload.reply_to = normalizeRecipients(message.reply_to, "reply_to");
  if (message.attachments?.length) payload.attachments = message.attachments;
  return payload;
}

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function handleSend(request, env, url) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const queryToken = request.method === "GET" ? url.searchParams.get("token") : null;
  if (!(await tokenMatches(match?.[1] ?? queryToken, env.SEND_TOKEN))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    return jsonResponse({ error: "Worker is missing mail provider configuration" }, 500);
  }

  try {
    const message = await readMessage(request, url);
    const payload = buildPayload(message, env.MAIL_FROM);
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return jsonResponse({ error: "Email provider rejected the request", status: response.status, details: result.message || result.name || "Unknown provider error" }, 502);
    }
    return jsonResponse({ ok: true, id: result.id });
  } catch (error) {
    if (error instanceof HttpError) return jsonResponse({ error: error.message }, error.status);
    return jsonResponse({ error: "Failed to send email" }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ ok: true, service: "cloudflare-mail-worker" });
    }
    if (url.pathname !== "/send") return jsonResponse({ error: "Not found" }, 404);
    if (request.method !== "GET" && request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    return handleSend(request, env, url);
  },
};

export { buildPayload, decodedBase64Size, readMessage };
