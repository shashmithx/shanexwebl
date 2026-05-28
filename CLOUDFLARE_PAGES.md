# Cloudflare Pages Deployment

This project is prepared as a static Vite site for Cloudflare Pages.

## Build Settings

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js version: `20` or newer

## Local Check

```bash
npm install
npm run build
npm run preview
```

## Notes

- The hosted Pages version is fully static.
- The shop uses browser `localStorage` for products, accounts and orders.
- Default static admin login:
  - Email: `admin@shanex.com`
  - Password: `admin123`
- The old Node/MySQL and WhatsApp files are kept in the repository, but they are not required for the Cloudflare Pages build.
