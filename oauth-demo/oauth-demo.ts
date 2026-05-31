import express from "express";
import { createIntegration, createCredentials, listCredentials, listIntegrations, getIntegrationStatus, initStorages } from "./handlers/integration-handlers";
import { oauthLogin, oauthCallback, refreshOAuth2Token, revokeOAuth1Tokens, revokeOAuth2Tokens, initAuthStorage } from "./handlers/oauth-handlers";
import { getDMConversation, sendDM, getFollowers } from "./handlers/dm-handlers";
import { uploadMedia, proxyMedia } from "./handlers/media-handlers";
import { getXChatConversations, getXChatMessages, sendXChatMessage, getUserPublicKeys, uploadXChatMedia, proxyXChatMedia, updateXChatSettings, getXChatSettings, unlockKeys, registerKeys, reactToMessage, editMessage, sendTypingIndicator } from "./handlers/xchat-handlers";
import { getXAASubscriptions, createXAASubscription, deleteXAASubscription, updateXAASubscription } from "./handlers/xaa-handlers";
import { handleWebhook, listWebhookEvents, webhookEventBus } from "./handlers/webhook-handlers";
import { listWebhooks, createWebhook, deleteWebhook, validateWebhook, getSubscriptionCount, listSubscriptions, createSubscription, deleteSubscription, validateSubscription, lookupUsers, proxyPublicImage } from "./handlers/webhook-mgmt-handlers";
import { getWebhookConfig, updateWebhookConfig } from "./handlers/webhook-config";
import { log } from './logger';
import { __dirname } from './esm-utils';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const app = express();

app.set('trust proxy', 'loopback');
app.use(express.json({
  limit: '50mb',
  verify: (req, _res, buf) => { (req as any).rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Allow external access only to webhook receiver endpoints; restrict everything else to localhost
app.use((req, res, next) => {
  if (req.path.startsWith('/webhook/') || req.path === '/ngrok' || req.path === '/integrations/oauth/callback') return next();
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    log.warn('server', `Blocked proxied request to ${req.path} from ${forwarded}`);
    res.status(403).json({ error: 'Forbidden: localhost only' });
    return;
  }
  next();
});

app.use(express.static(__dirname(import.meta.url) + "/public"));

// Integration routes
app.post("/integrations", createIntegration);
app.get("/integrations", listIntegrations);
app.get("/integrations/:id", getIntegrationStatus);

// Credentials routes
app.post("/credentials", createCredentials);
app.get("/credentials", listCredentials);

// OAuth routes
app.post("/integrations/:id/oauth/login/:type", oauthLogin);
app.get("/integrations/oauth/callback", oauthCallback);
app.post("/integrations/:id/oauth2/refresh", refreshOAuth2Token);
app.post("/integrations/:id/oauth1/revoke", revokeOAuth1Tokens);
app.post("/integrations/:id/oauth2/revoke", revokeOAuth2Tokens);

// DM routes
app.get("/integrations/:integrationId/conversation/:userId/:participantId/messages", getDMConversation);
app.post("/integrations/:integrationId/conversation/:userId/:participantId/send", sendDM);
app.get("/integrations/:id/dm/followers", getFollowers);

// Media routes
app.post("/integrations/:integrationId/media/upload", uploadMedia);
app.get("/integrations/:integrationId/media/proxy", proxyMedia);

// X Chat routes
app.get("/integrations/:id/xchat/settings", getXChatSettings);
app.patch("/integrations/:id/xchat/settings", updateXChatSettings);
app.post("/integrations/:id/xchat/unlock", unlockKeys);
app.post("/integrations/:id/xchat/register", registerKeys);
app.post("/integrations/:id/xchat/conversations/:conversationId/react", reactToMessage);
app.post("/integrations/:id/xchat/conversations/:conversationId/edit", editMessage);
app.post("/integrations/:id/xchat/conversations/:conversationId/typing", sendTypingIndicator);
app.get("/integrations/:id/xchat/conversations", getXChatConversations);
app.get("/integrations/:id/xchat/conversations/:conversationId/messages", getXChatMessages);
app.post("/integrations/:id/xchat/conversations/:conversationId/send", sendXChatMessage);
app.get("/integrations/:id/xchat/users/:userId/public-keys", getUserPublicKeys);
app.post("/integrations/:id/xchat/media/upload", uploadXChatMedia);
app.get("/integrations/:id/xchat/media/proxy", proxyXChatMedia);

// XAA (X Activity API) routes
app.get("/integrations/:id/xaa/subscriptions", getXAASubscriptions);
app.post("/integrations/:id/xaa/subscriptions", createXAASubscription);
app.put("/integrations/:id/xaa/subscriptions/:subscriptionId", updateXAASubscription);
app.delete("/integrations/:id/xaa/subscriptions/:subscriptionId", deleteXAASubscription);

app.get("/webhook-events", listWebhookEvents);
app.get("/webhook-events/stream", webhookEventBus.handler);

// Webhook receiver routes
app.post("/webhook/:appId", handleWebhook);
app.get("/webhook/:appId", handleWebhook);

// Ngrok timeout test endpoint
app.get("/ngrok", async (req, res) => {
  const ms = parseInt(req.query.ms as string) || 4000;
  log.info('server', `Ngrok delay test: ${ms}ms`);
  await new Promise(resolve => setTimeout(resolve, ms));
  res.json({ delayed: ms });
});

// Webhook management routes
app.get("/credentials/:appId/webhooks", listWebhooks);
app.post("/credentials/:appId/webhooks", createWebhook);
app.delete("/credentials/:appId/webhooks/:webhookId", deleteWebhook);
app.put("/credentials/:appId/webhooks/:webhookId/validate", validateWebhook);

// Subscription management routes
app.get("/credentials/:appId/subscriptions/count", getSubscriptionCount);
app.get("/credentials/:appId/webhooks/:webhookId/subscriptions", listSubscriptions);
app.post("/credentials/:appId/webhooks/:webhookId/subscriptions", createSubscription);
app.delete("/credentials/:appId/webhooks/:webhookId/subscriptions/:userId", deleteSubscription);
app.get("/credentials/:appId/webhooks/:webhookId/subscriptions/validate", validateSubscription);
app.get("/credentials/:appId/users", lookupUsers);
app.get("/media/proxy/public", proxyPublicImage);

// Webhook delay config
app.get("/webhook-config", getWebhookConfig);
app.patch("/webhook-config", updateWebhookConfig);

// Chat page route
app.get("/integrations/:integrationId/conversation/:userId/:participantId", (req, res) => {
  res.sendFile(__dirname(import.meta.url) + "/public/chat.html");
});

async function main() {
  await initStorages();
  await initAuthStorage();
  
  app.listen(3001, () => {
    log.info('server', 'OAuth demo server running on http://localhost:3001');
  });
}

main().catch(err => log.error('server', 'Startup failed:', err));