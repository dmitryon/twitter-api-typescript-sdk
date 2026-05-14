export interface DMMediaParams {
  dm_id: string;
  media_id: string;
  resource_id: string;
}

const TON_URL_RE = /\/dm\/(?<dm_id>[^\/]+)\/(?<media_id>[^\/]+)\/(?<resource_id>[^\/]+)$/;

export function parseTonUrl(url: string): DMMediaParams | null {
  const match = url.match(TON_URL_RE);
  if (!match?.groups) return null;
  const { dm_id, media_id, resource_id } = match.groups;
  return { dm_id, media_id, resource_id };
}
