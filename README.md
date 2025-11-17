# Lokoja Artisan MVP - Starter RepoThis ZIP contains a frontend (React Native - Expo) and backend 
(Node.js + Express) starter project for your Lokoja artisan app MVP.## What's included- backend/: 
Express server, DB schema, Dockerfile- mobile-app/: Expo React Native app with Home, Book, 
Payment WebView screens- .env.example for required environment variables## Quick start (local)### Backend1. 
Install PostgreSQL and create a database.2. Copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL`.3. 
Run `psql < backend/schema.sql` to create tables.4. `cd backend && npm install`5. `npm run dev` (requires nodemon) or `npm start`
### Mobile (Expo)1. `cd mobile-app && npm install`2. Start Expo: `npm start`3. Update `mobile-app/services/api.js` to point to your 
backend (use your machine IP for device testing).## Notes- Payment provider integration is stubbed with placeholders. Replace with your 
Flutterwave/Paystack secret calls.- For production: configure S3/Supabase for uploads, secure webhooks, HTTPS, and proper CORS.
