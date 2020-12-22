/* jshint esversion: 6 */
/* global pako */

var zip = zip || {};

zip.Archive = class {

    constructor(buffer) {
        this._entries = [];
        const stream = buffer instanceof Uint8Array ? new zip.BinaryReader(buffer) : buffer;
        const signature = [ 0x50, 0x4B, 0x01, 0x02 ];
        if (stream.length < 4 || !stream.peek(2).every((value, index) => value === signature[index])) {
            throw new zip.Error('Invalid Zip archive.');
        }
        const lookup = (stream, signature) => {
            let position = stream.length - 65536;
            while (position !== 0) {
                position = Math.max(0, position);
                stream.seek(position);
                const buffer = stream.read(Math.min(stream.length - position, 65000));
                for (let i = buffer.length - 4; i >= 0; i--) {
                    if (signature[0] === buffer[i] &&
                        signature[1] === buffer[i + 1] &&
                        signature[2] === buffer[i + 2] &&
                        signature[3] === buffer[i + 3]) {
                        stream.seek(position + i + 4);
                        return true;
                    }
                }
                position += 4000;
            }
            return false;
        };
        if (!lookup(stream, [ 0x50, 0x4B, 0x05, 0x06 ])) {
            throw new zip.Error('End of central directory not found.');
        }
        let reader = new zip.BinaryReader(stream.read(16));
        reader.skip(12);
        let offset = reader.uint32(); // central directory offset
        if (offset > stream.length) {
            if (!lookup(stream, [ 0x50, 0x4B, 0x06, 0x06 ])) {
                throw new zip.Error('Zip64 end of central directory not found.');
            }
            reader = new zip.BinaryReader(stream.read(52));
            reader.skip(44);
            offset = reader.uint32();
            if (reader.uint32() !== 0) {
                throw new zip.Error('Zip 64-bit central directory offset not supported.');
            }
        }
        if (offset > stream.length) {
            throw new zip.Error('Invalid central directory offset.');
        }
        stream.seek(offset); // central directory offset

        const entries = [];
        while (stream.position + 4 < stream.length && stream.read(4).every((value, index) => value === signature[index])) {
            const entry = {};
            const reader = new zip.BinaryReader(stream.read(42));
            reader.uint16(); // version made by
            reader.skip(2); // version needed to extract
            const flags = reader.uint16();
            if ((flags & 1) == 1) {
                throw new zip.Error('Encrypted entries not supported.');
            }
            entry.compressionMethod = reader.uint16();
            reader.uint32(); // date
            reader.uint32(); // crc32
            entry.compressedSize = reader.uint32();
            entry.size = reader.uint32();
            entry.nameLength = reader.uint16(); // file name length
            const extraDataLength = reader.uint16();
            const commentLength = reader.uint16();
            entry.disk = reader.uint16(); // disk number start
            reader.uint16(); // internal file attributes
            reader.uint32(); // external file attributes
            entry.localHeaderOffset = reader.uint32();
            entry.nameBuffer = stream.read(entry.nameLength);
            const extraData = stream.read(extraDataLength);
            if (extraData.length > 0) {
                const reader = new zip.BinaryReader(extraData);
                while (reader.position < reader.length) {
                    const type = reader.uint16();
                    reader.uint16(); // length
                    switch (type) {
                        case 0x0001:
                            if (entry.size === 0xffffffff) {
                                entry.size = reader.uint32();
                                if (reader.uint32() !== 0) {
                                    throw new zip.Error('Zip 64-bit offset not supported.');
                                }
                            }
                            if (entry.compressedSize === 0xffffffff) {
                                entry.compressedSize = reader.uint32();
                                if (reader.uint32() !== 0) {
                                    throw new zip.Error('Zip 64-bit offset not supported.');
                                }
                            }
                            if (entry.localHeaderOffset === 0xffffffff) {
                                entry.localHeaderOffset = reader.uint32();
                                if (reader.uint32() !== 0) {
                                    throw new zip.Error('Zip 64-bit offset not supported.');
                                }
                            }
                            if (entry.disk === 0xffff) {
                                entry.disk = reader.uint32();
                            }
                            break;
                    }
                }
            }
            stream.read(commentLength); // comment
            entries.push(entry);
        }
        for (const entry of entries) {
            this._entries.push(new zip.Entry(stream, entry));
        }
        stream.seek(0);
    }

    get entries() {
        return this._entries;
    }
};

zip.Entry = class {

    constructor(stream, entry) {
        stream.seek(entry.localHeaderOffset);
        const signature = [ 0x50, 0x4B, 0x03, 0x04 ];
        if (stream.position + 4 > stream.length || !stream.read(4).every((value, index) => value === signature[index])) {
            throw new zip.Error('Invalid local file header signature.');
        }
        const reader = new zip.BinaryReader(stream.read(26));
        reader.skip(22);
        entry.nameLength = reader.uint16();
        const extraDataLength = reader.uint16();
        entry.nameBuffer = stream.read(entry.nameLength);
        stream.skip(extraDataLength);
        this._name = '';
        for (const c of entry.nameBuffer) {
            this._name += String.fromCharCode(c);
        }
        this._stream = stream.stream(entry.compressedSize);
        switch (entry.compressionMethod) {
            case 0: { // Stored
                if (entry.size !== entry.compressedSize) {
                    throw new zip.Error('Invalid compression size.');
                }
                break;
            }
            case 8: {
                // Deflate
                this._stream = new zip.InflaterStream(this._stream, entry.size);
                break;
            }
            default:
                throw new zip.Error('Invalid compression method.');
        }
    }

    get name() {
        return this._name;
    }

    get stream() {
        return this._stream;
    }

    get data() {
        return this.stream.peek();
    }
};

zip.HuffmanTree = class {

    constructor() {
        this.table = new Uint16Array(16);
        this.symbol = new Uint16Array(288);
        zip.HuffmanTree._offsets = zip.HuffmanTree._offsets || new Uint16Array(16);
    }

    build(lengths, offset, count) {
        for (let i = 0; i < 16; ++i) {
            this.table[i] = 0;
        }
        for (let i = 0; i < count; ++i) {
            this.table[lengths[offset + i]]++;
        }
        this.table[0] = 0;
        let sum = 0;
        for (let i = 0; i < 16; i++) {
            zip.HuffmanTree._offsets[i] = sum;
            sum += this.table[i];
        }
        for (let i = 0; i < count; i++) {
            if (lengths[offset + i]) {
                this.symbol[zip.HuffmanTree._offsets[lengths[offset + i]]++] = i;
            }
        }
    }

    static initialize() {
        if (!zip.HuffmanTree.staticLiteralLengthTree) {
            zip.HuffmanTree.staticLiteralLengthTree = new zip.HuffmanTree();
            zip.HuffmanTree.staticLiteralLengthTree.table = new Uint8Array([ 0, 0, 0, 0, 0,  0, 0, 24, 152, 112, 0, 0, 0, 0, 0, 0 ]);
            for (let i = 0; i < 24; ++i) {
                zip.HuffmanTree.staticLiteralLengthTree.symbol[i] = 256 + i;
            }
            for (let i = 0; i < 144; ++i) {
                zip.HuffmanTree.staticLiteralLengthTree.symbol[24 + i] = i;
            }
            for (let i = 0; i < 8; ++i) {
                zip.HuffmanTree.staticLiteralLengthTree.symbol[24 + 144 + i] = 280 + i;
            }
            for (let i = 0; i < 112; ++i) {
                zip.HuffmanTree.staticLiteralLengthTree.symbol[24 + 144 + 8 + i] = 144 + i;
            }
            zip.HuffmanTree.staticDistanceTree = new zip.HuffmanTree();
            zip.HuffmanTree.staticDistanceTree.table = new Uint8Array([ 0, 0, 0, 0, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ]);
            zip.HuffmanTree.staticDistanceTree.symbol = new Uint8Array([ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31 ]);
        }
    }
};

zip.Inflater = class {

    inflateRaw(data) {

        if (typeof process === 'object' && typeof process.versions == 'object' && typeof process.versions.node !== 'undefined') {
            return require('zlib').inflateRawSync(data);
        }
        if (typeof pako !== 'undefined') {
            return pako.inflateRaw(data);
        }

        zip.Inflater.initilize();
        zip.HuffmanTree.initialize();

        const reader = new zip.BitReader(data);
        const output = new zip.Ouptut();

        const literalLengthTree = new zip.HuffmanTree();
        const distanceTree = new zip.HuffmanTree();

        let type;
        do {
            type = reader.bits(3);
            switch (type >>> 1) {
                case 0: // uncompressed block
                    this._inflateUncompressedBlock(reader, output);
                    break;
                case 1: // block with fixed huffman trees
                    this._inflateBlockData(reader, output, zip.HuffmanTree.staticLiteralLengthTree, zip.HuffmanTree.staticDistanceTree);
                    break;
                case 2: // block with dynamic huffman trees
                    this._decodeTrees(reader, literalLengthTree, distanceTree);
                    this._inflateBlockData(reader, output, literalLengthTree, distanceTree);
                    break;
                default:
                    throw new zip.Error('Unknown block type.');
            }
        } while ((type & 1) == 0);

        return output.merge();
    }

    _inflateUncompressedBlock(reader, output) {
        while (reader.data > 8) {
            reader.position--;
            reader.data -= 8;
        }
        reader.data = 0;
        const length = reader.uint16();
        const inverseLength = reader.uint16();
        if (length !== (~inverseLength & 0x0000ffff)) {
            throw new zip.Error('Invalid uncompressed block length.');
        }

        const block = reader.read(length);
        output.push(block);

        if (length > 32768) {
            output.buffer.set(block.subarray(block.length - 32768, block.length), 0);
            output.position = 32768;
        }
        else {
            output.reset();
            output.buffer.set(block, output.position);
            output.position += block.length;
        }
    }

    _decodeTrees(reader, lengthTree, distanceTree) {

        const hlit = reader.bits(5) + 257;
        const hdist = reader.bits(5) + 1;
        const lengthCount = reader.bits(4) + 4;
        for (let i = 0; i < 19; i++) {
            zip.Inflater._lengths[i] = 0;
        }
        for (let j = 0; j < lengthCount; j++) {
            zip.Inflater._lengths[zip.Inflater._codeOrder[j]] = reader.bits(3);
        }
        zip.Inflater._codeTree.build(zip.Inflater._lengths, 0, 19);
        let length;
        for (let position = 0; position < hlit + hdist;) {
            const symbol = reader.symbol(zip.Inflater._codeTree);
            switch (symbol) {
                case 16: {
                    const prev = zip.Inflater._lengths[position - 1];
                    for (length = reader.bits(2) + 3; length; length--) {
                        zip.Inflater._lengths[position++] = prev;
                    }
                    break;
                }
                case 17: {
                    for (length = reader.bits(3) + 3; length; length--) {
                        zip.Inflater._lengths[position++] = 0;
                    }
                    break;
                }
                case 18: {
                    for (length = reader.bits(7) + 11; length; length--) {
                        zip.Inflater._lengths[position++] = 0;
                    }
                    break;
                }
                default: {
                    zip.Inflater._lengths[position++] = symbol;
                    break;
                }
            }
        }
        lengthTree.build(zip.Inflater._lengths, 0, hlit);
        distanceTree.build(zip.Inflater._lengths, hlit, hdist);
    }

    _inflateBlockData(reader, output, lengthTree, distanceTree) {
        const buffer = output.buffer;
        let position = output.position;
        let start = position;
        for (;;) {
            if (position > 62464) {
                output.position = position;
                output.push(new Uint8Array(buffer.subarray(start, position)));
                position = output.reset();
                start = position;
            }
            let symbol = reader.symbol(lengthTree);
            if (symbol === 256) {
                output.position = position;
                output.push(new Uint8Array(buffer.subarray(start, output.position)));
                output.reset();
                return;
            }
            if (symbol < 256) {
                buffer[position++] = symbol;
            }
            else {
                symbol -= 257;
                const length = reader.bitsBase(zip.Inflater._lengthBits[symbol], zip.Inflater._lengthBase[symbol]);
                const distance = reader.symbol(distanceTree);
                let offset = position - reader.bitsBase(zip.Inflater._distanceBits[distance], zip.Inflater._distanceBase[distance]);
                for (let i = 0; i < length; i++) {
                    buffer[position++] = buffer[offset++];
                }
            }
        }
    }

    static initilize() {
        if (zip.HuffmanTree.staticLiteralLengthTree) {
            return;
        }
        zip.Inflater._codeOrder = [ 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 ];
        zip.Inflater._codeTree = new zip.HuffmanTree();
        zip.Inflater._lengths = new Uint8Array(288 + 32);
        zip.Inflater._lengthBits = [ 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 6 ];
        zip.Inflater._lengthBase = [ 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 323 ];
        zip.Inflater._distanceBits = [ 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 ];
        zip.Inflater._distanceBase = [ 1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577 ];
    }

};

zip.Ouptut = class {

    constructor() {
        this._blocks = [];
        this.buffer = new Uint8Array(65536);
        this.position = 0;
    }

    reset() {
        if (this.position > 32768) {
            this.buffer.set(this.buffer.subarray(this.position - 32768, this.position), 0);
            this.position = 32768;
        }
        return this.position;
    }

    push(block) {
        this._blocks.push(block);
    }

    merge() {
        let size = 0;
        for (const block1 of this._blocks) {
            size += block1.length;
        }
        const output = new Uint8Array(size);
        let offset = 0;
        for (const block2 of this._blocks) {
            output.set(block2, offset);
            offset += block2.length;
        }
        return output;
    }

};

zip.BitReader = class {

    constructor(buffer) {
        this.buffer = buffer;
        this.position = 0;
        this.data = 0;
        this.value = 0;
    }

    bits(count) {
        while (this.data < 24) {
            this.value |= this.buffer[this.position++] << this.data;
            this.data += 8;
        }
        const value = this.value & (0xffff >>> (16 - count));
        this.value >>>= count;
        this.data -= count;
        return value;
    }

    bitsBase(count, base) {
        if (count == 0) {
            return base;
        }
        while (this.data < 24) {
            this.value |= this.buffer[this.position++] << this.data;
            this.data += 8;
        }
        const value = this.value & (0xffff >>> (16 - count));
        this.value >>>= count;
        this.data -= count;
        return value + base;
    }

    read(size) {
        const value = this.buffer.subarray(this.position, this.position + size);
        this.position += size;
        return value;
    }

    uint16() {
        const value = this.buffer[this.position] | (this.buffer[this.position + 1] << 8);
        this.position += 2;
        return value;
    }

    symbol(tree) {
        while (this.data < 24) {
            this.value |= this.buffer[this.position++] << this.data;
            this.data += 8;
        }
        let sum = 0;
        let current = 0;
        let length = 0;
        let value = this.value;
        const table = tree.table;
        do {
            current = (current << 1) + (value & 1);
            value >>>= 1;
            length++;
            sum += table[length];
            current -= table[length];
        } while (current >= 0);
        this.value = value;
        this.data -= length;
        return tree.symbol[sum + current];
    }
};

zip.InflaterStream = class {

    constructor(stream, length) {
        this._stream = stream;
        this._position = 0;
        this._length = length;
    }

    get position() {
        return this._position;
    }

    get length() {
        return this._length;
    }

    seek(position) {
        if (this._buffer === undefined) {
            this._inflate();
        }
        this._position = position >= 0 ? position : this._length + position;
    }

    skip(offset) {
        if (this._buffer === undefined) {
            this._inflate();
        }
        this._position += offset;
    }

    peek(length) {
        const position = this._position;
        length = length !== undefined ? length : this._length - position;
        this.skip(length);
        const end = this._position;
        this.seek(position);
        if (position === 0 && length === this._length) {
            return this._buffer;
        }
        return this._buffer.subarray(position, end);
    }

    read(length) {
        const position = this._position;
        length = length !== undefined ? length : this._length - position;
        this.skip(length);
        if (position === 0 && length === this._length) {
            return this._buffer;
        }
        return this._buffer.subarray(position, this._position);
    }

    byte() {
        const position = this._position;
        this.skip(1);
        return this._buffer[position];
    }

    _inflate() {
        if (this._buffer === undefined) {
            const compressed = this._stream.peek();
            this._buffer = new zip.Inflater().inflateRaw(compressed);
            if (this._length != this._buffer.length) {
                throw new zip.Error('Invalid uncompressed size.');
            }
            delete this._stream;
        }
    }
};

zip.BinaryReader = class {

    constructor(buffer) {
        this._buffer = buffer;
        this._length = buffer.length;
        this._position = 0;
        this._view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    get position() {
        return this._position;
    }

    get length() {
        return this._length;
    }

    create(buffer) {
        return new zip.BinaryReader(buffer);
    }

    stream(length) {
        return this.create(this.read(length));
    }

    seek(position) {
        this._position = position >= 0 ? position : this._length + position;
    }

    skip(offset) {
        this._position += offset;
    }

    peek(length) {
        if (this._position === 0 && length === undefined) {
            return this._buffer;
        }
        const position = this._position;
        this.skip(length !== undefined ? length : this._length - this._position);
        const end = this._position;
        this.seek(position);
        return this._buffer.subarray(position, end);
    }

    read(length) {
        if (this._position === 0 && length === undefined) {
            this._position = this._length;
            return this._buffer;
        }
        const position = this._position;
        this.skip(length !== undefined ? length : this._length - this._position);
        return this._buffer.subarray(position, this._position);
    }

    byte() {
        const position = this._position;
        this.skip(1);
        return this._buffer[position];
    }

    uint16() {
        const position = this._position;
        this.skip(2);
        return this._view.getUint16(position, true);
    }

    uint32() {
        const position = this._position;
        this.skip(4);
        return this._view.getUint32(position, true);
    }
};

zip.Error = class extends Error {
    constructor(message) {
        super(message);
        this.name = 'Zip Error';
    }
};

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports.Archive = zip.Archive;
    module.exports.Inflater = zip.Inflater;
}