
const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const session = require("express-session");

const app = express();
const PORT = 3000;

const db = new Database(path.join(__dirname, "ecommerce.db"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "mstore-session-secret-change-later",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

// DATABASE TABLES

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    price REAL NOT NULL,
    icon TEXT DEFAULT '🛍️',
    description TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    total REAL NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );
`);

// Add user_id to existing orders without deleting old orders.

const orderColumns = db.prepare("PRAGMA table_info(orders)").all();
if (!orderColumns.some(column => column.name === "user_id")) {
  db.exec("ALTER TABLE orders ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
}

// Add sample products only if the products table is empty.

const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;

if (productCount === 0) {
  const insertProduct = db.prepare(`
    INSERT INTO products (name, category, price, icon, description)
    VALUES (?, ?, ?, ?, ?)
  `);

  const sampleProducts = [
    ["Wireless Headphones", "Electronics", 1499, "🎧", "Enjoy your favourite music."],
    ["Smart Watch", "Electronics", 2499, "⌚", "A smart companion for every day."],
    ["Laptop Backpack", "Accessories", 999, "🎒", "Carry your essentials with ease."],
    ["Bluetooth Speaker", "Electronics", 1299, "🔊", "Enjoy clear sound anywhere."],
    ["Travel Bottle", "Lifestyle", 499, "🧴", "A handy bottle for everyday use."],
    ["Desk Lamp", "Home", 799, "💡", "Brighten up your workspace."]
  ];

  const seedProducts = db.transaction(() => {
    for (const product of sampleProducts) {
      insertProduct.run(...product);
    }
  });

  seedProducts();
}

// AUTHENTICATION HELPER

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      message: "Please log in to view your orders."
    });
  }

  next();
}

// REGISTER
app.post("/api/register", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Please fill in all fields."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must contain at least 6 characters."
      });
    }

    const existingUser = db.prepare(
      "SELECT id FROM users WHERE email = ?"
    ).get(email);

    if (existingUser) {
      return res.status(409).json({
        message: "This email is already registered. Please log in."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = db.prepare(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"
    ).run(name, email, hashedPassword);

    req.session.user = {
      id: Number(result.lastInsertRowid),
      name,
      email
    };

    req.session.save((error) => {
      if (error) {
        console.error("Session save error:", error);
        return res.status(500).json({
          message: "Account created, but login session failed. Please log in."
        });
      }

      return res.status(201).json({
        message: "Registration successful!",
        user: req.session.user
      });
    });
  } catch (error) {
    console.error("Registration error:", error);

    return res.status(500).json({
      message: "Registration error: " + error.message
    });
  }
});
// LOGIN

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Enter your email and password."
      });
    }

    const user = db.prepare(
      "SELECT * FROM users WHERE email = ?"
    ).get(String(email).trim().toLowerCase());

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email
    };

    res.json({
      message: "Login successful!",
      user: req.session.user
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      message: "Login failed. Please try again."
    });
  }
});

// GET CURRENT USER

app.get("/api/me", (req, res) => {
  res.json({
    user: req.session.user || null
  });
});

// LOGOUT

app.post("/api/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        message: "Could not log out."
      });
    }

    res.clearCookie("connect.sid");
    res.json({ message: "Logged out successfully." });
  });
});

// GET ALL PRODUCTS

app.get("/api/products", (req, res) => {
  try {
    const products = db.prepare(
      "SELECT * FROM products ORDER BY id"
    ).all();

    res.json(products);
  } catch (error) {
    console.error("Products error:", error);
    res.status(500).json({
      message: "Could not load products."
    });
  }
});

// PLACE ORDER
// Login is optional. Guest checkout remains available.

const createOrder = db.transaction((customer, items) => {
  let total = 0;
  const verifiedItems = [];

  for (const item of items) {
    const productId = Number(item.id);
    const quantity = Number(item.quantity);

    if (
      !Number.isInteger(productId) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    ) {
      throw new Error("Invalid product or quantity.");
    }

    const product = db.prepare(
      "SELECT id, name, price FROM products WHERE id = ?"
    ).get(productId);

    if (!product) {
      throw new Error("A product in your cart is unavailable.");
    }

    total += Number(product.price) * quantity;

    verifiedItems.push({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      quantity
    });
  }

  const orderResult = db.prepare(`
    INSERT INTO orders
      (user_id, customer_name, phone, address, total)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    customer.userId,
    customer.name,
    customer.phone,
    customer.address,
    total
  );

  const orderId = Number(orderResult.lastInsertRowid);

  const insertItem = db.prepare(`
    INSERT INTO order_items
      (order_id, product_id, product_name, price, quantity)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const item of verifiedItems) {
    insertItem.run(
      orderId,
      item.id,
      item.name,
      item.price,
      item.quantity
    );
  }

  return { orderId, total, items: verifiedItems };
});

app.post("/api/orders", (req, res) => {
  try {
    const { customer, items } = req.body;

    if (
      !customer ||
      !customer.name ||
      !customer.phone ||
      !customer.address ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        message: "Please enter your details and add items to your cart."
      });
    }

    const order = createOrder({
      userId: req.session.user ? req.session.user.id : null,
      name: String(customer.name).trim(),
      phone: String(customer.phone).trim(),
      address: String(customer.address).trim()
    }, items);

    res.status(201).json({
      message: "Order placed successfully!",
      orderId: order.orderId,
      orderNumber: `MS${String(order.orderId).padStart(6, "0")}`,
      total: order.total,
      items: order.items
    });
  } catch (error) {
    console.error("Order error:", error);
    res.status(400).json({
      message: error.message || "Could not place your order."
    });
  }
});

// MY ORDERS — LOGIN REQUIRED

app.get("/api/my-orders", requireLogin, (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT id, customer_name, phone, address, total, created_at
      FROM orders
      WHERE user_id = ?
      ORDER BY id DESC
    `).all(req.session.user.id);

    const getItems = db.prepare(`
      SELECT product_name AS name, price, quantity
      FROM order_items
      WHERE order_id = ?
    `);

    const result = orders.map(order => ({
      ...order,
      orderNumber: `MS${String(order.id).padStart(6, "0")}`,
      items: getItems.all(order.id)
    }));

    res.json({ orders: result });
  } catch (error) {
    console.error("My orders error:", error);
    res.status(500).json({
      message: "Could not load your orders."
    });
  }
});

// START SERVER

app.listen(PORT, () => {
  console.log(`M.STORE running at http://localhost:${PORT}`);
});
