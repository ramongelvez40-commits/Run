import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const secret = process.env.SESSION_SECRET || 'change-me-in-production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const setting = (key, fallback) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? String(fallback);
const coinsPerDollar = () => Number(setting('coins_per_dollar', 1000));
const threshold = () => Number(setting('redeem_threshold', 5000));
const jsonError = (res, status, error) => res.status(status).json({ ok: false, error });
const tokenFor = (kind, id) => jwt.sign({ kind, id }, secret, { expiresIn: '7d' });
function auth(req, res, next) {
  try {
    const token = req.cookies.run_session;
    if (!token) return jsonError(res, 401, 'Inicia sesión para continuar.');
    req.actor = jwt.verify(token, secret);
    next();
  } catch { return jsonError(res, 401, 'La sesión ya no es válida.'); }
}
function adminOnly(req, res, next) { if (req.actor?.kind !== 'admin') return jsonError(res, 403, 'Acceso solo para administración.'); next(); }
function userOnly(req, res, next) { if (req.actor?.kind !== 'user') return jsonError(res, 403, 'Acceso solo para usuarios.'); next(); }
function safeUser(id) { return db.prepare('SELECT id,name,email,coins,email_verified,created_at FROM users WHERE id=?').get(id); }
function mailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.SMTP_FROM) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } });
}
async function sendPinEmail(to, name, code, platformName) {
  const transport = mailer();
  if (!transport) throw new Error('Correo SMTP no configurado.');
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject: 'Tu PIN de recompensa de run', text: `Hola ${name},\n\nTu solicitud fue aprobada. Tu PIN para ${platformName || 'la plataforma seleccionada'} es:\n\n${code}\n\nÚsalo una sola vez en el lugar autorizado.\n\nEquipo run` });
}

app.get('/api/setup/status', (_req, res) => res.json({ ok: true, configured: Boolean(db.prepare('SELECT id FROM admins LIMIT 1').get()) }));
app.post('/api/setup/admin', (req, res) => {
  if (db.prepare('SELECT id FROM admins LIMIT 1').get()) return jsonError(res, 409, 'El administrador ya está configurado.');
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const confirm = String(req.body?.confirmPassword || '');
  if (!email || !password || password.length < 8 || password !== confirm) return jsonError(res, 400, 'Revisa el correo y las dos contraseñas. Deben coincidir y tener al menos 8 caracteres.');
  const result = db.prepare('INSERT INTO admins(email,password_hash) VALUES (?,?)').run(email, bcrypt.hashSync(password, 12));
  res.cookie('run_session', tokenFor('admin', result.lastInsertRowid), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 });
  res.json({ ok: true, kind: 'admin', user: { email } });
});
app.get('/api/public/config', (_req, res) => res.json({ ok: true, threshold: threshold(), coinsPerDollar: coinsPerDollar(), platforms: db.prepare('SELECT id,slot,name,logo_url,link FROM platforms WHERE active=1 ORDER BY slot').all() }));
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 8) return jsonError(res, 400, 'Nombre, correo y contraseña de al menos 8 caracteres son obligatorios.');
  const normalized = String(email).trim().toLowerCase();
  try {
    const info = db.prepare('INSERT INTO users(name,email,password_hash) VALUES (?,?,?)').run(String(name).trim(), normalized, bcrypt.hashSync(password, 12));
    res.cookie('run_session', tokenFor('user', info.lastInsertRowid), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 });
    res.json({ ok: true, user: safeUser(info.lastInsertRowid) });
  } catch { return jsonError(res, 409, 'Ese correo ya está registrado.'); }
});
app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const admin = db.prepare('SELECT * FROM admins WHERE email=?').get(email);
  const record = user || admin;
  if (!record || !bcrypt.compareSync(password, record.password_hash)) return jsonError(res, 401, 'Correo o contraseña incorrectos.');
  const kind = user ? 'user' : 'admin';
  res.cookie('run_session', tokenFor(kind, record.id), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 });
  res.json({ ok: true, kind, user: user ? safeUser(user.id) : { email: admin.email } });
});
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('run_session'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ ok: true, kind: req.actor.kind, user: req.actor.kind === 'user' ? safeUser(req.actor.id) : db.prepare('SELECT id,email FROM admins WHERE id=?').get(req.actor.id) }));
app.get('/api/user/redemptions', auth, userOnly, (req, res) => res.json({ ok: true, redemptions: db.prepare(`SELECT r.id,r.coins_cost,r.status,r.requested_at,r.sent_at,p.name platform_name FROM redemptions r JOIN platforms p ON p.id=r.platform_id WHERE r.user_id=? ORDER BY r.id DESC`).all(req.actor.id) }));
app.post('/api/user/redeem', auth, userOnly, (req, res) => {
  const platform = db.prepare('SELECT * FROM platforms WHERE id=? AND active=1').get(Number(req.body?.platformId));
  const user = safeUser(req.actor.id);
  if (!platform) return jsonError(res, 400, 'Plataforma no disponible.');
  if (user.coins < threshold()) return jsonError(res, 400, `Necesitas ${threshold().toLocaleString('es-VE')} monedas.`);
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(threshold(), user.id);
    db.prepare('INSERT INTO coin_ledger(user_id,amount,kind,description) VALUES (?,?,?,?)').run(user.id, -threshold(), 'redeem', `Solicitud de PIN para ${platform.name}`);
    return db.prepare('INSERT INTO redemptions(user_id,platform_id,coins_cost) VALUES (?,?,?)').run(user.id, platform.id, threshold()).lastInsertRowid;
  });
  const id = tx();
  res.json({ ok: true, id, user: safeUser(user.id), message: 'Solicitud enviada para revisión.' });
});

app.get('/api/admin/dashboard', auth, adminOnly, (_req, res) => {
  const users = db.prepare(`SELECT u.id,u.name,u.email,u.coins,u.created_at, COALESCE((SELECT SUM(coins) FROM offer_events WHERE user_id=u.id AND status='confirmed'),0) earned_coins, COALESCE((SELECT SUM(value_cents) FROM pins p JOIN redemptions r ON r.pin_id=p.id WHERE r.user_id=u.id AND r.status='sent'),0) reward_cents FROM users u ORDER BY u.id ASC`).all().map((u) => ({ ...u, generated_cents: Math.floor(Number(u.earned_coins) / coinsPerDollar() * 100), remaining_cents: Math.floor(Number(u.earned_coins) / coinsPerDollar() * 100) - Number(u.reward_cents) }));
  const totals = db.prepare(`SELECT COALESCE(SUM(coins),0) earned_coins FROM offer_events WHERE status='confirmed'`).get();
  const pins = db.prepare(`SELECT COUNT(*) available FROM pins WHERE status='available'`).get();
  const pending = db.prepare(`SELECT COUNT(*) count FROM redemptions WHERE status='requested'`).get();
  res.json({ ok: true, threshold: threshold(), coinsPerDollar: coinsPerDollar(), users, totals: { ...totals, generated_cents: Math.floor(Number(totals.earned_coins) / coinsPerDollar() * 100) }, pins, pending });
});
app.get('/api/admin/platforms', auth, adminOnly, (_req, res) => res.json({ ok: true, platforms: db.prepare('SELECT * FROM platforms ORDER BY slot').all() }));
app.put('/api/admin/platforms/:id', auth, adminOnly, (req, res) => {
  const { name = '', logoUrl = '', link = '', active = false } = req.body || {};
  if (link && !/^https:\/\//i.test(link)) return jsonError(res, 400, 'El enlace debe comenzar con https://');
  db.prepare('UPDATE platforms SET name=?,logo_url=?,link=?,active=? WHERE id=?').run(String(name).trim(), String(logoUrl).trim(), String(link).trim(), active ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});
app.get('/api/admin/pins', auth, adminOnly, (_req, res) => res.json({ ok: true, pins: db.prepare(`SELECT pins.id,pins.code,pins.value_cents,pins.status,pins.assigned_at,platforms.name platform_name FROM pins JOIN platforms ON platforms.id=pins.platform_id ORDER BY pins.id DESC`).all() }));
app.post('/api/admin/pins', auth, adminOnly, (req, res) => {
  const { platformId, code, valueCents = 100 } = req.body || {};
  if (!platformId || !code) return jsonError(res, 400, 'Plataforma y PIN son obligatorios.');
  try { db.prepare('INSERT INTO pins(platform_id,code,value_cents) VALUES (?,?,?)').run(Number(platformId), String(code).trim(), Number(valueCents)); res.json({ ok: true }); } catch { return jsonError(res, 409, 'Ese PIN ya existe.'); }
});
app.get('/api/admin/redemptions', auth, adminOnly, (_req, res) => res.json({ ok: true, redemptions: db.prepare(`SELECT r.*,u.name,u.email,p.name platform_name, pins.code pin_code,pins.value_cents FROM redemptions r JOIN users u ON u.id=r.user_id JOIN platforms p ON p.id=r.platform_id LEFT JOIN pins ON pins.id=r.pin_id ORDER BY CASE r.status WHEN 'requested' THEN 0 ELSE 1 END,r.id DESC`).all() }));
app.post('/api/admin/redemptions/:id/send', auth, adminOnly, async (req, res) => {
  const redemption = db.prepare(`SELECT r.*,u.name,u.email,p.name platform_name FROM redemptions r JOIN users u ON u.id=r.user_id JOIN platforms p ON p.id=r.platform_id WHERE r.id=?`).get(Number(req.params.id));
  if (!redemption || redemption.status !== 'requested') return jsonError(res, 400, 'La solicitud no está pendiente.');
  const pin = db.prepare('SELECT * FROM pins WHERE id=? AND status=\'available\' AND platform_id=? ORDER BY id LIMIT 1').get(Number(req.body?.pinId), redemption.platform_id);
  if (!pin) return jsonError(res, 400, 'Selecciona un PIN disponible de la plataforma correcta.');
  try {
    await sendPinEmail(redemption.email, redemption.name, pin.code, redemption.platform_name);
    const tx = db.transaction(() => { db.prepare('UPDATE pins SET status=\'assigned\',assigned_user_id=?,assigned_at=CURRENT_TIMESTAMP WHERE id=?').run(redemption.user_id, pin.id); db.prepare('UPDATE redemptions SET pin_id=?,status=\'sent\',sent_at=CURRENT_TIMESTAMP WHERE id=?').run(pin.id, redemption.id); });
    tx();
    res.json({ ok: true, message: 'PIN enviado al correo registrado.' });
  } catch (error) { return jsonError(res, 503, error.message); }
});
app.post('/api/admin/users/:id/credit', auth, adminOnly, (req, res) => {
  const amount = Number(req.body?.coins || 0);
  if (!Number.isInteger(amount) || amount <= 0) return jsonError(res, 400, 'Cantidad de monedas no válida.');
  const user = safeUser(Number(req.params.id));
  if (!user) return jsonError(res, 404, 'Usuario no encontrado.');
  const ext = `manual-${Date.now()}-${user.id}`;
  db.transaction(() => { db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(amount, user.id); db.prepare('INSERT INTO coin_ledger(user_id,amount,kind,description,external_id) VALUES (?,?,?,?,?)').run(user.id, amount, 'adjustment', 'Ajuste administrativo', ext); })();
  res.json({ ok: true, user: safeUser(user.id) });
});
app.post('/api/webhooks/offerwall', (req, res) => {
  if (!process.env.OFFERWALL_WEBHOOK_SECRET || req.get('x-offerwall-secret') !== process.env.OFFERWALL_WEBHOOK_SECRET) return jsonError(res, 401, 'No autorizado.');
  const { externalId, userId, coins, revenueCents = 0 } = req.body || {};
  const amount = Number(coins);
  if (!externalId || !userId || !Number.isInteger(amount) || amount <= 0) return jsonError(res, 400, 'Datos de conversión incompletos.');
  try {
    db.transaction(() => { db.prepare('INSERT INTO offer_events(external_id,user_id,revenue_cents,coins) VALUES (?,?,?,?)').run(String(externalId), Number(userId), Number(revenueCents), amount); db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(amount, Number(userId)); db.prepare('INSERT INTO coin_ledger(user_id,amount,kind,description,external_id) VALUES (?,?,?,?,?)').run(Number(userId), amount, 'earn', 'Recompensa confirmada por muro de ofertas', String(externalId)); })();
    res.json({ ok: true });
  } catch { return jsonError(res, 409, 'Esta conversión ya fue registrada o el usuario no existe.'); }
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, () => console.log(`run disponible en el puerto ${port}`));
