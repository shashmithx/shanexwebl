import bcrypt from 'bcryptjs';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 4000);
const jwtSecret = process.env.JWT_SECRET || 'dev-only-change-this-secret';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'shanex_shop',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function signUser(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    jwtSecret,
    { expiresIn: '7d' },
  );
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function query(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res.status(401).json({ message: 'Login required.' });
  }

  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired login.' });
  }
}

function readUserFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;

  try {
    return jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  return next();
}

async function ensureAdminUser() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return;

  const existing = await query('SELECT id FROM users WHERE email = :email LIMIT 1', {
    email: process.env.ADMIN_EMAIL,
  });
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);

  if (existing.length) {
    await query(
      'UPDATE users SET name = :name, password_hash = :passwordHash, role = "admin" WHERE email = :email',
      { name: 'SHANEX Admin', passwordHash, email: process.env.ADMIN_EMAIL },
    );
    return;
  }

  await query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (:name, :email, :passwordHash, "admin")',
    { name: 'SHANEX Admin', email: process.env.ADMIN_EMAIL, passwordHash },
  );
}

app.get('/api/health', async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ message: 'Name, email and a 6+ character password are required.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (:name, :email, :passwordHash, "customer")',
      { name, email, passwordHash },
    );
    const user = { id: result.insertId, name, email, role: 'customer' };
    return res.status(201).json({ token: signUser(user), user });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'An account already exists for this email.' });
    }
    throw error;
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password, role } = req.body;

  const users = await query('SELECT * FROM users WHERE email = :email LIMIT 1', { email });
  const user = users[0];

  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  if (role && user.role !== role) {
    return res.status(403).json({ message: `${role} login is not available for this account.` });
  }

  return res.json({ token: signUser(user), user: publicUser(user) });
});

app.get('/api/products', async (req, res) => {
  const includeDrafts = req.query.includeDrafts === 'true';
  const requester = readUserFromRequest(req);
  if (includeDrafts && requester?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required.' });
  }
  const sql = includeDrafts
    ? 'SELECT * FROM products ORDER BY created_at DESC'
    : 'SELECT * FROM products WHERE status = "active" ORDER BY created_at DESC';
  res.json(await query(sql));
});

app.post('/api/products', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, price, image_url, category, stock, status } = req.body;

  if (!name || !description) {
    return res.status(400).json({ message: 'Product name and description are required.' });
  }

  const baseSlug = slugify(name);
  const slug = `${baseSlug}-${Date.now().toString(36)}`;
  const result = await query(
    `INSERT INTO products (name, slug, description, price, image_url, category, stock, status)
     VALUES (:name, :slug, :description, :price, :image_url, :category, :stock, :status)`,
    {
      name,
      slug,
      description,
      price: Number(price || 0),
      image_url: image_url || null,
      category: category || 'General',
      stock: Number(stock || 0),
      status: status === 'draft' ? 'draft' : 'active',
    },
  );

  const products = await query('SELECT * FROM products WHERE id = :id', { id: result.insertId });
  return res.status(201).json(products[0]);
});

app.put('/api/products/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, price, image_url, category, stock, status } = req.body;

  await query(
    `UPDATE products
     SET name = :name, description = :description, price = :price, image_url = :image_url,
         category = :category, stock = :stock, status = :status
     WHERE id = :id`,
    {
      id: req.params.id,
      name,
      description,
      price: Number(price || 0),
      image_url: image_url || null,
      category: category || 'General',
      stock: Number(stock || 0),
      status: status === 'draft' ? 'draft' : 'active',
    },
  );

  const products = await query('SELECT * FROM products WHERE id = :id', { id: req.params.id });
  return res.json(products[0]);
});

app.delete('/api/products/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM products WHERE id = :id', { id: req.params.id });
    res.status(204).end();
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ message: 'This product has orders. Set it to draft instead of deleting it.' });
    }
    throw error;
  }
});

app.get('/api/orders', requireAuth, async (req, res) => {
  const orders = req.user.role === 'admin'
    ? await query('SELECT * FROM orders ORDER BY created_at DESC')
    : await query('SELECT * FROM orders WHERE user_id = :userId ORDER BY created_at DESC', { userId: req.user.id });

  res.json(orders);
});

app.post('/api/orders', requireAuth, async (req, res) => {
  const { items, customer_phone, shipping_address, notes } = req.body;

  if (!Array.isArray(items) || !items.length || !shipping_address) {
    return res.status(400).json({ message: 'Cart items and shipping address are required.' });
  }

  const ids = items.map((item) => Number(item.productId)).filter(Boolean);
  if (!ids.length) {
    return res.status(400).json({ message: 'Cart items are invalid.' });
  }
  const products = await query(`SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND status = "active"`, ids);
  const productMap = new Map(products.map((product) => [product.id, product]));

  const normalizedItems = items.map((item) => {
    const product = productMap.get(Number(item.productId));
    const quantity = Math.max(1, Number(item.quantity || 1));
    if (!product) throw new Error('One or more products are not available.');
    if (product.stock < quantity) throw new Error(`${product.name} has only ${product.stock} available.`);
    return {
      product,
      quantity,
      lineTotal: Number(product.price) * quantity,
    };
  });

  const total = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [orderResult] = await connection.execute(
      `INSERT INTO orders (user_id, customer_name, customer_email, customer_phone, shipping_address, notes, total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, req.user.name, req.user.email, customer_phone || null, shipping_address, notes || null, total],
    );

    for (const item of normalizedItems) {
      await connection.execute(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderResult.insertId, item.product.id, item.product.name, item.quantity, item.product.price, item.lineTotal],
      );
      await connection.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product.id]);
    }

    await connection.commit();
    return res.status(201).json({ id: orderResult.insertId, total, status: 'pending' });
  } catch (error) {
    await connection.rollback();
    return res.status(400).json({ message: error.message });
  } finally {
    connection.release();
  }
});

app.put('/api/orders/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const allowed = ['pending', 'confirmed', 'processing', 'completed', 'cancelled'];
  const status = allowed.includes(req.body.status) ? req.body.status : 'pending';
  await query('UPDATE orders SET status = :status WHERE id = :id', { status, id: req.params.id });
  res.json({ id: Number(req.params.id), status });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Server error. Check API logs for details.' });
});

if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

ensureAdminUser()
  .then(() => {
    app.listen(port, () => {
      console.log(`SHANEX API running on http://127.0.0.1:${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to start SHANEX API:', error);
    process.exit(1);
  });
