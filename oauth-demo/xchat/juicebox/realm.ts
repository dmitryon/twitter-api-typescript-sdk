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
}

function marshalRequest(req: SecretsRequest): Uint8Array {
  if (req.recover1) return cborEncode('Recover1');
  if (req.recover2) return cborEncode({ Recover2: { version: Buffer.from(req.recover2.version), oprf_blinded_input: Buffer.from(req.recover2.oprfBlindedInput) } });
  if (req.recover3) return cborEncode({ Recover3: { version: Buffer.from(req.recover3.version), unlock_key_tag: Buffer.from(req.recover3.unlockKeyTag) } });
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

export class RealmClient {
  private transport: NoiseTransport | null = null;
  private sessionId: number = 0;

  constructor(
    private realm: Realm,
    private authToken: string,
  ) {}

  async makeRequest(req: SecretsRequest): Promise<SecretsResponse> {
    if (this.realm.publicKey) {
      return this.makeHardwareRequest(req);
    }
    return this.makeSoftwareRequest(req);
  }

  private async makeSoftwareRequest(req: SecretsRequest): Promise<SecretsResponse> {
    const body = marshalRequest(req);
    const url = this.realm.address.replace(/\/$/, '') + '/req';
    const reqType = req.recover1 ? 'Recover1' : req.recover2 ? 'Recover2' : 'Recover3';
    jbLog('debug', `POST ${url} (${reqType}, ${body.length} bytes)`);
    const startTime = Date.now();

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/cbor',
        'Authorization': `Bearer ${this.authToken}`,
        'X-Juicebox-Version': JUICEBOX_VERSION,
      },
      body,
    });

    if (!resp.ok) throw new Error(`realm HTTP ${resp.status}`);
    const respBody = new Uint8Array(await resp.arrayBuffer());
    jbLog('debug', `← ${resp.status} (${Date.now() - startTime}ms, ${respBody.length} bytes)`);
    return cborDecode(respBody) as SecretsResponse;
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
    const clientReq = cborEncode({
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
    });

    const url = this.realm.address.replace(/\/$/, '') + '/req';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor', 'X-Juicebox-Version': JUICEBOX_VERSION },
      body: clientReq,
    });
    if (!resp.ok) throw new Error(`realm HTTP ${resp.status}`);
    const clientResp = cborDecode(new Uint8Array(await resp.arrayBuffer())) as any;
    if (typeof clientResp === 'string') throw new Error(clientResp);
    if (clientResp.InvalidAuth) throw new Error('invalid auth');
    if (!clientResp.Ok?.Handshake) throw new Error('handshake failed');

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
    const ciphertext = this.transport!.encrypt(reqBytes);
    const clientReq = cborEncode({
      realm: Buffer.from(this.realm.id),
      auth_token: this.authToken,
      session_id: this.sessionId,
      kind: 'SecretsRequest',
      encrypted: { Transport: { ciphertext: Buffer.from(ciphertext) } },
    });

    const url = this.realm.address.replace(/\/$/, '') + '/req';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor', 'X-Juicebox-Version': JUICEBOX_VERSION },
      body: clientReq,
    });
    if (!resp.ok) throw new Error(`realm HTTP ${resp.status}`);
    const clientResp = cborDecode(new Uint8Array(await resp.arrayBuffer())) as any;

    if (typeof clientResp === 'string' && clientResp === 'MissingSession') {
      this.transport = null;
      return this.makeHardwareRequest({ recover1: true }); // will re-establish
    }
    if (clientResp.MissingSession) { this.transport = null; throw new Error('session lost'); }
    if (!clientResp.Ok?.Transport) throw new Error('transport response missing');

    const plaintext = this.transport!.decrypt(clientResp.Ok.Transport.ciphertext);
    const padded = cborDecode(plaintext) as any;
    const innerBytes = padded.padded_bytes
      ? new Uint8Array(padded.padded_bytes).slice(0, padded.unpadded_length)
      : plaintext;
    return cborDecode(innerBytes) as SecretsResponse;
  }

  private async sendViaHandshake(reqBytes: Uint8Array): Promise<SecretsResponse> {
      const { state, request } = noiseStart(this.realm.publicKey!, reqBytes);
      this.sessionId = Math.floor(Math.random() * 0xFFFFFFFF);
      const clientReq = cborEncode({
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
      });

      const url = this.realm.address.replace(/\/$/, '') + '/req';
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/cbor', 'X-Juicebox-Version': JUICEBOX_VERSION },
        body: clientReq,
      });

      if (!resp.ok) throw new Error(`realm HTTP ${resp.status}`);
      const clientResp = cborDecode(new Uint8Array(await resp.arrayBuffer())) as any;

      // Handle error variants (string or map)
      if (typeof clientResp === 'string') throw new Error(clientResp);
      if (clientResp.InvalidAuth) throw new Error('invalid auth');
      if (clientResp.Unavailable) throw new Error('unavailable');
      if (clientResp.MissingSession) throw new Error('missing session');
      if (!clientResp.Ok?.Handshake) throw new Error('handshake failed: ' + JSON.stringify(clientResp));

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
      return cborDecode(innerBytes) as SecretsResponse;
  }
}
