# Fumba Port Warehouse Management System (WMS)

An enterprise grade, role based Warehouse Management System designed to automate, streamline, and secure indoor freight handling, storage placement, customs clearance, financial billing, and gate dispatch operations for indoor storage facilities at Fumba Port.

## Table of Contents

* [Project Overview](#project-overview)
* [Objectives](#objectives)
* [Technology Stack](#technology-stack)
* [System Architecture](#system-architecture)
* [User Roles and Permissions](#user-roles-and-permissions)
* [Major System Modules](#major-system-modules)
* [Complete Cargo Workflow](#complete-cargo-workflow)
* [Invoice and Payment Workflow](#invoice-and-payment-workflow)
* [Management Release Workflow](#management-release-workflow)
* [Database Architecture](#database-architecture)
* [REST API Reference](#rest-api-reference)
* [Project Structure](#project-structure)
* [Installation and Local Setup](#installation-and-local-setup)
* [Docker Configuration](#docker-configuration)
* [Environment Variables](#environment-variables)
* [Flutterwave Payment Integration](#flutterwave-payment-integration)
* [Security Architecture](#security-architecture)
* [Automated Testing](#automated-testing)
* [Initial System Setup](#initial-system-setup)
* [Important Business Rules](#important-business-rules)
* [System Status and Current Scope](#system-status-and-current-scope)
* [Known Limitations](#known-limitations)
* [Useful Commands](#useful-commands)
* [Project Information](#project-information)
* [License and Usage](#license-and-usage)

## Project Overview

Fumba Port is a major logistics maritime hub handling thousands of metric tonnes of cargo. Manual freight tracking, fragmented storage placement, delayed customs clearance, and error-prone billing can lead to port congestion, cargo damage, and financial discrepancies.

The Fumba Port Warehouse Management System solves these operational bottlenecks by digitizing the end to end lifespan of indoor freight:

1. Digital Cargo Registration and Verification: Capture incoming freight documentation, container details, and handling requirements at the port gate.
2. Rule Based Storage Placement Engine: Automatically evaluate weight, volume, hazardous material classifications, customs status, and fragile handling constraints to recommend eligible indoor storage bins.
3. Integrated Customs Inspection and Clearance: Maintain customs hold markers and digital inspection logs directly within the logistics workflow.
4. Automated Tariff Billing and Payment Gateway: Automatically generate itemized storage invoices based on weight, volume, and storage duration upon cargo approval, featuring direct online payment integration via Flutterwave.
5. Strict Multi-Tiered Gate-Out Authorization: Enforce release readiness checks including payment confirmation, customs clearance, and supervisor validation before authorizing cargo dispatch at the gate.

## Objectives

### Main Project Objective
To design, develop, and deploy an automated, secure, and role-restricted Warehouse Management System tailored specifically for indoor freight handling at Fumba Port.

### Key Operational Goals
* Eliminate Storage Over-Allocation: Enforce real-time weight and volume calculations across a 5-tier physical hierarchy consisting of Warehouse to Zone to Rack to Level to Bin.
* Enforce Operational Security: Prevent unauthorized physical cargo movement via real-time barcode scanning and role-restricted state machine workflows.
* Ensure Transparent Financial Operations: Automate storage tariff calculations using arbitrary precision fixed point math to eliminate floating point rounding errors.
* Provide Real-Time Visibility: Broadcast operational updates such as scanning progress, placement validation, cargo release status via WebSockets using Socket.IO to staff and management portals.

## Technology Stack

### Frontend Application
* Framework: React 18.3 (`react`, `react-dom`)
* Build Tool: Vite 5.4 (`@vitejs/plugin-react-swc`)
* Router: React Router DOM 6.30
* State and Data Fetching: TanStack React Query 5.83
* UI Components: Tailwind CSS 3.4, Radix UI Primitives, Lucide Icons, Shadcn UI Components
* Forms and Validation: React Hook Form 7.61, Zod 3.25, `@hookform/resolvers`
* Real-Time Client: Socket.IO Client 4.8
* Testing: Vitest 3.2, React Testing Library, JSDOM

### Backend Service
* Runtime: Node.js (v18+ LTS)
* Web Framework: Express 4.21
* Real-Time Communications: Socket.IO 4.8
* Database Driver: Node Postgres (`pg` 8.13)
* Security and Encryption: Bcryptjs 3.0, Node.js Native Crypto (`crypto`)
* Email Notifications: Nodemailer 7.0
* Environment Management: Dotenv 16.4
* Testing: Node.js Native Test Runner (`node --test`)

### Database and Storage
* Database Engine: PostgreSQL 17 with `pgcrypto` extension
* Procedural Logic: PL/pgSQL functions, constraints, and triggers
* Isolation and Locking: Advisory Locks (`pg_advisory_xact_lock`, `pg_try_advisory_lock`), Row-level Locks (`FOR UPDATE`)

### Infrastructure and Deployment
* Containerization: Docker and Docker Compose
* Web Server and Reverse Proxy: Nginx 1.27 (Production Edge Proxy)
* Process Manager: Nodemon (Development), Node.js (Production)

## System Architecture

The WMS architecture follows a decoupled, multi-container service model communicating over HTTP REST and WebSockets:

```
                  +-----------------------------------+
                  |   Browser Client / Handheld GUI   |
                  |     React 18 + Vite (Port 3000)   |
                  +-----------------+-----------------+
                                    |
                         HTTP REST  |  Socket.IO WSS
                                    v
                  +-----------------+-----------------+
                  |    Edge Proxy / Reverse Nginx      |
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

| Service Name | Container Name | Host Port Binding | Internal Container Port |
| :--- | :--- | :--- | :--- |
| frontend | fumba-frontend | 127.0.0.1:3000 | 3000 |
| backend | fumba-backend | 127.0.0.1:5000 | 5000 |
| postgres | fumba-postgres | 127.0.0.1:5433 | 5432 |

## User Roles and Permissions

The system implements strict Role Based Access Control (RBAC) across 9 portal roles:

| Role Name | Key Identifier | Responsibilities and Access Scope |
| :--- | :--- | :--- |
| System Administrator | `system-admin` | Full system access, warehouse hierarchy management, user account provisioning, system settings, audit log archiving, and backup restore. |
| Warehouse Staff | `warehouse-staff` | Cargo registration, scanning barcode validation, cargo placement execution, relocation, and barcode printing. |
| Warehouse Supervisor | `warehouse-supervisor` | Cargo registration approval or rejection, emergency release approvals, placement overrides, staff activity monitoring, and review queue oversight. |
| Customs Officer | `customs-officer` | Customs hold enforcement, physical inspection logging, declaration verification, and customs clearance status updates. |
| Finance Officer | `finance-officer` | Storage tariff management, invoice details viewing, manual payment recording, payment confirmation, invoice printing, and financial reporting. |
| Gate Officer | `gate-officer` | Release queue inspection, gate-out validation, emergency release requests, and physical dispatch execution. |
| Management | `management` | High-level executive dashboards, operational performance reports, management release decisions, and tariff approval oversight. |
| Auditor | `auditor` | Read-only compliance portal for inspecting complete audit logs, cargo transition histories, financial ledgers, and system changes. |
| Scanner Account | `scanner` | Dedicated handheld scanning account paired with staff sessions for real-time barcode scanning. |

## Major System Modules

1. Authentication and Session Manager: JWT token issuance, refresh token family rotation, replay attack prevention, and session revocation.
2. Initial System Setup (Bootstrap): One-time administrator setup flow guarded by database advisory locks.
3. Warehouse Hierarchy and Capacity Management: Interactive configuration of Warehouses, Zones, Racks, Levels, and Bins with live capacity calculations.
4. Dynamic Cargo Registration Form Builder: Customizable registration fields with validation rules and catalog option mappings.
5. Cargo Registration and Verification: Capture consignment details, compute weight and volume, generate barcodes, and execute duplicate detection. Automatically creates a pending invoice upon registration.
6. Bin Rule Engine and Placement Evaluator: Rule engine evaluating capacity, hazard compatibility, customs holds, and fragile handling.
7. Scanner and Placement Activity Engine: Handheld barcode scanner sessions with Socket.IO real-time feedback loops.
8. Customs Processing Module: Track customs inspection statuses such as Pending Inspection, On Hold, Inspected, and Cleared.
9. Tariff Management and Approval Pipeline: Define base rates, billing units, and submit tariffs for executive management approval.
10. Automated Billing and Invoice Generator: Automatic itemized storage invoice creation upon cargo registration, activated upon supervisor approval.
11. Payment Engine (Flutterwave Gateway): Online card and mobile money payments via Flutterwave OAuth 2.0 and webhook verification.
12. Management Release Engine: Override mechanism allowing early freight release under executive authorization.
13. Gate-Out and Dispatch Control: Final release readiness verification checking payment, customs, and approval status before dispatch.
14. Audit Logging and System Monitoring: Immutable system audit trail capturing user actions, timestamps, IP addresses, and metadata.
15. Notification Engine: Event-driven notification scheduler alerting supervisors of pending review escalations.

## Complete Cargo Workflow

```
 [ Gate Registration ]
          |
          v
 [ Duplicate Check & Initial Capture ] ===> Status: Pending Review
          |                                (Invoice Automatically Created)
          v
 [ Supervisor Review ] ===> Approved / Rejected / Correction Required
          |
          +------------------------------------------+
          v (If Approved)                            v (If Rejected)
 [ Payment Reference Generated ]           [ Invoice Automatically Cancelled ]
          |                                          |
          v                                          v
 [ Bin Rule Recommendation ]               [ Payment Capability Blocked ]
          |
          v
 [ Scanning & Physical Placement ]
          |
          v
 [ Customs Clearance / Inspection ] ===> [ Payment Settlement via Flutterwave / Finance ]
                                                     |
                                                     v
                                          [ Release Readiness Evaluation ]
                                                     |
                                                     v
                                          [ Gate-Out Authorization ] ===> Status: Dispatched
```

1. Cargo Registration: Warehouse Staff registers incoming cargo. The system validates the applicable active tariff, creates the cargo record with `registration_status` set to `Pending Review`, and automatically creates an initial invoice. The older `status` and `workflow_status` columns remain synchronized database aliases of `registration_status` for backward compatibility.
2. Automatic Invoice Creation: An invoice is created immediately during cargo registration in `Draft` status with `payment_reference` set to `NULL`. Finance does not manually initiate invoice generation.
3. Supervisor Review: The Supervisor evaluates the registration and chooses to Approve, Reject, or Request Correction.
4. Approval Processing: Upon Supervisor approval, `registration_status` becomes `Approved`, the existing invoice is issued, and a payment reference (`PAY-*`) and public payment token are generated. Payment emails are queued to the freight owner.
5. Rejection Processing: If the Supervisor rejects the cargo, `registration_status` becomes `Rejected`, and the existing invoice is automatically cancelled (`status = 'Cancelled'`). Payment initiation and public payment links are blocked, while financial and audit histories are preserved.
6. Storage Placement: Rule engine evaluates candidate storage locations and staff confirms physical placement via barcode scanning.
7. Customs Processing: Customs officers inspect freight and set status to Cleared or On Hold.
8. Payment Settlement: Customer pays online via Flutterwave using the public payment link or completes payment directly with Finance.
9. Release Readiness and Gate-Out: Gate Officer validates cargo at exit. The system confirms `Approved` registration, `Placed` status, `Cleared` customs, and `Paid` invoice (or approved Management Release) before authorizing final Gate-Out dispatch (`placement_status = 'Dispatched'`).

## Invoice and Payment Workflow

* Automatic Invoice Creation: Triggered automatically when Warehouse Staff completes cargo registration.
* Pending Approval State: While Supervisor review is pending, the invoice exists in the system but its payment reference (`payment_reference`) remains `NULL`, preventing payment initiation.
* Supervisor Approval Activation: When the Supervisor approves cargo, the existing invoice is activated, generating a unique `PAY-*` public payment reference and activating the public payment link.
* Supervisor Rejection Cancellation: When cargo is rejected, the invoice status changes to `Cancelled`, `payment_reference` is cleared, and public payment attempts are rejected.
* Tariff Verification: Invoice calculation validates active, effective, management-approved tariffs prior to cargo registration.
* Arbitrary Precision Math: Monetary amounts are computed using BigInt scaled fixed point arithmetic (`DECIMAL_SCALE = 10000n`) to prevent floating point rounding errors.
* Finance Officer Visibility: Finance Officers monitor invoices, inspect charges, view paid amounts and balances, print invoices, and resend payment link emails. Finance Officers do not manually create registration invoices.
* Flutterwave Integration: Supports Flutterwave OAuth 2.0 authentication, REST API calls, and HMAC webhook signature verification.

## Management Release Workflow

In urgent operational situations such as perishable freight or diplomatic shipments, executive management can authorize a Management Release:

* Purpose: Provides an executive payment override allowing cargo release while financial settlement is processed.
* Preserved Safeguards: Does not bypass physical storage placement rules or customs holds.
* Gate Restriction: Gate Officers can dispatch cargo with an approved Management Release provided Customs clearance and physical placement are verified.

## Database Architecture

* Engine: PostgreSQL 17
* Database Name: `fumbaport_wms`
* Schema Migrations: Tracked in `schema_migrations` and executed via `database/migrationRunner.js`.
* Data Persistence: Stored across container restarts in Docker volume `postgres_data`.
* Access Privileges: Runtime user permissions strictly revoke `UPDATE`, `DELETE`, and `TRUNCATE` on `audit_logs` and `archived_audit_logs` to ensure audit immutability.

## REST API Reference

The backend API is structured under the `/api` prefix:

| Route Group | Base Path | Core Responsibilities |
| :--- | :--- | :--- |
| Authentication | `/api/auth` | Login, token refresh, logout, session state. |
| System Setup | `/api/bootstrap` | Initial one-time system setup and administrator bootstrap. |
| Warehouses | `/api/warehouses` | Warehouse configuration and capacity settings. |
| Hierarchy | `/api/zones`, `/api/racks`, `/api/levels`, `/api/bins` | Storage topology and bin management. |
| Cargo | `/api/cargo` | Registration, resubmission, document uploads, barcode generation. |
| Placement | `/api/placement`, `/api/scanner` | Placement validation, recommendations, scanner sessions. |
| Bin Rules | `/api/bin-rules` | Rule engine parameters and priority rules. |
| Finance | `/api/finance` | Storage tariffs, charge ledgers, invoices, payments. |
| Customs | `/api/customs` | Inspection logs, hold management, customs clearance. |
| Gate | `/api/gate` | Release queue, gate-out validation, emergency release requests. |
| Management | `/api/management` | Tariff approvals, management releases, reports. |
| Administration | `/api/users`, `/api/roles`, `/api/audit-logs` | User administration, roles, audit trails. |

## Project Structure

```
WMS-FumbaPort/
+-- backend/
|   +-- config/              # Database connection, environment, & auth registries
|   +-- controllers/         # Express API endpoint controllers
|   +-- database/            # Schema SQL, migrations, seeding, & grant scripts
|   +-- middleware/          # Auth, security headers, validation, rate limiting
|   +-- models/              # Admin and audit data access models
|   +-- realtime/            # Socket.IO server setup & room event dispatchers
|   +-- routes/              # Express API route declarations
|   +-- services/            # Core business engines (finance, rules, workflow)
|   +-- tests/               # Backend API integration and unit test suites
|   +-- utils/               # Token, password, file validation, & logger utilities
|   +-- app.js               # Express application middleware configuration
|   +-- server.js            # Node HTTP & WebSocket server entry point
+-- frontend/
|   +-- src/
|   |   +-- components/      # UI components & Radix primitives
|   |   +-- hooks/           # Custom React hooks
|   |   +-- lib/             # Utility helpers & state definitions
|   |   +-- pages/           # Portal views (Admin, Supervisor, Finance, Gate, etc.)
|   |   +-- App.jsx          # React router & main application shell
|   |   +-- main.jsx         # React application DOM entry point
|   +-- package.json
|   +-- vite.config.js
+-- docker-compose.yml       # Development multi-container orchestration
+-- docker-compose.production.yml # Production multi-container setup with Nginx Edge
+-- README.md                # System documentation
```

## Installation and Local Setup

### Prerequisites
* Docker Desktop (v24.0+)
* Node.js (v18.0+ LTS for local non-Docker development)
* Git

### Step-by-Step Installation

1. Clone the Repository:
   ```bash
   git clone https://github.com/Abdillah-Ali/Designing-and-Developing-a-Warehouse-Management-System-for-Fumba-Port-Indoor-Storage-Facilities.git
   cd WMS-FumbaPort
   ```

2. Configure Environment Variables:
   Copy `.env.production.example` or create a `.env` file in the root directory:
   ```bash
   cp .env.production.example .env
   ```

3. Start Containers via Docker Compose:
   ```bash
   docker compose up --build -d
   ```

4. Verify Service Health:
   ```bash
   docker compose ps
   ```

5. Access Application:
   * Frontend GUI: `http://localhost:3000`
   * Backend API: `http://localhost:5000/api/health`
   * Database: `localhost:5433`

## Docker Configuration

| Service Name | Container Name | Host Binding | Container Port |
| :--- | :--- | :--- | :--- |
| frontend | fumba-frontend | 127.0.0.1:3000 | 3000 |
| backend | fumba-backend | 127.0.0.1:5000 | 5000 |
| postgres | fumba-postgres | 127.0.0.1:5433 | 5432 |

## Environment Variables

| Variable Name | Purpose and Description | Default or Example |
| :--- | :--- | :--- |
| `POSTGRES_DB` | PostgreSQL database name | `fumbaport_wms` |
| `POSTGRES_USER` | PostgreSQL superuser username | `postgres` |
| `POSTGRES_PASSWORD` | PostgreSQL superuser password | Configured in .env |
| `JWT_SECRET` | Secret key for signing JWT access tokens | Configured in .env |
| `PORT` | Backend HTTP listening port | `5000` |
| `PAYMENT_PROVIDER` | Payment integration driver | `flutterwave` |
| `PAYMENT_ENVIRONMENT` | Payment environment mode | `sandbox` |
| `FLUTTERWAVE_CLIENT_ID` | Flutterwave OAuth Client ID | Configured in .env |
| `FLUTTERWAVE_CLIENT_SECRET` | Flutterwave OAuth Client Secret | Configured in .env |
| `FLUTTERWAVE_WEBHOOK_SECRET` | Secret for HMAC signature verification | Configured in .env |

## Flutterwave Payment Integration

* Provider Driver: Flutterwave v4 Sandbox API
* Authentication: OAuth 2.0 token endpoint integration
* Public Payment Portal: Hosted payment route at `/pay/:token`
* Webhook Handler: Listens at `/api/payments/webhook`, verifying HMAC SHA256 signatures (`FLUTTERWAVE_WEBHOOK_SECRET`) and enforcing idempotency via `payment_webhook_events`.
* Local Sandbox Testing: Configure sandbox credentials in `.env` for local testing.

## Security Architecture

* Authentication: Short lived JWT access tokens paired with database refresh tokens featuring token family rotation and replay detection.
* Authorization: Centralized Authorization Registry mapping routes to explicit permission keys.
* Database Immutability: Database runtime user permissions revoke `UPDATE`, `DELETE`, and `TRUNCATE` on audit log tables.
* Upload Hardening: Binary magic byte file validation for uploaded documents preventing file extension spoofing.
* Request Inspection: Prototype pollution inspection middleware capping object depth and property counts.
* Sensitive Data Redaction: Interception middleware automatically redacting password hashes and tokens from outgoing JSON responses.

## Automated Testing

### Running Backend Tests
Execute the native Node.js backend test runner:
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

## Initial System Setup

1. Navigate to `http://localhost:3000/initial-setup` on a fresh database installation.
2. The setup wizard checks if a System Administrator account exists.
3. If no administrator is present, the wizard prompts for initial admin details and creates the account.
4. Database advisory locks (`SETUP_LOCK_KEY`) ensure one-time execution and permanently lock the initial setup route.

## Important Business Rules

* Cargo Approval Requirement: Cargo must have `registration_status = Approved` before physical storage placement is permitted.
* Capacity Enforcements: Storage bins enforce strict maximum weight and volume limits.
* Hazardous Cargo Segregation: Hazardous cargo can only be placed in designated hazard zones.
* Customs Hold Enforcements: Cargo under customs hold cannot receive Gate-Out clearance.
* Financial Settlement: Gate-Out authorization requires full invoice payment or an approved Management Release.
* System Administrator Cap: System configuration caps the maximum allowable active System Administrators.

## System Status and Current Scope

This system is currently configured and deployed for:

* Final Year University Project Demonstration
* Localhost User Acceptance Testing (UAT)
* Docker desktop local evaluation

It is not currently deployed to a public cloud production server.

## Known Limitations

* Local Machine Binding: Configured by default for local single-instance deployment (`127.0.0.1`).
* Simulated Email Delivery: When SMTP variables are unconfigured, emails fall back to local logger output.

## Useful Commands

```bash
# Docker service control
docker compose up -d
docker compose down
docker compose logs -f

# Database scripts
docker compose exec backend npm run migrate
docker compose exec backend npm run verify-schema
docker compose exec backend npm run seed:warehouses

# Testing scripts
docker compose exec backend npm test
```

## Project Information

* Institution: Final Year Project (B.Sc. Computer Science)
* Project Title: Designing and Developing a Warehouse Management System for Fumba Port Indoor Storage Facilities
* Repository: Abdillah-Ali/Designing-and-Developing-a-Warehouse-Management-System-for-Fumba-Port-Indoor-Storage-Facilities

## License and Usage

No explicit open source license is currently provided for this repository. All rights are reserved by the project author.
