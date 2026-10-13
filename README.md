# School ERP Backend

Express + Mongoose REST API for a multi-tenant school ERP. Root-level API reference: [`../API.md`](../API.md).

## Requirements

- Node.js 18 or newer and npm
- MongoDB 6/7 configured as a replica set for transaction-backed payments (a MongoDB Atlas cluster also works)

For a local single-node replica set, start MongoDB with `--replSet rs0`, then initialize it once with `mongosh`: `rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})`.

## Install and configure

From this directory:

```powershell
npm install
Copy-Item .env.example .env
```

Set the values in `.env` for your local environment:

- `NODE_ENV`: runtime mode (`development`, `test`, or `production`).
- `PORT`: API port; local development commonly uses `5000`.
- `MONGO_URI`: MongoDB replica-set connection string.
- `JWT_SECRET`: long, random secret; use a different value per environment.
- `SESSION_HOURS`: session-cookie lifetime.
- `COOKIE_SECURE`: enable secure cookies when served over HTTPS.
- `CLIENT_ORIGIN`: allowed frontend origin for CORS.
- `SCHOOL_TIMEZONE`: timezone used for school date rules, commonly `Asia/Kolkata`.

Do not commit `.env`, share its values, or use production credentials in a demo. Commit `.env.example` only; it must contain placeholders, not secrets.

## Seed development data

```powershell
npm run seed
```

**Warning: the seed script clears collections in its configured database before inserting demo data.** Point it only at a disposable development database. Never run it against production.

The seed creates two schools, students, classes, and Admin, Teacher, and Accountant accounts. Password for the seeded demo accounts: `Password@123`.

| School | Role | Email |
|---|---|---|
| Greenfield Public School (GPS) | Admin | `admin@greenfield.example` |
| GPS | Teacher | `teacher1@greenfield.example` |
| GPS | Teacher | `teacher2@greenfield.example` |
| GPS | Accountant | `accountant@greenfield.example` |
| Riverside Academy (RVA) | Admin | `admin@riverside.example` |
| RVA | Teacher | `teacher1@riverside.example` |
| RVA | Teacher | `teacher2@riverside.example` |
| RVA | Accountant | `accountant@riverside.example` |

Each school has teacher-assigned classes and a Grade 6-A class without an assigned teacher. Use that class to demonstrate teacher access restrictions.

## Run and test

```powershell
npm run dev
npm test
```

The health check is `http://localhost:5000/api/health` with the default development port. Jest starts an in-memory MongoDB replica set for tests; alternatively configure `TEST_MONGO_URI` to use a dedicated test replica set. Test data and Jest cache use the ignored `.test-data/` directory.

The test suite covers authentication/CSRF, role permissions, cross-school reads and writes, reports and CSV exports, school-scoped uniqueness, teacher class assignment, attendance rules, partial payments, balances, overpayment prevention, idempotent retries, concurrent payment attempts, and receipt sequences. **Latest recorded run: 39 passed and 2 failed.** The failures are tenant-test fixture requests rejected because the fixture's guardian name is one character while input validation requires at least two. Rerun the suite after correcting the fixture; don't present the suite as fully passing until it is green.

## Tenant design

Schools share a MongoDB database. School-owned documents contain `schoolId`. Users are associated with schools through a membership containing their school and role. Authentication resolves the active membership on the server; clients cannot choose a tenant by submitting `schoolId`. Queries, writes, reports, and CSV exports are scoped to the authenticated school. Cross-school record IDs return `404`. Teachers are additionally limited to assigned classes. School-scoped unique indexes permit values such as admission numbers to repeat between schools while preventing duplicates inside one school.

Money is stored in integer paise. Payments use MongoDB transactions and an idempotency key so retries do not double-charge; partial payments update the outstanding balance.

## Known limitations

- Accountant accounts are seed-provided; the UI creates teachers only.
- No refunds, payment gateway, recurring billing, PDF generation, or audit log.
- Receipts use browser printing; CSV generation is not streamed.
- Frontend automated tests are not currently configured.
- Backend suite has the two fixture failures noted above pending a rerun after correction.

