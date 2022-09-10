
// Experimental

var numpy = numpy || {};
var python = python || require('./python');

numpy.ModelFactory = class {

    match(context) {
        const stream = context.stream;
        const signature = [ 0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59 ];
        if (stream && signature.length <= stream.length && stream.peek(signature.length).every((value, index) => value === signature[index])) {
            return { name: 'npy' };
        }
        const entries = context.entries('zip');
        if (entries.size > 0 && Array.from(entries.keys()).every((name) => name.endsWith('.npy'))) {
            return { name: 'npz', value: entries };
        }
        const obj = context.open('pkl');
        if (obj) {
            if (numpy.Utility.isTensor(obj)) {
                return { name: 'numpy.ndarray', value: obj };
            }
            if (Array.isArray(obj) && obj.every((obj) => obj && obj.__class__ && obj.__class__.__name__ === 'Network' && (obj.__class__.__module__ === 'dnnlib.tflib.network' || obj.__class__.__module__ === 'tfutil'))) {
                return { name: 'dnnlib.tflib.network', value: obj };
            }
            const weights = numpy.Utility.weights(obj);
            if (weights) {
                return { name: 'pickle', value: weights };
            }
        }
        return undefined;
    }

    open(context, match) {
        let format = '';
        const graphs = [];
        switch (match.name) {
            case 'npy': {
                format = 'NumPy Array';
                const execution = new python.Execution(null);
                const stream = context.stream;
                const buffer = stream.peek();
                const bytes = execution.invoke('io.BytesIO', [ buffer ]);
                const array = execution.invoke('numpy.load', [ bytes ]);
                const layer = { type: 'numpy.ndarray', parameters: [ { name: 'value', tensor: { name: '', array: array } } ] };
                graphs.push({ layers: [ layer ] });
                break;
            }
            case 'npz': {
                format = 'NumPy Zip';
                const layers = new Map();
                const execution = new python.Execution(null);
                for (const entry of match.value) {
                    if (!entry[0].endsWith('.npy')) {
                        throw new numpy.Error("Invalid file name '" + entry.name + "'.");
                    }
                    const name = entry[0].replace(/\.npy$/, '');
                    const parts = name.split('/');
                    const parameterName = parts.pop();
                    const groupName = parts.join('/');
                    if (!layers.has(groupName)) {
                        layers.set(groupName, { name: groupName, parameters: [] });
                    }
                    const layer = layers.get(groupName);
                    const stream = entry[1];
                    const buffer = stream.peek();
                    const bytes = execution.invoke('io.BytesIO', [ buffer ]);
                    const array = execution.invoke('numpy.load', [ bytes ]);
                    layer.parameters.push({
                        name: parameterName,
                        tensor: { name: name, array: array }
                    });
                }
                graphs.push({ layers: Array.from(layers.values()) });
                break;
            }
            case 'pickle': {
                format = 'NumPy Weights';
                const layers = new Map();
                const weights = match.value;
                let separator = '.';
                if (Array.from(weights.keys()).filter((key) => key.indexOf('_') !== -1) &&
                    Array.from(weights.keys()).every((key) => key.indexOf('_') > key.indexOf('.'))) {
                    separator = '_';
                }
                for (const pair of weights) {
                    const name = pair[0];
                    const array = pair[1];
                    const parts = name.split(separator);
                    const parameterName = parts.length > 1 ? parts.pop() : '?';
                    const layerName = parts.join(separator);
                    if (!layers.has(layerName)) {
                        layers.set(layerName, { name: layerName, parameters: [] });
                    }
                    const layer = layers.get(layerName);
                    layer.parameters.push({
                        name: parameterName,
                        tensor: { name: name, array: array }
                    });
                }
                graphs.push({ layers: Array.from(layers.values()) });
                break;
            }
            case 'numpy.ndarray': {
                format = 'NumPy NDArray';
                const layer = {
                    type: 'numpy.ndarray',
                    parameters: [ { name: 'value', tensor: { name: '', array: match.value } } ]
                };
                graphs.push({ layers: [ layer ] });
                break;
            }
            case 'dnnlib.tflib.network': {
                format = 'dnnlib';
                for (const obj of match.value) {
                    const layers = new Map();
                    for (const entry of obj.variables) {
                        const name = entry[0];
                        const value = entry[1];
                        if (numpy.Utility.isTensor(value)) {
                            const parts = name.split('/');
                            const parameterName = parts.length > 1 ? parts.pop() : '?';
                            const layerName = parts.join('/');
                            if (!layers.has(layerName)) {
                                layers.set(layerName, { name: layerName, parameters: [] });
                            }
                            const layer = layers.get(layerName);
                            layer.parameters.push({
                                name: parameterName,
                                tensor: { name: name, array: value }
                            });
                        }
                    }
                    graphs.push({ name: obj.name, layers: Array.from(layers.values()) });
                }
                break;
            }
            default: {
                throw new numpy.Error("Unsupported NumPy format '" + match.name + "'.");
            }
        }
        const model = new numpy.Model(format, graphs);
        return Promise.resolve(model);
    }
};

numpy.Model = class {

    constructor(format, graphs) {
        this._format = format;
        this._graphs = graphs.map((graph) => new numpy.Graph(graph));
    }

    get format() {
        return this._format;
    }

    get graphs() {
        return this._graphs;
    }
};

numpy.Graph = class {

    constructor(graph) {
        this._name = graph.name || '';
        this._nodes = graph.layers.map((layer) => new numpy.Node(layer));
    }

    get name() {
        return this._name;
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

numpy.Parameter = class {

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

numpy.Argument = class {

    constructor(name, initializer) {
        if (typeof name !== 'string') {
            throw new numpy.Error("Invalid argument identifier '" + JSON.stringify(name) + "'.");
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

numpy.Node = class {

    constructor(layer) {
        this._name = layer.name || '';
        this._type = { name: layer.type || '{}' };
        this._inputs = [];
        for (const parameter of layer.parameters) {
            const initializer = new numpy.Tensor(parameter.tensor.array);
            this._inputs.push(new numpy.Parameter(parameter.name, [
                new numpy.Argument(parameter.tensor.name || '', initializer)
            ]));
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

numpy.Tensor = class  {

    constructor(array) {
        this._type = new numpy.TensorType(array.dtype.__name__, new numpy.TensorShape(array.shape));
        this._data = array.tobytes();
        this._byteorder = array.dtype.byteorder;
        this._itemsize = array.dtype.itemsize;
    }

    get type(){
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

numpy.TensorType = class {

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

numpy.TensorShape = class {

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

numpy.Utility = class {

    static isTensor(obj) {
        return obj && obj.__class__ &&
            ((obj.__class__.__module__ === 'numpy' && obj.__class__.__name__ === 'ndarray') ||
             (obj.__class__.__module__ === 'numpy.core.memmap' && obj.__class__.__name__ === 'memmap'));
    }

    static weights(obj) {
        const dict = (obj, key) => {
            const dict = key === '' ? obj : obj[key];
            if (dict) {
                const weights = new Map();
                if (dict instanceof Map) {
                    for (const pair of dict) {
                        const key = pair[0];
                        const obj = pair[1];
                        if (numpy.Utility.isTensor(obj)) {
                            weights.set(key, obj);
                            continue;
                        }
                        else if (obj instanceof Map && Array.from(obj).every((pair) => numpy.Utility.isTensor(pair[1]))) {
                            for (const pair of obj) {
                                weights.set(key + '.' + pair[0], pair[1]);
                            }
                            continue;
                        }
                        else if (key === '_metadata') {
                            continue;
                        }
                        return null;
                    }
                    return weights;
                }
                else if (!Array.isArray(dict)) {
                    const set = new Set([ 'weight_order', 'lr', 'model_iter', '__class__' ]);
                    for (const entry of Object.entries(dict)) {
                        const key = entry[0];
                        const value = entry[1];
                        if (key) {
                            if (numpy.Utility.isTensor(value)) {
                                weights.set(key, value);
                                continue;
                            }
                            if (set.has(key)) {
                                continue;
                            }
                            if (value && !Array.isArray(value) && Object.entries(value).every((entry) => numpy.Utility.isTensor(entry[1]))) {
                                const name = key;
                                for (const entry of Object.entries(value)) {
                                    weights.set(name + '.' + entry[0], entry[1]);
                                }
                                continue;
                            }
                        }
                        return null;
                    }
                    return weights;
                }
            }
            return null;
        };
        const list = (obj, key) => {
            const list = key === '' ? obj : obj[key];
            if (list && Array.isArray(list) && list.every((obj) => Object.entries(obj).every((entry) => numpy.Utility.isTensor(entry[1])))) {
                const weights = new Map();
                for (let i = 0; i < list.length; i++) {
                    const obj = list[i];
                    for (const entry of Object.entries(obj)) {
                        weights.set(i.toString() + '.' + entry[0], entry[1]);
                    }
                }
                return weights;
            }
            if (list && Array.isArray(list)) {
                const weights = new Map();
                for (let i = 0; i < list.length; i++) {
                    const obj = list[i];
                    if (numpy.Utility.isTensor(obj)) {
                        weights.set(i.toString(), obj);
                        continue;
                    }
                    else if (obj instanceof Map && Array.from(obj).every((pair) => numpy.Utility.isTensor(pair[1]))) {
                        for (const pair of obj) {
                            weights.set(i.toString() + '.' + pair[0], pair[1]);
                        }
                        continue;
                    }
                    return null;
                }
                return weights;
            }
            return null;
        };
        const keys = [ '', 'blobs', 'model' ];
        for (const key of keys) {
            const weights = dict(obj, key);
            if (weights && weights.size > 0) {
                return weights;
            }
        }
        for (const key of keys) {
            const weights = list(obj, key);
            if (weights) {
                return weights;
            }
        }
        return null;
    }
};

numpy.Error = class extends Error {

    constructor(message) {
        super(message);
        this.name = 'Error loading Chainer model.';
    }
};

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports.ModelFactory = numpy.ModelFactory;
}
