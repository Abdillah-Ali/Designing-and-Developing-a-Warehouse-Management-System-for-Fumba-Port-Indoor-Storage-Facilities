# Fumba Port Warehouse Management System (WMS)

An enterprise-grade, role-based Warehouse Management System (WMS) designed to automate, streamline, and secure indoor freight handling, storage placement, customs clearance, financial billing, and gate dispatch operations for indoor storage facilities at Fumba Port.

---

## 📋 Table of Contents

- [Project Overview](#-project-overview)
- [Objectives](#-objectives)
- [Technology Stack](#-technology-stack)
- [System Architecture](#-system-architecture)
- [User Roles and Permissions](#-user-roles-and-permissions)
- [Major System Modules](#-major-system-modules)
- [Complete Cargo Workflow](#-complete-cargo-workflow)
- [Invoice and Payment Workflow](#-invoice-and-payment-workflow)
- [Management Release Workflow](#-management-release-workflow)
- [Database Architecture](#-database-architecture)
- [REST API Reference](#-rest-api-reference)
- [Project Structure](#-project-structure)
- [Installation and Local Setup](#-installation-and-local-setup)
- [Docker Configuration](#-docker-configuration)
- [Environment Variables](#-environment-variables)
- [Flutterwave Payment Integration](#-flutterwave-payment-integration)
- [Security Architecture](#-security-architecture)
- [Automated Testing](#-automated-testing)
- [Initial System Setup](#-initial-system-setup)
- [Important Business Rules](#-important-business-rules)
- [System Status / Current Scope](#-system-status--current-scope)
- [Known Limitations](#-known-limitations)
- [Useful Commands](#-useful-commands)
- [Project Information](#-project-information)
- [License / Usage](#-license--usage)

---

## 🎯 Project Overview

Fumba Port is a major logistics maritime hub handling thousands of metric tonnes of cargo. Manual freight tracking, fragmented storage placement, delayed customs clearance, and error-prone billing can lead to port congestion, cargo damage, and financial discrepancies.

The **Fumba Port Warehouse Management System (WMS)** solves these operational bottlenecks by digitizing the end-to-end lifespan of indoor freight:

1. **Digital Cargo Registration & Verification**: Capture incoming freight documentation, container details, and handling requirements at the port gate.
2. **Rule-Based Storage Placement Engine**: Automatically evaluate weight, volume, hazardous material classifications, customs status, and fragile handling constraints to recommend eligible indoor storage bins.
3. **Integrated Customs Inspection & Clearance**: Maintain customs hold markers and digital inspection logs directly within the logistics workflow.
4. **Automated Tariff Billing & Payment Gateway**: Automatically generate itemized storage invoices based on weight, volume, and storage duration upon cargo approval, featuring direct online payment integration via Flutterwave.
5. **Strict Multi-Tiered Gate-Out Authorization**: Enforce release readiness checks (payment confirmation, customs clearance, and supervisor validation) before authorizing cargo dispatch at the gate.

---

## 🚀 Objectives

### Main Project Objective

To design, develop, and deploy an automated, secure, and role-restricted Warehouse Management System tailored specifically for indoor freight handling at Fumba Port.

### Key Operational Goals

- **Eliminate Storage Over-Allocation**: Enforce real-time weight and volume calculations across a 5-tier physical hierarchy (`Warehouse -> Zone -> Rack -> Level -> Bin`).
- **Enforce Operational Security**: Prevent unauthorized physical cargo movement via real-time barcode scanning and role-restricted state machine workflows.
- **Ensure Transparent Financial Operations**: Automate storage tariff calculations using arbitrary-precision fixed-point math to eliminate floating-point rounding errors.
- **Provide Real-Time Visibility**: Broadcast operational updates (scanning progress, placement validation, cargo release status) via WebSockets (Socket.IO) to staff and management portals.

---

## 🛠️ Technology Stack

### Frontend Application

- **Framework**: React 18.3 (`react`, `react-dom`)
- **Build Tool**: Vite 5.4 (`@vitejs/plugin-react-swc`)
- **Router**: React Router DOM 6.30
- **State & Data Fetching**: TanStack React Query 5.83
- **UI Components**: Tailwind CSS 3.4, Radix UI Primitives, Lucide Icons, Shadcn UI Components
- **Forms & Validation**: React Hook Form 7.61, Zod 3.25, `@hookform/resolvers`
- **Real-Time Client**: Socket.IO Client 4.8
- **Testing**: Vitest 3.2, React Testing Library, JSDOM

### Backend Service

- **Runtime**: Node.js (v18+ LTS)
- **Web Framework**: Express 4.21
- **Real-Time Communications**: Socket.IO 4.8
- **Database Driver**: Node Postgres (`pg` 8.13)
- **Security & Encryption**: Bcryptjs 3.0, Node.js Native Crypto (`crypto`)
- **Email Notifications**: Nodemailer 7.0
- **Environment Management**: Dotenv 16.4
- **Testing**: Node.js Native Test Runner (`node --test`)

### Database & Storage

- **Database Engine**: PostgreSQL 17 (with `pgcrypto` extension)
- **Procedural Logic**: PL/pgSQL functions, constraints, and triggers
- **Isolation & Locking**: Advisory Locks (`pg_advisory_xact_lock`, `pg_try_advisory_lock`), Row-level Locks (`FOR UPDATE`)

### Infrastructure & Deployment

- **Containerization**: Docker & Docker Compose
- **Web Server / Reverse Proxy**: Nginx 1.27 (Production Edge Proxy)
- **Process Manager**: Nodemon (Development), Node.js (Production)

---

## 🏗️ System Architecture

The WMS architecture follows a decoupled, multi-container service model communicating over HTTP/REST and WebSockets:

```
                  +-----------------------------------+
                  |   Browser Client / Handheld GUI   |
                  |     React 18 + Vite (Port 3000)   |
                  +-----------------+-----------------+
                                    |
                         HTTP REST  |  Socket.IO WSS
                                    v
                  +-----------------+-----------------+
                  |   Edge Proxy / Reverse Nginx      |
                  |   (Production Port 80/443)        |
                  +-----------------+-----------------+
                                    |
                                    v
                  +-----------------+-----------------+
                  |    Express 4 Backend Server       |
                  |    REST API & Real-Time Engine    |
                  |          (Port 5000)              |
                  +--------+----------------+---------+
                           |                |
             OAuth / REST  |                | Node-Postgres Driver
                           v                v
      +--------------------+---+   +--------+----------------+
      |  Flutterwave Payment   |   |   PostgreSQL 17 Engine  |
      |   Gateway / Webhooks   |   |      (Port 5433/5422)    |
      +------------------------+   +-------------------------+
```

### Container Port Bindings (Local Environment)

| Service Name | Container Name   | Host Port Binding | Internal Container Port |
| :----------- | :--------------- | :---------------- | :---------------------- |
| `frontend`   | `fumba-frontend` | `127.0.0.1:3000`  | `3000`                  |
| `backend`    | `fumba-backend`  | `127.0.0.1:5000`  | `5000`                  |
| `postgres`   | `fumba-postgres` | `127.0.0.1:5433`  | `5432`                  |

---

## 👥 User Roles and Permissions

The system implements strict Role-Based Access Control (RBAC) across 9 portal roles:

| Role Name                | Key Identifier         | Responsibilities & Access Scope                                                                                                                 |
| :----------------------- | :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| **System Administrator** | `system-admin`         | Full system access, warehouse hierarchy management, user account provisioning, system settings, audit log archiving, and backup/restore.        |
| **Warehouse Staff**      | `warehouse-staff`      | Cargo registration, scanning barcode validation, cargo placement execution, relocation, and barcode printing.                                   |
| **Warehouse Supervisor** | `warehouse-supervisor` | Cargo registration approval/rejection, emergency release approvals, placement overrides, staff activity monitoring, and review queue oversight. |
| **Customs Officer**      | `customs-officer`      | Customs hold enforcement, physical inspection logging, declaration verification, and customs clearance status updates.                          |
| **Finance Officer**      | `finance-officer`      | Storage tariff management, invoice generation, manual payment recording, payment confirmation, and financial reporting.                         |
| **Gate Officer**         | `gate-officer`         | Release queue inspection, gate-out validation, emergency release requests, and physical dispatch execution.                                     |
| **Management**           | `management`           | High-level executive dashboards, operational performance reports, management release decisions, and tariff approval oversight.                  |
| **Auditor**              | `auditor`              | Read-only compliance portal for inspecting complete audit logs, cargo transition histories, financial ledgers, and system changes.              |
| **Scanner Account**      | `scanner`              | Dedicated handheld scanning account paired with staff sessions for real-time barcode scanning.                                                  |

---

## 🧩 Major System Modules

1. **Authentication & Session Manager**: JWT token issuance, refresh token family rotation, replay attack prevention, and session revocation.
2. **Initial System Setup (Bootstrap)**: One-time administrator setup flow guarded by database advisory locks (`SETUP_LOCK_KEY`).
3. **Warehouse Hierarchy & Capacity Management**: Interactive configuration of Warehouses, Zones, Racks, Levels, and Bins with live capacity calculations.
4. **Dynamic Cargo Registration Form Builder**: Customizable registration fields with validation rules and catalog option mappings.
5. **Cargo Registration & Verification**: Capture consignment details, compute weight/volume, generate barcodes, and execute duplicate detection.
6. **Bin Rule Engine & Placement Evaluator**: Rule engine evaluating capacity, hazard compatibility, customs holds, and fragile handling.
7. **Scanner & Placement Activity Engine**: Handheld barcode scanner sessions with Socket.IO real-time feedback loops.
8. **Customs Processing Module**: Track customs inspection statuses (`Pending Inspection`, `On Hold`, `Inspected`, `Cleared`).
9. **Tariff Management & Approval Pipeline**: Define base rates, billing units, and submit tariffs for executive management approval.
10. **Automated Billing & Invoice Generator**: Automatic itemized storage invoice creation upon supervisor cargo approval.
11. **Payment Engine (Flutterwave Gateway)**: Online card/mobile money payments via Flutterwave OAuth 2.0 and webhook verification.
12. **Management Release Engine**: Override mechanism allowing early freight release under executive authorization.
13. **Gate-Out & Dispatch Control**: Final release readiness verification checking payment, customs, and approval status before dispatch.
14. **Audit Logging & System Monitoring**: Immutable system audit trail capturing user actions, timestamps, IP addresses, and metadata.
15. **Notification Engine**: Event-driven notification scheduler alerting supervisors of pending review escalations.

---

## 🔄 Complete Cargo Workflow

```
 [ Gate Registration ]
          │
          ▼
 [ Duplicate Check & Initial Capture ] ➔ Status: "Pending Review"
          │
          ▼
 [ Supervisor Review ] ➔ Approved / Rejected / Correction Required
          │
          ├──────────────────────────────────────────┐
          ▼ (If Approved)                            ▼ (Automatic)
 [ Bin Rule Recommendation ]              [ Automated Storage Invoice Generated ]
          │                                          │
          ▼                                          ▼
 [ Scanning & Physical Placement ]       [ Payment Settlement via Flutterwave / Finance ]
          │                                          │
          ▼                                          ▼
 [ Customs Clearance / Inspection ] ───────► [ Release Readiness Evaluation ]
                                                     │
                                                     ▼
                                          [ Gate-Out Authorization ] ➔ Status: "Dispatched"
```

1. **Cargo Registration**: Staff registers incoming cargo. System checks for duplicates and sets status to `Pending Review`.
2. **Supervisor Review**: Supervisor reviews details and chooses **Approve**, **Reject**, or **Request Correction**.
3. **Automated Billing**: Upon approval, the system immediately calculates storage charges and generates a public invoice.
4. **Placement Recommendation**: The rule engine filters available bins and recommends the optimal storage location.
5. **Physical Placement**: Staff scans cargo and bin barcodes via mobile scanner or manual entry.
6. **Customs Inspection**: Customs officers inspect freight and set status to `Cleared` or `On Hold`.
7. **Payment Settlement**: Freight owner pays invoice online via Flutterwave or directly with the Finance Officer.
8. **Release Readiness Check**: System verifies:
   - Cargo `registration_status` = `Approved`
   - Cargo `placement_status` = `Placed` or `Relocated`
   - Customs `customs_status` = `Cleared`
   - Payment `invoice_status` = `Paid` (or approved `Management Release`)
9. **Gate-Out Dispatch**: Gate officer verifies barcode at exit, confirming final physical dispatch (`placement_status` = `Dispatched`).

---

## 💳 Invoice and Payment Workflow

- **Automatic Invoice Generation**: Triggered automatically when cargo registration is marked `Approved`.
- **Arbitrary-Precision Calculation**: Daily rates, weight/volume charges, and stay durations are computed using `BigInt`-scaled fixed-point arithmetic (`DECIMAL_SCALE = 10000n`) to prevent rounding errors.
- **Payment Options**: Supports full lump-sum payments and structured partial/installment billing.
- **Flutterwave Gateway Integration**:
  - OAuth 2.0 client authentication (`FLUTTERWAVE_CLIENT_ID`, `FLUTTERWAVE_CLIENT_SECRET`).
  - Webhooks verified using HMAC signatures (`FLUTTERWAVE_WEBHOOK_SECRET`).
  - Local testing supported via Flutterwave Developer Sandbox API.

---

## 🔒 Management Release Workflow

In urgent operational scenarios (e.g. perishable goods, diplomatic cargo, or emergency relief supplies), executive management can authorize a **Management Release**:

- **Bypasses**: Standard upfront payment prerequisites.
- **Does NOT Bypass**: Physical safety placement constraints or customs security holds.
- **Audit Requirement**: Requires written justification notes and dual management confirmation.

---

## 🗄️ Database Architecture

- **Engine**: PostgreSQL 17
- **Database Name**: `fumbaport_wms`
- **Migration Tracking**: Managed via custom script `database/migrationRunner.js` tracking executed files in `schema_migrations`.
- **Data Persistence**: Preserved across container restarts via Docker volume `postgres_data`.

---

## 📡 REST API Reference

The backend exposes a structured RESTful API under the `/api` prefix:

| Module Route Group       | Base Endpoint                                                             | Primary Responsibilities                                            |
| :----------------------- | :------------------------------------------------------------------------ | :------------------------------------------------------------------ |
| **Authentication**       | `/api/auth`                                                               | Login, token refresh, logout, session state.                        |
| **System Setup**         | `/api/bootstrap`                                                          | Initial system setup and first admin creation.                      |
| **Warehouse Structure**  | `/api/warehouses`, `/api/zones`, `/api/racks`, `/api/levels`, `/api/bins` | Hierarchy configuration & storage location management.              |
| **Cargo Management**     | `/api/cargo`                                                              | Registration, document uploads, barcode generation, status updates. |
| **Placement & Scanning** | `/api/placement`, `/api/scanner`                                          | Placement validation, candidate recommendation, scanner sessions.   |
| **Bin Rules**            | `/api/bin-rules`                                                          | Storage rule configuration and evaluator parameter settings.        |
| **Finance & Billing**    | `/api/finance`                                                            | Tariffs, charge ledgers, invoices, payment recording.               |
| **Customs Processing**   | `/api/customs`                                                            | Inspection logs, hold management, customs clearance.                |
| **Gate Operations**      | `/api/gate`                                                               | Release queues, gate-out verification, emergency release requests.  |
| **Management**           | `/api/management`                                                         | Tariff approvals, management releases, operational reports.         |
| **System Admin**         | `/api/users`, `/api/roles`, `/api/audit-logs`, `/api/system-settings`     | System user administration, audit logging, runtime grants.          |

---

## 📁 Project Structure

```
WMS-FumbaPort/
├── backend/
│   ├── config/              # Database connection, environment, & auth registries
│   ├── controllers/         # Express API endpoint controllers
│   ├── database/            # Schema SQL, migrations, seeding, & grant scripts
│   ├── middleware/          # Auth, security headers, validation, rate limiting
│   ├── models/              # Admin and audit data access models
│   ├── realtime/            # Socket.IO server setup & room event dispatchers
│   ├── routes/              # Express API route declarations
│   ├── services/            # Core business engines (finance, rules, workflow)
│   ├── tests/               # Backend API integration and unit test suites
│   ├── utils/               # Token, password, file validation, & logger utilities
│   ├── app.js               # Express application middleware configuration
│   └── server.js            # Node HTTP & WebSocket server entry point
├── frontend/
│   ├── src/
│   │   ├── components/      # UI components & Shadcn/Radix primitives
│   │   ├── hooks/           # Custom React hooks
│   │   ├── lib/             # Utility helpers & state definitions
│   │   ├── pages/           # Portal views (Admin, Supervisor, Finance, Gate, etc.)
│   │   ├── App.jsx          # React router & main application shell
│   │   └── main.jsx         # React application DOM entry point
│   ├── package.json
│   └── vite.config.js
├── docker-compose.yml       # Development multi-container orchestration
├── docker-compose.production.yml # Production multi-container setup with Nginx Edge
└── README.md                # System documentation
```

---

## 💻 Installation and Local Setup

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (v24.0+)
- [Node.js](https://nodejs.org/) (v18.0+ LTS - for local non-Docker development)
- [Git](https://git-scm.com/)

### Step-by-Step Installation

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/Abdillah-Ali/Designing-and-Developing-a-Warehouse-Management-System-for-Fumba-Port-Indoor-Storage-Facilities.git
   cd WMS-FumbaPort
   ```

2. **Configure Environment Variables**:
   Copy `.env.production.example` or create a local `.env` file in the root directory:

   ```bash
   cp .env.production.example .env
   ```

3. **Start Containers via Docker Compose**:

   ```bash
   docker compose up --build -d
   ```

4. **Verify Container Health**:

   ```bash
   docker compose ps
   ```

5. **Access Application**:
   - **Frontend GUI**: [`http://localhost:3000`](http://localhost:3000)
   - **Backend API**: [`http://localhost:5000/api/health`](http://localhost:5000/api/health)
   - **Database (PostgreSQL)**: `localhost:5433`

---

## 🔐 Environment Variables

| Variable Name                | Purpose / Description                    | Default / Example      |
| :--------------------------- | :--------------------------------------- | :--------------------- |
| `POSTGRES_DB`                | PostgreSQL database name                 | `fumbaport_wms`        |
| `POSTGRES_USER`              | PostgreSQL superuser username            | `postgres`             |
| `POSTGRES_PASSWORD`          | PostgreSQL superuser password            | _(Configured in .env)_ |
| `JWT_SECRET`                 | Secret key for signing JWT access tokens | _(Configured in .env)_ |
| `PORT`                       | Backend HTTP listening port              | `5000`                 |
| `PAYMENT_PROVIDER`           | Payment integration driver               | `flutterwave`          |
| `PAYMENT_ENVIRONMENT`        | Payment environment mode                 | `sandbox`              |
| `FLUTTERWAVE_CLIENT_ID`      | Flutterwave OAuth Client ID              | _(Configured in .env)_ |
| `FLUTTERWAVE_CLIENT_SECRET`  | Flutterwave OAuth Client Secret          | _(Configured in .env)_ |
| `FLUTTERWAVE_WEBHOOK_SECRET` | Secret for HMAC signature verification   | _(Configured in .env)_ |

---

## 🛡️ Security Architecture

- **Authentication**: JWT access tokens (short-lived) paired with database-backed refresh tokens featuring automatic token family rotation and replay attack detection.
- **Authorization**: Centralized Route Authorization Registry mapping regex routes to granular permission keys.
- **Database Immutability**: Database runtime user (`app_runtime_user`) explicitly has `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, archived_audit_logs`.
- **Upload Hardening**: Binary magic-byte file signature validation (`%PDF-`, JPEG/PNG headers) blocking file extension spoofing and path traversal.
- **Input Inspection**: Middleware inspects request body depth (max 10) and blocks prototype pollution keys (`__proto__`, `constructor`).
- **Response Redaction**: Automatic interception of JSON responses to strip passwords, hash strings, and internal file paths.

---

## 🧪 Automated Testing

### Running Backend Tests

Execute the native Node.js backend test suite:

```bash
cd backend
npm test
```

### Running Frontend Tests

Execute the Vitest React component test suite:

```bash
cd frontend
npm run test
```

---

## 🚀 Initial System Setup (Bootstrap Admin)

When launching the application for the first time on a fresh database:

1. Navigate to [`http://localhost:3000/initial-setup`](http://localhost:3000/initial-setup).
2. The system checks if an administrator exists. If none is present, the setup wizard prompts for the initial System Administrator credentials.
3. Upon creation, database advisory locks (`SETUP_LOCK_KEY = 927431`) guarantee one-time execution, permanently locking the `/initial-setup` route against future calls.

---

## ⚡ Useful Operational Commands

### Docker Management

```bash
# Start all containers in detached mode
docker compose up -d

# View real-time container logs
docker compose logs -f

# Rebuild containers after dependency updates
docker compose up --build -d

# Stop all running services
docker compose down
```

### Database Management

```bash
# Execute database schema migrations manually
docker compose exec backend npm run migrate

# Verify database schema integrity
docker compose exec backend npm run verify-schema

# Seed real Fumba Port warehouse hierarchy data
docker compose exec backend npm run seed:warehouses

# Connect directly to PostgreSQL interactive terminal
docker compose exec postgres psql -U postgres -d fumbaport_wms
```

---

## 📄 Project Information

- **Institution**: Final Year Project (B.Sc. Computer Science)
- **Project Title**: Designing and Developing a Warehouse Management System for Fumba Port Indoor Storage Facilities
- **Repository**: [`Abdillah-Ali/Designing-and-Developing-a-Warehouse-Management-System-for-Fumba-Port-Indoor-Storage-Facilities`](https://github.com/Abdillah-Ali/Designing-and-Developing-a-Warehouse-Management-System-for-Fumba-Port-Indoor-Storage-Facilities)

---

## 📜 License / Usage

This project is released under the **MIT License**.
