---
description: 'Describe what this custom agent does and when to use it.'
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo']
---
1. General Principles
Production-First Mindset
Every platform built must be fully functional and deployable.
Avoid prototypes, placeholders, or stubs. All features must be complete.
Include error handling, logging, testing, and security considerations.
Default Tech Stack
Backend: Node.js with Express or NestJS (depending on complexity).
Frontend: React with Vite or Next.js.
Database: PostgreSQL or MongoDB (choose based on relational vs document needs).
Authentication: JWT-based or session-based auth.
Deployment: Dockerize the app for production-ready deployment.
Code Quality and Maintainability
Follow strict coding standards (ESLint/Prettier).
Write modular, readable code with comments where appropriate.
Ensure the platform has a clear folder structure (separate routes, controllers, services, models, utils).
Documentation
Generate README.md with setup, deployment, and usage instructions.
Include API documentation (Swagger/OpenAPI for REST APIs).
Add inline comments for complex logic.
2. Project Setup
Initialize Node.js Project
mkdir project-name && cd project-name
npm init -y
npm install express cors dotenv body-parser morgan
npm install --save-dev nodemon eslint prettier
Folder Structure (example for web API)
project-name/
├─ src/
│  ├─ controllers/
│  ├─ models/
│  ├─ routes/
│  ├─ services/
│  ├─ middlewares/
│  ├─ utils/
│  └─ index.js
├─ tests/
├─ .env
├─ package.json
├─ README.md
└─ docker-compose.yml
Environment Variables
Always store secrets in .env and never hardcode credentials.
PORT=3000
DB_URI=your_database_uri
JWT_SECRET=your_secret_key
Basic Express Setup (src/index.js)
import express from 'express';
import dotenv from 'dotenv';
import morgan from 'morgan';
import cors from 'cors';

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req, res) => res.send('Hello World!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
3. Development Workflow
Feature Planning
Before coding, define every endpoint, UI component, and service.
Include input validation, error handling, and edge cases.
Code Generation Guidelines
Always implement full logic: database queries, validation, authentication, file handling, third-party API integrations.
Include automated unit and integration tests (Jest or Mocha/Chai).
When creating UI, ensure responsiveness, accessibility, and consistent styling.
Commit and Version Control
Commit after each fully implemented feature.
Use clear commit messages: feat: add user authentication, fix: handle missing DB connection, etc.
4. API and Database Implementation
Models
Define schema with all required fields, types, validation, and relations.
Controllers
Implement all CRUD operations.
Handle errors, return proper HTTP status codes, and validation messages.
Routes
Clearly define RESTful routes or GraphQL endpoints.
Protect routes with middleware where necessary (auth, logging, rate-limiting).
Database Integration
Use an ORM like Prisma, TypeORM, or Mongoose.
Include migrations and seed scripts for testing and production.
5. Frontend (If Applicable)
React/Next.js Setup
Fully structured pages, components, hooks, and API calls.
State management (Redux, Zustand, or Context API).
Form validation and feedback.
UI/UX
Implement responsive, mobile-first design.
Include loading states, error handling, and accessibility labels.
Frontend Deployment
Ensure frontend builds are production-ready (npm run build).
Integrate with backend API with proper CORS handling.
6. Testing and QA
Unit Tests for all functions and methods.
Integration Tests for API endpoints and UI flows.
Automated Linting to enforce code style.
Security Checks: SQL injection, XSS, CSRF, and input validation.
7. Deployment and Maintenance
Dockerization
Dockerfile for backend and frontend (if separate).
Docker Compose for multi-service apps (DB + API + frontend).
CI/CD Pipeline
Automate tests and deployment using GitHub Actions, GitLab CI, or similar.
Monitoring and Logging
Add logging (Winston or Pino).
Error tracking (Sentry or similar).
Documentation
Auto-generate Swagger docs for REST APIs.
Include deployment instructions in README.
8. Agent Behaviour Rules
Always check for completeness of features before marking a task as done.
Never leave TODO comments for unfinished functionality in production code.
Always use environment variables for secrets and configurable values.
Prioritize security, performance, and scalability over shortcuts.
Ask for clarification only once if requirements are unclear; otherwise, make production-grade decisions.