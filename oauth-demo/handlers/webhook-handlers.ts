import { Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { log } from "../logger";
import { CredentialsStorage } from "../storage";
import { EventBus } from "../event-bus";
import { webhookDelayConfig } from "../webhook-config";

const webhookLogDir = path.join(__dirname, "../data/webhooks");
const credentialsStorage = new CredentialsStorage();

export const webhookEventBus = new EventBus();

async function ensureWebhookDir() {
    await fs.mkdir(webhookLogDir, { recursive: true });
}

export const listWebhookEvents = async (req: Request, res: Response) => {
    try {
        await ensureWebhookDir();
        const files = await fs.readdir(webhookLogDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'))
            .sort((a, b) => {
                const tsA = parseInt(a.replace('.json', '').split('-').pop()!);
                const tsB = parseInt(b.replace('.json', '').split('-').pop()!);
                return tsB - tsA;
            })
            .slice(0, 100);
        const events = await Promise.all(jsonFiles.map(async f => {
            const data = JSON.parse(await fs.readFile(path.join(webhookLogDir, f), 'utf-8'));
            const bodyHash = f.split('-')[1];
            const duplicates = files.filter(df => df.startsWith(`webhook-${bodyHash}-`) && df !== f).map(df => {
                const ts = parseInt(df.replace(`webhook-${bodyHash}-`, '').replace('.json', ''));
                return new Date(ts).toISOString();
            });
            return { filename: f, ...data, duplicateDates: duplicates };
        }));
        res.json(events);
    } catch (error: any) {
        log.error('webhook', 'listWebhookEvents failed:', error.message);
        res.status(500).json({ error: error.message });
    }
};

export const handleWebhook = async (req: Request, res: Response) => {
    const { appId } = req.params;

    if (req.method === 'GET') {
        const crc_token = req.query.crc_token;
        if (!crc_token) {
            res.status(400).send("Missing crc_token");
            return;
        }

        log.debug('webhook', `CRC request received for app ${appId}`, { ip: req.ip });

        const creds = await credentialsStorage.load(appId);
        if (!creds?.consumer_secret) {
            log.error('webhook', `No consumer_secret found for app ${appId}`);
            res.status(500).json({ error: "Consumer secret not found" });
            return;
        }

        const hmac = crypto.createHmac("sha256", creds.consumer_secret);
        hmac.update(crc_token as string);
        const response_token = "sha256=" + hmac.digest("base64");
        log.info('webhook', `CRC response ready for app ${appId}, sending now`);

        if (webhookDelayConfig.crcDelayMs > 0) {
            log.info('webhook', `CRC delay: ${webhookDelayConfig.crcDelayMs}ms`);
            await new Promise((resolve) => setTimeout(resolve, webhookDelayConfig.crcDelayMs));
        }

        res.json({ response_token });
        return;
    }

    // POST webhook — verify signature
    const signature = req.headers['x-twitter-webhooks-signature'] as string;
    if (!signature) {
        log.warn('webhook', `Missing signature header for app ${appId}`);
        res.status(401).json({ error: 'Missing signature' });
        return;
    }

    const creds = await credentialsStorage.load(appId);
    if (!creds?.consumer_secret) {
        log.error('webhook', `No consumer_secret found for app ${appId}`);
        res.status(500).json({ error: 'Consumer secret not found' });
        return;
    }

    const rawBody = (req as any).rawBody as Buffer;
    const expected = 'sha256=' + crypto.createHmac('sha256', creds.consumer_secret).update(rawBody).digest('base64');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        log.warn('webhook', `Invalid signature for app ${appId}`);
        res.status(401).json({ error: 'Invalid signature' });
        return;
    }

    try {
        await ensureWebhookDir();

        const timestamp = new Date().toISOString();
        const bodyHash = crypto.createHash("sha256").update(JSON.stringify(req.body)).digest("hex").slice(0, 12);
        const filename = `webhook-${bodyHash}-${Date.now()}.json`;
        const filePath = path.join(webhookLogDir, filename);

        const webhookData = {
            timestamp,
            headers: req.headers,
            body: req.body,
            query: req.query,
            method: req.method,
            url: req.url
        };

        const existing = (await fs.readdir(webhookLogDir)).filter(f => f.startsWith(`webhook-${bodyHash}-`) && f !== filename);
        if (existing.length > 0) {
            const dates = existing.map(f => {
                const ts = parseInt(f.replace(`webhook-${bodyHash}-`, "").replace(".json", ""));
                return new Date(ts).toISOString();
            });
            log.info('webhook', `Duplicate webhook (hash=${bodyHash}), previously received at: ${dates.join(", ")}`);
        }

        log.info('webhook', `Event received from ${req.ip}`, webhookData.body);

        await fs.writeFile(filePath, JSON.stringify(webhookData, null, 2));

        webhookEventBus.broadcast({ filename, ...webhookData, duplicateDates: existing.map(f => {
            const ts = parseInt(f.replace(`webhook-${bodyHash}-`, "").replace(".json", ""));
            return new Date(ts).toISOString();
        })});

        if (webhookDelayConfig.webhookDelayMs > 0) {
            log.info('webhook', `Webhook reply delay: ${webhookDelayConfig.webhookDelayMs}ms`);
            await new Promise(r => setTimeout(r, webhookDelayConfig.webhookDelayMs));
        }

        // Slowly stream JSON response to test Twitter's timeout behavior
        const responseJson = JSON.stringify({ status: "received" });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(responseJson) });
        for (const ch of responseJson) {
            res.write(ch);
            // await new Promise(r => setTimeout(r, 500));
        }
        res.end();
    } catch (error: any) {
        log.error('webhook', 'Handler error:', error.error || error.message || error);
        const status = error.status || 500;
        res.status(status).json({ error: error.error || error.message || "Unknown error" });
    }
};