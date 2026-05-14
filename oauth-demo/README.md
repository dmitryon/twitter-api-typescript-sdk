# OAuth Demo Application

This directory contains a complete OAuth demonstration application for the Twitter API TypeScript SDK.

## Files

- `oauth-demo.ts` - Main Express server with OAuth flows and API endpoints
- `oauth-demo-callback.ts` - HTTPS callback proxy server for OAuth redirects
- `oauth-flows.ts` - OAuth1 and OAuth2 flow implementations
- `oauth-utils.ts` - Utility functions for OAuth client creation
- `storage.ts` - File-based storage classes for integrations, credentials, and sessions
- `types.ts` - TypeScript interfaces and type definitions
- `data/` - Storage directory for persisted data
- `public/` - Static web assets (HTML, CSS, JS)
- `ssl/` - SSL certificates for HTTPS callback server

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `.env`

3. Run the main OAuth demo server:
   ```bash
   npm run dev
   ```

4. Run the callback proxy server (if needed):
   ```bash
   # node oauth-demo-callback.ts
   npx ts-node oauth-demo-callback.ts 
   ```

## Features

- OAuth1 and OAuth2 authentication flows
- Direct message operations
- Media upload functionality
- User followers retrieval
- Integration and credential management