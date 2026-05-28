# SHANEX Shop Setup

The shop now uses a Node/Express API and a MySQL database.

## 1. Create the database

Import the schema:

```bash
mysql -u root -p < database/schema.sql
```

## 2. Configure environment variables

Copy `.env.example` to `.env` and update the MySQL credentials.

```bash
cp .env.example .env
```

Set an admin login before starting the API:

```txt
ADMIN_EMAIL=admin@shanex.com
ADMIN_PASSWORD=your-secure-password
```

When the API starts, it creates or updates that admin account.

## 3. Run the site

```bash
npm run dev
```

This starts:

- Express API on `http://127.0.0.1:4000`
- Vite frontend on the Vite dev URL

## Shop Features

- Customer register/login
- Admin login
- Product listing from MySQL
- Admin product add/delete
- Customer cart
- Customer checkout/order creation
- Stock reduction after order
- Admin/customer order list

## Production Note

This is no longer a static-only website. Deploy it to hosting that supports Node.js and MySQL, or split the frontend and backend across separate services.
