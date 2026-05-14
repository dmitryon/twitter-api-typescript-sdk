import type { Response } from "node-fetch";
import { request, RequestOptions } from "./request";
import { AuthClient } from "./types";

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

/**
 * Download DM media using the OAuth 2.0 endpoint.
 *
 * Parses the TON URL automatically:
 *   https://ton.twitter.com/1.1/ton/data/dm/{dm_id}/{media_id}/{resource_id}
 *
 * Returns the raw fetch Response so callers can stream / buffer as needed.
 */
export function getDMMedia(
  auth: AuthClient,
  params: DMMediaParams,
  requestOptions?: Partial<RequestOptions>
): Promise<Response> {
  return request({
    auth,
    ...requestOptions,
    endpoint: `/2/dm_conversations/media/${params.dm_id}/${params.media_id}/${params.resource_id}`,
    method: "GET",
  });
}
