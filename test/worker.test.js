import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = {
  SEND_TOKEN: "test-send-token",
  RESEND_API_KEY: "re_test_key",
  MAIL_FROM: "Reports <reports@example.com>",
};

function request(path, init = {}) {
  return new Request(`https://mailer.example${path}`, init);
}

test("health endpoint is available without mail credentials", async () => {
  const response = await worker.fetch(request("/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "cloudflare-mail-worker" });
});

test("send endpoint requires the bearer token", async () => {
  const response = await worker.fetch(request("/send?to=a%40b.com&subject=x&text=y"), env);
  assert.equal(response.status, 401);
});

test("GET sends an email through the provider API", async (t) => {
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    sent = JSON.parse(init.body);
    return Response.json({ id: "email_123" });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(request(
    "/send?to=a%40example.net&subject=Hello&text=Report",
    { headers: { Authorization: "Bearer test-send-token" } },
  ), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: "email_123" });
  assert.deepEqual(sent.to, ["a@example.net"]);
  assert.equal(sent.from, env.MAIL_FROM);
  assert.equal(sent.subject, "Hello");
  assert.equal(sent.text, "Report");
});

test("GET can send an email using a token in the browser URL", async (t) => {
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ id: "email_browser" });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const params = new URLSearchParams({
    token: env.SEND_TOKEN,
    to: "a@example.net",
    subject: "Browser",
    text: "Sent from the address bar",
  });
  const response = await worker.fetch(request(`/send?${params}`), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: "email_browser" });
  assert.deepEqual(sent.to, ["a@example.net"]);
  assert.equal(sent.subject, "Browser");
  assert.equal(sent.text, "Sent from the address bar");
});

test("multipart uploads become provider Base64 attachments", async (t) => {
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ id: "email_attachment" });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const form = new FormData();
  form.set("to", "a@example.net");
  form.set("subject", "File");
  form.set("text", "Attached.");
  form.set("attachment", new Blob(["hello"]), "hello.txt");
  const response = await worker.fetch(request("/send", {
    method: "POST",
    headers: { Authorization: "Bearer test-send-token" },
    body: form,
  }), env);

  assert.equal(response.status, 200);
  assert.equal(sent.attachments[0].filename, "hello.txt");
  assert.equal(sent.attachments[0].content, "aGVsbG8=");
});

test("invalid addresses are rejected before calling provider", async () => {
  const response = await worker.fetch(request(
    "/send?to=not-an-email&subject=Hello&text=Report",
    { headers: { Authorization: "Bearer test-send-token" } },
  ), env);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Invalid email address/);
});
