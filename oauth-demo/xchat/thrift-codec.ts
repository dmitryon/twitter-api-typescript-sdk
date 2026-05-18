/**
 * thrift-codec.ts — Generic Thrift binary protocol encoder/decoder
 *
 * Uses schema definitions instead of reflection. Each schema describes
 * the fields of a struct with their IDs, types, and optional nested schemas.
 *
 * Port of: pkg/twittermeow/data/payload/thrift_codec.go
 */

// Thrift type constants
export const T = {
  STOP: 0,
  BOOL: 2,
  BYTE: 3,
  I16: 6,
  I32: 8,
  I64: 10,
  STRING: 11, // also binary
  STRUCT: 12,
  LIST: 15,
} as const;

export type ThriftType = typeof T[keyof typeof T];

export interface FieldSchema {
  id: number;
  name: string;
  type: ThriftType;
  /** For STRUCT fields: the schema of the nested struct */
  schema?: Schema;
  /** For LIST fields: the element type */
  elemType?: ThriftType;
  /** For LIST of STRUCT: the element schema */
  elemSchema?: Schema;
  /** If true, value is stored as number (for i64 that fits in JS number) */
  asNumber?: boolean;
  /** If true, field is binary (Uint8Array) not string */
  binary?: boolean;
}

export type Schema = FieldSchema[];

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export function decode(buf: Buffer | Uint8Array, schema: Schema): Record<string, any> {
  const reader = new Reader(Buffer.from(buf));
  return readStruct(reader, schema);
}

class Reader {
  pos = 0;
  constructor(private buf: Buffer) {}

  readByte(): number { return this.buf[this.pos++]; }
  readI16(): number { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  readI32(): number { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  readI64(): bigint { const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return v; }
  readBool(): boolean { return this.readByte() !== 0; }
  readString(): string { const len = this.readI32(); const s = this.buf.subarray(this.pos, this.pos + len).toString('utf8'); this.pos += len; return s; }
  readBinary(): Buffer { const len = this.readI32(); const b = this.buf.subarray(this.pos, this.pos + len); this.pos += len; return Buffer.from(b); }

  readFieldBegin(): { type: number; id: number } {
    const type = this.readByte();
    if (type === T.STOP) return { type, id: 0 };
    const id = this.readI16();
    return { type, id };
  }

  skip(type: number): void {
    switch (type) {
      case T.BOOL: case T.BYTE: this.pos += 1; break;
      case T.I16: this.pos += 2; break;
      case T.I32: this.pos += 4; break;
      case T.I64: this.pos += 8; break;
      case T.STRING: { const len = this.readI32(); this.pos += len; break; }
      case T.STRUCT: { let f = this.readFieldBegin(); while (f.type !== T.STOP) { this.skip(f.type); f = this.readFieldBegin(); } break; }
      case T.LIST: { const et = this.readByte(); const sz = this.readI32(); for (let i = 0; i < sz; i++) this.skip(et); break; }
    }
  }
}

function readStruct(r: Reader, schema: Schema): Record<string, any> {
  const result: Record<string, any> = {};
  const fieldMap = new Map<number, FieldSchema>();
  for (const f of schema) fieldMap.set(f.id, f);

  let f = r.readFieldBegin();
  while (f.type !== T.STOP) {
    const fieldSchema = fieldMap.get(f.id);
    if (!fieldSchema) {
      r.skip(f.type);
    } else {
      result[fieldSchema.name] = readValue(r, f.type, fieldSchema);
    }
    f = r.readFieldBegin();
  }
  return result;
}

function readValue(r: Reader, wireType: number, schema: FieldSchema): any {
  switch (wireType) {
    case T.BOOL: return r.readBool();
    case T.I32: return r.readI32();
    case T.I64: return schema.asNumber ? Number(r.readI64()) : r.readI64();
    case T.STRING: return schema.binary ? r.readBinary() : r.readString();
    case T.STRUCT: return schema.schema ? readStruct(r, schema.schema) : skipAndReturnNull(r, wireType);
    case T.LIST: {
      const elemType = r.readByte();
      const size = r.readI32();
      const list: any[] = [];
      for (let i = 0; i < size; i++) {
        if (elemType === T.STRUCT && schema.elemSchema) {
          list.push(readStruct(r, schema.elemSchema));
        } else if (elemType === T.STRING) {
          list.push(r.readString());
        } else if (elemType === T.I32) {
          list.push(r.readI32());
        } else if (elemType === T.I64) {
          list.push(schema.asNumber ? Number(r.readI64()) : r.readI64());
        } else {
          r.skip(elemType);
          list.push(null);
        }
      }
      return list;
    }
    default:
      r.skip(wireType);
      return null;
  }
}

function skipAndReturnNull(r: Reader, type: number): null {
  r.skip(type);
  return null;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

export function encode(obj: Record<string, any>, schema: Schema): Buffer {
  const writer = new Writer();
  writeStruct(writer, obj, schema);
  return writer.toBuffer();
}

class Writer {
  private parts: Buffer[] = [];

  writeByte(v: number) { this.parts.push(Buffer.from([v])); }
  writeI16(v: number) { const b = Buffer.allocUnsafe(2); b.writeInt16BE(v, 0); this.parts.push(b); }
  writeI32(v: number) { const b = Buffer.allocUnsafe(4); b.writeInt32BE(v, 0); this.parts.push(b); }
  writeI64(v: bigint | number) { const b = Buffer.allocUnsafe(8); b.writeBigInt64BE(BigInt(v), 0); this.parts.push(b); }
  writeBool(v: boolean) { this.parts.push(Buffer.from([v ? 1 : 0])); }
  writeString(s: string) { const buf = Buffer.from(s, 'utf8'); this.writeI32(buf.length); this.parts.push(buf); }
  writeBinary(b: Buffer | Uint8Array) { this.writeI32(b.length); this.parts.push(Buffer.from(b)); }

  writeFieldBegin(type: number, id: number) { this.writeByte(type); this.writeI16(id); }
  writeFieldStop() { this.writeByte(T.STOP); }
  writeListBegin(elemType: number, size: number) { this.writeByte(elemType); this.writeI32(size); }

  toBuffer(): Buffer { return Buffer.concat(this.parts); }
}

function writeStruct(w: Writer, obj: Record<string, any>, schema: Schema): void {
  for (const field of schema) {
    const value = obj[field.name];
    if (value === undefined || value === null) continue;

    w.writeFieldBegin(field.type, field.id);
    writeValue(w, value, field);
  }
  w.writeFieldStop();
}

function writeValue(w: Writer, value: any, schema: FieldSchema): void {
  switch (schema.type) {
    case T.BOOL: w.writeBool(value); break;
    case T.I32: w.writeI32(value); break;
    case T.I64: w.writeI64(value); break;
    case T.STRING:
      if (schema.binary) w.writeBinary(value);
      else w.writeString(value);
      break;
    case T.STRUCT:
      if (schema.schema) writeStruct(w, value, schema.schema);
      break;
    case T.LIST: {
      const elemType = schema.elemType || (schema.elemSchema ? T.STRUCT : T.STRING);
      const arr = value as any[];
      w.writeListBegin(elemType, arr.length);
      for (const item of arr) {
        if (elemType === T.STRUCT && schema.elemSchema) writeStruct(w, item, schema.elemSchema);
        else if (elemType === T.STRING) w.writeString(item);
        else if (elemType === T.I32) w.writeI32(item);
        else if (elemType === T.I64) w.writeI64(item);
        else if (elemType === T.BOOL) w.writeBool(item);
      }
      break;
    }
  }
}
