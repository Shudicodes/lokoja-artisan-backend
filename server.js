import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// simple local uploads (for dev). In production use S3 or Supabase storage.
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Register (user or artisan)
app.post('/api/register', async (req, res) => {
  const { name, email, phone, role, password } = req.body;
  if (!name || !phone || !role || !password) return res.status(400).json({ error: 'missing_fields' });
  try {
    const pwdHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users(name,email,phone,role,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,name,phone,role`,
      [name,email,phone,role,pwdHash]
    );
    const user = result.rows[0];
    if (role === 'artisan') {
      await pool.query(
        `INSERT INTO artisans(user_id, category, city, verified) VALUES($1,$2,$3,false)`,
        [user.id, req.body.category || 'general', req.body.city || 'Lokoja']
      );
    }
    res.json({ user });
  } catch(e){
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'missing_fields' });
  try {
    const r = await pool.query(`SELECT id, password_hash, name, role FROM users WHERE phone=$1`, [phone]);
    if (r.rowCount === 0) return res.status(401).json({ error: 'invalid_credentials' });
    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'changeme', { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, role: user.role }});
  } catch(e){
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// List artisans (verified)
app.get('/api/artisans', async (req, res) => {
  const { category, city } = req.query;
  if (!category || !city) return res.status(400).json({ error: 'missing_query' });
  try {
    const q = `SELECT a.id, u.name, a.category, a.city, a.price_from, a.avg_rating, a.profile_photo
               FROM artisans a JOIN users u ON a.user_id = u.id
               WHERE a.category = $1 AND a.city = $2 AND a.verified = true
               ORDER BY a.avg_rating DESC LIMIT 50`;
    const result = await pool.query(q, [category, city]);
    res.json(result.rows);
  } catch(e){
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Create booking and payment ref
app.post('/api/book', async (req, res) => {
  const { user_id, artisan_id, service_category, scheduled_at, amount } = req.body;
  if (!user_id || !artisan_id || !amount) return res.status(400).json({ error: 'missing_fields' });
  try {
    const result = await pool.query(
      `INSERT INTO bookings(user_id, artisan_id, service_category, scheduled_at, status, amount) VALUES($1,$2,$3,$4,'pending',$5) RETURNING id`,
      [user_id, artisan_id, service_category || 'general', scheduled_at || null, amount]
    );
    const bookingId = result.rows[0].id;
    const providerRef = uuidv4();
    await pool.query(`INSERT INTO payments(booking_id, provider, provider_ref, amount, status) VALUES($1,$2,$3,$4,'initiated')`, [bookingId, 'flutterwave', providerRef, amount]);
    const payment_url = `${process.env.FRONTEND_URL || 'http://localhost:19006'}/pay?ref=${providerRef}`;
    res.json({ bookingId, payment_url, provider_ref: providerRef });
  } catch(e){
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Simple artisan onboarding (file upload)
app.post('/api/artisan/onboard', upload.fields([{ name: 'id_document', maxCount: 1 }, { name: 'profile_photo', maxCount: 1 }]), async (req, res) => {
  const { user_id, category, city, bio, price_from } = req.body;
  try {
    const idDoc = req.files['id_document'] ? req.files['id_document'][0].path : null;
    const photo = req.files['profile_photo'] ? req.files['profile_photo'][0].path : null;
    await pool.query(`UPDATE artisans SET category=$1, city=$2, bio=$3, price_from=$4, id_document=$5, profile_photo=$6 WHERE user_id=$7`, [category, city, bio, price_from || null, idDoc, photo, user_id]);
    res.json({ status: 'ok' });
  } catch(e){
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Webhook endpoint (provider will call this)
app.post('/api/payments/webhook', async (req, res) => {
  // In production: verify signature header, provider details
  const { provider_ref, status } = req.body;
  try {
    const upd = await pool.query(`UPDATE payments SET status=$1 WHERE provider_ref=$2 RETURNING booking_id`, [status, provider_ref]);
    if (upd.rowCount === 0) return res.status(404).json({ error: 'payment_not_found' });
    const bookingId = upd.rows[0].booking_id;
    if (status === 'successful' || status === 'paid') {
      await pool.query(`UPDATE bookings SET status='paid', payment_ref=$1 WHERE id=$2`, [provider_ref, bookingId]);
      // notify artisan (push/sockets) - not implemented
    }
    res.json({ status: 'ok' });
  } catch(e){
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend running on ${port}`));