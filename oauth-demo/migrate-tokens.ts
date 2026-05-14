import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.join(__dirname, "data");
const INTEGRATIONS_DIR = path.join(DATA_DIR, "integrations");
const ACCESS_TOKENS_DIR = path.join(DATA_DIR, "access-tokens");

async function migrate() {
  await fs.mkdir(ACCESS_TOKENS_DIR, { recursive: true });

  const files = (await fs.readdir(INTEGRATIONS_DIR)).filter(f => f.endsWith(".json"));

  for (const file of files) {
    const filePath = path.join(INTEGRATIONS_DIR, file);
    const integration = JSON.parse(await fs.readFile(filePath, "utf-8"));
    let changed = false;
    const oauth1User = integration.oauth1?.user;
    const oauth2User = integration.oauth2?.user || oauth1User;

    if (integration.oauth1?.tokens) {
      const userId = oauth1User?.id;
      if (userId) {
        const accessTokenId = `${integration.appId}-oauth1-${userId}-${integration.id}`;
        const entry = {
          id: accessTokenId,
          appId: integration.appId,
          authType: "oauth1",
          user: oauth1User,
          tokens: integration.oauth1.tokens
        };
        await fs.writeFile(path.join(ACCESS_TOKENS_DIR, `${accessTokenId}.json`), JSON.stringify(entry, null, 2));
        integration.oauth1 = { accessTokenId };
        changed = true;
        console.log(`  oauth1 -> ${accessTokenId}`);
      }
    }

    if (integration.oauth2?.tokens) {
      const userId = oauth2User?.id;
      if (userId) {
        const accessTokenId = `${integration.appId}-oauth2-${userId}`;
        const entry = {
          id: accessTokenId,
          appId: integration.appId,
          authType: "oauth2",
          user: oauth2User,
          tokens: integration.oauth2.tokens
        };
        // OAuth2 is shared — only write if it doesn't exist yet or has a newer token
        const entryPath = path.join(ACCESS_TOKENS_DIR, `${accessTokenId}.json`);
        let shouldWrite = true;
        try {
          const existing = JSON.parse(await fs.readFile(entryPath, "utf-8"));
          if (existing.tokens?.expires_at >= integration.oauth2.tokens.expires_at) {
            shouldWrite = false;
            console.log(`  oauth2 -> ${accessTokenId} (kept existing, newer expiry)`);
          }
        } catch {}
        if (shouldWrite) {
          await fs.writeFile(entryPath, JSON.stringify(entry, null, 2));
          console.log(`  oauth2 -> ${accessTokenId}`);
        }
        integration.oauth2 = { accessTokenId };
        changed = true;
      }
    }

    if (changed) {
      await fs.writeFile(filePath, JSON.stringify(integration, null, 2));
      console.log(`Migrated ${integration.id} (${integration.name})`);
    } else {
      console.log(`Skipped ${integration.id} (${integration.name}) — no tokens`);
    }
  }

  console.log("Migration complete.");
}

migrate().catch(console.error);
