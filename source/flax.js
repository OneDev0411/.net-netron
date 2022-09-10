
// Experimental

var flax = flax || {};
var python = python || require('./python');

flax.ModelFactory = class {

    match(context) {
        const stream = context.stream;
        if (stream.length > 4) {
            const code = stream.peek(1)[0];
            if (code === 0xDE || code === 0xDF || ((code & 0x80) === 0x80)) {
                return 'msgpack.map';
            }
        }
        return '';
    }

    open(context) {
        return context.require('./msgpack').then((msgpack) => {
            const stream = context.stream;
            const buffer = stream.peek();
            const execution = new python.Execution(null);
            const reader = msgpack.BinaryReader.open(buffer, (code, data) => {
                switch (code) {
                    case 1: { // _MsgpackExtType.ndarray
                        const reader = msgpack.BinaryReader.open(data);
                        const tuple = reader.read();
                        const dtype = execution.invoke('numpy.dtype', [ tuple[1] ]);
                        dtype.byteorder = '<';
                        return execution.invoke('numpy.ndarray', [ tuple[0], dtype, tuple[2] ]);
                    }
                    default: {
                        throw new flax.Error("Unsupported MessagePack extension '" + code + "'.");
                    }
                }
            });
            const obj = reader.read();
            return new flax.Model(obj);
        });
    }
};

flax.Model = class {

    constructor(obj) {
        this._graphs = [ new flax.Graph(obj) ];
    }

    get format() {
        return 'Flax';
    }

    get graphs() {
        return this._graphs;
    }
};

flax.Graph = class {

    constructor(obj) {
        const layers = new Map();
        const flatten = (path, obj) => {
            if (Object.entries(obj).every((entry) => entry[1].__class__ && entry[1].__class__.__module__ === 'numpy' && entry[1].__class__.__name__ === 'ndarray')) {
                layers.set(path.join('.'), obj);
            }
            else {
                for (const pair of Object.entries(obj)) {
                    flatten(path.concat(pair[0]), pair[1]);
                }
            }
        };
        flatten([], obj);
        this._nodes = Array.from(layers).map((entry) => new flax.Node(entry[0], entry[1]));
    }

    get inputs() {
        return [];
    }

    get outputs() {
        return [];
    }

    get nodes() {
        return this._nodes;
    }
};

flax.Parameter = class {

    constructor(name, args) {
        this._name = name;
        this._arguments = args;
    }

    get name() {
        return this._name;
    }

    get visible() {
        return true;
    }

    get arguments() {
        return this._arguments;
    }
};

flax.Argument = class {

    constructor(name, initializer) {
        if (typeof name !== 'string') {
            throw new flax.Error("Invalid argument identifier '" + JSON.stringify(name) + "'.");
        }
        this._name = name;
        this._initializer = initializer || null;
    }

    get name() {
        return this._name;
    }

    get type() {
        return this._initializer.type;
    }

    get initializer() {
        return this._initializer;
    }
};

flax.Node = class {

    constructor(name, weights) {
        this._name = name;
        this._type = { name: 'Module' };
        this._inputs = [];
        for (const entry of Object.entries(weights)) {
            const name = entry[0];
            const tensor = new flax.Tensor(entry[1]);
            const argument = new flax.Argument(this._name + '.' + name, tensor);
            const parameter = new flax.Parameter(name, [ argument ]);
            this._inputs.push(parameter);
        }
    }

    get type() {
        return this._type;
    }

    get name() {
        return this._name;
    }

    get inputs() {
        return this._inputs;
    }

    get outputs() {
        return [];
    }

    get attributes() {
        return [];
    }
};

flax.TensorType = class {

    constructor(dataType, shape) {
        this._dataType = dataType;
        this._shape = shape;
    }

    get dataType() {
        return this._dataType || '?';
    }

    get shape() {
        return this._shape;
    }

    toString() {
        return this.dataType + this._shape.toString();
    }
};

flax.TensorShape = class {

    constructor(dimensions) {
        this._dimensions = dimensions;
    }

    get dimensions() {
        return this._dimensions;
    }

    toString() {
        if (!this._dimensions || this._dimensions.length == 0) {
            return '';
        }
        return '[' + this._dimensions.join(',') + ']';
    }
};

flax.Tensor = class {

    constructor(array) {
        this._type = new flax.TensorType(array.dtype.__name__, new flax.TensorShape(array.shape));
        this._data = array.tobytes();
        this._byteorder = array.dtype.byteorder;
        this._itemsize = array.dtype.itemsize;
    }

    get type() {
        return this._type;
    }

    get layout() {
        switch (this._type.dataType) {
            case 'string':
            case 'object':
                return '|';
            default:
                return this._byteorder;
        }
    }

    get values() {
        switch (this._type.dataType) {
            case 'string': {
                if (this._data instanceof Uint8Array) {
                    const data = this._data;
                    const decoder = new TextDecoder('utf-8');
                    const size = this._type.shape.dimensions.reduce((a, b) => a * b, 1);
                    this._data = new Array(size);
                    let offset = 0;
                    for (let i = 0; i < size; i++) {
                        const buffer = data.subarray(offset, offset + this._itemsize);
                        const index = buffer.indexOf(0);
                        this._data[i] = decoder.decode(index >= 0 ? buffer.subarray(0, index) : buffer);
                        offset += this._itemsize;
                    }
                }
                return this._data;
            }
            case 'object': {
                return this._data;
            }
            default:
                return this._data;
        }
    }
};

flax.Error = class extends Error {

    constructor(message) {
        super(message);
        this.name = 'Error loading Flax model.';
    }
};

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports.ModelFactory = flax.ModelFactory;
}


