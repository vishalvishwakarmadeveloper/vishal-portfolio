const { Resend } = require('resend');

const NOTIFY_TO = 'vishalkir02@gmail.com';
const FROM_ADDRESS = 'onboarding@resend.dev';

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// Best-effort only: resets on cold start and isn't shared across concurrent
// serverless instances. Fine as a speed bump for a low-traffic portfolio site.
const rateLimitMap = new Map();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getClientIp(req) {
    const forwarded = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return 'unknown';
}

function isRateLimited(ip) {
    const now = Date.now();

    for (const [key, entry] of rateLimitMap) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
            rateLimitMap.delete(key);
        }
    }

    const entry = rateLimitMap.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return false;
    }

    entry.count += 1;
    return entry.count > RATE_LIMIT_MAX;
}

function toTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildNotificationHtml({ name, email, message, submittedAt, ip }) {
    return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #100E1F;">
        <h2 style="color: #7C3AED; margin-bottom: 20px;">New Portfolio Contact Form Submission</h2>
        <table style="width: 100%; border-collapse: collapse;">
            <tr>
                <td style="padding: 8px 0; font-weight: bold; width: 140px; vertical-align: top;">Name</td>
                <td style="padding: 8px 0;">${escapeHtml(name)}</td>
            </tr>
            <tr>
                <td style="padding: 8px 0; font-weight: bold; vertical-align: top;">Email</td>
                <td style="padding: 8px 0;">${escapeHtml(email)}</td>
            </tr>
            <tr>
                <td style="padding: 8px 0; font-weight: bold; vertical-align: top;">Message</td>
                <td style="padding: 8px 0; white-space: pre-wrap;">${escapeHtml(message)}</td>
            </tr>
            <tr>
                <td style="padding: 8px 0; font-weight: bold; vertical-align: top;">Submitted</td>
                <td style="padding: 8px 0;">${escapeHtml(submittedAt)}</td>
            </tr>
            <tr>
                <td style="padding: 8px 0; font-weight: bold; vertical-align: top;">User IP</td>
                <td style="padding: 8px 0;">${escapeHtml(ip)}</td>
            </tr>
        </table>
    </div>`;
}

function buildAutoReplyHtml({ name }) {
    return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; background: #0A0A1C; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(90deg, #7C3AED, #EC4899); padding: 28px 32px;">
            <h1 style="margin: 0; color: #ffffff; font-size: 22px;">Thanks for reaching out, ${escapeHtml(name)}!</h1>
        </div>
        <div style="padding: 28px 32px; color: #F5F5F7;">
            <p style="font-size: 15px; line-height: 1.6;">
                Thank you for contacting me through my portfolio. I've received your message
                and really appreciate you taking the time to reach out.
            </p>
            <p style="font-size: 15px; line-height: 1.6;">
                I typically reply within <strong>24 hours</strong> &mdash; I'll get back to you as soon as possible
                with a thoughtful response.
            </p>
            <p style="font-size: 15px; line-height: 1.6; margin-top: 24px;">
                Best regards,<br>
                <strong style="color: #A78BFA;">Vishal Vishwakarma</strong>
            </p>
        </div>
    </div>`;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method not allowed' });
        return;
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        res.status(400).json({ success: false, error: 'Invalid request body' });
        return;
    }

    const name = toTrimmedString(req.body.name);
    const email = toTrimmedString(req.body.email);
    const message = toTrimmedString(req.body.message);
    const website = toTrimmedString(req.body.website);

    // Honeypot: bots that fill hidden fields get a fake success, no email sent.
    if (website.length > 0) {
        console.log('Honeypot triggered, submission blocked silently');
        res.status(200).json({ success: true });
        return;
    }

    const ip = getClientIp(req);

    if (isRateLimited(ip)) {
        res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
        return;
    }

    if (!name || name.length > 100) {
        res.status(400).json({ success: false, error: 'Please enter a valid name.' });
        return;
    }

    if (!email || email.length > 200 || !EMAIL_REGEX.test(email)) {
        res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
        return;
    }

    if (!message || message.length < 10) {
        res.status(400).json({ success: false, error: 'Please enter a message of at least 10 characters.' });
        return;
    }

    if (message.length > 5000) {
        res.status(400).json({ success: false, error: 'Message is too long.' });
        return;
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const submittedAt = new Date().toISOString();

    try {
        const { error } = await resend.emails.send({
            from: FROM_ADDRESS,
            to: NOTIFY_TO,
            replyTo: email,
            subject: 'New Portfolio Contact Form Submission',
            html: buildNotificationHtml({ name, email, message, submittedAt, ip })
        });
        if (error) throw error;
    } catch (err) {
        console.error('Failed to send notification email:', err);
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again later.' });
        return;
    }

    try {
        const { error } = await resend.emails.send({
            from: FROM_ADDRESS,
            to: email,
            subject: 'Thanks for contacting Vishal Vishwakarma',
            html: buildAutoReplyHtml({ name })
        });
        if (error) throw error;
    } catch (err) {
        // Expected to fail for arbitrary recipients until a custom domain is
        // verified in Resend (onboarding@resend.dev is a sandbox sender).
        // Never let this affect the response to the visitor.
        console.error('Failed to send auto-reply email (non-fatal):', err);
    }

    res.status(200).json({ success: true });
};
