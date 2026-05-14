import { Request, Response } from "express";
import crypto from "crypto";
import { Integration, TwitterApplicationCredentials } from "../types";
import { IntegrationStorage, CredentialsStorage, AccessTokenStorage } from "../storage";
import { log } from "../logger";
import { apiLogger } from "../api-logger";

const integrationStorage = new IntegrationStorage();
const credentialsStorage = new CredentialsStorage();
const accessTokenStorage = new AccessTokenStorage();

export const createIntegration = async (req: Request, res: Response) => {
  const { name, appId } = req.body;
  const integration: Integration = {
    id: crypto.randomUUID(),
    name,
    appId
  };
  
  await integrationStorage.save(integration);
  log.info('integration', `Created integration "${name}" (${integration.id}) for app ${appId}`);
  res.json(integration);
};

export const createCredentials = async (req: Request, res: Response) => {
  const credentials: TwitterApplicationCredentials = { ...req.body };
  await credentialsStorage.save(credentials);
  log.info('credentials', `Saved credentials for app ${credentials.appId}`);
  res.json(credentials);
};

export const listCredentials = async (req: Request, res: Response) => {
  const credentials = await credentialsStorage.list();
  log.debug('credentials', `Listed ${credentials.length} credentials`);
  res.json(credentials);
};

export const listIntegrations = async (req: Request, res: Response) => {
  const integrations = await integrationStorage.list();
  const hydrated = await Promise.all(integrations.map(async (integration) => {
    const oauth1Entry = integration.oauth1?.accessTokenId ? await accessTokenStorage.load(integration.oauth1.accessTokenId) : null;
    const oauth2Entry = integration.oauth2?.accessTokenId ? await accessTokenStorage.load(integration.oauth2.accessTokenId) : null;
    return {
      ...integration,
      oauth1: oauth1Entry ? { ...integration.oauth1, tokens: oauth1Entry.tokens, user: oauth1Entry.user } : integration.oauth1,
      oauth2: oauth2Entry ? { ...integration.oauth2, tokens: oauth2Entry.tokens, user: oauth2Entry.user } : integration.oauth2
    };
  }));
  log.debug('integration', `Listed ${integrations.length} integrations`);
  res.json(hydrated);
};

export const getIntegrationStatus = async (req: Request, res: Response) => {
  const integration = await integrationStorage.load(req.params.id);
  if (!integration) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }
  
  const oauth1Entry = integration.oauth1?.accessTokenId ? await accessTokenStorage.load(integration.oauth1.accessTokenId) : null;
  const oauth2Entry = integration.oauth2?.accessTokenId ? await accessTokenStorage.load(integration.oauth2.accessTokenId) : null;
  const oauth1Authenticated = !!oauth1Entry?.tokens?.access_token;
  const oauth2Authenticated = !!oauth2Entry?.tokens?.access_token;
  log.debug('integration', `Status for ${req.params.id}: oauth1=${oauth1Authenticated}, oauth2=${oauth2Authenticated}`);
    
  res.json({
    ...integration,
    oauth1Authenticated,
    oauth2Authenticated,
    oauth1: oauth1Entry ? { ...integration.oauth1, tokens: oauth1Entry.tokens, user: oauth1Entry.user } : integration.oauth1,
    oauth2: oauth2Entry ? { ...integration.oauth2, tokens: oauth2Entry.tokens, user: oauth2Entry.user } : integration.oauth2
  });
};

export const initStorages = async () => {
  await integrationStorage.init();
  await credentialsStorage.init();
  await accessTokenStorage.init();
  await apiLogger.init();
};