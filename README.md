# Cloudflare Mail Worker

[简体中文](README.zh-CN.md) | English

A small, UI-free email API for Cloudflare Workers. It sends through Resend's HTTPS API, so no SMTP sockets or mail account password are exposed to callers. The sender address must belong to a verified domain in Resend.

## Configure secrets

Create a Resend API key, verify the sender domain, then from this directory run:

```sh
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAIL_FROM
npx wrangler secret put SEND_TOKEN
```

`MAIL_FROM` can be a bare address or a display name, for example `TrendRadar <reports@example.com>`. `SEND_TOKEN` is a long random value required by every send request. For command-line or programmatic requests, send it as an `Authorization: Bearer YOUR_SEND_TOKEN` header. For a short email sent directly from a browser address bar, a GET request can instead include `token=YOUR_SEND_TOKEN` in the URL. URL tokens can be retained in browser history, proxy, and server logs, so use this option only if you accept that risk.

Deploy:

```sh
npm install
npx wrangler login
npx wrangler deploy
```

Use `npx wrangler dev` locally. Put local-only secrets in `.dev.vars` (already ignored by Git):

```dotenv
RESEND_API_KEY=re_...
MAIL_FROM=TrendRadar <reports@example.com>
SEND_TOKEN=replace-with-a-long-random-value
```

## Send without attachments

Simple GET endpoint:

```sh
curl -G 'https://YOUR-WORKER.workers.dev/send' \
  -H 'Authorization: Bearer YOUR_SEND_TOKEN' \
  --data-urlencode 'to=person@example.net' \
  --data-urlencode 'subject=Hello from TrendRadar' \
  --data-urlencode 'text=The report is ready.'
```

`to` accepts comma-separated recipients (up to 10). Optional parameters: `cc`, `bcc`, `reply_to`, and `html`. At least one of `text` or `html` is required. URL query parameters are suitable for short messages; use POST for longer content.

To send a short email directly from a browser, replace the worker URL, token, recipient, and message in this link and open it in the address bar:

```text
https://YOUR-WORKER.workers.dev/send?token=YOUR_SEND_TOKEN&to=person%40example.net&subject=Hello&text=The%20report%20is%20ready.
```

## Send with attachments

Multipart form upload (repeat `attachment` for multiple files):

```sh
curl 'https://YOUR-WORKER.workers.dev/send' \
  -H 'Authorization: Bearer YOUR_SEND_TOKEN' \
  -F 'to=person@example.net' \
  -F 'subject=Report with attachment' \
  -F 'text=Please see the attached report.' \
  -F 'attachment=@./report.pdf'
```

JSON is also supported. Each attachment uses standard Base64:

```json
{
  "to": "person@example.net",
  "subject": "Report with attachment",
  "text": "Please see the attached report.",
  "attachments": [
    {
      "filename": "report.txt",
      "content_base64": "SGVsbG8gZnJvbSBUcmVuZFJhZGFyIQ==",
      "content_type": "text/plain"
    }
  ]
}
```

Send the JSON with `Content-Type: application/json` and the same Bearer authorization header. The service allows up to 5 attachments and 10 MiB total raw attachment data per email, below Resend's documented 40 MB limit after Base64 encoding.

## Endpoints and limits

- `GET /health`: unauthenticated liveness check; it does not send mail.
- `GET /send`: send a short text or HTML email using query parameters.
- `POST /send`: send JSON or `multipart/form-data`, including attachments.
- All send requests require a token. Use the `Authorization: Bearer YOUR_SEND_TOKEN` header for POST requests and programmatic calls; browser GET requests may use the `token` query parameter instead.
- Recipients, subject, and message bodies are validated; each text/HTML body is limited to 200,000 characters.

Keep the Worker URL private where practical, rotate `SEND_TOKEN` if it is exposed, and do not expose the Resend API key. Consider Cloudflare Access or a rate limiting rule for a production endpoint.
