# Shanex Customer Database

Python standard library only app for managing software customers, subscriptions,
renewals, payments, invoices, and license keys.

## Run

```powershell
python customer_dashboard.py
```

Open this URL in your browser:

```txt
http://127.0.0.1:8088
```

## Data Saved

- Customer name
- Shop / business name
- Contact number
- Exact location
- Google Maps link
- Latitude / longitude for the dashboard map
- Hardware ID
- Installed PC details
- PC count
- License count
- One license price
- Paid amount
- Plan days
- Plan start date
- Renewal date
- Subscription status: active or dropped
- License key
- Notes

The app saves data in:

```txt
customer_database.sqlite3
```

## Dashboard

- Active customer count
- Renewals coming in the next 30 days
- Overdue renewals
- Received amount
- Expected income
- Pending income
- Dropped subscription count
- New users this month
- Expected renewal income
- Customer map with pins for customers who have latitude/longitude

## Customer PCs

Customers are saved first. Then click the `PCs` button on a customer row to add
PC records under that customer.

PC records save:

- PC name
- Hardware ID
- Windows version
- Processor
- RAM
- Notes

## Invoice And License

Click the `Invoice` button on a customer row. The app will ask for the paid
amount, generate a license key if the customer does not already have one, create
an invoice, and open a print-friendly invoice page.

Use the browser print option to print it or save it as a PDF.

## Quotation And Payment Flow

- Click `Quote` to create a print-friendly quotation.
- Click `Invoice` to create an invoice and license key.
- Click `Payment` to update the paid amount.
- Payment status is calculated automatically:
  - `unpaid` when paid amount is zero
  - `partial` when paid amount is less than the total
  - `paid` when paid amount covers the total

## Note

The location warning compares the location text you type with existing customer
locations. It is a helpful duplicate/nearby-location hint, not GPS distance
calculation.
