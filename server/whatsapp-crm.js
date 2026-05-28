import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import qrcode from 'qrcode-terminal';
import puppeteer from 'puppeteer';
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 8088);
const dataDir = path.resolve(__dirname, '..', 'data');
const publicDir = path.resolve(__dirname, '..', 'public');
const dbPath = path.join(dataDir, 'whatsapp-crm.json');

const startupNeedles = [
  'SHANEX Print Manager - Startup Report',
  'SHANEX Print Manager Started',
];
let waStatus = 'starting';
let lastQrAt = null;
let currentQrDataUrl = '';
let waEvents = [];
let waClient = null;
const processedMessageIds = new Set();
const sessionCookieName = 'shanex_session';
const sessions = new Map();
const loginPassword = process.env.CRM_PASSWORD || 'shanex@2026';
const internalPrintToken = crypto.randomBytes(24).toString('hex');
let db = {
  customers: [],
  pcs: [],
  imports: [],
  quotations: [],
  invoices: [],
  payments: [],
  loyaltyLedger: [],
  whatsappEvents: [],
  tickets: [],
  settings: {
    companyName: 'Shanex',
    website: 'shanex.lk',
    phone: '0772818661',
    email: 'hello@shanex.lk',
    address: 'Willauda Road, Waga North, Thummodara, Sri Lanka',
    logoPath: '/assets/shanex-logo.png',
    bankDetails: 'Bank: Your Bank Name\nAccount Name: Shanex\nAccount No: 0000000000\nBranch: Your Branch',
    terms: '1. License activation is processed after payment confirmation.\n2. Payments are non-refundable after license activation.\n3. Renewal must be completed before license expiry to avoid service interruption.\n4. Bank reference number must be shared after payment.',
  },
};

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use('/assets', express.static(publicDir));

function nowIso() {
  return new Date().toISOString();
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id || 0)), 0) + 1;
}

async function loadDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    db = { ...db, ...JSON.parse(raw) };
    db.customers ||= [];
    db.pcs ||= [];
    db.imports ||= [];
    db.quotations ||= [];
    db.invoices ||= [];
    db.payments ||= [];
    db.loyaltyLedger ||= [];
    db.whatsappEvents ||= [];
    db.tickets ||= [];
    db.settings = {
      companyName: 'Shanex',
      website: 'shanex.lk',
      phone: '0772818661',
      email: 'hello@shanex.lk',
      address: 'Willauda Road, Waga North, Thummodara, Sri Lanka',
      logoPath: '/assets/shanex-logo.png',
      bankDetails: 'Bank: Your Bank Name\nAccount Name: Shanex\nAccount No: 0000000000\nBranch: Your Branch',
      terms: '1. License activation is processed after payment confirmation.\n2. Payments are non-refundable after license activation.\n3. Renewal must be completed before license expiry to avoid service interruption.\n4. Bank reference number must be shared after payment.',
      ...(db.settings || {}),
    };
    normalizeDb();
    await saveDb();
    waEvents = db.whatsappEvents.slice(0, 50);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await saveDb();
  }
}

async function saveDb() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf8');
}

function cleanValue(value = '') {
  return String(value)
    .trim()
    .replace(/^[:\s>*•\-`]+/, '')
    .replace(/^[*`]+|[*`]+$/g, '')
    .trim();
}

function pickLine(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\s*:?\\s*(.+)$`, 'i');
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match) return cleanValue(match[1]);
  }
  return '';
}

function isStartupReport(text) {
  return startupNeedles.some((needle) => text.includes(needle))
    || /Print Manager\s*(?:-\s*Startup Report|Started!?)/i.test(text);
}

function addWaEvent(type, message, meta = {}) {
  const event = { type, message, at: nowIso(), ...meta };
  waEvents.unshift(event);
  waEvents = waEvents.slice(0, 50);
  db.whatsappEvents ||= [];
  db.whatsappEvents.unshift(event);
  db.whatsappEvents = db.whatsappEvents.slice(0, 200);
  saveDb().catch((error) => console.error('Failed to save WhatsApp log:', error.message));
  console.log(`[WhatsApp ${type}] ${message}`);
}

function previewText(value = '') {
  return cleanValue(value).replace(/\s+/g, ' ').slice(0, 120);
}

function cleanPhone(value = '') {
  return cleanValue(value).replace('@c.us', '').replace(/\D/g, '');
}

function asMoney(value = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function dateValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value || nowIso());
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function addDaysKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00+05:30`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function chartLabel(dateKey) {
  return new Date(`${dateKey}T00:00:00+05:30`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Colombo',
  });
}

function reportDateKey(reportTime, fallback) {
  return localDateKey(parseReportDate(reportTime, fallback));
}

function importReportDate(item) {
  const savedDate = cleanValue(item.reportDate || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(savedDate)) return savedDate;
  return reportDateKey(item.reportTime, item.importedAt || item.firstImportedAt || item.lastImportedAt);
}

function normalizeImports() {
  const merged = new Map();
  for (const item of db.imports || []) {
    const reportDate = importReportDate(item);
    const machineKey = item.pcId || item.hwid || item.id;
    const key = `${machineKey}:${reportDate}`;
    const count = Math.max(1, Number(item.count || 1));
    const firstImportedAt = item.firstImportedAt || item.importedAt || item.lastImportedAt || nowIso();
    const lastImportedAt = item.lastImportedAt || item.importedAt || firstImportedAt;
    const normalized = {
      ...item,
      reportDate,
      firstImportedAt,
      lastImportedAt,
      importedAt: item.importedAt || firstImportedAt,
      count,
    };

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, normalized);
      continue;
    }

    const existingFirst = dateValue(existing.firstImportedAt);
    const incomingFirst = dateValue(firstImportedAt);
    const existingLast = dateValue(existing.lastImportedAt);
    const incomingLast = dateValue(lastImportedAt);
    existing.count += count;
    if (!existingFirst || (incomingFirst && incomingFirst < existingFirst)) {
      existing.firstImportedAt = firstImportedAt;
      existing.importedAt = firstImportedAt;
    }
    if (!existingLast || incomingLast >= existingLast) {
      Object.assign(existing, normalized, {
        id: existing.id,
        count: existing.count,
        firstImportedAt: existing.firstImportedAt,
        importedAt: existing.importedAt,
        lastImportedAt,
      });
    }
  }

  db.imports = Array.from(merged.values())
    .sort((a, b) => dateValue(b.lastImportedAt || b.importedAt) - dateValue(a.lastImportedAt || a.importedAt))
    .slice(0, 300);
}

function normalizePcsByHwid() {
  const byHwid = new Map();
  const pcIdMap = new Map();
  const normalized = [];

  for (const pc of db.pcs || []) {
    const hwid = cleanValue(pc.hwid || '');
    if (!hwid) {
      normalized.push(pc);
      continue;
    }

    const existing = byHwid.get(hwid);
    if (!existing) {
      byHwid.set(hwid, pc);
      normalized.push(pc);
      continue;
    }

    const existingSeen = dateValue(existing.lastSeenAt || existing.updatedAt || existing.createdAt);
    const incomingSeen = dateValue(pc.lastSeenAt || pc.updatedAt || pc.createdAt);
    const keep = incomingSeen > existingSeen ? pc : existing;
    const drop = keep === pc ? existing : pc;
    pcIdMap.set(drop.id, keep.id);
    Object.assign(keep, {
      customerId: keep.customerId || drop.customerId,
      pcName: keep.pcName || drop.pcName,
      version: keep.version || drop.version,
      cpu: keep.cpu || drop.cpu,
      ram: keep.ram || drop.ram,
      ipWan: keep.ipWan || drop.ipWan,
      ipLan: keep.ipLan || drop.ipLan,
      os: keep.os || drop.os,
      license: keep.license || drop.license,
      remaining: keep.remaining || drop.remaining,
      status: keep.status || drop.status,
      lastReportTime: keep.lastReportTime || drop.lastReportTime,
    });
    byHwid.set(hwid, keep);
    if (keep === pc) {
      const index = normalized.findIndex((item) => item.id === existing.id);
      if (index !== -1) normalized[index] = keep;
    }
  }

  for (const item of db.imports || []) {
    if (pcIdMap.has(item.pcId)) item.pcId = pcIdMap.get(item.pcId);
  }
  db.pcs = normalized.filter((pc, index, list) => !pc.hwid || list.findIndex((item) => item.hwid === pc.hwid) === index);
}

function uniquePcs() {
  const byHwid = new Map();
  for (const pc of db.pcs) {
    const key = pc.hwid || `pc:${pc.id}`;
    const existing = byHwid.get(key);
    if (!existing || dateValue(pc.lastSeenAt || pc.updatedAt) > dateValue(existing.lastSeenAt || existing.updatedAt)) {
      byHwid.set(key, pc);
    }
  }
  return Array.from(byHwid.values());
}

function billableCustomers() {
  const customerIds = new Set(uniquePcs().map((pc) => pc.customerId));
  for (const invoice of db.invoices) customerIds.add(invoice.customerId);
  for (const quotation of db.quotations) customerIds.add(quotation.customerId);
  for (const payment of db.payments) customerIds.add(payment.customerId);
  return db.customers.filter((customer) => customerIds.has(customer.id));
}

function customerFirstSeenAt(customer) {
  const importTimes = db.imports
    .filter((item) => item.customerId === customer.id)
    .map((item) => item.firstImportedAt || item.importedAt || item.lastImportedAt)
    .filter(Boolean)
    .sort((a, b) => dateValue(a) - dateValue(b));
  return importTimes[0] || customer.createdAt || customer.updatedAt || nowIso();
}

function customerAnalytics() {
  const customers = billableCustomers();
  const today = localDateKey();
  const labels = Array.from({ length: 14 }, (_, index) => addDaysKey(today, -(13 - index)));
  const importsByDay = new Map();
  for (const item of db.imports) {
    const key = importReportDate(item);
    if (!importsByDay.has(key)) importsByDay.set(key, new Set());
    importsByDay.get(key).add(item.customerId);
  }

  const firstSeen = new Map(customers.map((customer) => [customer.id, localDateKey(customerFirstSeenAt(customer))]));
  const newToday = customers.filter((customer) => firstSeen.get(customer.id) === today);
  const activeToday = importsByDay.get(today) || new Set();
  const returningToday = customers.filter(
    (customer) => activeToday.has(customer.id) && firstSeen.get(customer.id) < today,
  );
  const newByDay = labels.map((key) => customers.filter((customer) => firstSeen.get(customer.id) === key).length);
  const returningByDay = labels.map((key) => {
    const active = importsByDay.get(key) || new Set();
    return customers.filter((customer) => active.has(customer.id) && firstSeen.get(customer.id) < key).length;
  });
  const last7New = newByDay.slice(-7);
  const previous7New = newByDay.slice(0, 7);
  const sevenDayAverage = last7New.reduce((sum, value) => sum + value, 0) / 7;
  const previousAverage = previous7New.reduce((sum, value) => sum + value, 0) / 7;
  const growthDelta = sevenDayAverage - previousAverage;

  return {
    todayNewCustomers: newToday.length,
    todayReturningCustomers: returningToday.length,
    sevenDayNewAverage: Number(sevenDayAverage.toFixed(2)),
    growthDelta: Number(growthDelta.toFixed(2)),
    newCustomerTrend: labels.map((key, index) => ({
      date: key,
      label: chartLabel(key),
      value: newByDay[index],
      returning: returningByDay[index],
    })),
  };
}

function docNumber(prefix, items) {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(nextId(items)).padStart(4, '0')}`;
}

function formatCurrency(value) {
  return `Rs. ${asMoney(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function isGenericShopName(value = '') {
  return /^shanex\s+print\s+hub$/i.test(cleanValue(value));
}

function normalizeDb() {
  for (const customer of db.customers) {
    customer.customerName = cleanValue(customer.customerName);
    customer.shopName = cleanValue(customer.shopName);
    customer.sourceShopName = cleanValue(customer.sourceShopName || '');
    customer.contactNumber = cleanPhone(customer.contactNumber);
    if (customer.contactNumber && isGenericShopName(customer.shopName)) {
      customer.sourceShopName ||= customer.shopName;
      customer.customerName = `WhatsApp ${customer.contactNumber}`;
      customer.shopName = `WhatsApp ${customer.contactNumber}`;
    }
    customer.identityKey ||= customer.contactNumber
      ? `wa:${customer.contactNumber}`
      : `shop:${String(customer.shopName || customer.customerName || customer.id).toLowerCase()}`;
  }

  for (const pc of db.pcs) {
    for (const key of ['pcName', 'hwid', 'version', 'cpu', 'ram', 'ipWan', 'ipLan', 'os', 'license', 'remaining', 'status', 'lastReportTime']) {
      pc[key] = cleanValue(pc[key] || '');
    }
  }
  normalizePcsByHwid();

  for (const quotation of db.quotations) {
    quotation.total = asMoney(quotation.total);
    quotation.subtotal = asMoney(quotation.subtotal || quotation.total);
    quotation.discount = asMoney(quotation.discount);
    quotation.status ||= 'draft';
  }

  for (const invoice of db.invoices) {
    recalcInvoice(invoice);
  }

  for (const payment of db.payments) {
    payment.amount = asMoney(payment.amount);
    payment.reference = cleanValue(payment.reference || '');
  }

  normalizeImports();
}

function customerIdentity(parsed, meta = {}) {
  const phone = cleanPhone(parsed.whatsapp || meta.fromPhone || meta.from);
  const contactName = cleanValue(meta.fromName || '');
  const reportShop = cleanValue(parsed.shop || '');
  const hasRealShop = reportShop && !isGenericShopName(reportShop);
  const nameFromWhatsapp = contactName && contactName !== phone;
  const displayName = hasRealShop
    ? reportShop
    : nameFromWhatsapp
      ? contactName
      : phone
        ? `WhatsApp ${phone}`
        : reportShop || 'Unknown Customer';

  return {
    identityKey: phone ? `wa:${phone}` : `shop:${displayName.toLowerCase()}`,
    customerName: displayName,
    shopName: displayName,
    contactNumber: phone,
    sourceShopName: reportShop,
  };
}

function parseStartupReport(text) {
  if (!isStartupReport(text)) return null;
  const isStartedFormat = /Print Manager\s*Started!?/i.test(text);
  const hwid = pickLine(text, 'HWID');

  return {
    format: isStartedFormat ? 'started' : 'startup-report',
    shop: pickLine(text, 'Shop'),
    version: pickLine(text, 'Version'),
    reportTime: pickLine(text, 'Time'),
    pcName: pickLine(text, 'PC Name') || (hwid ? `PC-${hwid.slice(0, 8)}` : ''),
    hwid,
    cpu: pickLine(text, 'CPU'),
    ram: pickLine(text, 'RAM'),
    ipWan: pickLine(text, 'IP WAN') || pickLine(text, 'Public IP'),
    ipLan: pickLine(text, 'IP LAN') || pickLine(text, 'Local IP'),
    os: pickLine(text, 'OS'),
    license: pickLine(text, 'License'),
    remaining: pickLine(text, 'Remaining'),
    whatsapp: pickLine(text, 'WhatsApp'),
    status: pickLine(text, 'Status'),
    rawText: text,
  };
}

function publicCustomer(customer) {
  const pcs = uniquePcs().filter((pc) => pc.customerId === customer.id);
  const invoices = db.invoices.filter((invoice) => invoice.customerId === customer.id);
  const payments = db.payments.filter((payment) => payment.customerId === customer.id);
  const tickets = db.tickets.filter((ticket) => ticket.customerId === customer.id);
  const loyaltyPoints = db.loyaltyLedger
    .filter((entry) => entry.customerId === customer.id)
    .reduce((sum, entry) => sum + Number(entry.points || 0), 0);
  return {
    ...customer,
    pcCount: pcs.length,
    pcs,
    paidTotal: payments.reduce((sum, payment) => sum + asMoney(payment.amount), 0),
    pendingTotal: invoices.reduce((sum, invoice) => sum + asMoney(invoice.balance), 0),
    loyaltyPoints,
    openTickets: tickets.filter((ticket) => !['closed', 'resolved'].includes(ticket.status)).length,
  };
}

function recalcInvoice(invoice) {
  const paidAmount = db.payments
    .filter((payment) => payment.invoiceId === invoice.id)
    .reduce((sum, payment) => sum + asMoney(payment.amount), 0);
  invoice.total = asMoney(invoice.total);
  invoice.paidAmount = paidAmount;
  invoice.balance = Math.max(0, invoice.total - paidAmount);
  invoice.status = invoice.balance <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : invoice.status || 'unpaid';
  if (invoice.status !== 'paid' && paidAmount <= 0) invoice.status = 'unpaid';
  return invoice;
}

function recalcAllInvoices() {
  for (const invoice of db.invoices) recalcInvoice(invoice);
}

function quotationMessage(quotation, customer) {
  return [
    `Hello ${customer.shopName},`,
    '',
    `Your SHANEX Print Manager quotation ${quotation.number} is ready.`,
    `Plan: ${quotation.planDays} days`,
    `Licenses: ${quotation.licenses}`,
    `Total: ${formatCurrency(quotation.total)}`,
    '',
    'Please complete the payment before activation. After payment, send the bank reference number.',
    '',
    'Thank you.',
    db.settings.companyName,
  ].join('\n');
}

function invoiceMessage(invoice, customer) {
  return [
    `Hello ${customer.shopName},`,
    '',
    `Your invoice ${invoice.number} is ready.`,
    `Total: ${formatCurrency(invoice.total)}`,
    `Paid: ${formatCurrency(invoice.paidAmount)}`,
    `Balance: ${formatCurrency(invoice.balance)}`,
    `Status: ${invoice.status.toUpperCase()}`,
    '',
    db.settings.companyName,
    `${db.settings.phone} | ${db.settings.email}`,
  ].join('\n');
}

function customerFinance(customerId) {
  recalcAllInvoices();
  const customer = db.customers.find((item) => item.id === customerId);
  const quotations = db.quotations.filter((item) => item.customerId === customerId);
  const invoices = db.invoices.filter((item) => item.customerId === customerId);
  const payments = db.payments.filter((item) => item.customerId === customerId);
  const loyalty = db.loyaltyLedger.filter((item) => item.customerId === customerId);
  return {
    customer,
    quotations,
    invoices,
    payments,
    loyalty,
    totals: {
      quoted: quotations.reduce((sum, item) => sum + asMoney(item.total), 0),
      invoiced: invoices.reduce((sum, item) => sum + asMoney(item.total), 0),
      paid: payments.reduce((sum, item) => sum + asMoney(item.amount), 0),
      pending: invoices.reduce((sum, item) => sum + asMoney(item.balance), 0),
      loyaltyPoints: loyalty.reduce((sum, item) => sum + Number(item.points || 0), 0),
    },
  };
}

function documentHtml(type, doc, customer) {
  const isInvoice = type === 'invoice';
  const title = isInvoice ? 'Invoice' : 'Quotation';
  const status = cleanValue(doc.status || (isInvoice ? 'unpaid' : 'draft')).toUpperCase();
  const payments = isInvoice ? db.payments.filter((payment) => payment.invoiceId === doc.id) : [];
  const paymentRows = payments.length
    ? payments.map((payment) => `<tr><td>${escHtml(new Date(payment.receivedAt).toLocaleDateString())}</td><td>${escHtml(payment.method)}</td><td>${escHtml(payment.reference || '-')}</td><td class="right">${formatCurrency(payment.amount)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">No payments received yet.</td></tr>';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escHtml(title)} ${escHtml(doc.number)}</title>
  <style>
    @page { size:A4; margin:10mm; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Arial, sans-serif; color:#0a1b4d; background:#fff; }
    .top { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; border-bottom:2px solid #246bff; padding-bottom:14px; }
    .doc-brand { min-width:230px; max-width:58%; }
    .brand-logo-wrap { width:224px; height:64px; padding:3px 8px 3px 0; overflow:visible; display:flex; align-items:center; justify-content:flex-start; }
    .brand-logo { width:100%; height:100%; object-fit:contain; object-position:left center; display:block; }
    .tag { color:#526083; margin-top:4px; font-size:12px; }
    .company, .doc-meta { color:#526083; line-height:1.35; font-size:11px; }
    .doc-title { text-align:right; }
    h1 { margin:0; font-size:28px; color:#0a1b4d; }
    .badge { display:inline-block; margin-top:6px; padding:5px 8px; border-radius:4px; background:#edf4ff; color:#246bff; font-weight:700; font-size:11px; }
    .panel { margin-top:14px; border:1px solid #dce4f2; border-radius:8px; padding:11px; }
    .two { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    h2 { margin:0 0 7px; font-size:11px; text-transform:uppercase; color:#246bff; }
    table { width:100%; border-collapse:collapse; margin-top:14px; }
    th { background:#f5f7fb; color:#2b49a3; text-align:left; font-size:10px; text-transform:uppercase; padding:8px; border-bottom:1px solid #dce4f2; }
    td { padding:8px; border-bottom:1px solid #dce4f2; vertical-align:top; font-size:12px; }
    .right { text-align:right; }
    .totals { width:290px; margin-left:auto; margin-top:12px; }
    .totals div { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid #e6eaf2; font-size:12px; }
    .totals .grand { font-size:17px; font-weight:800; border-bottom:0; color:#0a1b4d; }
    .muted { color:#526083; }
    .notes { white-space:pre-wrap; line-height:1.35; font-size:11px; }
    .footer { margin-top:16px; display:flex; justify-content:space-between; gap:20px; color:#526083; font-size:10px; border-top:1px solid #dce4f2; padding-top:10px; }
    @media print { .no-print { display:none; } body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
    .print-btn { position:fixed; right:22px; top:22px; background:#246bff; color:#fff; border:0; border-radius:6px; padding:10px 14px; font-weight:700; cursor:pointer; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print / Save PDF</button>
  <div class="top">
    <div class="doc-brand">
      <div class="brand-logo-wrap">
        <img class="brand-logo" src="http://127.0.0.1:${port}${escHtml(db.settings.logoPath || '/assets/shanex-logo.png')}" alt="SHANEX">
      </div>
      <div class="tag">Develop • Design • Print</div>
      <div class="company">
        ${escHtml(db.settings.website)}<br>
        ${escHtml(db.settings.phone)} | ${escHtml(db.settings.email)}<br>
        ${escHtml(db.settings.address)}
      </div>
    </div>
    <div class="doc-title">
      <h1>${title}</h1>
      <div class="doc-meta">
        <strong>${escHtml(doc.number)}</strong><br>
        Date: ${escHtml(new Date(doc.createdAt || nowIso()).toLocaleDateString())}<br>
        ${isInvoice && doc.dueDate ? `Due: ${escHtml(doc.dueDate)}<br>` : ''}
        <span class="badge">${escHtml(status)}</span>
      </div>
    </div>
  </div>

  <div class="two panel">
    <div>
      <h2>Bill To</h2>
      <strong>${escHtml(customer.shopName)}</strong><br>
      <span class="muted">${escHtml(customer.customerName || '')}</span><br>
      ${escHtml(customer.contactNumber || '')}<br>
      ${escHtml(customer.exactLocation || '')}
    </div>
    <div>
      <h2>License Details</h2>
      Plan: ${escHtml(doc.planDays)} days<br>
      Licenses: ${escHtml(doc.licenses)}<br>
      Unit Price: ${formatCurrency(doc.unitPrice)}
    </div>
  </div>

  <table>
    <thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Amount</th></tr></thead>
    <tbody>
      <tr>
        <td>SHANEX Print Manager License - ${escHtml(doc.planDays)} days</td>
        <td class="right">${escHtml(doc.licenses)}</td>
        <td class="right">${formatCurrency(doc.unitPrice)}</td>
        <td class="right">${formatCurrency(doc.subtotal)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <div><span>Subtotal</span><strong>${formatCurrency(doc.subtotal)}</strong></div>
    <div><span>Discount</span><strong>${formatCurrency(doc.discount)}</strong></div>
    ${isInvoice ? `<div><span>Paid</span><strong>${formatCurrency(doc.paidAmount)}</strong></div><div><span>Balance</span><strong>${formatCurrency(doc.balance)}</strong></div>` : ''}
    <div class="grand"><span>Total</span><strong>${formatCurrency(doc.total)}</strong></div>
  </div>

  ${isInvoice ? `<div class="panel"><h2>Payments</h2><table><thead><tr><th>Date</th><th>Method</th><th>Bank Reference</th><th class="right">Amount</th></tr></thead><tbody>${paymentRows}</tbody></table></div>` : ''}

  <div class="two">
    <div class="panel notes">
      <h2>Bank Details</h2>
      ${escHtml(db.settings.bankDetails || '')}
    </div>
    <div class="panel notes">
      <h2>Terms & Conditions</h2>
      ${escHtml(db.settings.terms || '')}
    </div>
  </div>

  ${doc.notes ? `<div class="panel notes"><h2>Notes</h2>${escHtml(doc.notes)}</div>` : ''}

  <div class="footer">
    <div>Generated by SHANEX Control Desk</div>
    <div>${escHtml(db.settings.email)} • ${escHtml(db.settings.phone)}</div>
  </div>
</body>
</html>`;
}

function paymentStatementHtml(customerId) {
  const finance = customerFinance(customerId);
  const customer = finance.customer;
  const invoiceMap = new Map(finance.invoices.map((invoice) => [invoice.id, invoice]));
  const rows = finance.payments.length
    ? finance.payments.map((payment) => {
      const invoice = invoiceMap.get(payment.invoiceId);
      return `<tr><td>${escHtml(new Date(payment.receivedAt).toLocaleDateString())}</td><td>${escHtml(invoice?.number || '-')}</td><td>${escHtml(payment.method || '-')}</td><td>${escHtml(payment.reference || '-')}</td><td class="right">${formatCurrency(payment.amount)}</td></tr>`;
    }).join('')
    : '<tr><td colspan="5" class="muted">No payments found for this customer.</td></tr>';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payment Statement - ${escHtml(customer.shopName)}</title>
  <style>
    @page { size:A4; margin:10mm; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Arial, sans-serif; color:#0a1b4d; background:#fff; font-size:12px; }
    .top { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; border-bottom:2px solid #246bff; padding-bottom:14px; }
    .brand-logo-wrap { width:224px; height:64px; padding:3px 8px 3px 0; display:flex; align-items:center; justify-content:flex-start; }
    .brand-logo { width:100%; height:100%; object-fit:contain; object-position:left center; display:block; }
    .company, .muted { color:#526083; line-height:1.35; }
    h1 { margin:0; font-size:26px; text-align:right; }
    h2 { margin:0 0 7px; font-size:11px; text-transform:uppercase; color:#246bff; }
    .panel { margin-top:14px; border:1px solid #dce4f2; border-radius:8px; padding:11px; }
    .summary { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:14px; }
    .box { border:1px solid #dce4f2; border-radius:8px; padding:10px; background:#fbfcff; }
    .box span { display:block; color:#526083; font-size:10px; text-transform:uppercase; }
    .box strong { display:block; margin-top:4px; font-size:15px; }
    table { width:100%; border-collapse:collapse; margin-top:14px; }
    th { background:#f5f7fb; color:#2b49a3; text-align:left; font-size:10px; text-transform:uppercase; padding:8px; border-bottom:1px solid #dce4f2; }
    td { padding:8px; border-bottom:1px solid #dce4f2; vertical-align:top; }
    .right { text-align:right; }
    .footer { margin-top:18px; display:flex; justify-content:space-between; gap:20px; color:#526083; font-size:10px; border-top:1px solid #dce4f2; padding-top:10px; }
    @media print { .no-print { display:none; } body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
    .print-btn { position:fixed; right:22px; top:22px; background:#246bff; color:#fff; border:0; border-radius:6px; padding:10px 14px; font-weight:700; cursor:pointer; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print / Save PDF</button>
  <div class="top">
    <div>
      <div class="brand-logo-wrap"><img class="brand-logo" src="http://127.0.0.1:${port}${escHtml(db.settings.logoPath || '/assets/shanex-logo.png')}" alt="SHANEX"></div>
      <div class="company">${escHtml(db.settings.website)}<br>${escHtml(db.settings.phone)} | ${escHtml(db.settings.email)}<br>${escHtml(db.settings.address)}</div>
    </div>
    <div>
      <h1>Payment Statement</h1>
      <div class="muted" style="text-align:right;">Generated: ${escHtml(new Date().toLocaleDateString())}</div>
    </div>
  </div>
  <div class="panel">
    <h2>Customer</h2>
    <strong>${escHtml(customer.shopName)}</strong><br>
    <span class="muted">${escHtml(customer.customerName || '')}<br>${escHtml(customer.contactNumber || '')}<br>${escHtml(customer.exactLocation || '')}</span>
  </div>
  <div class="summary">
    <div class="box"><span>Total Paid</span><strong>${formatCurrency(finance.totals.paid)}</strong></div>
    <div class="box"><span>Pending</span><strong>${formatCurrency(finance.totals.pending)}</strong></div>
    <div class="box"><span>Invoiced</span><strong>${formatCurrency(finance.totals.invoiced)}</strong></div>
    <div class="box"><span>Loyalty</span><strong>${finance.totals.loyaltyPoints} pts</strong></div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Invoice</th><th>Method</th><th>Bank Ref No</th><th class="right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    <div>Generated by SHANEX Control Desk</div>
    <div>${escHtml(db.settings.email)} • ${escHtml(db.settings.phone)}</div>
  </div>
</body>
</html>`;
}

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index === -1) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function isAuthenticated(req) {
  const token = parseCookies(req.headers.cookie || '')[sessionCookieName];
  return Boolean(token && sessions.has(token));
}

function setSessionCookie(res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: nowIso() });
  res.setHeader('Set-Cookie', `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearSessionCookie(req, res) {
  const token = parseCookies(req.headers.cookie || '')[sessionCookieName];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function loginPage(error = '') {
  return `<!doctype html>
<html lang="si">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SHANEX CRM Login</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --ink:#0a1b4d; --muted:#526083; --line:#dce4f2; --blue:#246bff; --cyan:#00c2e6; --violet:#6a4cff; --bg:#f5f7fb; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; font-family:Inter, Arial, sans-serif; color:var(--ink); background:radial-gradient(900px 280px at 50% -80px,#fff 0,#f7f9fd 58%,#edf3fb 100%); }
    body::before { content:""; position:fixed; inset:0; pointer-events:none; background:linear-gradient(135deg,rgba(36,107,255,.08),rgba(0,194,230,.05),rgba(106,76,255,.08)); }
    .login { width:min(420px, calc(100vw - 28px)); background:rgba(255,255,255,.9); border:1px solid var(--line); border-radius:8px; box-shadow:0 24px 80px rgba(10,27,77,.12); padding:28px; position:relative; }
    .brand { display:flex; align-items:center; gap:12px; margin-bottom:22px; }
    .brand img { height:42px; width:auto; }
    h1 { font-family:Sora, Inter, sans-serif; font-size:24px; margin:0; letter-spacing:0; }
    label { display:block; font-size:12px; font-weight:800; color:var(--muted); margin-bottom:8px; text-transform:uppercase; }
    input { width:100%; border:1px solid var(--line); border-radius:8px; padding:13px 14px; font:inherit; color:var(--ink); outline:none; }
    input:focus { border-color:var(--blue); box-shadow:0 0 0 4px rgba(36,107,255,.1); }
    button { width:100%; margin-top:16px; border:0; border-radius:8px; padding:13px 16px; color:white; font-weight:800; cursor:pointer; background:linear-gradient(90deg,var(--blue),var(--cyan),var(--violet)); }
    .muted { color:var(--muted); line-height:1.5; margin:0 0 18px; }
    .error { color:#b91c1c; background:#fee2e2; border:1px solid #fecaca; border-radius:8px; padding:10px 12px; margin-bottom:14px; }
  </style>
</head>
<body>
  <form class="login" method="post" action="/login">
    <div class="brand"><img src="/assets/shanex-logo.png" alt="SHANEX"><h1>CRM Login</h1></div>
    <p class="muted">Secure access for SHANEX customer, license, invoice, and WhatsApp intake management.</p>
    ${error ? `<div class="error">${escHtml(error)}</div>` : ''}
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus>
    <button type="submit">Login</button>
  </form>
</body>
</html>`;
}

async function renderPdf(pathname) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    const separator = pathname.includes('?') ? '&' : '?';
    await page.goto(`http://127.0.0.1:${port}${pathname}${separator}printToken=${internalPrintToken}`, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    });
  } finally {
    await browser.close();
  }
}

async function importStartupReport(text, meta = {}) {
  const parsed = parseStartupReport(text);
  if (!parsed) {
    throw new Error('This is not a SHANEX Print Manager startup report.');
  }
  if (!parsed.hwid) {
    throw new Error('HWID is required in the startup report.');
  }

  const stamp = nowIso();
  const identity = customerIdentity(parsed, meta);
  let pc = db.pcs.find((item) => item.hwid === parsed.hwid);
  let customer = pc ? db.customers.find((item) => item.id === pc.customerId) : null;

  if (!customer) {
    customer = db.customers.find((item) => item.identityKey === identity.identityKey);
  }

  if (!customer && identity.contactNumber) {
    customer = db.customers.find((item) => cleanPhone(item.contactNumber) === identity.contactNumber);
  }

  if (!customer && parsed.shop && !isGenericShopName(parsed.shop)) {
    customer = db.customers.find(
      (item) => item.shopName.toLowerCase() === parsed.shop.toLowerCase(),
    );
  }

  if (!customer) {
    customer = {
      id: nextId(db.customers),
      identityKey: identity.identityKey,
      customerName: identity.customerName,
      shopName: identity.shopName,
      sourceShopName: identity.sourceShopName,
      contactNumber: identity.contactNumber,
      exactLocation: '',
      latitude: null,
      longitude: null,
      googleMapsLink: '',
      status: 'active',
      notes: '',
      createdAt: stamp,
      updatedAt: stamp,
    };
    db.customers.push(customer);
  } else {
    customer.identityKey ||= identity.identityKey;
    customer.sourceShopName = identity.sourceShopName || customer.sourceShopName || '';
    customer.updatedAt = stamp;
    if (identity.contactNumber && !customer.contactNumber) customer.contactNumber = identity.contactNumber;
    if (isGenericShopName(customer.shopName) && !isGenericShopName(identity.shopName)) {
      customer.shopName = identity.shopName;
      customer.customerName = identity.customerName;
    }
  }

  if (!pc) {
    pc = {
      id: nextId(db.pcs),
      customerId: customer.id,
      pcName: parsed.pcName,
      hwid: parsed.hwid,
      version: parsed.version,
      cpu: parsed.cpu,
      ram: parsed.ram,
      ipWan: parsed.ipWan,
      ipLan: parsed.ipLan,
      os: parsed.os,
      license: parsed.license,
      remaining: parsed.remaining,
      reportFormat: parsed.format,
      status: parsed.status,
      lastReportTime: parsed.reportTime,
      lastSeenAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
    };
    db.pcs.push(pc);
  } else {
    Object.assign(pc, {
      customerId: customer.id,
      pcName: parsed.pcName || pc.pcName,
      version: parsed.version || pc.version,
      cpu: parsed.cpu || pc.cpu,
      ram: parsed.ram || pc.ram,
      ipWan: parsed.ipWan || pc.ipWan,
      ipLan: parsed.ipLan || pc.ipLan,
      os: parsed.os || pc.os,
      license: parsed.license || pc.license,
      remaining: parsed.remaining || pc.remaining,
      reportFormat: parsed.format || pc.reportFormat,
      status: parsed.status || pc.status,
      lastReportTime: parsed.reportTime || pc.lastReportTime,
      lastSeenAt: stamp,
      updatedAt: stamp,
    });
  }

  const reportDate = reportDateKey(parsed.reportTime, stamp);
  const existingDailyImport = db.imports.find(
    (item) => Number(item.pcId) === Number(pc.id) && importReportDate(item) === reportDate,
  );
  const importPayload = {
    customerId: customer.id,
    pcId: pc.id,
    hwid: parsed.hwid,
    from: meta.from || '',
    fromName: meta.fromName || '',
    rawText: text,
    reportTime: parsed.reportTime,
    reportDate,
    lastImportedAt: stamp,
  };

  if (existingDailyImport) {
    Object.assign(existingDailyImport, importPayload, {
      count: Math.max(1, Number(existingDailyImport.count || 1)) + 1,
      firstImportedAt: existingDailyImport.firstImportedAt || existingDailyImport.importedAt || stamp,
    });
  } else {
    db.imports.unshift({
      id: nextId(db.imports),
      ...importPayload,
      importedAt: stamp,
      firstImportedAt: stamp,
      count: 1,
    });
  }
  normalizeImports();
  await saveDb();

  return { customer: publicCustomer(customer), pc, parsed, duplicateDaily: Boolean(existingDailyImport) };
}

function stats() {
  recalcAllInvoices();
  const pcs = uniquePcs();
  const customers = billableCustomers();
  const customerGrowth = customerAnalytics();
  const activeCustomers = customers.filter((customer) => customer.status !== 'inactive').length;
  const onlineToday = pcs.filter((pc) => {
    if (!pc.lastSeenAt) return false;
    return Date.now() - new Date(pc.lastSeenAt).getTime() < 24 * 60 * 60 * 1000;
  }).length;
  const today = new Date().toISOString().slice(0, 10);
  const openTickets = db.tickets.filter((ticket) => !['closed', 'resolved'].includes(ticket.status)).length;
  const todayTickets = db.tickets.filter((ticket) => String(ticket.scheduledAt || '').slice(0, 10) === today).length;

  return {
    customers: customers.length,
    activeCustomers,
    pcs: pcs.length,
    onlineToday,
    imports: db.imports.length,
    mappedCustomers: customers.filter((customer) => customer.latitude && customer.longitude).length,
    quotes: db.quotations.length,
    invoices: db.invoices.length,
    paidIncome: db.payments.reduce((sum, payment) => sum + asMoney(payment.amount), 0),
    pendingIncome: db.invoices.reduce((sum, invoice) => sum + asMoney(invoice.balance), 0),
    expectedIncome: db.invoices.reduce((sum, invoice) => sum + asMoney(invoice.total), 0),
    openTickets,
    todayTickets,
    todayNewCustomers: customerGrowth.todayNewCustomers,
    todayReturningCustomers: customerGrowth.todayReturningCustomers,
    customerGrowthSpeed: customerGrowth.sevenDayNewAverage,
    customerGrowthDelta: customerGrowth.growthDelta,
  };
}

function analytics() {
  const today = localDateKey();
  const labels = Array.from({ length: 7 }, (_, index) => addDaysKey(today, -(6 - index)));
  const dailyImports = labels.map((label) => ({
    label: chartLabel(label),
    value: db.imports.filter((item) => importReportDate(item) === label).length,
  }));
  const customerGrowth = customerAnalytics();

  const pcs = uniquePcs();
  const licenseCounts = pcs.reduce((acc, pc) => {
    const label = pc.license || 'Unknown';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const pcByCustomer = db.customers
    .map((customer) => ({
      label: customer.shopName,
      value: pcs.filter((pc) => pc.customerId === customer.id).length,
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return {
    dailyImports,
    licenseMix: Object.entries(licenseCounts).map(([label, value]) => ({ label, value })),
    pcByCustomer,
    customerGrowth,
  };
}

function licensePcList(license) {
  return uniquePcs()
    .filter((pc) => (pc.license || 'Unknown') === license)
    .map((pc) => {
      const customer = db.customers.find((item) => item.id === pc.customerId) || {};
      return {
        id: pc.id,
        pcName: pc.pcName,
        hwid: pc.hwid,
        license: pc.license || 'Unknown',
        remaining: pc.remaining,
        lastSeenAt: pc.lastSeenAt,
        customerId: pc.customerId,
        customerName: customer.customerName || '',
        shopName: customer.shopName || '',
        contactNumber: customer.contactNumber || '',
      };
    })
    .sort((a, b) => dateValue(b.lastSeenAt) - dateValue(a.lastSeenAt));
}

function parseReportDate(value, fallback) {
  const parsed = Date.parse(value || '');
  if (Number.isFinite(parsed)) return new Date(parsed);
  return new Date(fallback || nowIso());
}

function formatMinutesOfDay(minutes) {
  if (!Number.isFinite(minutes)) return '-';
  const total = Math.round(minutes);
  const hours24 = Math.floor(total / 60) % 24;
  const mins = total % 60;
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

function customerActivity(customerId) {
  const imports = db.imports
    .filter((item) => item.customerId === customerId)
    .slice()
    .sort((a, b) => new Date(a.importedAt) - new Date(b.importedAt));
  const activeDates = new Set(imports.map((item) => importReportDate(item)).filter(Boolean));
  const minuteValues = imports.map((item) => {
    const date = parseReportDate(item.reportTime, item.importedAt);
    return date.getHours() * 60 + date.getMinutes();
  });
  const avgMinutes = minuteValues.length
    ? minuteValues.reduce((sum, value) => sum + value, 0) / minuteValues.length
    : Number.NaN;
  const labels = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - index));
    return date.toISOString().slice(0, 10);
  });
  const daily = labels.map((label) => ({
    label: new Date(`${label}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: new Set(imports.filter((item) => importReportDate(item) === label).map((item) => item.pcId)).size,
  }));

  return {
    activeDays: activeDates.size,
    totalStartups: imports.length,
    averageStartupTime: formatMinutesOfDay(avgMinutes),
    lastStartupAt: imports.at(-1)?.lastImportedAt || imports.at(-1)?.importedAt || '',
    daily,
  };
}

function googleMapsUrl(customer) {
  if (customer.googleMapsLink) return customer.googleMapsLink;
  if (customer.latitude && customer.longitude) {
    return `https://www.google.com/maps/search/?api=1&query=${customer.latitude},${customer.longitude}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.exactLocation || customer.shopName)}`;
}

function page() {
  return `<!doctype html>
<html lang="si">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SHANEX WhatsApp CRM</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --bg:#f5f7fb; --panel:#ffffff; --ink:#0a1b4d; --muted:#526083; --line:#dce4f2; --blue:#246bff; --violet:#6a4cff; --cyan:#00c2e6; --soft:#e6eaf2; --danger:#ef4444; --shadow:0 18px 48px rgba(10,27,77,.08); --grad:linear-gradient(90deg,var(--blue),var(--cyan),var(--violet)); }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Inter, Arial, "Noto Sans Sinhala", sans-serif; background:var(--bg); color:var(--ink); min-height:100vh; }
    body::before { content:""; position:fixed; inset:0; height:360px; pointer-events:none; z-index:-2; background:radial-gradient(1200px 360px at 50% -120px,#ffffff 0,#f6f8fc 55%,#eef3fb 100%); }
    body::after { content:""; position:fixed; inset:auto 0 0 0; height:210px; pointer-events:none; z-index:-1; opacity:.65; background:linear-gradient(170deg,transparent 0 48%,rgba(230,234,242,.9) 49% 57%,transparent 58%); }
    header { color:var(--ink); padding:34px clamp(18px,4vw,56px) 20px; display:flex; align-items:center; justify-content:space-between; gap:18px; flex-wrap:wrap; position:relative; }
    header::before, header::after { content:""; position:absolute; width:142px; height:86px; opacity:.45; background-image:radial-gradient(#b8c7ee 1.6px,transparent 1.6px); background-size:16px 16px; pointer-events:none; }
    header::before { left:36px; top:16px; }
    header::after { right:36px; top:66px; }
    .brand { display:flex; align-items:center; gap:26px; position:relative; z-index:1; min-width:0; }
    .logo { width:54px; height:54px; border-radius:8px; display:grid; place-items:center; background:linear-gradient(135deg,#0a1b4d 0 54%,#246bff 55% 76%,#00c2e6 77%); color:#fff; font-family:Sora,Inter,sans-serif; font-weight:800; box-shadow:0 14px 32px rgba(36,107,255,.18); }
    .logo img { width:100%; height:100%; object-fit:contain; object-position:left center; display:block; }
    .brand.has-logo .logo { width:220px; height:62px; flex:0 0 220px; overflow:visible; background:transparent; box-shadow:none; border-radius:0; }
    .brand-copy { min-width:0; }
    .brand-title { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
    .brand-title h1 { font-weight:400; }
    .brand-word { display:none; }
    h1 { margin:0; font-family:Sora,Inter,sans-serif; font-size:clamp(24px,3vw,38px); letter-spacing:0; }
    header p { margin:10px 0 0; color:var(--muted); font-size:16px; }
    .accent-line { width:104px; height:4px; border-radius:999px; background:var(--grad); margin-top:14px; }
    main { max-width:1540px; margin:0 auto; padding:4px clamp(12px,3vw,34px) 40px; }
    .status { display:flex; align-items:center; gap:10px; padding:10px 13px; border-radius:8px; background:#fff; border:1px solid var(--line); box-shadow:var(--shadow); position:relative; z-index:1; }
    .dot { width:10px; height:10px; border-radius:999px; background:#f59e0b; box-shadow:0 0 0 5px rgba(245,158,11,.18); }
    .dot.ready { background:#22c55e; box-shadow:0 0 0 5px rgba(34,197,94,.18); }
    .hero { background:rgba(255,255,255,.82); border:1px solid var(--line); border-radius:8px; padding:18px; color:var(--ink); box-shadow:var(--shadow); margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; position:relative; overflow:hidden; }
    .hero::after { content:""; position:absolute; right:22px; top:16px; width:96px; height:64px; opacity:.42; background-image:radial-gradient(#b8c7ee 1.5px,transparent 1.5px); background-size:13px 13px; }
    .hero strong { font-family:Sora,Inter,sans-serif; font-size:20px; }
    .grid { display:grid; grid-template-columns:1fr; gap:18px; align-items:start; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; margin-bottom:18px; }
    .analytics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-bottom:18px; }
    .chart-card { min-height:292px; display:flex; flex-direction:column; }
    .chart-card canvas { width:100%; height:220px; max-height:220px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:var(--shadow); padding:15px; position:relative; overflow:hidden; }
    .card::before { content:""; position:absolute; left:0; top:0; right:0; height:3px; background:var(--grad); }
    .card::after { content:""; position:absolute; right:-16px; top:-18px; width:72px; height:72px; opacity:.7; background:linear-gradient(135deg,#eef4ff,#e8fbff); border-radius:18px; transform:rotate(12deg); }
    .card span { display:block; color:var(--muted); font-size:13px; position:relative; z-index:1; }
    .card strong { display:block; font-size:26px; margin-top:5px; position:relative; z-index:1; }
    section { background:rgba(255,255,255,.9); border:1px solid var(--line); border-radius:8px; box-shadow:var(--shadow); padding:16px; backdrop-filter:blur(8px); }
    h2 { margin:0 0 12px; font-family:Sora,Inter,sans-serif; font-size:20px; }
    h2::before { content:""; display:inline-block; width:26px; height:4px; border-radius:999px; background:var(--grad); margin-right:10px; vertical-align:middle; }
    label { display:block; font-weight:800; font-size:12px; text-transform:uppercase; color:#2b49a3; margin:10px 0 6px; letter-spacing:.03em; }
    input, textarea, select { width:100%; border:1px solid #dbe3f0; border-radius:8px; padding:11px 12px; font:inherit; background:#fbfcff; color:var(--ink); outline:none; }
    textarea { min-height:160px; resize:vertical; }
    input:focus, textarea:focus { border-color:var(--blue); box-shadow:0 0 0 3px rgba(36,107,255,.12); background:#fff; }
    button { border:0; border-radius:8px; padding:10px 14px; min-height:40px; background:linear-gradient(135deg,var(--blue),var(--cyan)); color:white; font-weight:800; cursor:pointer; box-shadow:0 10px 22px rgba(36,107,255,.18); }
    button.secondary { background:#f0f3fa; color:#0a1b4d; box-shadow:none; border:1px solid #dbe3f0; }
    button.danger { background:var(--danger); }
    .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
    .stack { display:none; }
    .toolbar { display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap; }
    .toolbar input { flex:1; min-width:220px; }
    #map { height:390px; border:1px solid var(--line); border-radius:8px; margin-bottom:14px; background:#eef3fb; overflow:hidden; }
    .leaflet-container, .leaflet-pane, .leaflet-top, .leaflet-bottom { z-index:1 !important; }
    .map-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
    .map-controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .map-controls button { min-height:34px; padding:7px 10px; }
    .map-toggle { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:13px; font-weight:700; }
    .map-toggle input { width:auto; }
    table { width:100%; border-collapse:collapse; min-width:900px; }
    .table-wrap { overflow:auto; border:1px solid var(--line); border-radius:8px; background:white; }
    th,td { padding:12px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { background:#f5f7fb; color:#2b49a3; font-size:12px; text-transform:uppercase; letter-spacing:.03em; }
    tr:hover td { background:#fbfdfd; }
    .muted { color:var(--muted); font-size:13px; line-height:1.45; }
    .pill { display:inline-block; border-radius:999px; padding:4px 9px; background:#edf4ff; color:#246bff; font-size:12px; font-weight:800; }
    .pc-list { display:grid; gap:8px; }
    .pc-item { border:1px solid var(--line); border-radius:8px; padding:11px; background:#fbfdfd; }
    .split { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .modal-backdrop { position:fixed; inset:0; background:rgba(10,27,77,.42); display:none; align-items:flex-start; justify-content:center; padding:28px 12px; z-index:5000; overflow:auto; }
    .modal-backdrop.open { display:flex; }
    .modal { width:min(1180px,100%); background:#fff; border:1px solid var(--line); border-radius:8px; box-shadow:0 30px 80px rgba(10,27,77,.24); padding:18px; position:relative; z-index:5001; }
    .modal-close { position:absolute; right:14px; top:14px; width:38px; padding:0; background:#f0f3fa; color:var(--ink); box-shadow:none; border:1px solid var(--line); }
    .modal-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:start; }
    .mini-grid { display:grid; grid-template-columns:repeat(4,minmax(120px,1fr)); gap:10px; margin:12px 0; }
    .mini-card { border:1px solid var(--line); border-radius:8px; padding:10px; background:#fbfcff; }
    .mini-card span { display:block; color:var(--muted); font-size:12px; }
    .mini-card strong { display:block; font-size:20px; margin-top:4px; }
    .activity-chart { height:220px; max-height:220px; width:100%; }
    .event-log { max-height:190px; overflow:auto; display:grid; gap:8px; }
    .event-item { border:1px solid var(--line); border-radius:8px; padding:9px; background:#fbfcff; }
    .event-item strong { text-transform:uppercase; font-size:11px; color:var(--blue); }
    .event-item.received strong { color:#0a1b4d; }
    .event-item.imported strong { color:#16a34a; }
    .event-item.ignored strong { color:#d97706; }
    .event-item.error strong, .event-item.disconnected strong { color:#dc2626; }
    .doc-list { display:grid; gap:10px; }
    .doc { border:1px solid var(--line); border-radius:8px; padding:11px; background:#fbfcff; }
    .doc-head { display:flex; justify-content:space-between; gap:8px; align-items:center; flex-wrap:wrap; }
    .hero-tools { display:flex; gap:8px; flex-wrap:wrap; position:relative; z-index:1; }
    #qrPanel { border-color:rgba(36,107,255,.24); }
    @media(max-width:1080px){ .grid,.stats,.analytics,.modal-grid{grid-template-columns:1fr 1fr;} .grid{grid-template-columns:1fr;} .analytics .chart-card:first-child{grid-column:1/-1;} }
    @media(max-width:760px){ .brand.has-logo .logo{width:174px;height:50px;flex-basis:174px;} .brand{gap:14px;} h1{font-size:clamp(21px,6vw,30px);} header p{font-size:14px;} }
    @media(max-width:660px){ .brand{align-items:flex-start; flex-direction:column;} .brand-copy{width:100%;} }
    @media(max-width:620px){ .stats,.split,.analytics,.modal-grid,.mini-grid{grid-template-columns:1fr;} header{padding:16px;} main{padding:10px 10px 28px;} .hero{align-items:flex-start;} .analytics .chart-card:first-child{grid-column:auto;} }
    @media(max-width:520px){ .brand{width:100%;align-items:flex-start;} .brand-title{gap:4px 7px;} .accent-line{margin-top:10px;} .status{margin-left:0;} }
  </style>
</head>
<body>
  <header>
    <div class="brand has-logo">
      <div class="logo"><img src="${db.settings.logoPath || '/assets/shanex-logo.png'}" alt="SHANEX"></div>
      <div class="brand-copy">
        <div class="brand-title"><h1>Control Desk</h1></div>
        <div class="accent-line"></div>
        <p>WhatsApp startup reports, customer PCs, location intelligence.</p>
      </div>
    </div>
    <div class="status"><span id="statusDot" class="dot"></span><strong id="waStatus">Starting</strong><button class="secondary" id="logoutBtn" style="min-height:34px;padding:7px 10px;">Logout</button></div>
  </header>
  <main>
    <div class="hero">
      <div>
        <strong>Print Manager Live Intake</strong>
        <div class="muted">Incoming WhatsApp startup reports become customers and PC assets automatically.</div>
      </div>
      <div class="hero-tools">
        <button id="openImportBtn">Import Report</button>
        <button class="secondary" id="openFinanceBtn">Finance Center</button>
        <button class="secondary" id="openSupportBtn">Support Tickets</button>
        <button class="secondary" id="openSettingsBtn">Settings</button>
        <div class="pill">shanex.lk</div>
      </div>
    </div>
    <section id="qrPanel" style="display:none; margin-bottom:18px;">
      <h2>WhatsApp Login</h2>
      <p class="muted">Open WhatsApp on your phone, go to Linked devices, then scan this QR code.</p>
      <img id="qrImage" alt="WhatsApp QR" style="width:260px; max-width:100%; border:1px solid var(--line); border-radius:8px; background:white; padding:10px;">
    </section>
    <div class="stats">
      <div class="card"><span>Customers</span><strong id="sCustomers">0</strong></div>
      <div class="card"><span>New Today</span><strong id="sNewToday">0</strong></div>
      <div class="card"><span>Returning Today</span><strong id="sReturningToday">0</strong></div>
      <div class="card"><span>Growth / Day</span><strong id="sGrowthSpeed">0</strong></div>
      <div class="card"><span>Active</span><strong id="sActive">0</strong></div>
      <div class="card"><span>PCs</span><strong id="sPcs">0</strong></div>
      <div class="card"><span>Seen Today</span><strong id="sOnline">0</strong></div>
      <div class="card"><span>Imports</span><strong id="sImports">0</strong></div>
      <div class="card"><span>Mapped</span><strong id="sMapped">0</strong></div>
      <div class="card"><span>Paid</span><strong id="sPaid">Rs. 0</strong></div>
      <div class="card"><span>Pending</span><strong id="sPending">Rs. 0</strong></div>
      <div class="card"><span>Expected</span><strong id="sExpected">Rs. 0</strong></div>
      <div class="card"><span>Open Tickets</span><strong id="sOpenTickets">0</strong></div>
      <div class="card"><span>Today Jobs</span><strong id="sTodayTickets">0</strong></div>
    </div>

    <div class="analytics">
      <section class="chart-card">
        <h2>Import Trend</h2>
        <canvas id="importsLine"></canvas>
      </section>
      <section class="chart-card">
        <h2>License Mix</h2>
        <canvas id="licensePie"></canvas>
      </section>
      <section class="chart-card">
        <h2>PC Load</h2>
        <canvas id="pcBar"></canvas>
      </section>
      <section class="chart-card">
        <h2>Customer Growth</h2>
        <canvas id="customerGrowthLine"></canvas>
      </section>
    </div>

    <section style="margin-bottom:18px;">
      <h2>WhatsApp Intake Log</h2>
      <div id="waEvents" class="event-log"><div class="muted">Waiting for WhatsApp events.</div></div>
    </section>

    <div class="grid">
      <div class="stack">
        <section>
          <h2>Manual Import</h2>
          <p class="muted">Paste a startup report here when you want to import a message manually.</p>
          <textarea id="reportText" placeholder="Paste SHANEX Print Manager startup report here"></textarea>
          <div class="actions"><button id="importBtn">Import Report</button></div>
          <div id="importNote" class="muted" style="margin-top:8px;"></div>
        </section>

        <section>
          <h2>Selected Customer</h2>
          <div id="selectedCustomer" class="muted">Select a customer row.</div>
          <div class="split">
            <div><label>Latitude</label><input id="latInput" placeholder="6.927079"></div>
            <div><label>Longitude</label><input id="lngInput" placeholder="79.861244"></div>
          </div>
          <label>Exact Location</label><input id="locationInput" placeholder="Shop address">
          <label>Google Maps Link</label><input id="mapsInput" placeholder="https://maps.google.com/...">
          <div class="actions"><button id="saveLocationBtn">Save Location</button></div>
        </section>

        <section>
          <h2>PCs Under Customer</h2>
          <div id="pcList" class="pc-list"><div class="muted">Select a customer.</div></div>
        </section>
      </div>

      <section>
        <div class="map-head">
          <h2 style="margin:0;">Customer Map</h2>
          <div class="map-controls">
            <button class="secondary" id="mapZoomInBtn">+</button>
            <button class="secondary" id="mapZoomOutBtn">-</button>
            <button class="secondary" id="mapSriLankaBtn">Sri Lanka</button>
            <label class="map-toggle"><input id="wheelZoomToggle" type="checkbox"> Wheel zoom</label>
          </div>
        </div>
        <div id="map"></div>
        <div class="toolbar">
          <input id="search" placeholder="Search shop, customer, phone, HWID, PC">
          <button class="secondary" id="refreshBtn">Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Customer / Shop</th><th>Contact</th><th>PCs</th><th>Last Seen</th><th>Location</th><th>Actions</th></tr></thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </section>
    </div>
  </main>

  <div id="modalBackdrop" class="modal-backdrop">
    <div class="modal">
      <button class="modal-close" id="modalCloseBtn">×</button>
      <h2 id="modalTitle">Manage</h2>
      <div id="modalBody"></div>
    </div>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    let customers = [];
    let selectedId = null;
    let map = null;
    let layer = null;
    let charts = {};
    let wheelZoomEnabled = false;

    function esc(value){ return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function money(value){ return 'Rs. ' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
    async function api(path, options = {}) {
      const res = await fetch(path, { headers:{'content-type':'application/json'}, ...options });
      if (res.status === 401) {
        location.href = '/login';
        throw new Error('Login required');
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    }
    function mapsUrl(c){
      if (c.googleMapsLink) return c.googleMapsLink;
      if (c.latitude && c.longitude) return 'https://www.google.com/maps/search/?api=1&query=' + c.latitude + ',' + c.longitude;
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.exactLocation || c.shopName);
    }
    async function load(){
      const q = encodeURIComponent(document.querySelector('#search').value.trim());
      const [status, stats, list, analytics] = await Promise.all([api('/api/status'), api('/api/stats'), api('/api/customers?q=' + q), api('/api/analytics')]);
      customers = list;
      document.querySelector('#waStatus').textContent = status.status;
      document.querySelector('#statusDot').className = status.status === 'ready' ? 'dot ready' : 'dot';
      document.querySelector('#qrPanel').style.display = status.qrDataUrl ? 'block' : 'none';
      if (status.qrDataUrl) document.querySelector('#qrImage').src = status.qrDataUrl;
      document.querySelector('#sCustomers').textContent = stats.customers;
      document.querySelector('#sNewToday').textContent = stats.todayNewCustomers;
      document.querySelector('#sReturningToday').textContent = stats.todayReturningCustomers;
      document.querySelector('#sGrowthSpeed').textContent = Number(stats.customerGrowthSpeed || 0).toFixed(1);
      document.querySelector('#sActive').textContent = stats.activeCustomers;
      document.querySelector('#sPcs').textContent = stats.pcs;
      document.querySelector('#sOnline').textContent = stats.onlineToday;
      document.querySelector('#sImports').textContent = stats.imports;
      document.querySelector('#sMapped').textContent = stats.mappedCustomers;
      document.querySelector('#sPaid').textContent = money(stats.paidIncome);
      document.querySelector('#sPending').textContent = money(stats.pendingIncome);
      document.querySelector('#sExpected').textContent = money(stats.expectedIncome);
      document.querySelector('#sOpenTickets').textContent = stats.openTickets;
      document.querySelector('#sTodayTickets').textContent = stats.todayTickets;
      renderRows();
      renderMap();
      renderCharts(analytics);
      renderWaEvents(status.events || []);
      if (selectedId) renderSelected();
    }
    function renderWaEvents(events){
      const target = document.querySelector('#waEvents');
      if (!target) return;
      target.innerHTML = events.length ? events.slice(0, 8).map(event =>
        '<div class="event-item ' + esc(event.type) + '"><strong>' + esc(event.type) + '</strong><div>' + esc(event.message) + '</div><div class="muted">' + esc(event.from || '') + (event.from ? ' | ' : '') + new Date(event.at).toLocaleString() + '</div></div>'
      ).join('') : '<div class="muted">No WhatsApp events yet. New startup reports will appear here.</div>';
    }
    function renderRows(){
      document.querySelector('#rows').innerHTML = customers.map(c => {
        const last = c.pcs[0]?.lastSeenAt ? new Date(c.pcs[0].lastSeenAt).toLocaleString() : '-';
        return '<tr>' +
          '<td><strong>' + esc(c.shopName) + '</strong><div class="muted">' + esc(c.customerName) + '</div></td>' +
          '<td>' + esc(c.contactNumber || '-') + '</td>' +
          '<td><span class="pill">' + c.pcCount + '</span><div class="muted">' + esc(c.pcs.map(p => p.pcName).join(', ') || '-') + '</div></td>' +
          '<td>' + esc(last) + '</td>' +
          '<td>' + (c.latitude && c.longitude ? '<span class="pill">mapped</span>' : '<span class="muted">not set</span>') + '</td>' +
          '<td><button class="secondary" data-manage="' + c.id + '">Manage</button> <a target="_blank" href="' + mapsUrl(c) + '"><button>Maps</button></a></td>' +
        '</tr>';
      }).join('');
    }
    function renderMap(){
      if (!window.L) return;
      if (!map) {
        map = L.map('map', { scrollWheelZoom:false, zoomControl:false }).setView([7.8731, 80.7718], 7);
        L.control.zoom({ position:'topright' }).addTo(map);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; OpenStreetMap' }).addTo(map);
        layer = L.layerGroup().addTo(map);
      }
      if (wheelZoomEnabled) map.scrollWheelZoom.enable(); else map.scrollWheelZoom.disable();
      layer.clearLayers();
      const bounds = [];
      customers.filter(c => c.latitude && c.longitude).forEach(c => {
        const ll = [c.latitude, c.longitude];
        bounds.push(ll);
        L.marker(ll).addTo(layer).bindPopup('<strong>' + esc(c.shopName) + '</strong><br>' + esc(c.contactNumber || '') + '<br>PCs: ' + c.pcCount + '<br><a target="_blank" href="' + mapsUrl(c) + '">Open Google Maps</a>');
      });
      if (bounds.length) map.fitBounds(bounds, { padding:[28,28], maxZoom:12 });
      setTimeout(() => map.invalidateSize(), 100);
    }
    function chartColors(){
      return ['#246bff', '#00c2e6', '#6a4cff', '#0a1b4d', '#7aa7ff', '#72e3f2'];
    }
    function drawChart(id, config){
      if (!window.Chart) return;
      if (charts[id]) charts[id].destroy();
      charts[id] = new Chart(document.getElementById(id), config);
    }
    function licensePcHtml(label, rows){
      const body = rows.length ? rows.map(pc =>
        '<tr>' +
          '<td><strong>' + esc(pc.shopName || pc.customerName || '-') + '</strong><div class="muted">' + esc(pc.contactNumber || '-') + '</div></td>' +
          '<td>' + esc(pc.pcName || '-') + '<div class="muted">' + esc(pc.hwid || '-') + '</div></td>' +
          '<td><span class="pill">' + esc(pc.license || 'Unknown') + '</span><div class="muted">' + esc(pc.remaining || '') + '</div></td>' +
          '<td>' + esc(pc.lastSeenAt ? new Date(pc.lastSeenAt).toLocaleString() : '-') + '</td>' +
          '<td><button class="secondary" data-manage="' + pc.customerId + '">Manage</button></td>' +
        '</tr>'
      ).join('') : '<tr><td colspan="5"><div class="muted">No PCs in this license category.</div></td></tr>';
      return '<section><h2>' + esc(label) + ' PCs</h2><div class="table-wrap"><table><thead><tr><th>Customer</th><th>PC / HWID</th><th>License</th><th>Last Seen</th><th>Action</th></tr></thead><tbody>' + body + '</tbody></table></div></section>';
    }
    async function openLicenseCategory(label){
      const rows = await api('/api/license-pcs?license=' + encodeURIComponent(label || 'Unknown'));
      openModal('License: ' + (label || 'Unknown'), licensePcHtml(label || 'Unknown', rows));
    }
    function renderCharts(data){
      const baseOptions = {
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:'#0a1b4d', boxWidth:10, font:{ family:'Inter' } } } },
        scales:{
          x:{ ticks:{ color:'#526083', font:{ family:'Inter' } }, grid:{ display:false } },
          y:{ beginAtZero:true, ticks:{ precision:0, color:'#526083', font:{ family:'Inter' } }, grid:{ color:'#e6eaf2' } }
        }
      };
      drawChart('importsLine', {
        type:'line',
        data:{ labels:data.dailyImports.map(x => x.label), datasets:[{ label:'Reports', data:data.dailyImports.map(x => x.value), borderColor:'#246bff', backgroundColor:'rgba(36,107,255,.12)', fill:true, tension:.35, pointRadius:4 }] },
        options:baseOptions
      });
      drawChart('licensePie', {
        type:'doughnut',
        data:{ labels:data.licenseMix.map(x => x.label), datasets:[{ data:data.licenseMix.map(x => x.value), backgroundColor:chartColors(), borderColor:'#ffffff', borderWidth:3 }] },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          onClick:(_event, elements, chart) => {
            if (!elements.length) return;
            openLicenseCategory(chart.data.labels[elements[0].index]);
          },
          plugins:{ legend:{ position:'bottom', labels:{ color:'#0a1b4d', boxWidth:10, font:{ family:'Inter' } } } },
          cutout:'62%'
        }
      });
      drawChart('pcBar', {
        type:'bar',
        data:{ labels:data.pcByCustomer.map(x => x.label), datasets:[{ label:'PCs', data:data.pcByCustomer.map(x => x.value), backgroundColor:'rgba(0,194,230,.78)', borderColor:'#00c2e6', borderWidth:1, borderRadius:6 }] },
        options:baseOptions
      });
      drawChart('customerGrowthLine', {
        type:'line',
        data:{
          labels:data.customerGrowth.newCustomerTrend.map(x => x.label),
          datasets:[
            { label:'New Customers', data:data.customerGrowth.newCustomerTrend.map(x => x.value), borderColor:'#246bff', backgroundColor:'rgba(36,107,255,.12)', fill:true, tension:.35, pointRadius:4 },
            { label:'Returning Customers', data:data.customerGrowth.newCustomerTrend.map(x => x.returning), borderColor:'#00c2e6', backgroundColor:'rgba(0,194,230,.08)', fill:false, tension:.35, pointRadius:4 }
          ]
        },
        options:baseOptions
      });
    }
    function renderCustomerActivity(activity){
      drawChart('customerActivityChart', {
        type:'bar',
        data:{ labels:activity.daily.map(x => x.label), datasets:[{ label:'Startups', data:activity.daily.map(x => x.value), backgroundColor:'rgba(36,107,255,.72)', borderColor:'#246bff', borderWidth:1, borderRadius:6 }] },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          plugins:{ legend:{ display:false } },
          scales:{
            x:{ ticks:{ color:'#526083', font:{ family:'Inter' } }, grid:{ display:false } },
            y:{ beginAtZero:true, ticks:{ precision:0, color:'#526083', font:{ family:'Inter' } }, grid:{ color:'#e6eaf2' } }
          }
        }
      });
    }
    async function renderSelected(){
      const c = customers.find(x => x.id === selectedId);
      if (!c) return;
      document.querySelector('#selectedCustomer').innerHTML = '<strong>' + esc(c.shopName) + '</strong><div class="muted">' + esc(c.contactNumber || '') + '</div>';
      document.querySelector('#latInput').value = c.latitude || '';
      document.querySelector('#lngInput').value = c.longitude || '';
      document.querySelector('#locationInput').value = c.exactLocation || '';
      document.querySelector('#mapsInput').value = c.googleMapsLink || '';
      const pcs = await api('/api/customers/' + c.id + '/pcs');
      document.querySelector('#pcList').innerHTML = pcs.length ? pcs.map(p => '<div class="pc-item"><strong>' + esc(p.pcName || '-') + '</strong><span class="pill">' + esc(p.license || 'Unknown License') + '</span><div class="muted">HWID: ' + esc(p.hwid) + '</div><div>' + esc(p.cpu || '-') + '</div><div class="muted">' + esc(p.ram || '-') + ' | ' + esc(p.os || '-') + '</div><div class="muted">WAN ' + esc(p.ipWan || '-') + ' | LAN ' + esc(p.ipLan || '-') + ' | ' + esc(p.status || '-') + '</div></div>').join('') : '<div class="muted">No PCs.</div>';
    }
    function openModal(title, html){
      document.querySelector('#modalTitle').textContent = title;
      document.querySelector('#modalBody').innerHTML = html;
      document.querySelector('#modalBackdrop').classList.add('open');
    }
    function closeModal(){
      document.querySelector('#modalBackdrop').classList.remove('open');
    }
    function quoteForm(customerId){
      return '<section><h2>Create Quotation</h2>' +
        '<input type="hidden" id="quoteCustomerId" value="' + customerId + '">' +
        '<div class="split"><div><label>Plan Days</label><select id="quotePlan"><option value="30">30 Days</option><option value="365">365 Days</option></select></div><div><label>Licenses</label><input id="quoteLicenses" type="number" min="1" value="1"></div></div>' +
        '<div class="split"><div><label>Unit Price</label><input id="quoteUnitPrice" type="number" min="0" value="1000"></div><div><label>Discount</label><input id="quoteDiscount" type="number" min="0" value="0"></div></div>' +
        '<label>Notes</label><input id="quoteNotes" placeholder="Activation before payment / special note">' +
        '<div class="actions"><button id="createQuoteBtn">Create Quotation</button></div><div id="quoteNote" class="muted"></div></section>';
    }
    function renderDocs(finance){
      const quoteHtml = finance.quotations.length ? finance.quotations.map(q =>
        '<div class="doc"><div class="doc-head"><strong>' + esc(q.number) + '</strong><span class="pill">' + esc(q.status) + '</span></div>' +
        '<div class="muted">' + q.planDays + ' days | ' + q.licenses + ' licenses | ' + money(q.total) + '</div>' +
        '<textarea readonly style="min-height:100px;margin-top:8px;">' + esc(q.message || '') + '</textarea>' +
        '<div class="actions"><button class="secondary" data-copy-text="' + q.id + '" data-copy-kind="quote">Copy Message</button>' +
        '<a target="_blank" href="/documents/quotations/' + q.id + '"><button class="secondary">View</button></a>' +
        '<a target="_blank" href="/documents/quotations/' + q.id + '/pdf"><button>PDF</button></a>' +
        '<button data-convert-quote="' + q.id + '">Convert to Invoice</button></div></div>'
      ).join('') : '<div class="muted">No quotations yet.</div>';
      const invoiceHtml = finance.invoices.length ? finance.invoices.map(inv =>
        '<div class="doc"><div class="doc-head"><strong>' + esc(inv.number) + '</strong><span class="pill">' + esc(inv.status) + '</span></div>' +
        '<div class="muted">Total ' + money(inv.total) + ' | Paid ' + money(inv.paidAmount) + ' | Pending ' + money(inv.balance) + '</div>' +
        '<textarea readonly style="min-height:92px;margin-top:8px;">' + esc(inv.message || '') + '</textarea>' +
        '<div class="split"><div><label>Payment Amount</label><input id="payAmount' + inv.id + '" type="number" min="0" value="' + inv.balance + '"></div><div><label>Bank Ref No</label><input id="payRef' + inv.id + '" placeholder="Bank reference"></div></div>' +
        '<div class="actions"><button data-add-payment="' + inv.id + '">Add Payment</button><button class="secondary" data-copy-text="' + inv.id + '" data-copy-kind="invoice">Copy Invoice</button>' +
        '<a target="_blank" href="/documents/invoices/' + inv.id + '"><button class="secondary">View</button></a>' +
        '<a target="_blank" href="/documents/invoices/' + inv.id + '/pdf"><button>PDF</button></a></div></div>'
      ).join('') : '<div class="muted">No invoices yet.</div>';
      const paymentHtml = finance.payments.length ? finance.payments.map(p =>
        '<div class="doc"><strong>' + money(p.amount) + '</strong><div class="muted">Ref: ' + esc(p.reference || '-') + ' | ' + esc(p.method || '-') + ' | ' + new Date(p.receivedAt).toLocaleString() + '</div></div>'
      ).join('') : '<div class="muted">No payments yet.</div>';
      return '<section><h2>Quotations</h2><div class="doc-list">' + quoteHtml + '</div></section>' +
        '<section><h2>Invoices & Payments</h2><div class="doc-list">' + invoiceHtml + '</div></section>' +
        '<section><h2>Payment History</h2><div class="doc-list">' + paymentHtml + '</div></section>';
    }
    function ticketForm(customerId){
      const localNow = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
      return '<section><h2>Create Support Ticket</h2>' +
        '<input type="hidden" id="ticketCustomerId" value="' + customerId + '">' +
        '<label>Issue / Error</label><input id="ticketTitle" placeholder="Printer error / license issue / remote support">' +
        '<label>Description</label><textarea id="ticketDescription" style="min-height:90px;" placeholder="What happened?"></textarea>' +
        '<div class="split"><div><label>Priority</label><select id="ticketPriority"><option>normal</option><option>urgent</option><option>low</option></select></div><div><label>Status</label><select id="ticketStatus"><option>open</option><option>scheduled</option><option>in-progress</option></select></div></div>' +
        '<div class="split"><div><label>Allocate Time</label><input id="ticketScheduledAt" type="datetime-local" value="' + localNow + '"></div><div><label>Duration Minutes</label><input id="ticketDuration" type="number" min="5" value="30"></div></div>' +
        '<label>Assigned To</label><input id="ticketAssignee" placeholder="Technician name">' +
        '<div class="actions"><button id="createTicketBtn">Create Ticket</button></div><div id="ticketNote" class="muted"></div></section>';
    }
    function renderTickets(tickets){
      if (!tickets.length) return '<div class="muted">No support tickets yet.</div>';
      return tickets.map(ticket =>
        '<div class="doc"><div class="doc-head"><strong>#' + ticket.id + ' ' + esc(ticket.title || '-') + '</strong><span class="pill">' + esc(ticket.status) + '</span></div>' +
        '<div class="muted">' + esc(ticket.priority) + ' | ' + (ticket.scheduledAt ? new Date(ticket.scheduledAt).toLocaleString() : 'No time allocated') + ' | ' + ticket.durationMinutes + ' mins</div>' +
        '<div>' + esc(ticket.description || '') + '</div>' +
        '<label>Status</label><select data-ticket-status="' + ticket.id + '"><option ' + (ticket.status === 'open' ? 'selected' : '') + '>open</option><option ' + (ticket.status === 'scheduled' ? 'selected' : '') + '>scheduled</option><option ' + (ticket.status === 'in-progress' ? 'selected' : '') + '>in-progress</option><option ' + (ticket.status === 'resolved' ? 'selected' : '') + '>resolved</option><option ' + (ticket.status === 'closed' ? 'selected' : '') + '>closed</option></select></div>'
      ).join('');
    }
    async function openCustomerModal(customerId){
      const c = customers.find(x => x.id === Number(customerId)) || await api('/api/customers?q=').then(list => list.find(x => x.id === Number(customerId)));
      const [pcs, finance, activity, tickets] = await Promise.all([api('/api/customers/' + customerId + '/pcs'), api('/api/customers/' + customerId + '/finance'), api('/api/customers/' + customerId + '/activity'), api('/api/customers/' + customerId + '/tickets')]);
      const pcHtml = pcs.length ? pcs.map(p =>
        '<div class="pc-item"><div class="doc-head"><strong>' + esc(p.pcName || '-') + '</strong><button class="danger" data-delete-pc="' + p.id + '">Delete PC</button></div>' +
        '<div class="muted">HWID: ' + esc(p.hwid) + '</div><div class="muted">' + esc(p.cpu || '-') + '</div><div class="muted">WAN ' + esc(p.ipWan || '-') + ' | LAN ' + esc(p.ipLan || '-') + '</div></div>'
      ).join('') : '<div class="muted">No PCs.</div>';
      const totals = '<div class="mini-grid">' +
        '<div class="mini-card"><span>Paid</span><strong>' + money(finance.totals.paid) + '</strong></div>' +
        '<div class="mini-card"><span>Pending</span><strong>' + money(finance.totals.pending) + '</strong></div>' +
        '<div class="mini-card"><span>Invoiced</span><strong>' + money(finance.totals.invoiced) + '</strong></div>' +
        '<div class="mini-card"><span>Loyalty</span><strong>' + finance.totals.loyaltyPoints + ' pts</strong></div>' +
        '<div class="mini-card"><span>Active Days</span><strong>' + activity.activeDays + '</strong></div>' +
        '<div class="mini-card"><span>Startups</span><strong>' + activity.totalStartups + '</strong></div>' +
        '<div class="mini-card"><span>Avg Startup</span><strong>' + activity.averageStartupTime + '</strong></div>' +
        '<div class="mini-card"><span>Last Startup</span><strong>' + (activity.lastStartupAt ? new Date(activity.lastStartupAt).toLocaleDateString() : '-') + '</strong></div></div>';
      openModal((c ? c.shopName : 'Customer') + ' Manager',
        totals +
        '<div class="actions"><a target="_blank" href="/documents/customers/' + customerId + '/payments/pdf"><button>Payment Statement PDF</button></a><a target="_blank" href="/documents/customers/' + customerId + '/payments"><button class="secondary">View Statement</button></a></div>' +
        '<div class="modal-grid"><section><h2>Customer Details</h2>' +
        '<label>Customer Name</label><input id="modalCustomerName" value="' + esc(c?.customerName || '') + '">' +
        '<label>Shop / Business Name</label><input id="modalShopName" value="' + esc(c?.shopName || '') + '">' +
        '<label>Contact Number</label><input id="modalContactNumber" value="' + esc(c?.contactNumber || '') + '">' +
        '<div class="actions"><button id="modalSaveCustomer" data-customer-id="' + customerId + '">Save Customer</button></div></section>' +
        '<section><h2>Customer Location</h2><div class="split"><div><label>Latitude</label><input id="modalLat" value="' + esc(c?.latitude || '') + '"></div><div><label>Longitude</label><input id="modalLng" value="' + esc(c?.longitude || '') + '"></div></div>' +
        '<label>Exact Location</label><input id="modalLocation" value="' + esc(c?.exactLocation || '') + '"><label>Google Maps Link</label><input id="modalMaps" value="' + esc(c?.googleMapsLink || '') + '">' +
        '<div class="actions"><button id="modalSaveLocation" data-customer-id="' + customerId + '">Save Location</button></div></section>' +
        '</div><div class="modal-grid" style="margin-top:14px;">' + quoteForm(customerId) + '<section><h2>PC Assets</h2><div class="pc-list">' + pcHtml + '</div></section></div>' +
        '<div class="modal-grid" style="margin-top:14px;">' + ticketForm(customerId) + '<section><h2>Support Tickets</h2><div class="doc-list">' + renderTickets(tickets) + '</div></section></div>' +
        '<section style="margin-top:14px;"><h2>Startup Activity</h2><canvas id="customerActivityChart" class="activity-chart"></canvas></section>' +
        '<div class="modal-grid" style="margin-top:14px;">' + renderDocs(finance) + '</div>'
      );
      renderCustomerActivity(activity);
    }
    async function openManualImport(){
      openModal('Manual Startup Import', '<section><p class="muted">Paste a SHANEX Print Manager startup report here.</p><textarea id="modalReportText" placeholder="Paste report here"></textarea><div class="actions"><button id="modalImportBtn">Import Report</button></div><div id="modalImportNote" class="muted"></div></section>');
    }
    function financeCenterHtml(list){
      const rows = list.length ? list.map(c =>
        '<tr><td><strong>' + esc(c.shopName) + '</strong><div class="muted">' + esc(c.contactNumber || '-') + '</div></td>' +
        '<td><span class="pill">' + c.pcCount + '</span></td>' +
        '<td>' + money(c.paidTotal) + '</td>' +
        '<td>' + money(c.pendingTotal) + '</td>' +
        '<td><span class="pill">' + c.loyaltyPoints + ' pts</span></td>' +
        '<td><button data-finance-customer="' + c.id + '">Manage</button></td></tr>'
      ).join('') : '<tr><td colspan="6"><div class="muted">No customers found. Import WhatsApp startup reports first.</div></td></tr>';
      return '<section><h2>Customer Finance</h2>' +
        '<div class="toolbar"><input id="financeSearch" placeholder="Search customer, phone, shop"><button class="secondary" id="financeRefreshBtn">Refresh</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Customer</th><th>PCs</th><th>Paid</th><th>Pending</th><th>Loyalty</th><th>Action</th></tr></thead><tbody id="financeRows">' + rows + '</tbody></table></div></section>';
    }
    async function openFinanceCenter(){
      const list = await api('/api/customers?q=');
      openModal('Finance Center', financeCenterHtml(list));
    }
    function supportCenterHtml(tickets){
      const rows = tickets.length ? tickets.map(ticket =>
        '<tr><td><strong>#' + ticket.id + ' ' + esc(ticket.title || '-') + '</strong><div class="muted">' + esc(ticket.customerName || '-') + '</div></td>' +
        '<td><span class="pill">' + esc(ticket.priority) + '</span></td>' +
        '<td>' + esc(ticket.status) + '</td>' +
        '<td>' + (ticket.scheduledAt ? new Date(ticket.scheduledAt).toLocaleString() : '-') + '</td>' +
        '<td>' + ticket.durationMinutes + ' mins</td>' +
        '<td><button data-support-customer="' + ticket.customerId + '">Open Customer</button></td></tr>'
      ).join('') : '<tr><td colspan="6"><div class="muted">No support tickets yet.</div></td></tr>';
      return '<section><h2>Support Tickets</h2><div class="toolbar"><button class="secondary" id="supportRefreshBtn">Refresh</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Priority</th><th>Status</th><th>Allocated Time</th><th>Duration</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
    }
    async function openSupportCenter(){
      openModal('Support Tickets', supportCenterHtml(await api('/api/tickets')));
    }
    function filterFinanceRows(){
      const q = document.querySelector('#financeSearch')?.value.trim().toLowerCase() || '';
      const filtered = customers.filter(c => !q || (c.shopName + ' ' + c.customerName + ' ' + c.contactNumber).toLowerCase().includes(q));
      const temp = document.createElement('div');
      temp.innerHTML = financeCenterHtml(filtered);
      document.querySelector('#financeRows').innerHTML = temp.querySelector('#financeRows').innerHTML;
    }
    async function openSettings(){
      const settings = await api('/api/settings');
      openModal('Company Settings',
        '<div class="modal-grid"><section><h2>Company</h2>' +
        '<label>Company Name</label><input id="setCompany" value="' + esc(settings.companyName || '') + '">' +
        '<label>Website</label><input id="setWebsite" value="' + esc(settings.website || '') + '">' +
        '<label>Phone</label><input id="setPhone" value="' + esc(settings.phone || '') + '">' +
        '<label>Email</label><input id="setEmail" value="' + esc(settings.email || '') + '">' +
        '<label>Address</label><textarea id="setAddress">' + esc(settings.address || '') + '</textarea></section>' +
        '<section><h2>Invoice Details</h2>' +
        '<label>Bank Details</label><textarea id="setBank" style="min-height:140px;">' + esc(settings.bankDetails || '') + '</textarea>' +
        '<label>Terms & Conditions</label><textarea id="setTerms" style="min-height:170px;">' + esc(settings.terms || '') + '</textarea>' +
        '<div class="actions"><button id="saveSettingsBtn">Save Settings</button></div><div id="settingsNote" class="muted"></div></section></div>'
      );
    }
    document.querySelector('#rows').addEventListener('click', e => {
      if (!e.target.dataset.manage) return;
      selectedId = Number(e.target.dataset.manage);
      openCustomerModal(selectedId);
    });
    document.querySelector('#openImportBtn').addEventListener('click', openManualImport);
    document.querySelector('#openFinanceBtn').addEventListener('click', openFinanceCenter);
    document.querySelector('#openSupportBtn').addEventListener('click', openSupportCenter);
    document.querySelector('#openSettingsBtn').addEventListener('click', openSettings);
    document.querySelector('#modalCloseBtn').addEventListener('click', closeModal);
    document.querySelector('#modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
    document.querySelector('#modalBody').addEventListener('change', async e => {
      if (e.target.id === 'quotePlan') document.querySelector('#quoteUnitPrice').value = e.target.value === '365' ? 5000 : 1000;
      if (e.target.dataset.ticketStatus) {
        const result = await api('/api/tickets/' + e.target.dataset.ticketStatus, { method:'PUT', body: JSON.stringify({ status:e.target.value }) });
        await load(); await openCustomerModal(result.customerId);
      }
    });
    document.querySelector('#modalBody').addEventListener('input', e => {
      if (e.target.id === 'financeSearch') filterFinanceRows();
    });
    document.querySelector('#modalBody').addEventListener('click', async e => {
      if (e.target.dataset.financeCustomer) {
        selectedId = Number(e.target.dataset.financeCustomer);
        await openCustomerModal(selectedId);
      }
      if (e.target.id === 'financeRefreshBtn') {
        await load();
        await openFinanceCenter();
      }
      if (e.target.id === 'supportRefreshBtn') {
        await openSupportCenter();
      }
      if (e.target.dataset.supportCustomer) {
        selectedId = Number(e.target.dataset.supportCustomer);
        await openCustomerModal(selectedId);
      }
      if (e.target.id === 'modalImportBtn') {
        try {
          const result = await api('/api/import/startup-report', { method:'POST', body: JSON.stringify({ text: document.querySelector('#modalReportText').value }) });
          document.querySelector('#modalImportNote').textContent = 'Imported: ' + result.customer.shopName + ' / ' + result.pc.pcName;
          await load();
        } catch (error) { document.querySelector('#modalImportNote').textContent = error.message; }
      }
      if (e.target.id === 'saveSettingsBtn') {
        await api('/api/settings', { method:'PUT', body: JSON.stringify({
          companyName: document.querySelector('#setCompany').value,
          website: document.querySelector('#setWebsite').value,
          phone: document.querySelector('#setPhone').value,
          email: document.querySelector('#setEmail').value,
          address: document.querySelector('#setAddress').value,
          bankDetails: document.querySelector('#setBank').value,
          terms: document.querySelector('#setTerms').value,
        }) });
        document.querySelector('#settingsNote').textContent = 'Saved.';
      }
      if (e.target.id === 'modalSaveCustomer') {
        const id = e.target.dataset.customerId;
        await api('/api/customers/' + id, { method:'PUT', body: JSON.stringify({
          customerName: document.querySelector('#modalCustomerName').value,
          shopName: document.querySelector('#modalShopName').value,
          contactNumber: document.querySelector('#modalContactNumber').value,
        }) });
        await load(); await openCustomerModal(id);
      }
      if (e.target.id === 'modalSaveLocation') {
        const id = e.target.dataset.customerId;
        await api('/api/customers/' + id + '/location', { method:'PUT', body: JSON.stringify({ latitude: document.querySelector('#modalLat').value, longitude: document.querySelector('#modalLng').value, exactLocation: document.querySelector('#modalLocation').value, googleMapsLink: document.querySelector('#modalMaps').value }) });
        await load(); await openCustomerModal(id);
      }
      if (e.target.id === 'createQuoteBtn') {
        const id = document.querySelector('#quoteCustomerId').value;
        const result = await api('/api/quotations', { method:'POST', body: JSON.stringify({ customerId:id, planDays:document.querySelector('#quotePlan').value, licenses:document.querySelector('#quoteLicenses').value, unitPrice:document.querySelector('#quoteUnitPrice').value, discount:document.querySelector('#quoteDiscount').value, notes:document.querySelector('#quoteNotes').value }) });
        document.querySelector('#quoteNote').textContent = 'Created ' + result.quotation.number;
        await load(); await openCustomerModal(id);
      }
      if (e.target.id === 'createTicketBtn') {
        const id = document.querySelector('#ticketCustomerId').value;
        await api('/api/tickets', { method:'POST', body: JSON.stringify({
          customerId:id,
          title:document.querySelector('#ticketTitle').value,
          description:document.querySelector('#ticketDescription').value,
          priority:document.querySelector('#ticketPriority').value,
          status:document.querySelector('#ticketStatus').value,
          scheduledAt:document.querySelector('#ticketScheduledAt').value,
          durationMinutes:document.querySelector('#ticketDuration').value,
          assignee:document.querySelector('#ticketAssignee').value,
        }) });
        await load(); await openCustomerModal(id);
      }
      if (e.target.dataset.convertQuote) {
        const result = await api('/api/quotations/' + e.target.dataset.convertQuote + '/convert', { method:'POST', body:'{}' });
        await load(); await openCustomerModal(result.invoice.customerId);
      }
      if (e.target.dataset.addPayment) {
        const invoiceId = e.target.dataset.addPayment;
        const result = await api('/api/invoices/' + invoiceId + '/payments', { method:'POST', body: JSON.stringify({ amount: document.querySelector('#payAmount' + invoiceId).value, reference: document.querySelector('#payRef' + invoiceId).value }) });
        await load(); await openCustomerModal(result.invoice.customerId);
      }
      if (e.target.dataset.deletePc) {
        if (!confirm('Delete this PC?')) return;
        await api('/api/pcs/' + e.target.dataset.deletePc, { method:'DELETE' });
        await load(); if (selectedId) await openCustomerModal(selectedId);
      }
      if (e.target.dataset.copyText) {
        const box = e.target.closest('.doc').querySelector('textarea');
        await navigator.clipboard.writeText(box.value);
        e.target.textContent = 'Copied';
      }
    });
    document.querySelector('#importBtn').addEventListener('click', async () => {
      try {
        const result = await api('/api/import/startup-report', { method:'POST', body: JSON.stringify({ text: document.querySelector('#reportText').value }) });
        document.querySelector('#importNote').textContent = 'Imported: ' + result.customer.shopName + ' / ' + result.pc.pcName;
        document.querySelector('#reportText').value = '';
        await load();
      } catch (error) {
        document.querySelector('#importNote').textContent = error.message;
      }
    });
    document.querySelector('#saveLocationBtn').addEventListener('click', async () => {
      if (!selectedId) return alert('Select a customer first.');
      await api('/api/customers/' + selectedId + '/location', { method:'PUT', body: JSON.stringify({
        latitude: document.querySelector('#latInput').value,
        longitude: document.querySelector('#lngInput').value,
        exactLocation: document.querySelector('#locationInput').value,
        googleMapsLink: document.querySelector('#mapsInput').value,
      }) });
      await load();
    });
    document.querySelector('#refreshBtn').addEventListener('click', load);
    document.querySelector('#logoutBtn').addEventListener('click', async () => {
      await fetch('/logout', { method:'POST' });
      location.href = '/login';
    });
    document.querySelector('#mapZoomInBtn').addEventListener('click', () => map?.zoomIn());
    document.querySelector('#mapZoomOutBtn').addEventListener('click', () => map?.zoomOut());
    document.querySelector('#mapSriLankaBtn').addEventListener('click', () => map?.setView([7.8731, 80.7718], 7));
    document.querySelector('#wheelZoomToggle').addEventListener('change', e => {
      wheelZoomEnabled = e.target.checked;
      if (!map) return;
      if (wheelZoomEnabled) map.scrollWheelZoom.enable(); else map.scrollWheelZoom.disable();
    });
    document.querySelector('#search').addEventListener('input', () => clearTimeout(window.searchTimer) || (window.searchTimer = setTimeout(load, 250)));
    load();
    setInterval(load, 6000);
  </script>
</body>
</html>`;
}

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/');
  res.type('html').send(loginPage());
});
app.post('/login', (req, res) => {
  if (String(req.body.password || '') !== loginPassword) {
    return res.status(401).type('html').send(loginPage('Invalid password.'));
  }
  setSessionCookie(res);
  res.redirect('/');
});
app.post('/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});
app.use((req, res, next) => {
  if (req.query.printToken === internalPrintToken) return next();
  if (isAuthenticated(req)) return next();
  if (req.path.startsWith('/api') || req.path.endsWith('/pdf')) {
    return res.status(401).json({ error: 'Login required' });
  }
  return res.status(401).type('html').send(loginPage());
});

app.get('/', (_req, res) => res.type('html').send(page()));
app.get('/api/status', (_req, res) => res.json({ status: waStatus, lastQrAt, qrDataUrl: currentQrDataUrl, events: waEvents }));
app.get('/api/stats', (_req, res) => res.json(stats()));
app.get('/api/analytics', (_req, res) => res.json(analytics()));
app.get('/api/license-pcs', (req, res) => res.json(licensePcList(String(req.query.license || 'Unknown'))));
app.get('/api/settings', (_req, res) => res.json(db.settings));
app.put('/api/settings', async (req, res) => {
  db.settings = {
    ...db.settings,
    companyName: cleanValue(req.body.companyName || db.settings.companyName),
    website: cleanValue(req.body.website || db.settings.website),
    phone: cleanValue(req.body.phone || db.settings.phone),
    email: cleanValue(req.body.email || db.settings.email),
    address: String(req.body.address || '').trim(),
    bankDetails: String(req.body.bankDetails || '').trim(),
    terms: String(req.body.terms || '').trim(),
    logoPath: db.settings.logoPath || '/assets/shanex-logo.png',
  };
  await saveDb();
  res.json(db.settings);
});
app.get('/api/customers', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const list = billableCustomers().map(publicCustomer).filter((customer) => {
    if (!q) return true;
    const pcText = customer.pcs.map((pc) => `${pc.pcName} ${pc.hwid} ${pc.cpu} ${pc.os} ${pc.license} ${pc.ipWan} ${pc.ipLan}`).join(' ');
    return `${customer.customerName} ${customer.shopName} ${customer.contactNumber} ${customer.exactLocation} ${pcText}`.toLowerCase().includes(q);
  });
  res.json(list);
});
app.get('/api/customers/:id/pcs', (req, res) => {
  const customerId = Number(req.params.id);
  res.json(db.pcs.filter((pc) => pc.customerId === customerId));
});
app.delete('/api/pcs/:id', async (req, res) => {
  const pcId = Number(req.params.id);
  const index = db.pcs.findIndex((pc) => pc.id === pcId);
  if (index === -1) return res.status(404).json({ error: 'PC not found' });
  const [removed] = db.pcs.splice(index, 1);
  await saveDb();
  res.json({ ok: true, removed });
});
app.get('/api/customers/:id/finance', (req, res) => {
  const customerId = Number(req.params.id);
  const finance = customerFinance(customerId);
  if (!finance.customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(finance);
});
app.get('/api/customers/:id/activity', (req, res) => {
  const customerId = Number(req.params.id);
  const customer = db.customers.find((item) => item.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(customerActivity(customerId));
});
app.get('/api/customers/:id/tickets', (req, res) => {
  const customerId = Number(req.params.id);
  res.json(db.tickets
    .filter((ticket) => ticket.customerId === customerId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});
app.get('/api/tickets', (_req, res) => {
  const list = db.tickets
    .map((ticket) => {
      const customer = db.customers.find((item) => item.id === ticket.customerId);
      return { ...ticket, customerName: customer?.shopName || customer?.customerName || 'Unknown Customer' };
    })
    .sort((a, b) => {
      const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  res.json(list);
});
app.post('/api/tickets', async (req, res) => {
  const customerId = Number(req.body.customerId);
  const customer = db.customers.find((item) => item.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const stamp = nowIso();
  const ticket = {
    id: nextId(db.tickets),
    customerId,
    title: cleanValue(req.body.title || 'Support request'),
    description: String(req.body.description || '').trim(),
    priority: cleanValue(req.body.priority || 'normal'),
    status: cleanValue(req.body.status || 'open'),
    scheduledAt: cleanValue(req.body.scheduledAt || ''),
    durationMinutes: Math.max(5, Number(req.body.durationMinutes || 30)),
    assignee: cleanValue(req.body.assignee || ''),
    createdAt: stamp,
    updatedAt: stamp,
  };
  db.tickets.unshift(ticket);
  await saveDb();
  res.status(201).json(ticket);
});
app.put('/api/tickets/:id', async (req, res) => {
  const ticket = db.tickets.find((item) => item.id === Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  for (const key of ['title', 'priority', 'status', 'scheduledAt', 'assignee']) {
    if (req.body[key] !== undefined) ticket[key] = cleanValue(req.body[key]);
  }
  if (req.body.description !== undefined) ticket.description = String(req.body.description || '').trim();
  if (req.body.durationMinutes !== undefined) ticket.durationMinutes = Math.max(5, Number(req.body.durationMinutes || 30));
  ticket.updatedAt = nowIso();
  await saveDb();
  res.json(ticket);
});
app.put('/api/customers/:id', async (req, res) => {
  const customer = db.customers.find((item) => item.id === Number(req.params.id));
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const contactNumber = cleanPhone(req.body.contactNumber || customer.contactNumber);
  Object.assign(customer, {
    customerName: cleanValue(req.body.customerName || customer.customerName),
    shopName: cleanValue(req.body.shopName || customer.shopName),
    contactNumber,
    identityKey: contactNumber ? `wa:${contactNumber}` : customer.identityKey,
    updatedAt: nowIso(),
  });
  await saveDb();
  res.json(publicCustomer(customer));
});
app.get('/documents/customers/:id/payments', (req, res) => {
  const customerId = Number(req.params.id);
  const customer = db.customers.find((item) => item.id === customerId);
  if (!customer) return res.status(404).send('Customer not found');
  res.type('html').send(paymentStatementHtml(customerId));
});
app.get('/documents/customers/:id/payments/pdf', async (req, res) => {
  const customerId = Number(req.params.id);
  const customer = db.customers.find((item) => item.id === customerId);
  if (!customer) return res.status(404).send('Customer not found');
  try {
    const pdf = await renderPdf(`/documents/customers/${customerId}/payments`);
    const filename = `${customer.shopName || 'customer'}-payment-statement.pdf`.replace(/[^a-z0-9_.-]+/gi, '-');
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ error: `Failed to generate PDF: ${error.message}` });
  }
});
app.get('/documents/quotations/:id', (req, res) => {
  const quotation = db.quotations.find((item) => item.id === Number(req.params.id));
  if (!quotation) return res.status(404).send('Quotation not found');
  const customer = db.customers.find((item) => item.id === quotation.customerId);
  if (!customer) return res.status(404).send('Customer not found');
  res.type('html').send(documentHtml('quotation', quotation, customer));
});
app.get('/documents/quotations/:id/pdf', async (req, res) => {
  const quotation = db.quotations.find((item) => item.id === Number(req.params.id));
  if (!quotation) return res.status(404).send('Quotation not found');
  try {
    const pdf = await renderPdf(`/documents/quotations/${quotation.id}`);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${quotation.number}.pdf"`);
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ error: `Failed to generate PDF: ${error.message}` });
  }
});
app.get('/documents/invoices/:id', (req, res) => {
  const invoice = db.invoices.find((item) => item.id === Number(req.params.id));
  if (!invoice) return res.status(404).send('Invoice not found');
  recalcInvoice(invoice);
  const customer = db.customers.find((item) => item.id === invoice.customerId);
  if (!customer) return res.status(404).send('Customer not found');
  invoice.message = invoiceMessage(invoice, customer);
  res.type('html').send(documentHtml('invoice', invoice, customer));
});
app.get('/documents/invoices/:id/pdf', async (req, res) => {
  const invoice = db.invoices.find((item) => item.id === Number(req.params.id));
  if (!invoice) return res.status(404).send('Invoice not found');
  try {
    const pdf = await renderPdf(`/documents/invoices/${invoice.id}`);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${invoice.number}.pdf"`);
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ error: `Failed to generate PDF: ${error.message}` });
  }
});
app.post('/api/quotations', async (req, res) => {
  const customerId = Number(req.body.customerId);
  const customer = db.customers.find((item) => item.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const licenses = Math.max(1, Number(req.body.licenses || 1));
  const planDays = Math.max(1, Number(req.body.planDays || 30));
  const unitPrice = asMoney(req.body.unitPrice || (planDays >= 365 ? 5000 : 1000));
  const discount = asMoney(req.body.discount);
  const subtotal = licenses * unitPrice;
  const stamp = nowIso();
  const quotation = {
    id: nextId(db.quotations),
    number: docNumber('QT', db.quotations),
    customerId,
    status: 'draft',
    planDays,
    licenses,
    unitPrice,
    subtotal,
    discount,
    total: Math.max(0, subtotal - discount),
    notes: cleanValue(req.body.notes || ''),
    createdAt: stamp,
    updatedAt: stamp,
  };
  quotation.message = quotationMessage(quotation, customer);
  db.quotations.push(quotation);
  await saveDb();
  res.status(201).json({ quotation, message: quotation.message });
});
app.put('/api/quotations/:id/status', async (req, res) => {
  const quotation = db.quotations.find((item) => item.id === Number(req.params.id));
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
  quotation.status = cleanValue(req.body.status || quotation.status);
  quotation.updatedAt = nowIso();
  await saveDb();
  res.json(quotation);
});
app.post('/api/quotations/:id/convert', async (req, res) => {
  const quotation = db.quotations.find((item) => item.id === Number(req.params.id));
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
  const customer = db.customers.find((item) => item.id === quotation.customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  let invoice = quotation.invoiceId ? db.invoices.find((item) => item.id === quotation.invoiceId) : null;
  if (!invoice) {
    const stamp = nowIso();
    invoice = {
      id: nextId(db.invoices),
      number: docNumber('INV', db.invoices),
      quotationId: quotation.id,
      customerId: quotation.customerId,
      status: 'unpaid',
      planDays: quotation.planDays,
      licenses: quotation.licenses,
      unitPrice: quotation.unitPrice,
      subtotal: quotation.subtotal,
      discount: quotation.discount,
      total: quotation.total,
      paidAmount: 0,
      balance: quotation.total,
      notes: quotation.notes,
      dueDate: cleanValue(req.body.dueDate || ''),
      createdAt: stamp,
      updatedAt: stamp,
    };
    db.invoices.push(invoice);
    quotation.invoiceId = invoice.id;
  }
  quotation.status = 'converted';
  quotation.updatedAt = nowIso();
  recalcInvoice(invoice);
  invoice.message = invoiceMessage(invoice, customer);
  await saveDb();
  res.status(201).json({ invoice, message: invoice.message });
});
app.post('/api/invoices/:id/payments', async (req, res) => {
  const invoice = db.invoices.find((item) => item.id === Number(req.params.id));
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const amount = asMoney(req.body.amount);
  if (amount <= 0) return res.status(400).json({ error: 'Payment amount is required' });
  const stamp = nowIso();
  const payment = {
    id: nextId(db.payments),
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    amount,
    reference: cleanValue(req.body.reference || ''),
    method: cleanValue(req.body.method || 'Bank Transfer'),
    notes: cleanValue(req.body.notes || ''),
    receivedAt: cleanValue(req.body.receivedAt || stamp),
    createdAt: stamp,
  };
  db.payments.unshift(payment);
  recalcInvoice(invoice);

  const points = Math.floor(amount / 1000);
  if (points > 0) {
    db.loyaltyLedger.unshift({
      id: nextId(db.loyaltyLedger),
      customerId: invoice.customerId,
      points,
      reason: `Payment ${payment.reference || payment.id}`,
      sourceType: 'payment',
      sourceId: payment.id,
      createdAt: stamp,
    });
  }

  await saveDb();
  res.status(201).json({ payment, invoice, loyaltyPointsAdded: points });
});
app.post('/api/import/startup-report', async (req, res) => {
  try {
    const result = await importStartupReport(String(req.body.text || ''), { from: 'manual' });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.put('/api/customers/:id/location', async (req, res) => {
  const customer = db.customers.find((item) => item.id === Number(req.params.id));
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const lat = req.body.latitude === '' ? null : Number(req.body.latitude);
  const lng = req.body.longitude === '' ? null : Number(req.body.longitude);
  Object.assign(customer, {
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    exactLocation: String(req.body.exactLocation || '').trim(),
    googleMapsLink: String(req.body.googleMapsLink || '').trim(),
    updatedAt: nowIso(),
  });
  await saveDb();
  res.json(publicCustomer(customer));
});

function startWhatsAppMonitor() {
  waStatus = 'initializing';
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'shanex-crm' }),
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });
  waClient = client;
  addWaEvent('starting', 'WhatsApp engine is starting.');

  client.on('qr', async (qr) => {
    waStatus = 'scan-qr';
    lastQrAt = nowIso();
    currentQrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 260 });
    console.log('\nScan this WhatsApp QR code:\n');
    qrcode.generate(qr, { small: true });
  });
  client.on('ready', () => {
    waStatus = 'ready';
    currentQrDataUrl = '';
    console.log('WhatsApp monitor ready.');
  });
  client.on('authenticated', () => {
    waStatus = 'authenticated';
    addWaEvent('authenticated', 'WhatsApp session authenticated.');
  });
  client.on('auth_failure', (message) => {
    waStatus = 'auth-failed';
    addWaEvent('error', `WhatsApp auth failed: ${message}`);
  });
  client.on('loading_screen', (percent, message) => {
    waStatus = `loading ${percent}%`;
    if (Number(percent) === 100 || Number(percent) === 0) {
      addWaEvent('loading', `${percent}% ${message || ''}`.trim());
    }
  });
  client.on('change_state', (state) => {
    addWaEvent('state', String(state));
  });
  client.on('disconnected', (reason) => {
    waStatus = `disconnected: ${reason}`;
    addWaEvent('disconnected', String(reason));
  });
  async function handleWhatsAppMessage(message, eventName) {
    try {
      const id = message.id?._serialized || `${message.from}-${message.timestamp}-${message.body}`;
      if (processedMessageIds.has(id)) return;
      processedMessageIds.add(id);
      if (processedMessageIds.size > 500) processedMessageIds.clear();
      const text = message.body || '';
      if (!text.trim()) return;
      const senderId = message.author || message.from;
      addWaEvent('received', previewText(text), { from: senderId || message.from || '' });
      if (!isStartupReport(text)) {
        if (/Print Manager/i.test(text)) addWaEvent('ignored', `Unsupported report: ${previewText(text)}`, { from: senderId || message.from || '' });
        return;
      }
      const contact = message.author
        ? await client.getContactById(message.author)
        : await message.getContact();
      const result = await importStartupReport(text, {
        from: senderId,
        fromName: contact.pushname || contact.name || '',
        fromPhone: contact.number || senderId,
      });
      addWaEvent(
        result.duplicateDaily ? 'updated' : 'imported',
        `${result.customer.shopName} / ${result.pc.pcName} / ${contact.number || senderId} via ${eventName}`,
        { from: contact.number || senderId || '' },
      );
    } catch (error) {
      addWaEvent('error', error.message);
    }
  }
  client.on('message', (message) => handleWhatsAppMessage(message, 'message'));
  client.on('message_create', (message) => {
    if (message.fromMe) return;
    handleWhatsAppMessage(message, 'message_create');
  });

  client.initialize().catch((error) => {
    waStatus = 'failed';
    addWaEvent('error', `Failed to initialize WhatsApp: ${error.message}`);
    console.error('Failed to initialize WhatsApp:', error);
  });
}

async function shutdown() {
  try {
    if (waClient) await waClient.destroy();
  } catch (error) {
    console.error('Failed to close WhatsApp client:', error.message);
  } finally {
    process.exit(0);
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await loadDb();
app.listen(port, () => {
  console.log(`SHANEX WhatsApp CRM running at http://127.0.0.1:${port}`);
});
startWhatsAppMonitor();

