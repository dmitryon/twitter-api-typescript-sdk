import { Request, Response } from "express";
import { parseTonUrl } from "twitter-api-sdk";
import { resolveAuth, mediaCache, sseResponse } from "./handler-utils";
import { log } from "../logger";

export const uploadMedia = async (req: Request, res: Response) => {
  try {
    const { integrationId } = req.params;
    const { auth: authType } = req.query;
    
    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }
    const { client } = resolved;
    const { media, media_type } = req.body;

    const sendEvent = sseResponse(res);
    
    if (media_type?.startsWith('image/') && media_type !== 'image/gif') {
      const mediaBuffer = Buffer.from(media, 'base64');
      sendEvent({ step: 'init', detail: `${media_type}, ${mediaBuffer.length} bytes` });
      log.debug('media', `Simple upload: ${media_type}, ${mediaBuffer.length} bytes`);
      const response = await client.media.mediaUpload({
        media: mediaBuffer as any,
        media_category: "dm_image",
        shared: true
      });
      log.info('media', `Uploaded image, media_id=${response.data?.id}`);
      sendEvent({ step: 'complete', media_id: response.data?.id });
      res.end();
    } else if (media_type === 'image/gif' || media_type?.startsWith('video/')) {
      const mediaBuffer = Buffer.from(media, 'base64');
      const mediaCategory = media_type === 'image/gif' ? 'dm_gif' : 'dm_video';
      log.debug('media', `Chunked upload: ${media_type}, ${mediaBuffer.length} bytes, category=${mediaCategory}`);

      sendEvent({ step: 'init', detail: `${media_type}, ${mediaBuffer.length} bytes` });
      log.debug('media', `INIT: total_bytes=${mediaBuffer.length}, media_type=${media_type}`);
      const initResponse = await client.media.initializeMediaUpload({
        total_bytes: mediaBuffer.length,
        media_type,
        media_category: mediaCategory,
        shared: true
      });
      const mediaId = initResponse.data?.id;
      log.debug('media', `INIT response: media_id=${mediaId}`, initResponse.data);
      if (!mediaId) {
        sendEvent({ error: 'Failed to initialize upload' });
        res.end();
        return;
      }

      const SEGMENT_SIZE = 3 * 1024 * 1024; // 3MB binary = ~4MB base64 on wire
      const totalSegments = Math.ceil(mediaBuffer.length / SEGMENT_SIZE);
      for (let i = 0; i < totalSegments; i++) {
        const chunk = mediaBuffer.subarray(i * SEGMENT_SIZE, (i + 1) * SEGMENT_SIZE);
        sendEvent({ step: 'append', detail: `segment ${i + 1}/${totalSegments} (${chunk.length} bytes)` });
        log.debug('media', `APPEND: media_id=${mediaId}, segment ${i + 1}/${totalSegments}, ${chunk.length} bytes`);
        await client.media.appendMediaUpload(mediaId, {
          media: chunk as any,
          segment_index: i
        });
      }
      log.debug('media', `APPEND complete: media_id=${mediaId}, ${totalSegments} segment(s)`);

      sendEvent({ step: 'finalize' });
      log.debug('media', `FINALIZE: media_id=${mediaId}`);
      await client.media.finalizeMediaUpload(mediaId);
      log.debug('media', `FINALIZE complete: media_id=${mediaId}`);

      let statusResponse = await client.media.getMediaUploadStatus({
        media_id: mediaId,
        command: "STATUS"
      });
      log.debug('media', `STATUS: media_id=${mediaId}`, statusResponse.data);

      while (statusResponse.data?.processing_info?.state === 'pending' || statusResponse.data?.processing_info?.state === 'in_progress') {
        const { check_after_secs = 1, state, progress_percent } = statusResponse.data.processing_info;
        sendEvent({ step: 'processing', detail: `${progress_percent ?? 0}% — waiting ${check_after_secs}s` });
        log.debug('media', `Processing: state=${state}, progress=${progress_percent}%, check_after=${check_after_secs}s`);
        await new Promise(resolve => setTimeout(resolve, check_after_secs * 1000));
        statusResponse = await client.media.getMediaUploadStatus({
          media_id: mediaId,
          command: "STATUS"
        });
        log.debug('media', `STATUS poll: media_id=${mediaId}`, statusResponse.data);
      }

      if (statusResponse.data?.processing_info?.state === 'failed') {
        log.error('media', 'Processing failed, full response:', JSON.stringify(statusResponse, null, 2));
        const pi = statusResponse.data.processing_info as any;
        const err = pi?.error?.message || pi?.error?.name
          || statusResponse.errors?.[0]?.detail
          || 'Processing failed';
        sendEvent({ error: err });
        res.end();
        return;
      }

      log.info('media', `Uploaded ${mediaCategory}, media_id=${mediaId}`);
      sendEvent({ step: 'complete', media_id: mediaId, status: statusResponse.data });
      res.end();
    } else {
      sendEvent({ error: 'Unsupported media type' });
      res.end();
    }
  } catch (error: any) {
    log.error('media', 'Upload failed:', error.stack || error);
    const msg = error.message || 'Unknown error';
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    } else {
      res.status(error.status || 500).json({ error: msg });
    }
  }
};

export const proxyMedia = async (req: Request, res: Response) => {
  try {
    const { integrationId } = req.params;
    const { auth: authType, url } = req.query;
    
    if (!url) {
      res.status(400).json({ error: "URL parameter required" });
      return;
    }
    
    // Check file cache first
    const cached = await mediaCache.get(url as string);
    if (cached) {
      res.set('Content-Type', cached.contentType);
      res.send(cached.buffer);
      return;
    }
    
    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }
    const { client, authClient } = resolved;

    let response;
    const mediaUrl = new URL(url as string);
    const isPublicCdn = mediaUrl.hostname === 'pbs.twimg.com' || mediaUrl.hostname === 'video.twimg.com';
    const tonParams = authType === 'oauth2' ? parseTonUrl(url as string) : null;
    if (tonParams) {
      response = await client.directmessages.dmConversationsMediaDownload(tonParams.dm_id, tonParams.media_id, tonParams.resource_id);
    } else if (isPublicCdn) {
      response = await fetch(url as string);
    } else {
      const headers = await authClient.getAuthHeader({ url: url as string, method: 'GET' });
      response = await fetch(url as string, { headers: headers as any });
    }
    
    if (!response.ok) {
      res.status(response.status).json({ error: "Failed to fetch media" });
      return;
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Cache the media to file
    await mediaCache.set(url as string, buffer, contentType);
    
    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (error: any) {
    log.error('media', `Proxy error for ${req.query.url}:`, error.cause || error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};