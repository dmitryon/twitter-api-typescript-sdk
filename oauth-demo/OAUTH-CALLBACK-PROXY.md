# OAuth Callback Proxy

This HTTPS proxy server forwards OAuth callback requests to your main OAuth demo application. This is useful when you need to use HTTPS callback URLs for OAuth flows but your main application runs on HTTP.

## Features

- **HTTPS Support**: Runs on HTTPS with auto-generated self-signed certificates
- **Configurable Endpoints**: Support multiple callback endpoints
- **Request Forwarding**: Forwards all query parameters and headers to the target application
- **Error Handling**: Comprehensive error handling and logging
- **Health Check**: Built-in health check endpoint

## Setup

1. **Copy the environment configuration:**
   ```bash
   cp .env.callback.example .env
   ```

2. **Configure the environment variables in `.env`:**
   ```env
   # HTTPS server port for the callback proxy
   CALLBACK_HTTPS_PORT=3443
   
   # Comma-separated list of callback endpoints to handle
   CALLBACK_ENDPOINTS=/twitter_callback,/messaging-admin-ui/twitter-redirect.html
   
   # Target callback URL where requests should be forwarded
   TARGET_CALLBACK_URL=http://localhost:3001/integrations/oauth/callback
   
   # SSL certificate paths (will be auto-generated if not found)
   SSL_KEY_PATH=./ssl/key.pem
   SSL_CERT_PATH=./ssl/cert.pem
   ```

## Usage

### Start the OAuth Callback Proxy

```bash
npm run oauth-callback-proxy
```

The server will:
- Start on HTTPS port 3443 (or your configured port)
- Auto-generate SSL certificates if they don't exist
- Handle requests on the configured callback endpoints
- Forward requests to your target callback URL

### Start Your Main OAuth Demo Application

In another terminal:
```bash
npm run oauth-demo
```

### Configure Your OAuth Application

In your Twitter/X OAuth application settings, set the callback URL to:
```
https://localhost:3443/twitter_callback
```

Or for the messaging admin UI:
```
https://localhost:3443/messaging-admin-ui/twitter-redirect.html
```

## How It Works

1. **OAuth Provider** → **HTTPS Callback Proxy** → **Your HTTP Application**

2. The proxy receives the OAuth callback request on HTTPS
3. Extracts all query parameters from the request
4. Forwards the request to your configured target callback URL
5. Returns the response from your application back to the OAuth provider

## Example Flow

```
Twitter OAuth → https://localhost:3443/twitter_callback?code=abc123&state=xyz789
                ↓
Proxy forwards → http://localhost:3001/integrations/oauth/callback?code=abc123&state=xyz789
                ↓
Your app processes the OAuth callback and returns response
                ↓
Proxy returns response to Twitter OAuth
```

## Endpoints

- **Callback Endpoints**: Configured via `CALLBACK_ENDPOINTS` environment variable
- **Health Check**: `GET /health` - Returns server status and configuration
- **404 Handler**: All other routes return available endpoints

## SSL Certificates

The proxy automatically generates self-signed SSL certificates if they don't exist:
- Key: `./ssl/key.pem`
- Certificate: `./ssl/cert.pem`

For production use, replace these with proper SSL certificates from a trusted CA.

## Logging

The proxy logs all requests and responses with timestamps:
- Incoming callback requests
- Forwarded request URLs
- Response data
- Errors and exceptions

## Error Handling

- **Network Errors**: Returns 500 with error details
- **Timeout**: 30-second timeout for forwarded requests
- **Invalid Routes**: Returns 404 with available endpoints
- **Server Errors**: Comprehensive error logging

## Development

To modify the proxy behavior, edit `oauth-demo-callback.ts`:
- Add custom headers
- Modify request/response processing
- Add authentication
- Implement request validation

## Troubleshooting

### SSL Certificate Issues
If you get SSL certificate errors:
```bash
# Delete existing certificates and restart
rm -rf ssl/
npm run oauth-callback-proxy
```

### Port Already in Use
Change the port in your `.env` file:
```env
CALLBACK_HTTPS_PORT=3444
```

### Connection Refused
Make sure your target application is running:
```bash
npm run oauth-demo
```

### OAuth Callback Not Working
1. Check that your OAuth app callback URL matches the proxy URL
2. Verify the proxy is forwarding to the correct target URL
3. Check the logs for error messages