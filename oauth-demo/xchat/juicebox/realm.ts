/**
 * juicebox/realm.ts — Realm HTTP client
 * Port of: pkg/juiceboxgo/realm/client.go
 *
 * Uses CBOR for request/response serialization.
 * Software realms: direct CBOR over HTTP with Bearer auth.
 * Hardware realms: Noise NK encrypted CBOR over HTTP.
 */

import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import { noiseStart, noiseFinish, NoiseTransport } from './noise.js';
import type { Realm } from './config.js';
import type { JuiceboxCallLoggerInterface } from '../../storage.js';

const JUICEBOX_VERSION = '0.3.4';

function jbLog(level: 'debug' | 'info' | 'error', msg: string, extra?: any) {
  const ts = new Date().toISOString();
  const lvl = level === 'debug' ? '\x1b[34mDEBUG\x1b[0m' : level === 'info' ? '\x1b[32mINFO\x1b[0m ' : '\x1b[31mERROR\x1b[0m';
  const line = `\x1b[2m${ts}\x1b[0m ${lvl} \x1b[36m[juicebox]\x1b[0m ${msg}`;
  if (extra !== undefined) console.log(line, extra);
  else console.log(line);
}

export interface SecretsRequest {
  recover1?: boolean;
  recover2?: { version: Uint8Array; oprfBlindedInput: Uint8Array };
  recover3?: { version: Uint8Array; unlockKeyTag: Uint8Array };
  register1?: boolean;
  register2?: {
    version: Uint8Array;
    oprfPrivateKey: Uint8Array;
    oprfPublicKey: Uint8Array;
    oprfVerifyingKey: Uint8Array;
    unlockKeyCommitment: Uint8Array;
    unlockKeyTag: Uint8Array;
    encryptionKeyScalarShare: Uint8Array;
    encryptedSecret: Uint8Array;
    encryptedSecretCommitment: Uint8Array;
    numGuesses: number;
  };
}

function marshalRequest(req: SecretsRequest): Uint8Array {
  if (req.recover1) return cborEncode('Recover1');
  if (req.recover2) return cborEncode({ Recover2: { version: Buffer.from(req.recover2.version), oprf_blinded_input: Buffer.from(req.recover2.oprfBlindedInput) } });
  if (req.recover3) return cborEncode({ Recover3: { version: Buffer.from(req.recover3.version), unlock_key_tag: Buffer.from(req.recover3.unlockKeyTag) } });
  if (req.register1) return cborEncode('Register1');
  if (req.register2) return cborEncode({ Register2: {
    version: Buffer.from(req.register2.version),
    oprf_private_key: Buffer.from(req.register2.oprfPrivateKey),
    oprf_signed_public_key: {
      public_key: Buffer.from(req.register2.oprfPublicKey),
      verifying_key: Buffer.from(req.register2.oprfVerifyingKey),
    },
    unlock_key_commitment: Buffer.from(req.register2.unlockKeyCommitment),
    unlock_key_tag: Buffer.from(req.register2.unlockKeyTag),
    encryption_key_scalar_share: Buffer.from(req.register2.encryptionKeyScalarShare),
    encrypted_secret: Buffer.from(req.register2.encryptedSecret),
    encrypted_secret_commitment: Buffer.from(req.register2.encryptedSecretCommitment),
    policy: { num_guesses: req.register2.numGuesses },
  } });
  throw new Error('Unknown request type');
}

export interface SecretsResponse {
  Recover1?: { Ok?: { version: Uint8Array }; NotRegistered?: boolean; NoGuesses?: boolean };
  Recover2?: {
    Ok?: {
      oprf_blinded_result: Uint8Array;
      oprf_proof: { c: Uint8Array; beta_z: Uint8Array };
      oprf_signed_public_key: { public_key: Uint8Array; verifying_key: Uint8Array; signature: Uint8Array };
      unlock_key_commitment: Uint8Array;
      num_guesses: number;
      guess_count: number;
    };
    NotRegistered?: boolean;
    NoGuesses?: boolean;
    VersionMismatch?: boolean;
  };
  Recover3?: {
    Ok?: {
      encryption_key_scalar_share: Uint8Array;
      encrypted_secret: Uint8Array;
      encrypted_secret_commitment: Uint8Array;
    };
    NotRegistered?: boolean;
    NoGuesses?: boolean;
    BadUnlockKeyTag?: { guesses_remaining: number };
    VersionMismatch?: boolean;
  };
}

interface PostCborResult {
  status: number;
  decoded: any;
  startTime: number;
  url: string;
}

export class RealmClient {
  private transport: NoiseTransport | null = null;
  private sessionId: number = 0;

  constructor(
    private realm: Realm,
    private authToken: string,
    private logger?: JuiceboxCallLoggerInterface,
  ) {}

  async makeRequest(req: SecretsRequest): Promise<SecretsResponse> {
    if (this.realm.publicKey) {
      return this.makeHardwareRequest(req);
    }
    return this.makeSoftwareRequest(req);
  }

  private async postCbor(requestType: string, wireReq: any, extraHeaders: Record<string, string>, preEncoded?: any): Promise<PostCborResult> {
    const url = this.realm.address.replace(/\/$/, '') + '/req';
    const startTime = Date.now();
    const body = cborEncode(wireReq);

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor', 'X-Juicebox-Version': JUICEBOX_VERSION, ...extraHeaders },
      body: Buffer.from(body),
    });

    if (!resp.ok) {
      this.logRequest(startTime, url, requestType, resp.status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq) }, `realm HTTP ${resp.status}`);
      throw new Error(`realm HTTP ${resp.status}`);
    }

    const respBytes = new Uint8Array(await resp.arrayBuffer());
    const decoded = cborDecode(respBytes) as any;
    jbLog('debug', `← ${resp.status} (${Date.now() - startTime}ms, ${respBytes.length} bytes)`);
    return { status: resp.status, decoded, startTime, url };
  }

  private async makeSoftwareRequest(req: SecretsRequest): Promise<SecretsResponse> {
    const body = marshalRequest(req);
    const reqType = req.recover1 ? 'Recover1' : req.recover2 ? 'Recover2' : 'Recover3';
    const preEncoded = cborDecode(body);
    jbLog('debug', `POST ${this.realm.address}/req (${reqType}, ${body.length} bytes)`);

    const { status, decoded, startTime, url } = await this.postCbor(reqType, preEncoded, { 'Authorization': `Bearer ${this.authToken}` }, preEncoded);
    this.logRequest(startTime, url, reqType, status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(preEncoded), response_body: toJsonSafe(decoded), encoded_response: toJsonSafe(decoded) });
    return decoded as SecretsResponse;
  }

  private async makeHardwareRequest(req: SecretsRequest): Promise<SecretsResponse> {
    const reqBytes = marshalRequest(req);
    const needsForwardSecrecy = !!req.recover2 || !!req.recover3;

    // If we need forward secrecy but have no transport, establish session first
    if (needsForwardSecrecy && !this.transport) {
      await this.establishSession();
    }

    if (this.transport) {
      // Send via existing transport
      return this.sendViaTransport(reqBytes);
    }

    // No transport needed — piggyback on handshake
    return this.sendViaHandshake(reqBytes);
  }

  private async establishSession(): Promise<void> {
    jbLog('debug', `establishing Noise session with ${this.realm.address}`);
    const { state, request } = noiseStart(this.realm.publicKey!, new Uint8Array(0));
    this.sessionId = Math.floor(Math.random() * 0xFFFFFFFF);
    const wireReq = {
      realm: Buffer.from(this.realm.id),
      auth_token: this.authToken,
      session_id: this.sessionId,
      kind: 'HandshakeOnly',
      encrypted: {
        Handshake: {
          handshake: {
            client_ephemeral_public: Buffer.from(request.clientEphemeralPublic),
            payload_ciphertext: Buffer.from(request.payloadCiphertext),
          }
        }
      },
    };

    const { status, decoded: clientResp, startTime, url } = await this.postCbor('HandshakeOnly', wireReq, {});

    if (typeof clientResp === 'string') {
      this.logRequest(startTime, url, 'HandshakeOnly', status, { encoded_request: toJsonSafe(wireReq), encoded_response: clientResp }, clientResp);
      throw new Error(clientResp);
    }
    if (clientResp.InvalidAuth) {
      this.logRequest(startTime, url, 'HandshakeOnly', 401, { encoded_request: toJsonSafe(wireReq), encoded_response: toJsonSafe(clientResp) }, 'invalid auth');
      throw new Error('invalid auth');
    }
    if (!clientResp.Ok?.Handshake) {
      this.logRequest(startTime, url, 'HandshakeOnly', status, { encoded_request: toJsonSafe(wireReq), encoded_response: toJsonSafe(clientResp) }, 'handshake failed');
      throw new Error('handshake failed');
    }

    this.logRequest(startTime, url, 'HandshakeOnly', status, { encoded_request: toJsonSafe(wireReq), encoded_response: toJsonSafe(clientResp) });

    const hs = clientResp.Ok.Handshake.handshake;
    const { transport } = noiseFinish(state, {
      serverEphemeralPublic: hs.server_ephemeral_public,
      payloadCiphertext: hs.payload_ciphertext,
    });
    this.transport = transport;
    jbLog('debug', `Noise session established with ${this.realm.address}`);
  }

  private async sendViaTransport(reqBytes: Uint8Array): Promise<SecretsResponse> {
    jbLog('debug', `POST ${this.realm.address} via transport (${reqBytes.length} bytes)`);
    const preEncoded = cborDecode(reqBytes);
    const ciphertext = this.transport!.encrypt(reqBytes);
    const wireReq = {
      realm: Buffer.from(this.realm.id),
      auth_token: this.authToken,
      session_id: this.sessionId,
      kind: 'SecretsRequest',
      encrypted: { Transport: { ciphertext: Buffer.from(ciphertext) } },
    };

    const { status, decoded: clientResp, startTime, url } = await this.postCbor('Transport', wireReq, {}, preEncoded);

    if (typeof clientResp === 'string' && clientResp === 'MissingSession') {
      this.logRequest(startTime, url, 'Transport', status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq), encoded_response: clientResp }, 'MissingSession');
      this.transport = null;
      return this.makeHardwareRequest({ recover1: true });
    }
    if (clientResp.MissingSession) {
      this.logRequest(startTime, url, 'Transport', status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq), encoded_response: toJsonSafe(clientResp) }, 'session lost');
      this.transport = null;
      throw new Error('session lost');
    }
    if (!clientResp.Ok?.Transport) {
      this.logRequest(startTime, url, 'Transport', status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq), encoded_response: toJsonSafe(clientResp) }, 'transport response missing');
      throw new Error('transport response missing');
    }

    const plaintext = this.transport!.decrypt(clientResp.Ok.Transport.ciphertext);
    const padded = cborDecode(plaintext) as any;
    const innerBytes = padded.padded_bytes
      ? new Uint8Array(padded.padded_bytes).slice(0, padded.unpadded_length)
      : plaintext;
    const decoded = cborDecode(innerBytes) as SecretsResponse;
    this.logRequest(startTime, url, 'Transport', status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq), response_body: toJsonSafe(decoded), encoded_response: toJsonSafe(clientResp) });
    return decoded;
  }

  private async sendViaHandshake(reqBytes: Uint8Array): Promise<SecretsResponse> {
    const preEncoded = cborDecode(reqBytes);
    const { state, request } = noiseStart(this.realm.publicKey!, reqBytes);
    this.sessionId = Math.floor(Math.random() * 0xFFFFFFFF);
    const wireReq = {
      realm: Buffer.from(this.realm.id),
      auth_token: this.authToken,
      session_id: this.sessionId,
      kind: 'SecretsRequest',
      encrypted: {
        Handshake: {
          handshake: {
            client_ephemeral_public: Buffer.from(request.clientEphemeralPublic),
            payload_ciphertext: Buffer.from(request.payloadCiphertext),
          }
        }
      },
    };

    const { status, decoded: clientResp, startTime, url } = await this.postCbor('Handshake', wireReq, {}, preEncoded);

    // Handle error variants (string or map)
    if (typeof clientResp === 'string') {
      this.logRequest(startTime, url, 'Handshake', status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq), encoded_response: clientResp }, clientResp);
      throw new Error(clientResp);
    }
    if (clientResp.InvalidAuth) {
      this.logRequest(startTime, url, 'Handshake', 401, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq), encoded_response: toJsonSafe(clientResp) }, 'invalid auth');
      throw new Error('invalid auth');
    }
    if (clientResp.Unavailable) {
      this.logRequest(startTime, url, 'Handshake', status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq), encoded_response: toJsonSafe(clientResp) }, 'unavailable');
      throw new Error('unavailable');
    }
    if (clientResp.MissingSession) {
      this.logRequest(startTime, url, 'Handshake', status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq), encoded_response: toJsonSafe(clientResp) }, 'missing session');
      throw new Error('missing session');
    }
    if (!clientResp.Ok?.Handshake) {
      this.logRequest(startTime, url, 'Handshake', status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq), encoded_response: toJsonSafe(clientResp) }, 'handshake failed');
      throw new Error('handshake failed: ' + JSON.stringify(clientResp));
    }

    const hs = clientResp.Ok.Handshake.handshake;
    const { transport, payload } = noiseFinish(state, {
      serverEphemeralPublic: hs.server_ephemeral_public,
      payloadCiphertext: hs.payload_ciphertext,
    });
    this.transport = transport;

    // Payload is a PaddedSecretsResponse: { unpadded_length, padded_bytes }
    const padded = cborDecode(payload) as any;
    const innerBytes = padded.padded_bytes
      ? new Uint8Array(padded.padded_bytes).slice(0, padded.unpadded_length)
      : payload;
    const decoded = cborDecode(innerBytes) as SecretsResponse;
    this.logRequest(startTime, url, 'Handshake', status, { request_body: toJsonSafe(preEncoded), encoded_request: toJsonSafe(wireReq), response_body: toJsonSafe(decoded), encoded_response: toJsonSafe(clientResp) });
    return decoded;
  }

  private logRequest(startTime: number, url: string, requestType: string, status: number, data?: { request_body?: any; encoded_request?: any; response_body?: any; encoded_response?: any } | any, error?: string) {
    if (!this.logger) return;
    try {
      const isStructured = data && typeof data === 'object' && ('request_body' in data || 'encoded_request' in data || 'encoded_response' in data);
      this.logger.log({
        timestamp: new Date(startTime).toISOString(),
        method: 'POST',
        url,
        endpoint: new URL(url).pathname,
        request_type: requestType,
        request_body: isStructured ? data.request_body : undefined,
        encoded_request: isStructured ? data.encoded_request : undefined,
        status,
        response_body: isStructured ? data.response_body : data,
        encoded_response: isStructured ? data.encoded_response : undefined,
        duration_ms: Date.now() - startTime,
        error,
      });
    } catch {}
  }
}

function toJsonSafe(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Uint8Array || Buffer.isBuffer(obj)) return Buffer.from(obj).toString('base64');
  if (Array.isArray(obj)) return obj.map(toJsonSafe);
  if (typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = toJsonSafe(v);
    return out;
  }
  return obj;
}
