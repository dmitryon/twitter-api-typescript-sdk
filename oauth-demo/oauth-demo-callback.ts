import express from 'express';
import https from 'https';
import fs from 'fs';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();

// Configuration from environment variables
const HTTPS_PORT = parseInt(process.env.CALLBACK_HTTPS_PORT || '443');
const CALLBACK_ENDPOINTS = (process.env.CALLBACK_ENDPOINTS || '/twitter_callback,/messaging-admin-ui/twitter-redirect.html').split(',').map(e => e.trim());
const TARGET_CALLBACK_URL = process.env.TARGET_CALLBACK_URL || 'http://localhost:3001/integrations/oauth/callback';

// SSL certificate paths (you'll need to provide these)
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || './ssl/key.pem';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || './ssl/cert.pem';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'oauth-callback-proxy',
        port: HTTPS_PORT,
        endpoints: CALLBACK_ENDPOINTS,
        target: TARGET_CALLBACK_URL
    });
});

// OAuth callback proxy endpoints
app.get(CALLBACK_ENDPOINTS, async function (req, res) {
    try {
        console.log(`[${new Date().toISOString()}] Received callback request:`, {
            path: req.path,
            query: req.query,
            headers: {
                'user-agent': req.get('user-agent'),
                'referer': req.get('referer')
            }
        });

        // Forward the request to the target callback URL
        const params = new URLSearchParams(req.query as any);
        const targetUrl = `${TARGET_CALLBACK_URL}?${params.toString()}`;
        
        console.log(`[${new Date().toISOString()}] Forwarding to:`, targetUrl);

        const headers: Record<string, string> = {
            'User-Agent': req.get('user-agent') || 'OAuth-Callback-Proxy/1.0',
            'X-Forwarded-Proto': 'https',
            'X-Original-Host': req.get('host') || '',
        };
        if (req.ip) headers['X-Forwarded-For'] = req.ip;

        const response = await fetch(targetUrl, {
            method: 'GET',
            headers,
            timeout: 30000 // 30 second timeout
        });

        const contentType = response.headers.get('content-type') || '';
        
        // Handle different response types
        if (contentType.includes('application/json')) {
            const data = await response.json();
            console.log(`[${new Date().toISOString()}] Response data:`, data);
            res.status(response.status).json(data);
        } else if (contentType.includes('text/html')) {
            const html = await response.text();
            console.log(`[${new Date().toISOString()}] Response HTML length:`, html.length);
            res.status(response.status).type('html').send(html);
        } else {
            const text = await response.text();
            console.log(`[${new Date().toISOString()}] Response text:`, text);
            res.status(response.status).type('text').send(text);
        }

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error forwarding callback:`, error);
        
        // Return error response
        res.status(500).json({
            error: 'Callback forwarding failed',
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});



// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`[${new Date().toISOString()}] Unhandled error:`, error);
    res.status(500).json({
        error: 'Internal Server Error',
        message: error.message,
        timestamp: new Date().toISOString()
    });
});

// Function to create SSL certificates if they don't exist
function createSelfSignedCert() {
    const { execSync } = require('child_process');
    
    try {
        // Create ssl directory if it doesn't exist
        if (!fs.existsSync('./ssl')) {
            fs.mkdirSync('./ssl');
        }

        // Generate self-signed certificate
        execSync(`openssl req -x509 -newkey rsa:4096 -keyout ${SSL_KEY_PATH} -out ${SSL_CERT_PATH} -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"`);
        console.log('✓ Self-signed SSL certificate created');
    } catch (error) {
        console.error('Failed to create SSL certificate:', error);
        throw error;
    }
}

// Start HTTPS server
function startServer() {
    try {
        // Check if SSL certificates exist
        if (!fs.existsSync(SSL_KEY_PATH) || !fs.existsSync(SSL_CERT_PATH)) {
            console.log('SSL certificates not found, creating self-signed certificate...');
            createSelfSignedCert();
        }

        // Read SSL certificates
        const privateKey = fs.readFileSync(SSL_KEY_PATH, 'utf8');
        const certificate = fs.readFileSync(SSL_CERT_PATH, 'utf8');
        const credentials = { key: privateKey, cert: certificate };

        // Create HTTPS server
        const httpsServer = https.createServer(credentials, app);

        httpsServer.listen(HTTPS_PORT, () => {
            console.log('🚀 OAuth Callback Proxy Server started');
            console.log(`📡 HTTPS Server running on port ${HTTPS_PORT}`);
            console.log(`🔗 Callback endpoints: ${CALLBACK_ENDPOINTS.join(', ')}`);
            console.log(`🎯 Target callback URL: ${TARGET_CALLBACK_URL}`);
            console.log(`🔒 SSL Key: ${SSL_KEY_PATH}`);
            console.log(`🔒 SSL Cert: ${SSL_CERT_PATH}`);
            console.log(`\n📋 Example callback URLs:`);
            CALLBACK_ENDPOINTS.forEach(endpoint => {
                console.log(`   https://localhost:${HTTPS_PORT}${endpoint}`);
            });
            console.log(`\n🏥 Health check: https://localhost:${HTTPS_PORT}/health`);
        });

        httpsServer.on('error', (error) => {
            console.error('HTTPS Server error:', error);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down OAuth Callback Proxy Server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down OAuth Callback Proxy Server...');
    process.exit(0);
});

// Start the server
startServer();