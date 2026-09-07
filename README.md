# Fumba Port Warehouse Management System

Fumba Port WMS is a role-based warehouse management system for managing cargo from registration through storage, customs processing, finance, release approval, and gate-out. It is a final-year B.Sc. Computer Science project for indoor storage operations at Fumba Port.

## Features

- Cargo registration, cargo references, barcodes, and supporting-document uploads.
- Warehouse hierarchy management: warehouses, zones, racks, levels, and bins.
- Rule-based cargo placement recommendations and capacity validation.
- Barcode-assisted warehouse and handheld scanner workflows.
- Customs inspection, holds, clearance decisions, and cargo history.
- Tariffs, invoices, payments, customer payment links, and Flutterwave webhooks.
- Release-readiness checks, emergency releases, management releases, and gate-out confirmation.
- Audit logs, notifications, reports, user/session management, roles, permissions, and configuration backup/restore.

## Roles

| Role | Main responsibilities |
| --- | --- |
| System Administrator | Users, roles, permissions, warehouse configuration, rules, audits, and settings. |
| Warehouse Staff | Registration, document upload, placement, scanning, storage records, and dispatch preparation. |
| Warehouse Supervisor | Cargo approvals, reviews, placement oversight, placement overrides, and emergency releases. |
| Finance Officer | Tariffs, invoices, charges, payments, and financial reports. |
| Customs Officer | Inspections, customs records, holds, and clearance decisions. |
| Gate Officer | Release queue, gate-out records, emergency requests, and dispatch confirmation. |
| Management | Operational oversight, reports, release decisions, and tariff approvals. |
| Auditor | Read-only audit logs, cargo history, reports, and system-change oversight. |
| Scanner Account | Dedicated handheld scanning session. |

All dashboard sidebars can be collapsed to icons and expanded again. Navigation permissions remain role-specific.

## Technology

| Layer | Current technology |
| --- | --- |
| Frontend | React 18, Vite 8, React Router 7, Tailwind CSS, Radix UI, TanStack Query, Socket.IO Client |
| Backend | Node.js, Express 4, Socket.IO, PostgreSQL driver (`pg`), bcrypt, Nodemailer |
| Database | PostgreSQL 17 |
| Testing | Vitest and React Testing Library; Node.js test runner for the backend |
| Deployment | Docker Compose; Nginx for production TLS/reverse proxy |

## Architecture

```text
React + Vite frontend
        │ REST API / Socket.IO
Express + Socket.IO backend
        │
PostgreSQL 17
        │
Cargo-document file storage
```

## Project structure

```text
WMS-FumbaPort/
├── backend/
│   ├── config/          # Runtime configuration
│   ├── controllers/     # API handlers
│   ├── database/        # Schema, migrations, setup, and grants
│   ├── middleware/      # Authentication, authorization, validation, security
│   ├── realtime/        # Socket.IO integration
│   ├── routes/          # API routes
│   ├── services/        # Cargo, placement, billing, payment, release logic
│   ├── tests/           # Backend tests
│   └── uploads/         # Cargo documents: runtime data, do not delete
├── frontend/
│   ├── public/          # Static frontend assets
│   ├── src/components/  # Shared UI components
│   ├── src/pages/       # Role portals and public pages
│   ├── src/services/    # API client
│   └── src/lib/         # Access-control and utility logic
├── deployment/          # Production Nginx configuration and notes
├── docker-compose.yml   # Local Docker development stack
└── docker-compose.production.yml
```

## Local setup with Docker

### Requirements

- Docker Desktop with Docker Compose
- Node.js 18+ only when running outside Docker

### Start

1. Create or update the root `.env` with database credentials and a strong `JWT_SECRET`.
2. Start the stack:

   ```bash
   docker compose up --build -d
   ```

3. Check status:

   ```bash
   docker compose ps
   ```

4. Open:

   - Frontend: `http://localhost:3000`
   - Backend health endpoint: `http://localhost:5000/api/health`
   - PostgreSQL: `localhost:5433`

On a fresh database, open `http://localhost:3000/initial-setup` to create the first administrator account.

### Stop

```bash
docker compose down
```

## Running without Docker

Install and start each application separately.

```bash
cd backend
npm install
copy .env.example .env
npm run init-db
npm run migrate
npm run dev
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Use `backend/.env.example` as the backend environment reference. Never commit real passwords, JWT secrets, email credentials, or Flutterwave credentials.

## Important configuration

| Setting | Purpose |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL connection settings. |
| `JWT_SECRET` | Signs access tokens; use a strong private value. |
| `CARGO_DOCUMENT_UPLOAD_ROOT` | Where uploaded cargo documents are stored. |
| `CARGO_DOCUMENT_MAX_BYTES` | Maximum document size; default is 10 MB. |
| `PAYMENT_PROVIDER`, `PAYMENT_ENVIRONMENT` | Payment provider and environment. |
| `FLUTTERWAVE_CLIENT_ID`, `FLUTTERWAVE_CLIENT_SECRET`, `FLUTTERWAVE_WEBHOOK_SECRET` | Flutterwave credentials. |
| `PUBLIC_PAYMENT_BASE_URL` | Base URL for customer payment links. |
| `SMTP_*`, `EMAIL_FROM` | Optional email-delivery configuration. |

## API groups

Operational endpoints are under `/api` and use authentication, portal access, shift checks, and permissions where appropriate.

| Area | Base path |
| --- | --- |
| Authentication and profiles | `/api/auth`, `/api/profile` |
| Setup | `/api/bootstrap` |
| Cargo and registration form | `/api/cargo`, `/api/cargo-registration-form` |
| Warehouse and placement | `/api/warehouses`, `/api/zones`, `/api/racks`, `/api/levels`, `/api/bins`, `/api/placement` |
| Rules and capacity | `/api/bin-rules`, `/api/capacity-configurations` |
| Supervision and dispatch | `/api/supervisor`, `/api/dispatch`, `/api/release-readiness` |
| Finance and payments | `/api/finance`, `/api/payments`, `/api/public/payments` |
| Customs and gate | `/api/customs`, `/api/gate` |
| Management and reports | `/api/management`, `/api/reports` |
| Administration | `/api/users`, `/api/roles`, `/api/admin`, `/api/audit-logs`, `/api/user-sessions`, `/api/shifts` |
| Scanner and notifications | `/api/scanner`, `/api/notifications` |

## Security and data handling

- JWT access tokens and refresh sessions authenticate users.
- Permission middleware controls portals and protected API actions.
- Cargo documents are validated and stored as files; their records and metadata are stored in PostgreSQL.
- Audit records capture important activity and are protected by runtime database grants in production.
- Payment webhooks validate signatures and use idempotency protections.
- Security middleware applies request validation, rate limits, response minimization, and sensitive-data redaction.

## Commands

```bash
# Frontend tests and production build
cd frontend
npm test
npm run build

# Backend tests
cd ../backend
npm test

# Docker database tasks
docker compose exec backend npm run migrate
docker compose exec backend npm run verify-schema
docker compose exec backend npm run seed:warehouses
```

## Production deployment

Use `docker-compose.production.yml` together with `deployment/HTTPS.md`. Production uses Docker secrets, separate database-owner and application credentials, persistent cargo-document storage, and Nginx for TLS termination.

## Project information

- **Project:** Designing and Developing a Warehouse Management System for Fumba Port Indoor Storage Facilities
- **Programme:** B.Sc. Computer Science Final Year Project
- **Repository:** `Abdillah-Ali/Designing-and-Developing-a-Warehouse-Management-System-for-Fumba-Port-Indoor-Storage-Facilities`

## License

No open-source license is declared. All rights are reserved by the project author.
