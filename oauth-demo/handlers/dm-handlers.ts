import { Request, Response } from "express";
import { Client } from "twitter-api-sdk";
import { IntegrationStorage, CredentialsStorage, AccessTokenStorage } from "../storage";
import { oauthFromIntegration } from "../oauth-utils";
import { log } from "../logger";
import { apiLogger } from "../api-logger";

const integrationStorage = new IntegrationStorage();
const credentialsStorage = new CredentialsStorage();
const accessTokenStorage = new AccessTokenStorage();

export const getDMConversation = async (req: Request, res: Response) => {
  try {
    const { integrationId, userId, participantId } = req.params;
    const { auth } = req.query;
    
    const integration = await integrationStorage.load(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    
    const authClient = await oauthFromIntegration(auth as 'oauth1' | 'oauth2', integration, credentialsStorage, accessTokenStorage, integrationStorage);
    if (!authClient) {
      res.status(400).json({ error: "Invalid auth method or tokens not found" });
      return;
    }
    
    const client = new Client(authClient, { logger: apiLogger });
    const dmResponse = await client.directmessages.getDirectMessagesEventsByParticipantId(participantId, {
      "dm_event.fields": ["id", "text", "created_at", "sender_id", "attachments"],
      "media.fields": ["media_key", "type", "url", "preview_image_url", "variants", "duration_ms", "height", "width"],
      "user.fields": ["id", "username", "name"],
      "expansions": ["sender_id", "attachments.media_keys"]
    });
    
    log.debug('dm', `Fetched conversation ${userId} <-> ${participantId} (${dmResponse.data?.length || 0} messages)`);
    res.json(dmResponse);
  } catch (error: any) {
    log.error('dm', `getDMConversation failed (${req.params.participantId}):`, error.error || error.message || error);
    res.status(500).json({ error: error.message || 'Unknown error' });
  }
};

export const sendDM = async (req: Request, res: Response) => {
  try {
    const { integrationId, userId, participantId } = req.params;
    const { auth } = req.query;
    const { text, media_id } = req.body;
    
    const integration = await integrationStorage.load(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    
    const authClient = await oauthFromIntegration(auth as 'oauth1' | 'oauth2', integration, credentialsStorage, accessTokenStorage, integrationStorage);
    if (!authClient) {
      res.status(400).json({ error: "Invalid auth method or tokens not found" });
      return;
    }
    
    const client = new Client(authClient, { logger: apiLogger });
    const dmData: any = { text };
    
    if (media_id) {
      dmData.attachments = [{ media_id }];
    }
    
    const response = await client.directmessages.createDirectMessagesByParticipantId(participantId, dmData);
    log.info('dm', `Sent DM to ${participantId}${media_id ? ' (with media)' : ''}`);
    res.json(response);
  } catch (error: any) {
    log.error('dm', `sendDM failed (${req.params.participantId}):`, error.error || error.message || error);
    res.status(500).json({ error: error.message || 'Unknown error' });
  }
};

export const getFollowers = async (req: Request, res: Response) => {
  try {
    const integration = await integrationStorage.load(req.params.id);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    
    const authType = integration.oauth1?.accessTokenId ? 'oauth1' : 'oauth2';
    const authClient = await oauthFromIntegration(authType, integration, credentialsStorage, accessTokenStorage, integrationStorage);
    if (!authClient) {
      res.status(400).json({ error: "Invalid auth method or tokens not found" });
      return;
    }

    const accessTokenId = authType === 'oauth1' ? integration.oauth1!.accessTokenId : integration.oauth2!.accessTokenId;
    const tokenEntry = await accessTokenStorage.load(accessTokenId);
    const userId = tokenEntry!.user.id;
    
    const client = new Client(authClient, { logger: apiLogger });
    const followersResponse = await client.users.getUsersFollowers(userId, {
      "user.fields": ["id", "username", "name", "profile_image_url"]
    });
    
    const followers = followersResponse.data?.map(user => ({
      id: user.id,
      username: user.username!,
      name: user.name!,
      pictureUrl: user.profile_image_url
    })) || [];
    
    log.debug('dm', `Fetched ${followers.length} followers for integration ${req.params.id}`);
    res.json(followers);
  } catch (error: any) {
    log.error('dm', `getFollowers failed (${req.params.id}):`, error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};
