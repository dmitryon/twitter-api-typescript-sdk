import { Request, Response } from "express";

export interface WebhookDelayConfig {
    crcDelayMs: number;
    webhookDelayMs: number;
}

export const webhookDelayConfig: WebhookDelayConfig = {
    crcDelayMs: 0,
    webhookDelayMs: 0,
};

export const getWebhookConfig = (_req: Request, res: Response) => {
    res.json(webhookDelayConfig);
};

export const updateWebhookConfig = (req: Request, res: Response) => {
    const { crcDelayMs, webhookDelayMs } = req.body;
    if (crcDelayMs !== undefined) webhookDelayConfig.crcDelayMs = Number(crcDelayMs);
    if (webhookDelayMs !== undefined) webhookDelayConfig.webhookDelayMs = Number(webhookDelayMs);
    res.json(webhookDelayConfig);
};
