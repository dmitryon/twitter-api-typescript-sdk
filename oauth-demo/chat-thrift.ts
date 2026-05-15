/**
 * chat-thrift.ts
 *
 * Hand-rolled Apache Thrift binary protocol encoder/decoder for XChat message
 * structs. Field IDs are inferred from the chat-xdk API surface and naming
 * conventions — the actual .thrift schema is internal to the chat-xdk.
 */

// ---------------------------------------------------------------------------
// Field type constants (Thrift binary protocol)
// ---------------------------------------------------------------------------

export const T_STOP   = 0;
export const T_BOOL   = 2;
export const T_BYTE   = 3;
export const T_I16    = 6;
export const T_I32    = 8;
export const T_I64    = 10;
export const T_STRING = 11; // also used for binary
export const T_STRUCT = 12;
export const T_LIST   = 15;

// ---------------------------------------------------------------------------
// ThriftWriter
// ---------------------------------------------------------------------------

export class ThriftWriter {
  private buf: Buffer[] = [];

  writeFieldBegin(type: number, id: number) {
    const b = Buffer.allocUnsafe(3);
    b[0] = type;
    b.writeInt16BE(id, 1);
    this.buf.push(b);
  }

  writeFieldStop() {
    this.buf.push(Buffer.from([T_STOP]));
  }

  writeString(s: string) {
    const str = Buffer.from(s, 'utf8');
    const len = Buffer.allocUnsafe(4);
    len.writeInt32BE(str.length, 0);
    this.buf.push(len, str);
  }

  writeBinary(b: Buffer) {
    const len = Buffer.allocUnsafe(4);
    len.writeInt32BE(b.length, 0);
    this.buf.push(len, b);
  }

  writeI32(n: number) {
    const b = Buffer.allocUnsafe(4);
    b.writeInt32BE(n, 0);
    this.buf.push(b);
  }

  writeI64(n: bigint) {
    const b = Buffer.allocUnsafe(8);
    b.writeBigInt64BE(n, 0);
    this.buf.push(b);
  }

  writeBool(v: boolean) {
    this.buf.push(Buffer.from([v ? 1 : 0]));
  }

  writeListBegin(elemType: number, size: number) {
    const b = Buffer.allocUnsafe(5);
    b[0] = elemType;
    b.writeInt32BE(size, 1);
    this.buf.push(b);
  }

  writeRaw(b: Buffer) {
    this.buf.push(b);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.buf);
  }
}

// ---------------------------------------------------------------------------
// ThriftReader
// ---------------------------------------------------------------------------

export class ThriftReader {
  private pos = 0;
  constructor(private buf: Buffer) {}

  readByte(): number { return this.buf[this.pos++]; }

  readI16(): number {
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }

  readI32(): number {
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  readI64(): bigint {
    const v = this.buf.readBigInt64BE(this.pos);
    this.pos += 8;
    return v;
  }

  readBool(): boolean { return this.readByte() !== 0; }

  readString(): string {
    const len = this.readI32();
    const s = this.buf.slice(this.pos, this.pos + len).toString('utf8');
    this.pos += len;
    return s;
  }

  readBinary(): Buffer {
    const len = this.readI32();
    const b = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return b;
  }

  readFieldBegin(): { type: number; id: number } {
    const type = this.readByte();
    if (type === T_STOP) return { type, id: 0 };
    const id = this.readI16();
    return { type, id };
  }

  skip(type: number) {
    switch (type) {
      case T_BOOL: case T_BYTE: this.pos += 1; break;
      case T_I16: this.pos += 2; break;
      case T_I32: this.pos += 4; break;
      case T_I64: this.pos += 8; break;
      case T_STRING: this.pos += 4 + this.buf.readInt32BE(this.pos); break;
      case T_STRUCT: {
        let f = this.readFieldBegin();
        while (f.type !== T_STOP) { this.skip(f.type); f = this.readFieldBegin(); }
        break;
      }
      case T_LIST: {
        const et = this.readByte();
        const sz = this.readI32();
        for (let i = 0; i < sz; i++) this.skip(et);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Struct encoders (inferred field IDs)
// ---------------------------------------------------------------------------

function encodeTextContent(text: string): Buffer {
  const w = new ThriftWriter();
  w.writeFieldBegin(T_STRING, 1); w.writeString(text);
  w.writeFieldStop();
  return w.toBuffer();
}

function encodeMessageContent(text: string): Buffer {
  const w = new ThriftWriter();
  w.writeFieldBegin(T_STRING, 1); w.writeString('Text');
  w.writeFieldBegin(T_STRUCT, 2); w.writeRaw(encodeTextContent(text));
  w.writeFieldStop();
  return w.toBuffer();
}

/**
 * MessageCreateEvent {
 *   0: type           (string) = "Message"
 *   1: message_id     (string)
 *   2: sender_id      (string)
 *   3: conversation_id (string)
 *   4: text           (string) — flattened from nested MessageContent
 *   5: timestamp_ms   (i64)
 * }
 */
export function encodeMessageCreateEvent(
  messageId: string,
  senderId: string,
  conversationId: string,
  text: string,
): Buffer {
  const w = new ThriftWriter();
  w.writeFieldBegin(T_STRING, 0); w.writeString('Message');
  w.writeFieldBegin(T_STRING, 1); w.writeString(messageId);
  w.writeFieldBegin(T_STRING, 2); w.writeString(senderId);
  w.writeFieldBegin(T_STRING, 3); w.writeString(conversationId);
  w.writeFieldBegin(T_STRING, 4); w.writeString(text);
  w.writeFieldBegin(T_I64,    5); w.writeI64(BigInt(Date.now()));
  w.writeFieldStop();
  return w.toBuffer();
}

/**
 * MessageEventSignature {
 *   1: message_id        (string)
 *   2: sender_id         (string)
 *   3: conversation_id   (string)
 *   4: signature         (binary)
 *   5: signing_public_key (binary)
 *   6: key_version       (string)
 * }
 */
export function encodeMessageEventSignature(
  messageId: string,
  senderId: string,
  conversationId: string,
  signature: Buffer,
  signingPublicKey: Buffer,
  keyVersion: string,
): Buffer {
  const w = new ThriftWriter();
  w.writeFieldBegin(T_STRING, 1); w.writeString(messageId);
  w.writeFieldBegin(T_STRING, 2); w.writeString(senderId);
  w.writeFieldBegin(T_STRING, 3); w.writeString(conversationId);
  w.writeFieldBegin(T_STRING, 4); w.writeBinary(signature);
  w.writeFieldBegin(T_STRING, 5); w.writeBinary(signingPublicKey);
  w.writeFieldBegin(T_STRING, 6); w.writeString(keyVersion);
  w.writeFieldStop();
  return w.toBuffer();
}

// ---------------------------------------------------------------------------
// Struct decoder
// ---------------------------------------------------------------------------

export interface TextMessage {
  type: 'Message';
  message_id: string;
  sender_id: string;
  conversation_id: string;
  content: { content_type: 'Text'; text: string };
}

export interface KeyChangeEvent {
  type: 'KeyChange';
  key_version: string;
  participant_keys: Array<{ user_id: string; encrypted_key: string }>;
}

export type DecodedEvent = TextMessage | KeyChangeEvent | { type: 'Unknown'; raw: Buffer };

export function decodeEvent(buf: Buffer): DecodedEvent {
  try {
    const r = new ThriftReader(buf);
    const fields: Record<number, any> = {};
    let f = r.readFieldBegin();
    while (f.type !== T_STOP) {
      if (f.type === T_STRING)      fields[f.id] = r.readString();
      else if (f.type === T_I64)    fields[f.id] = r.readI64();
      else if (f.type === T_I32)    fields[f.id] = r.readI32();
      else if (f.type === T_BOOL)   fields[f.id] = r.readBool();
      else                          r.skip(f.type);
      f = r.readFieldBegin();
    }
    const type = fields[0] as string;
    if (type === 'Message') {
      return {
        type: 'Message',
        message_id:      fields[1] ?? '',
        sender_id:       fields[2] ?? '',
        conversation_id: fields[3] ?? '',
        content: { content_type: 'Text', text: fields[4] ?? '' },
      };
    }
    if (type === 'KeyChange') {
      return {
        type: 'KeyChange',
        key_version:      fields[2] ?? '',
        participant_keys: [],
      };
    }
    return { type: 'Unknown', raw: buf };
  } catch {
    return { type: 'Unknown', raw: buf };
  }
}
