# 用 Cloudflare Worker 发邮件

[简体中文](README.zh-CN.md) | [English](README.md)

这份指南按步骤带你部署邮件服务，并用浏览器链接发送一封短邮件。

## 开始前准备

你需要准备：

1. 一个 Cloudflare 账号。
2. 一个 Resend 账号，以及 Resend API Key。
3. 一个已在 Resend 验证的发件域名。发件邮箱必须使用这个域名，例如 `mail@example.com`。
4. 本项目文件，以及电脑上的 Node.js 和 npm。

## 第一步：登录 Cloudflare

在 PowerShell 打开本项目目录，运行：

```powershell
npx wrangler login --device
```

终端会显示一个网址和一次性验证码。打开网址，确认页面上的验证码和终端一致，然后按网页提示授权。验证码过期或授权失败时，重新运行命令获取新验证码。

## 第二步：保存发件设置

在 PowerShell 中逐条运行下面的命令。每条命令都会提示你输入对应的值：

```powershell
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAIL_FROM
npx wrangler secret put SEND_TOKEN
```

输入内容如下：

- `RESEND_API_KEY`：Resend 网站提供的 API Key。
- `MAIL_FROM`：收件人看到的发件人名称和邮箱，格式为 `名称 <邮箱>`。例如：`每日提醒 <mail@example.com>`。尖括号里的邮箱必须使用你已在 Resend 验证的域名。
- `SEND_TOKEN`：自己设置的一串较长、难猜的文字，例如随机密码。之后每次发送邮件都要用它。请保存好，不要发给别人。

## 第三步：部署邮件服务

在项目目录运行：

```powershell
npm install
npx wrangler deploy
```

部署成功后，终端会显示 Worker 的网址，通常类似：

```text
https://cloudflare-mailer.你的子域.workers.dev
```

把这个网址记下来，后面要用。修改代码后，再运行 `npx wrangler deploy` 即可重新部署。

## 第四步：用浏览器链接发一封短邮件

把下面链接中的示例内容换成自己的，然后复制整行到浏览器地址栏并打开：

```text
https://你的Worker网址/send?token=你的SEND_TOKEN&to=收件人%40example.com&subject=测试邮件&text=这是一封测试邮件
```

例如，假设 Worker 网址是 `https://cloudflare-mailer.example.workers.dev`，收件人是 `alice@example.com`，链接会像这样：

```text
https://cloudflare-mailer.example.workers.dev/send?token=替换成你保存的令牌&to=alice%40example.com&subject=测试邮件&text=你好，这是一封测试邮件。
```

打开链接后，页面显示 `{"ok":true,"id":"..."}` 表示发送成功。每打开一次链接都会发送一封邮件；不要为了查看结果而刷新页面。

链接参数说明：

- `token`：第二步设置的 `SEND_TOKEN`。
- `to`：收件人邮箱。
- `subject`：邮件主题。
- `text`：纯文本邮件内容。

链接中的空格、中文和特殊字符有时需要转换成 URL 编码。收件人邮箱里的 `@` 写成 `%40`。如果邮件内容比较长，或不想把令牌放进链接，请使用下面的请求头方式。

> **安全提醒：** 链接里的令牌、收件人和邮件内容可能保存在浏览器历史记录、代理或服务器日志中。不要分享链接，也不要用于敏感邮件。如果令牌泄露，请重新运行 `npx wrangler secret put SEND_TOKEN` 设置新令牌，然后重新部署。

## 其他发送方式

### 使用 PowerShell 发送短邮件

把网址、令牌和收件人替换成自己的值：

```powershell
$headers = @{ Authorization = "Bearer 你的SEND_TOKEN" }
$url = "https://你的Worker网址/send?to=alice%40example.com&subject=测试邮件&text=你好"
Invoke-RestMethod -Uri $url -Headers $headers
```

### 发送附件

需要上传文件时，在 PowerShell 使用 `curl.exe`，并把 `report.pdf` 换成实际文件路径：

```powershell
curl.exe "https://你的Worker网址/send" `
  -H "Authorization: Bearer 你的SEND_TOKEN" `
  -F "to=alice@example.com" `
  -F "subject=报告" `
  -F "text=请查看附件。" `
  -F "attachment=@report.pdf"
```

也可以通过 POST 发送 JSON。JSON 附件要先转换成 Base64；每个附件提供文件名、Base64 内容和文件类型。

## 本地试运行

在项目根目录创建 `.dev.vars` 文件，填写本地测试用的设置：

```dotenv
RESEND_API_KEY=你的Resend_API_Key
MAIL_FROM=每日提醒 <mail@example.com>
SEND_TOKEN=你自己设置的长随机令牌
```

然后运行：

```powershell
npx wrangler dev
```

本地服务启动后，终端会显示本地网址。把浏览器链接中的 Worker 网址换成本地网址即可测试。`.dev.vars` 已被 Git 忽略，不要把它提交或分享出去。

## 接口和限制

- `GET /health`：检查服务是否在线，不会发送邮件。
- `GET /send`：发送短邮件，可在浏览器地址栏打开链接。
- `POST /send`：发送较长内容或带附件的邮件，支持 JSON 和文件表单。
- 收件人最多 10 个；可用 `cc`、`bcc` 添加抄送和密送，也可用 `reply_to` 设置回复地址。
- 至少填写 `text` 或 `html` 其中一项；每种正文最多 200,000 个字符。
- 每封邮件最多 5 个附件；附件原始内容总量最多 10 MiB。POST 请求体最大 15 MiB。
- 所有发送请求都需要 `SEND_TOKEN`。浏览器链接用 `token` 参数；其他请求建议用 `Authorization` 请求头。

不要公开 Resend API Key 或发送令牌。生产环境可考虑为服务添加访问控制或限流。
