import nodemailer from "nodemailer";

export async function POST(req) {
  try {
    const body = await req.json();

    // Support BOTH payload styles:
    // - { to, subject, message }
    // - { toEmail, subject, message }
    const to = (body.to || body.toEmail || "").trim();
    const subject = (body.subject || "").trim();
    const message = (body.message || "").trim();

    if (!to || !subject || !message) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing to/subject/message" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ STAGING SAFETY: allowlist emails in staging (Preview on Vercel)
    // Set in Vercel Preview env:
    // APP_ENV=staging
    // TEST_EMAIL_ALLOWLIST=pyikpotey@gmail.com,another@test.com
    const appEnv = process.env.APP_ENV || "production";
    if (appEnv === "staging") {
      const allow = (process.env.TEST_EMAIL_ALLOWLIST || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const toLower = to.toLowerCase();
      if (allow.length > 0 && !allow.includes(toLower)) {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: true,
            reason: "staging_allowlist_block",
            to,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // ✅ Validate SMTP credentials early (gives clearer error than nodemailer)
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpUser || !smtpPass) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "SMTP credentials missing. Set SMTP_USER and SMTP_PASS.",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || "true") === "true",
      auth: { user: smtpUser, pass: smtpPass },
    });

    const fromName = process.env.MAIL_FROM_NAME || "Rental System";
    const fromEmail = process.env.MAIL_FROM_EMAIL || smtpUser;

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text: message,
      html: `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; white-space: pre-wrap;">${escapeHtml(
        message
      )}</pre>`,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        messageId: info.messageId,
        accepted: info.accepted || [],
        rejected: info.rejected || [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Notify error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}