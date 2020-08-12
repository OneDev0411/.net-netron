
/* jshint esversion: 6 */

var protobuf = protobuf || {};
var base = base || require('./base');

protobuf.get = (name) => {
    protobuf._map = protobuf._map || new Map();
    if (!protobuf._map.has(name)) {
        protobuf._map.set(name, {});
    }
    return protobuf._map.get(name);
};

protobuf.Reader = class {

    constructor(buffer) {
        this._buffer = buffer;
        this._length = buffer.length;
        this._position = 0;
        this._view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        this._decoder = new TextDecoder('utf-8');
    }

    static create(buffer) {
        return new protobuf.Reader(buffer);
    }

    next(length) {
        if (length === undefined) {
            return this._length;
        }
        return this._position + length;
    }

    end(position) {
        return this._position < position;
    }

    get pos() {
        return this._position;
    }

    string() {
        return this._decoder.decode(this.bytes());
    }

    bool() {
        return this.uint32() !== 0;
    }

    bytes() {
        const length = this.uint32();
        const start = this._position;
        const end = this._position + length;
        if (end > this._length) {
            throw this._indexOutOfRangeError(length);
        }
        this._position += length;
        return this._buffer.slice(start, end);
    }

    uint32() {
        let value = 4294967295;
        value = (this._buffer[this._position] & 127) >>> 0;
        if (this._buffer[this._position++] < 128) {
            return value;
        }
        value = (value | (this._buffer[this._position] & 127) <<  7) >>> 0;
        if (this._buffer[this._position++] < 128) return value;
        value = (value | (this._buffer[this._position] & 127) << 14) >>> 0; if (this._buffer[this._position++] < 128) return value;
        value = (value | (this._buffer[this._position] & 127) << 21) >>> 0; if (this._buffer[this._position++] < 128) return value;
        value = (value | (this._buffer[this._position] &  15) << 28) >>> 0; if (this._buffer[this._position++] < 128) return value;
        if ((this._position += 5) > this._length) {
            this._position = this._length;
            throw this._indexOutOfRangeError(10);
        }
        return value;
    }

    int32() {
        return this.uint32() | 0;
    }

    sint32() {
        const value = this.uint32();
        return value >>> 1 ^ -(value & 1) | 0;
    }

    int64() {
        return this._varint().toInt64();
    }

    uint64() {
        return this._varint().toInt64();
    }

    sint64() {
        return this._varint().zzDecode().toInt64();
    }

    fixed64() {
        const position = this._position;
        this.skip(8);
        return this._view.getUint64(position, true);
    }

    sfixed64() {
        const position = this._position;
        this.skip(8);
        return this._view.getInt64(position, true);
    }

    fixed32() {
        const position = this._position;
        this.skip(4);
        return this._view.getUint32(position, true);
    }

    sfixed32() {
        const position = this._position;
        this.skip(4);
        return this._view.getInt32(position, true);
    }

    float() {
        if (this._position + 4 > this._length) {
            throw this._indexOutOfRangeError(4);
        }
        const position = this._position;
        this._position += 4;
        return this._view.getFloat32(position, true);
    }

    double() {
        if (this._position + 8 > this._length) {
            throw this._indexOutOfRangeError(4);
        }
        const position = this._position;
        this._position += 8;
        return this._view.getFloat64(position, true);
    }

    array(obj, item, tag) {
        if ((tag & 7) === 2) {
            const end = this.uint32() + this._position;
            while (this._position < end) {
                obj.push(item());
            }
        }
        else {
            obj.push(item());
        }
        return obj;
    }

    floats(obj, tag) {
        if ((tag & 7) === 2) {
            if (obj && obj.length > 0) {
                throw new protobuf.Error('Invalid packed float array.');
            }
            const size = this.uint32();
            const end = this._position + size;
            const length = size >>> 2;
            obj = size > 1048576 ? new Float32Array(length) : new Array(length);
            let position = this._position;
            for (let i = 0; i < length; i++) {
                obj[i] = this._view.getFloat32(position, true);
                position += 4;
            }
            this._position = end;
        }
        else {
            if (obj !== undefined && obj.length < 1000000) {
                obj.push(this.float());
            }
            else {
                obj = undefined;
                this.float();
            }
        }
        return obj;
    }

    doubles(obj, tag) {
        if ((tag & 7) === 2) {
            if (obj && obj.length > 0) {
                throw new protobuf.Error('Invalid packed float array.');
            }
            const size = this.uint32();
            const end = this._position + size;
            const length = size >>> 3;
            obj = size > 1048576 ? new Float64Array(length) : new Array(length);
            let position = this._position;
            for (let i = 0; i < length; i++) {
                obj[i] = this._view.getFloat64(position, true);
                position += 8;
            }
            this._position = end;
        }
        else {
            if (obj !== undefined && obj.length < 1000000) {
                obj.push(this.double());
            }
            else {
                obj = undefined;
                this.double();
            }
        }
        return obj;
    }

    skip(offset) {
        this._position += offset;
        if (this._position > this._length) {
            throw this._indexOutOfRangeError(length);
        }
    }

    skipVarint() {
        do {
            if (this._position >= this._length) {
                throw this._indexOutOfRangeError();
            }
        }
        while (this._buffer[this._position++] & 128);
    }

    skipType(wireType) {
        switch (wireType) {
            case 0:
                this.skipVarint();
                break;
            case 1:
                this.skip(8);
                break;
            case 2:
                this.skip(this.uint32());
                break;
            case 3:
                while ((wireType = this.uint32() & 7) !== 4) {
                    this.skipType(wireType);
                }
                break;
            case 5:
                this.skip(4);
                break;
            default:
                throw new protobuf.Error('invalid wire type ' + wireType + ' at offset ' + this._position);
        }
    }

    entry(obj, key, value) {
        this.skipVarint();
        this._position++;
        let k = key();
        if (!Number.isInteger(k) && typeof k !== 'string') {
            k = k.toNumber();
        }
        this._position++;
        const v = value();
        obj[k] = v;
    }

    _varint() {
        const bits = new protobuf.LongBits(0, 0);
        let i = 0;
        if (this._length - this._position > 4) { // fast route (lo)
            for (; i < 4; ++i) {
                // 1st..4th
                bits.lo = (bits.lo | (this._buffer[this._position] & 127) << i * 7) >>> 0;
                if (this._buffer[this._position++] < 128) {
                    return bits;
                }
            }
            // 5th
            bits.lo = (bits.lo | (this._buffer[this._position] & 127) << 28) >>> 0;
            bits.hi = (bits.hi | (this._buffer[this._position] & 127) >>  4) >>> 0;
            if (this._buffer[this._position++] < 128) {
                return bits;
            }
            i = 0;
        }
        else {
            for (; i < 3; ++i) {
                if (this._position >= this._length)
                    throw this._indexOutOfRangeError();
                bits.lo = (bits.lo | (this._buffer[this._position] & 127) << i * 7) >>> 0;
                if (this._buffer[this._position++] < 128) {
                    return bits;
                }
            }
            bits.lo = (bits.lo | (this._buffer[this._position++] & 127) << i * 7) >>> 0;
            return bits;
        }
        if (this._length - this._position > 4) {
            for (; i < 5; ++i) {
                bits.hi = (bits.hi | (this._buffer[this._position] & 127) << i * 7 + 3) >>> 0;
                if (this._buffer[this._position++] < 128) {
                    return bits;
                }
            }
        }
        else {
            for (; i < 5; ++i) {
                if (this._position >= this._length) {
                    throw this._indexOutOfRangeError();
                }
                bits.hi = (bits.hi | (this._buffer[this._position] & 127) << i * 7 + 3) >>> 0;
                if (this._buffer[this._position++] < 128) {
                    return bits;
                }
            }
        }
        throw new protobuf.Error('Invalid varint encoding.');
    }

    _indexOutOfRangeError(length) {
        return RangeError('index out of range: ' + this._position + ' + ' + (length || 1) + ' > ' + this._length);
    }
};

protobuf.TextReader = class {

    constructor(buffer) {
        this._buffer = buffer;
        this._position = 0;
        this._lineEnd = -1;
        this._line = -1;
        this._column = 0;
        this._depth = 0;
        this._arrayDepth = 0;
        this._token = undefined;
        this._tokenSize = -1;
        this._decoder = new TextDecoder('utf-8', { fatal: true });
    }

    static create(buffer) {
        return new protobuf.TextReader(buffer);
    }

    start() {
        if (this._depth > 0) {
            this.expect('{');
        }
        this._depth++;
    }

    end() {
        const token = this.peek();
        if (this._depth > 0 && token === '}') {
            this.expect('}');
            this.match(';');
            this._depth--;
            return true;
        }
        return token === '';
    }

    tag() {
        const name = this.read();
        const separator = this.peek();
        if (separator !== '[' && separator !== '{') {
            this.expect(':');
        }
        return name;
    }

    integer() {
        const token = this.read();
        const value = Number.parseInt(token, 10);
        if (Number.isNaN(token - value)) {
            throw new protobuf.Error("Couldn't parse integer '" + token + "'" + this._location());
        }
        this._semicolon();
        return value;
    }

    float() {
        let token = this.read();
        if (token.startsWith('nan')) {
            return NaN;
        }
        if (token.startsWith('inf')) {
            return Infinity;
        }
        if (token.startsWith('-inf')) {
            return -Infinity;
        }
        if (token.endsWith('f')) {
            token = token.substring(0, token.length - 1);
        }
        const value = Number.parseFloat(token);
        if (Number.isNaN(token - value)) {
            throw new protobuf.Error("Couldn't parse float '" + token + "'" + this._location());
        }
        this._semicolon();
        return value;
    }

    string() {
        const token = this.read();
        if (token.length < 2) {
            throw new protobuf.Error('String is too short' + this._location());
        }
        const quote = token[0];
        if (quote !== "'" && quote !== '"') {
            throw new protobuf.Error('String is not in quotes' + this._location());
        }
        if (quote !== token[token.length - 1]) {
            throw new protobuf.Error('String quotes do not match' + this._location());
        }
        const value = token.substring(1, token.length - 1);
        this._semicolon();
        return value;
    }

    boolean() {
        const token = this.read();
        switch (token) {
            case 'true':
            case 'True':
            case '1':
                this._semicolon();
                return true;
            case 'false':
            case 'False':
            case '0':
                this._semicolon();
                return false;
        }
        throw new protobuf.Error("Couldn't parse boolean '" + token + "'" + this._location());
    }

    bytes() {
        const token = this.string();
        let i = 0;
        let o = 0;
        const length = token.length;
        const a = new Uint8Array(length);
        while (i < length) {
            let c = token.charCodeAt(i++);
            if (c !== 0x5C) {
                a[o++] = c;
            }
            else {
                if (i >= length) {
                    throw new protobuf.Error('Unexpected end of bytes string' + this._location());
                }
                c = token.charCodeAt(i++);
                switch (c) {
                    case 0x27: a[o++] = 0x27; break; // '
                    case 0x5C: a[o++] = 0x5C; break; // \\
                    case 0x22: a[o++] = 0x22; break; // "
                    case 0x72: a[o++] = 0x0D; break; // \r
                    case 0x6E: a[o++] = 0x0A; break; // \n
                    case 0x74: a[o++] = 0x09; break; // \t
                    case 0x62: a[o++] = 0x08; break; // \b
                    case 0x58: // x
                    case 0x78: // X
                        for (let xi = 0; xi < 2; xi++) {
                            if (i >= length) {
                                throw new protobuf.Error('Unexpected end of bytes string' + this._location());
                            }
                            let xd = token.charCodeAt(i++);
                            xd = xd >= 65 && xd <= 70 ? xd - 55 : xd >= 97 && xd <= 102 ? xd - 87 : xd >= 48 && xd <= 57 ? xd - 48 : -1;
                            if (xd === -1) {
                                throw new protobuf.Error("Unexpected hex digit '" + xd + "' in bytes string" + this._location());
                            }
                            a[o] = a[o] << 4 | xd;
                        }
                        o++;
                        break;
                    default:
                        if (c < 48 || c > 57) { // 0-9
                            throw new protobuf.Error("Unexpected character '" + c + "' in bytes string" + this._location());
                        }
                        i--;
                        for (let oi = 0; oi < 3; oi++) {
                            if (i >= length) {
                                throw new protobuf.Error('Unexpected end of bytes string' + this._location());
                            }
                            const od = token.charCodeAt(i++);
                            if (od < 48 || od > 57) {
                                throw new protobuf.Error("Unexpected octal digit '" + od + "' in bytes string" + this._location());
                            }
                            a[o] = a[o] << 3 | od - 48;
                        }
                        o++;
                        break;
                }
            }
        }
        return a.slice(0, o);
    }

    enum(type) {
        const token = this.read();
        if (!Object.prototype.hasOwnProperty.call(type, token)) {
            const value = Number.parseInt(token, 10);
            if (!Number.isNaN(token - value)) {
                this._semicolon();
                return value;
            }
            throw new protobuf.Error("Couldn't parse enum '" + token + "'" + this._location());
        }
        this._semicolon();
        return type[token];
    }

    any(message) {
        if (this.match('[')) {
            this.read();
            const begin = this._position;
            const end = this._buffer.indexOf(']', begin);
            if (end === -1 || end >= this.next) {
                throw new protobuf.Error('End of Any type_url not found' + this._location());
            }
            message.type_url = this.__substring(begin, end);
            this._position = end + 1;
            this._column = 0;
            message.value = this.skip().substring(1);
            this.expect('}');
            this.match(';');
            return true;
        }
        return false;
    }

    entry(obj, key, value) {
        this.start();
        let k;
        let v;
        while (!this.end()) {
            switch (this.tag()) {
                case 'key':
                    k = key();
                    break;
                case 'value':
                    v = value();
                    break;
            }
        }
        obj[k] = v;
    }

    array(obj, item) {
        if (this.first()) {
            while (!this.last()) {
                obj.push(item());
                this.next();
            }
        }
        else {
            obj.push(item());
        }
    }

    first() {
        if (this.match('[')) {
            this._arrayDepth++;
            return true;
        }
        return false;
    }

    last() {
        if (this.match(']')) {
            this._arrayDepth--;
            return true;
        }
        return false;
    }

    next() {
        const token = this.peek();
        if (token === ',') {
            this.read();
            return;
        }
        if (token === ']') {
            return;
        }
        this.handle(token);
    }

    skip() {
        let token = this.peek();
        if (token === '{') {
            const message = this._position;
            const depth = this._depth;
            this.start();
            while (!this.end() || depth < this._depth) {
                token = this.peek();
                if (token === '{') {
                    this.start();
                }
                else if (token !== '}') {
                    this.read();
                    this.match(';');
                }
            }
            return this._substring(message, this._position);
        }
        else if (token === '[') {
            const list = this._position;
            this.read();
            while (!this.last()) {
                token = this.read();
                if (token === '') {
                    this.handle(token);
                }
            }
            return this._substring(list, this._position);
        }
        const position = this._position;
        this.read();
        this._semicolon();
        return this._substring(position, this._position);
    }

    handle(token) {
        throw new protobuf.Error("Unexpected token '" + token + "'" + this._location());
    }

    field(token /*, module */) {
        throw new protobuf.Error("Unknown field '" + token + "'" + this._location());
    }

    _get(position) {
        return String.fromCharCode(this._buffer[position]);
    }

    _substring(start, end) {
        return this._decoder.decode(this._buffer.subarray(start, end));
    }

    _whitespace() {
        for (;;) {
            while (this._position >= this._lineEnd) {
                this._column = 0;
                this._position = this._lineEnd + 1;
                if (this._position >= this._buffer.length) {
                    return false;
                }
                this._lineEnd = this._buffer.indexOf(0x0a, this._position);
                if (this._lineEnd === -1) {
                    this._lineEnd = this._buffer.length;
                }
                this._line++;
            }
            const c = this._buffer[this._position];
            switch (c) {
                case 0x09: // \t
                case 0x0D: // \n
                case 0x20: // ' '
                    this._position++;
                    this._column++;
                    break;
                case 0x23: // #
                    this._position = this._lineEnd;
                    this._column = 0;
                    break;
                default:
                    return true;
            }
        }
    }

    tokenize() {
        if (!this._whitespace()) {
            this._tokenSize = 0;
            this._token = '';
            return;
        }
        let c = this._get(this._position);
        if (c === '[' && this._position + 2 < this._lineEnd) {
            let i = this._position + 1;
            let x = this._get(i);
            if (x >= 'a' && x <= 'z' || x >= 'A' && x <= 'Z') {
                i++;
                while (i < this._lineEnd) {
                    x = this._get(i);
                    i++;
                    if (x >= 'a' && x <= 'z' || x >= 'A' && x <= 'Z' || x >= '0' && x <= '9' || x === '.' || x === '/') {
                        continue;
                    }
                    if (x === ']') {
                        this._tokenSize = i - this._position;
                        this._token = this._substring(this._position, i);
                        return;
                    }
                }
            }
        }
        if (c === '{' || c === '}' || c === ':' || c === '[' || c === ',' || c === ']' || c === ';') {
            this._tokenSize = 1;
            this._token = c;
            return;
        }
        let position = this._position + 1;
        if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c === '_' || c === '$') {
            while (position < this._lineEnd) {
                c = this._get(position);
                if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c === '_' || c === '+' || c === '-') {
                    position++;
                    continue;
                }
                break;
            }
            this._tokenSize = position - this._position;
            this._token = this._substring(this._position, position);
            return;
        }
        if (c >= '0' && c <= '9' || c === '-' || c === '+' || c === '.') {
            while (position < this._lineEnd) {
                c = this._get(position);
                if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c === '_' || c === '+' || c === '-' || c === '.') {
                    position++;
                    continue;
                }
                break;
            }
            this._tokenSize = position - this._position;
            this._token = this._substring(this._position, position);
            return;
        }
        if (c === '"' || c === "'") {
            const quote = c;
            while (position < this._lineEnd) {
                c = this._get(position);
                if (c === '\\' && position < this._lineEnd) {
                    position += 2;
                    continue;
                }
                position++;
                if (c === quote) {
                    break;
                }
            }
            this._tokenSize = position - this._position;
            this._token = this._substring(this._position, position);
            return;
        }
        throw new protobuf.Error("Unexpected token '" + c + "'" + this._location());
    }

    peek() {
        if (this._tokenSize === -1) {
            this.tokenize();
        }
        return this._token;
    }

    read() {
        if (this._tokenSize === -1) {
            this.tokenize();
        }
        const token = this._token;
        this._position += this._tokenSize;
        this._column += this._token.length;
        this._tokenSize = -1;
        this._token = undefined;
        return token;
    }

    expect(value) {
        const token = this.peek();
        if (token !== value) {
            throw new protobuf.Error("Unexpected '" + token + "' instead of '" + value + "'" + this._location());
        }
        this.read();
    }

    match(value) {
        if (this.peek() === value) {
            this.read();
            return true;
        }
        return false;
    }

    _semicolon() {
        if (this._arrayDepth === 0) {
            this.match(';');
        }
    }

    _location() {
        return ' at ' + (this._line + 1).toString() + ':' + (this._column + 1).toString();
    }
};

protobuf.Int64 = base.Int64;
protobuf.Uint64 = base.Uint64;

protobuf.LongBits = class {

    constructor(lo, hi) {
        this.lo = lo >>> 0;
        this.hi = hi >>> 0;
    }

    zzDecode() {
        const mask = -(this.lo & 1);
        this.lo  = ((this.lo >>> 1 | this.hi << 31) ^ mask) >>> 0;
        this.hi  = ( this.hi >>> 1                  ^ mask) >>> 0;
        return this;
    }

    toUint64() {
        return new base.Uint64(this.lo, this.hi);
    }

    toInt64() {
        return new base.Int64(this.lo, this.hi);
    }
};

protobuf.Error = class extends Error {

    constructor(message) {
        super(message);
        this.name = 'Protocol Buffer Error';
        this.message = message;
    }
};

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports.Reader = protobuf.Reader;
    module.exports.TextReader = protobuf.TextReader;
    module.exports.Error = protobuf.Error;
    module.exports.Int64 = protobuf.Int64;
    module.exports.Uint64 = protobuf.Uint64;
    module.exports.get = protobuf.get;
}