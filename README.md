# Cloudflare Mail Worker

A small, UI-free email API for Cloudflare Workers. It sends through Resend's HTTPS API, so no SMTP sockets or mail account password are exposed to callers. The sender address must belong to a verified domain in Resend.

## Configure secrets

Create a Resend API key, verify the sender domain, then from this directory run:

```sh
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAIL_FROM
npx wrangler secret put SEND_TOKEN
```

`MAIL_FROM` can be a bare address or a display name, for example `TrendRadar <reports@example.com>`. `SEND_TOKEN` is a long random value required by every send request. Do not put it in a URL: URLs can be retained in browser, proxy, and server logs. The Worker accepts it only as `Authorization: Bearer ...`.

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
- All send requests require the `Authorization: Bearer <SEND_TOKEN>` header.
- Recipients, subject, and message bodies are validated; each text/HTML body is limited to 200,000 characters.

Keep the Worker URL private where practical, rotate `SEND_TOKEN` if it is exposed, and do not expose the Resend API key. Consider Cloudflare Access or a rate limiting rule for a production endpoint.
