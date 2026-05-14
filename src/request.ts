// Copyright 2021 Twitter, Inc.
// SPDX-License-Identifier: Apache-2.0

import fetch from "node-fetch";
import type { RequestInfo, RequestInit, Response, Headers } from "node-fetch";
import { buildQueryString } from "./utils";
import {
  AuthClient,
  TwitterNextToken,
  TwitterPaginatedResponse,
} from "./types";
import type { AbortController as AbortControllerPolyfill } from "abort-controller";

// FormData for Node.js
const FormData = require("form-data");

let AbortController:
  | typeof globalThis.AbortController
  | typeof AbortControllerPolyfill;

if (!globalThis.AbortController) {
  AbortController = require("abort-controller");
} else {
  // https://nodejs.org/api/globals.html#class-abortcontroller
  // AbortController available in v14.17.0 as experimental
  AbortController = globalThis.AbortController;
}

export interface ApiCallLogEntry {
  timestamp: string;
  method: string;
  url: string;
  endpoint: string;
  params?: Record<string, any>;
  request_body?: Record<string, any>;
  status: number;
  response_body?: Record<string, any>;
  duration_ms: number;
}

export interface ApiCallLogger {
  log(entry: ApiCallLogEntry): void | Promise<void>;
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  auth?: AuthClient;
  endpoint: string;
  params?: Record<string, any>;
  request_body?: Record<string, any>;
  method?: string;
  max_retries?: number;
  base_url?: string;
  content_type?: string;
  logger?: ApiCallLogger;
}

async function fetchWithRetries(
  url: RequestInfo,
  init: RequestInit,
  max_retries = 0
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429 && max_retries > 0) {
    const rateLimitReset = Number(res.headers.get("x-rate-limit-reset"));
    const rateLimitRemaining = Number(res.headers.get("x-rate-limit-remaining"));
    const timeTillReset = rateLimitReset * 1000 - Date.now();
    let timeToWait = 1000;
    if (rateLimitRemaining === 0)
      timeToWait = timeTillReset;
    await new Promise((resolve) => setTimeout(resolve, timeToWait));
    return fetchWithRetries(url, init, max_retries - 1);
  }
  return res;
}

class TwitterResponseError extends Error {
  status: number;
  statusText: string;
  headers: Record<string, any>;
  error: Record<string, any>;
  constructor(
    status: number,
    statusText: string,
    headers: Headers,
    error: Record<string, any>
  ) {
    const msg = error?.detail || error?.title || error?.raw || JSON.stringify(error) || statusText;
    super(`${status} ${statusText}: ${msg}`);
    this.status = status;
    this.statusText = statusText;
    this.headers = Object.fromEntries(headers);
    this.error = error;
  }
}

function isMultipartRequest(endpoint: string, request_body: any): boolean {
  // Check if this is a media upload endpoint that should use multipart/form-data
  const mediaUploadEndpoints = [
    '/2/media/upload',
    '/2/media/upload/'
  ];
  
  const isMediaUploadEndpoint = mediaUploadEndpoints.some(ep => endpoint.startsWith(ep)) || 
                               endpoint.includes('/media/upload/') && endpoint.includes('/append');
  
  // Check if request body contains media field (binary data)
  const hasMediaField = request_body && 'media' in request_body;
  
  return isMediaUploadEndpoint && hasMediaField;
}

async function safeResponseJson(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function buildLogEntry(
  startTime: number,
  args: { method?: string; endpoint: string; base_url?: string; params?: Record<string, any>; request_body?: Record<string, any> },
  status: number,
  response_body?: Record<string, any>,
): ApiCallLogEntry {
  const url = new URL((args.base_url || "https://api.x.com") + args.endpoint);
  url.search = buildQueryString(args.params || {});
  return {
    timestamp: new Date(startTime).toISOString(),
    method: args.method || "GET",
    url: url.toString(),
    endpoint: args.endpoint,
    params: args.params && Object.keys(args.params).length ? args.params : undefined,
    request_body: args.request_body,
    status,
    response_body,
    duration_ms: Date.now() - startTime,
  };
}

export async function request({
  auth,
  endpoint,
  params: query = {},
  request_body,
  method,
  max_retries,
  base_url = "https://api.x.com",
  headers,
  content_type,
  logger,
  ...options
}: RequestOptions): Promise<Response> {
  const startTime = Date.now();
  const url = new URL(base_url + endpoint);
  url.search = buildQueryString(query);
  const includeBody = (method === "POST" || method === "PUT") && !!request_body;
  
  let body: string | FormData | undefined;
  let requestHeaders: Record<string, string> = {};
  
  // Handle headers properly
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        requestHeaders[key] = value;
      } else if (Array.isArray(value)) {
        requestHeaders[key] = value.join(', ');
      }
    }
  }
  
  if (includeBody) {
    // Auto-detect if this should be multipart/form-data
    const shouldUseMultipart = content_type === "multipart/form-data" || isMultipartRequest(endpoint, request_body);
    
    if (shouldUseMultipart) {
      const formData = new FormData();
      for (const [key, value] of Object.entries(request_body)) {
        if (value instanceof Buffer) {
          formData.append(key, value);
        } else if (typeof value === 'string' && value.length > 0) {
          formData.append(key, value);
        } else if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      }
      body = formData as any; // Type assertion for node-fetch compatibility
      // Don't set Content-Type header for FormData - let form-data set it with boundary
    } else {
      body = JSON.stringify(request_body);
      requestHeaders["Content-Type"] = "application/json; charset=utf-8";
    }
  }
  
  if (auth) {
    const authHeaders = await auth.getAuthHeader({
      url: url.href,
      method: method || "GET",
      body: typeof body === 'string' ? body : undefined
    });
    requestHeaders = { ...requestHeaders, ...authHeaders };
  }
  
  const response = await fetchWithRetries(
    url.toString(),
    {
      headers: requestHeaders,
      method,
      body: body as any, // Type assertion for node-fetch compatibility with FormData
      // Timeout if you don't see any data for 60 seconds
      // https://developer.twitter.com/en/docs/tutorials/consuming-streaming-data
      timeout: 60000,
      ...options,
    },
    max_retries
  );
  if (!response.ok) {
    const error = await safeResponseJson(response);
      if (logger) {
          try {
              logger.log(buildLogEntry(startTime, { method, endpoint, base_url, params: query, request_body }, response.status, error));
          } catch {
          }
      }
    throw new TwitterResponseError(
      response.status,
      response.statusText,
      response.headers,
      error
    );
  }
  return response;
}

export async function* stream<T>(args: RequestOptions): AsyncGenerator<T> {
  const controller = new AbortController();
  const { body } = await request({
    signal: controller.signal as RequestInit["signal"],
    ...args,
  });
  if (body === null) throw new Error("No response returned from stream");
  let buf = "";
  try {
    for await (const chunk of body) {
      buf += chunk.toString();
      const lines = buf.split("\r\n");
      for (const [i, line] of lines.entries()) {
        if (i === lines.length - 1) {
          buf = line;
        } else if (line) yield JSON.parse(line);
      }
    }
  } finally {
    controller.abort();
  }
}

export async function rest<T = Record<string, any>>(
  args: RequestOptions
): Promise<T> {
  const startTime = Date.now();
  const response = await request(args);
  const json = await safeResponseJson(response) as T;
  if (args.logger) {
      try {
          args.logger.log(buildLogEntry(startTime, args, response.status, json as Record<string, any>));
      } catch {
      }
  }
  return json;
}

export function paginate<T extends TwitterNextToken>(
  args: RequestOptions
): TwitterPaginatedResponse<T> {
  return {
    then(resolve, reject) {
      return rest<T>(args).then(resolve, reject);
    },
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      let ended = false;
      let pagination_token: string | undefined;
      while (!ended) {
        const response = await rest<T>({
          ...args,
          params: {
            ...args.params,
            ...(pagination_token && { pagination_token }),
          },
        });
        yield response;
        pagination_token = response?.meta?.next_token;
        if (!pagination_token) {
          ended = true;
        }
      }
    },
  };
}
