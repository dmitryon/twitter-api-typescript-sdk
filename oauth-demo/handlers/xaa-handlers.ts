import { Request, Response } from "express";
import { resolveAuth, credentialsStorage, appBearerClient } from "./handler-utils";
import { log } from "../logger";

export const getXAASubscriptions = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const response = await resolved.client.activity.getActivitySubscriptions();
    log.debug('xaa', `Listed subscriptions for integration ${id}`);
    res.json(response);
  } catch (error: any) {
    log.error('xaa', `getXAASubscriptions failed:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const createXAASubscription = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { auth: authType } = req.query;
    const { event_type, user_id, webhook_id, tag } = req.body;

    if (!event_type || !user_id) {
      res.status(400).json({ error: "event_type and user_id are required" });
      return;
    }

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const body: any = {
      event_type,
      filter: { user_id },
    };
    if (webhook_id) body.webhook_id = webhook_id;
    if (tag) body.tag = tag;

    const response = await resolved.client.activity.createActivitySubscription(body);
    log.info('xaa', `Created subscription: event_type=${event_type}, user_id=${user_id}, webhook_id=${webhook_id || 'none'}`);
    res.json(response);
  } catch (error: any) {
    log.error('xaa', `createXAASubscription failed:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const deleteXAASubscription = async (req: Request, res: Response) => {
  try {
    const { id, subscriptionId } = req.params;

    // DELETE only supports BearerToken (app-level), so we need the app credentials
    const resolved = await resolveAuth(id, 'oauth2');
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    // Get the app's credentials to use app-level bearer token
    const integration = resolved.integration;
    const client = await appBearerClient(integration.appId);

    const response = await client.activity.deleteActivitySubscription(subscriptionId);
    log.info('xaa', `Deleted subscription ${subscriptionId}`);
    res.json(response);
  } catch (error: any) {
    log.error('xaa', `deleteXAASubscription failed:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const updateXAASubscription = async (req: Request, res: Response) => {
  try {
    const { id, subscriptionId } = req.params;
    const { webhook_id, tag } = req.body;

    const resolved = await resolveAuth(id, 'oauth2');
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const integration = resolved.integration;
    const client = await appBearerClient(integration.appId);

    const body: any = {};
    if (webhook_id !== undefined) body.webhook_id = webhook_id;
    if (tag !== undefined) body.tag = tag;

    const response = await client.activity.updateActivitySubscription(subscriptionId, body);
    log.info('xaa', `Updated subscription ${subscriptionId}: webhook_id=${webhook_id}, tag=${tag}`);
    res.json(response);
  } catch (error: any) {
    log.error('xaa', `updateXAASubscription failed:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};
