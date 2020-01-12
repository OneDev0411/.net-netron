/* jshint esversion: 6 */
/* eslint "indent": [ "error", 4, { "SwitchCase": 1 } ] */

var keras = keras || {};
var base = base || require('./base');
var marked = marked || require('marked');

keras.ModelFactory = class {

    match(context) {
        const identifier = context.identifier;
        const extension = identifier.split('.').pop().toLowerCase();
        if (extension === 'h5' || extension === 'hd5' || extension === 'hdf5' || extension === 'keras' || extension === 'model') {
            const buffer = context.buffer;
            const signature = [ 0x89, 0x48, 0x44, 0x46, 0x0D, 0x0A, 0x1A, 0x0A ];
            return (buffer && buffer.length > signature.length && signature.every((v, i) => v === buffer[i]));
        }
        if (extension == 'json' && !identifier.endsWith('-symbol.json')) {
            const json = context.text;
            if (json.indexOf('"mxnet_version":', 0) == -1) {
                try {
                    let root = JSON.parse(json);
                    if (root && root.nodes && root.arg_nodes && root.heads) {
                        return false;
                    }
                    if (root && root.modelTopology) {
                        root = root.modelTopology;
                    }
                    if (root && root.model_config) {
                        root = root.model_config;
                    }
                    if (root && root.class_name) {
                        return true;
                    }
                }
                catch (err) {
                    // continue regardless of error
                }
            }
        }
        return false;
    }

    open(context, host) {
        return host.require('./hdf5').then((hdf5) => {
            let format = 'Keras';
            let producer = '';
            let version = '';
            let backend = '';
            let model_config = null;
            let rootGroup = null;
            let weightsManifest = null;
            const identifier = context.identifier;
            try {
                switch (identifier.split('.').pop().toLowerCase()) {
                    case 'keras':
                    case 'h5':
                    case 'hd5':
                    case 'hdf5':
                    case 'model': {
                        const file = new hdf5.File(context.buffer);
                        rootGroup = file.rootGroup;
                        if (!rootGroup.attribute('model_config') && !rootGroup.attribute('layer_names')) {
                            throw new keras.Error("File format is not Keras HDF5.");
                        }
                        if (rootGroup.attribute('model_config')) {
                            model_config = JSON.parse(rootGroup.attribute('model_config'));
                        }
                        backend = rootGroup.attribute('backend') || '';
                        version = rootGroup.attribute('keras_version') || '';
                        format = format + (version ? (' v' + version) : '');
                        break;
                    }
                    case 'json': {
                        model_config = JSON.parse(context.text);
                        if (model_config.keras_version) {
                            version = model_config.keras_version;
                            format = format + (version ? (' v' + version) : '');
                        }
                        if (model_config.backend) {
                            backend = model_config.backend;
                        }
                        if (model_config && model_config.modelTopology) {
                            weightsManifest = model_config.weightsManifest || null;
                            backend = model_config.modelTopology.backend;
                            version = model_config.modelTopology.keras_version;
                            format = format + (version ? (' v' + version) : '');
                            format = 'TensorFlow.js ' + (model_config.format ? model_config.format : format);
                            producer = model_config.convertedBy || model_config.generatedBy || '';
                            model_config = model_config.modelTopology;
                        }
                        if (model_config.model_config) {
                            model_config = model_config.model_config;
                        }
                        break;
                    }
                }
            }
            catch (error) {
                let message = error && error.message ? error.message : error.toString();
                message = message.endsWith('.') ? message.substring(0, message.length - 1) : message;
                throw new keras.Error(message + " in '" + identifier + "'.");
            }

            if (!rootGroup && !model_config) {
                throw new keras.Error('\'model_config\' is not present.');
            }
            if (!rootGroup && !model_config.class_name) {
                throw new keras.Error('\'class_name\' is not present.');
            }
    
            return keras.Metadata.open(host).then((metadata) => {
                try {
                    return new keras.Model(metadata, format, producer, backend, model_config, rootGroup, weightsManifest);
                }
                catch (error) {
                    host.exception(error, false);
                    let message = error && error.message ? error.message : error.toString();
                    message = message.endsWith('.') ? message.substring(0, message.length - 1) : message;
                    throw new keras.Error(message + " in '" + identifier + "'.");
                }
            });
        });
    }
};

keras.Model = class {

    constructor(metadata, format, producer, backend, model_config, rootGroup, weightsManifest) {
        this._format = format;
        this._backend = backend;
        this._producer = producer;
        this._graphs = [];

        let weights = {};
        if (rootGroup) {
            let model_weights_group = rootGroup.group('model_weights');
            if (!model_weights_group && rootGroup.attribute('layer_names')) {
                model_weights_group = rootGroup;
            }
            if (model_weights_group) {
                model_weights_group = new keras.Group(model_weights_group);
                let layer_names = model_weights_group.attribute('layer_names');
                let layer_names_map = new Set();
                for (const layer_name of layer_names) {
                    layer_names_map.add(layer_name);
                }
                for (const layer_name of layer_names) {
                    let layer_weights = model_weights_group.group(layer_name);
                    if (layer_weights) {
                        let weight_names = layer_weights.attribute('weight_names');
                        if (layer_weights && weight_names && weight_names.length > 0) {
                            for (let weight_name of weight_names) {
                                let group = layer_weights.group(weight_name);
                                if (group) {
                                    let variable = group.value;
                                    if (variable) {
                                        if (model_config) {
                                            let initializer = new keras.Tensor(weight_name, variable.type, variable.shape, variable.littleEndian, variable.data, '');
                                            let parts = weight_name.split('/');
                                            parts.pop();
                                            let match = false;
                                            while (parts.length > 0) {
                                                let name = parts.join('/');
                                                if (layer_names_map.has(name)) {
                                                    match = true;
                                                }
                                                weights[name] = weights[name] || [];
                                                weights[name].push(initializer);
                                                parts.shift();
                                            }
                                            if (!match) {
                                                weights[layer_name] = weights[layer_name] || [];
                                                weights[layer_name].push(initializer);
                                            }
                                        }
                                        else {
                                            if (!weight_name.startsWith(layer_name + '/')) {
                                                weight_name = layer_name + '/' + weight_name; 
                                            }
                                            let initializer = new keras.Tensor(weight_name, variable.type, variable.shape, variable.littleEndian, variable.data, '');
                                            let parts = weight_name.split('/');
                                            parts.pop();
                                            let name = parts.join('/');
                                            weights[name] = weights[name] || [];
                                            weights[name].push(initializer);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        else if (weightsManifest) {
            for (const manifest of weightsManifest) {
                for (const weight of manifest.weights) {
                    let p = weight.name.split('/');
                    p.pop();
                    let initializer = new keras.Tensor(weight.name, weight.dtype, weight.shape, false, null, manifest.paths.join(';'));
                    while (p.length > 0) {
                        let weightName = p.join('/');
                        weights[weightName] = weights[weightName] || [];
                        weights[weightName].push(initializer);
                        p.shift();
                    }
                }
            }
        }
        
        this._activeGraph = new keras.Graph(metadata, model_config, weights);
        this._graphs.push(this._activeGraph);
    }

    get name() {
        return null;
    }

    get description() {
        return null;
    }

    get format() {
        return this._format;
    }

    get producer() {
        return this._producer;
    }

    get runtime() {
        return this._backend;
    }

    get graphs() {
        return this._graphs;
    }
};

keras.Graph = class {

    constructor(metadata, model, weights) {
        this._metadata = metadata;
        this._inputs = [];
        this._outputs = [];
        this._nodes = [];
        this._groups = false;

        if (model) {
            this._name = model.name || (model.config && model.config.name ? model.config.name : '');
            switch (model.class_name) {
                case 'AllCNN':
                case 'Sequential':
                    this._loadSequential(model.config, weights, '', null, null);
                    break;
                case 'Model':
                    this._loadModel(model.config, weights, '', null, null);
                    break;
                default:
                    throw new keras.Error('\'' + model.class_name + '\' is not supported.');
            }
        }
        else if (weights) {
            for (const layer of Object.keys(weights)) {
                if (weights[layer].length <= 6) {
                    const node = new keras.Node(metadata, 'Weights', { name: layer }, [], [], false, weights);
                    this._nodes.push(node)
                }
            }
        }
    }

    get name() {
        return this._name;
    }

    get groups() {
        return this._groups ? true : false;
    }

    get inputs() {
        return this._inputs;
    }

    get outputs() {
        return this._outputs;
    }

    get nodes() {
        return this._nodes;
    }

    _loadModel(config, weights, group, inputs, outputs) {
        if (group) {
            this._groups = true;
        }
        let nodeMap = new Map();
        if (config.layers) {
            for (const layer of config.layers) {
                if (layer.name) {
                    if (!nodeMap.has(layer.name)) {
                        nodeMap.set(layer.name, layer);
                        layer._inputs = [];
                        layer._outputs = [];
                    }
                }
            }
            for (const layer of config.layers) {
                if (layer.inbound_nodes) {
                    for (const inbound_node of layer.inbound_nodes) {
                        for (const inbound_connection of inbound_node) {
                            let inputName = inbound_connection[0];
                            let inputNode = nodeMap.get(inputName);
                            if (inputNode) {
                                let inputIndex = inbound_connection[2];
                                if (inputIndex != 0) {
                                    inputName += ':' + inputIndex.toString();
                                }
                                while (inputIndex >= inputNode._outputs.length) {
                                    inputNode._outputs.push('');
                                }
                                inputNode._outputs[inputIndex] = inputName;
                            }
                            layer._inputs.push(inputName);
                        }
                    }
                }
            }
        }
        let input_layers = config.input_layers;
        if (input_layers) {
            for (let i = 0; i < input_layers.length; i++) {
                let input_layer = input_layers[i];
                let name = input_layer[0];
                let type = null;
                let node = nodeMap.get(name);
                if (node && node.class_name == 'InputLayer') {
                    type = this._getInputType(node);
                    nodeMap.delete(name);
                }
                if (inputs && i < inputs.length) {
                    if (config.layers) {
                        for (const layer of config.layers) {
                            if (layer._inputs) {
                                layer._inputs = layer._inputs.map((input) => {
                                    return input === name ? inputs[i] : input;
                                });
                            }
                        }
                    }
                }
                else {
                    this._inputs.push(new keras.Parameter(name, true, [ new keras.Argument(name, type, null) ])); 
                }
            }
        }
        let inputMap = new Map();
        let output_layers = config.output_layers;
        if (output_layers) {
            for (let j = 0; j < output_layers.length; j++) {
                let output_layer = output_layers[j];
                let outputName = output_layer[0];
                let outputNode = nodeMap.get(outputName);
                let addGraphOutput = true;
                if (outputs && j < outputs.length) {
                    inputMap.set(outputName, outputs[j]);
                    outputName = outputs[j];
                    addGraphOutput = false;
                }
                if (outputNode) {
                    let outputIndex = output_layer[2];
                    if (outputIndex != 0) {
                        outputName += ':' + outputIndex.toString();
                    }
                    while (outputIndex >= outputNode._outputs.length) {
                        outputNode._outputs.push('');
                    }
                    outputNode._outputs[outputIndex] = outputName;
                }
                if (addGraphOutput) {
                    this._outputs.push(new keras.Parameter(outputName, true, [ new keras.Argument(outputName, null, null) ]));
                }
            }
        }

        if (config.layers) {
            for (const layer of config.layers) {
                if (nodeMap.has(layer.name)) {
                    this._loadNode(layer, layer._inputs, layer._outputs, weights, group, inputMap);
                }
            }
        }
    }

    _loadSequential(config, weights, group, inputs, outputs) {
        if (group) {
            this._groups = true;
        }
        let inputName = 'input';
        let inputType = null;
        let argument = inputName;
        let index = 0;
        let layers = config.layers ? config.layers : config;

        for (const layer of layers) {
            let name = index.toString();
            let nodeInputs = [ argument ];
            if (index == 0) {
                if (inputs && inputs.length > 0) {
                    nodeInputs = [ inputs[0] ];
                }
                else {
                    inputType = this._getInputType(layer);
                }
            }
            index++;
            if (layer.config && layer.config.name) {
                name = layer.config.name;
            }
            argument = name;
            let nodeOutputs = [ argument ];
            if (index == layers.length) {
                if (outputs && outputs.length > 0) {
                    nodeOutputs = [ outputs[0] ];
                    argument = null;
                }
            }

            this._loadNode(layer, nodeInputs, nodeOutputs, weights, group);
        }
        if (!inputs) {
            this._inputs.push(new keras.Parameter(inputName, true, [ new keras.Argument(inputName, inputType, null) ]));
        }
        if (argument) {
            this._outputs.push(new keras.Parameter(argument, true, [ new keras.Argument(argument, null, null) ]));
        }
    }

    _loadNode(layer, inputs, outputs, weights, group, inputMap) {
        let class_name = layer.class_name;
        switch (class_name) {
            case 'Sequential': {
                this._loadSequential(layer.config, weights, layer.name, inputs, outputs);
                break;
            }
            case 'Model': {
                this._loadModel(layer.config, weights, layer.name, inputs, outputs);
                break;
            }
            default: {
                inputs = inputs.map((input) => inputMap && inputMap.has(input) ? inputMap.get(input) : input);
                const node = new keras.Node(this._metadata, class_name, layer.config, inputs, outputs, group, weights);
                this._nodes.push(node);
                break;
            }
        }
    }

    _getInputType(layer) {
        if (layer && layer.config) {
            let dataType = '?';
            let shape = [];
            let config = layer.config;
            if (config.dtype) {
                dataType = config.dtype;
                delete config.dtype;
            }
            if (config.batch_input_shape) {
                shape = config.batch_input_shape.map(s => s == null ? '?' : s);
                delete config.batch_input_shape;
            }
            return new keras.TensorType(dataType, new keras.TensorShape(shape));
        }
        return null;
    }
};

keras.Parameter = class {

    constructor(name, visible, args) {
        this._name = name;
        this._visible = visible;
        this._arguments = args;
    }

    get name() {
        return this._name;
    }

    get visible() {
        return this._visible;
    }

    get arguments() {
        return this._arguments;
    }
};

keras.Argument = class {

    constructor(id, type, initializer) {
        this._id = id;
        this._type = type || null;
        this._initializer = initializer || null;
    }

    get id() {
        return this._id;
    }

    get type() {
        if (this._initializer) {
            return this._initializer.type;
        }
        return this._type;
    }

    get initializer() {
        return this._initializer;
    }
};

keras.Node = class {

    constructor(metadata, operator, config, inputs, outputs, group, weights) {
        if (group) {
            this._group = group;
        }
        this._metadata = metadata;
        this._operator = operator;
        this._name = (config && config.name) ? config.name : '';
        this._inputs = [];
        this._outputs = [];
        this._attributes = [];

        let names = [ this._name ];
        if ((operator == 'Bidirectional' || operator == 'TimeDistributed') && (config && config.layer)) {
            let inner = config.layer;
            delete config.layer;
            this._inner = new keras.Node(this._metadata, inner.class_name, inner.config, [], [], null, null);
            if (operator == 'Bidirectional' && inner.config.name) {
                names = [ this._name + '/forward_' + inner.config.name, this._name + '/backward_' + inner.config.name ];
            }
        }

        let initializers = {};
        if (weights) {
            for (const name of names) {
                if (weights[name]) {
                    for (const initializer of weights[name]) {
                        inputs.push(initializer.name);
                        initializers[initializer.name] = initializer;
                    }
                }
            }
        }

        if (config) {
            for (const attributeName of Object.keys(config)) {
                const attributeValue = config[attributeName];
                if (attributeName != 'name' && attributeValue != null) {
                    this._attributes.push(new keras.Attribute(this._metadata, this.operator, attributeName, attributeValue));
                }
            }
        }

        const schema = this._metadata.getSchema(this.operator);
        let innerOperator = this.inner ? this.inner.operator : null;
        let innerSchema = innerOperator ? this._metadata.getSchema(innerOperator) : null;
        let inputIndex = 0;
        while (inputs.length > 0) {
            let variadic = false;
            let inputName = null;
            let visible = true;
            if (!innerSchema || inputIndex == 0) {
                if (schema && schema.inputs && inputIndex < schema.inputs.length) {
                    let input = schema.inputs[inputIndex];
                    inputName = input.name;
                    if (operator === 'BatchNormalization' && inputName === 'gamma' && config.scale === false) {
                        inputIndex++;
                        continue;
                    }
                    visible = input.visible == false ? false : true; 
                    if (schema.inputs[inputIndex].option == 'variadic') {
                        variadic = true;
                    }
                }
            }
            else {
                switch (operator) {
                    case 'Bidirectional': {
                        let innerIndex = inputIndex;
                        if (innerSchema && innerSchema.inputs) {
                            if (innerIndex < innerSchema.inputs.length) {
                                inputName = 'forward_' + innerSchema.inputs[innerIndex].name;
                            }
                            else {
                                innerIndex = innerIndex - innerSchema.inputs.length + 1;
                                if (innerIndex < innerSchema.inputs.length) {
                                    inputName = 'backward_' + innerSchema.inputs[innerIndex].name;
                                }
                            }
                        }
                        visible = false;
                        break;
                    }
                    case 'TimeDistributed':
                        if (innerSchema && innerSchema.inputs && inputIndex < innerSchema.inputs.length) {
                            inputName = innerSchema.inputs[inputIndex].name;
                        }
                        break;
                }
            }
            const input = !variadic ? [ inputs.shift() ] : inputs.slice(0, inputs.length);
            const inputArguments = input.map((id) => {
                return new keras.Argument(id, null, initializers[id]);
            });
            if (!inputName && inputArguments.length == 1 && inputArguments[0].initializer && inputArguments[0].initializer.name) {
                const parts = inputArguments[0].initializer.name.split('/').pop().split(':').shift().split('_');
                const inputName1 = parts.pop();
                const inputName2 = parts.length > 0 ? [ parts.pop(), inputName1 ].join('_') : '';
                const inputNames = new Set([ 'recurrent_kernel', 'running_mean', 'running_std', 'moving_mean', 'moving_variance' ]);
                inputName = inputNames.has(inputName2) ? inputName2 : inputName1;
            }
            this._inputs.push(new keras.Parameter(inputName || inputIndex.toString(), visible, inputArguments));
            inputIndex++;
        }

        this._outputs = outputs.map((output, outputIndex) => {
            const outputName = 
                (schema && schema.outputs && outputIndex < schema.outputs.length && schema.outputs[outputIndex] && schema.outputs[outputIndex].name) ?
                    schema.outputs[outputIndex].name :
                    outputIndex.toString();
            return new keras.Parameter(outputName, true, [ new keras.Argument(output, null, null) ]);
        });
    }

    get operator() {
        return this._operator;
    }

    get name() {
        return this._name;
    }

    get group() {
        return this._group ? this._group : '';
    }

    get category() {
        const schema = this._metadata.getSchema(this._operator);
        return (schema && schema.category) ? schema.category : '';
    }

    get documentation() {
        let schema = this._metadata.getSchema(this._operator);
        if (schema) {
            schema = JSON.parse(JSON.stringify(schema));
            schema.name = this._operator;
            if (schema.description) {
                schema.description = marked(schema.description);
            }
            if (schema.attributes) {
                for (const attribute of schema.attributes) {
                    if (attribute.description) {
                        attribute.description = marked(attribute.description);
                    }
                }
            }
            if (schema.inputs) {
                for (const input of schema.inputs) {
                    if (input.description) {
                        input.description = marked(input.description);
                    }
                }
            }
            if (schema.outputs) {
                for (const output of schema.outputs) {
                    if (output.description) {
                        output.description = marked(output.description);
                    }
                }
            }
            if (schema.references) {
                for (const reference of schema.references) {
                    if (reference) {
                        reference.description = marked(reference.description);
                    }
                }
            }
            return schema;
        }
        return '';
    }

    get inputs() {
        return this._inputs;
    }

    get outputs() {
        return this._outputs;
    }

    get attributes() {
        return this._attributes;
    }

    get inner() {
        return this._inner;
    }
};

keras.Attribute = class {

    constructor(metadata, operator, name, value) {
        this._name = name;
        this._value = value;

        if (typeof value == 'object' && value.class_name && value.config) {
            this._value = keras.Attribute._convert(value);
        }

        switch (name) {
            case 'trainable':
                this._type = 'boolean';
                this._visible = false;
                break;
            case 'dtype':
                this._visible = false;
                break;
            default:
                var schema = metadata.getAttributeSchema(operator, this._name);
                if (schema) {
                    if (schema.type) {
                        this._type = schema.type;
                    }
                    if (Object.prototype.hasOwnProperty.call(schema, 'visible') && !schema.visible) {
                        this._visible = false;
                    }
                    else if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
                        if (keras.Attribute._isEquivalent(schema.default, value)) {
                            this._visible = false;
                        }
                    }
                }
                break;
        }
    }

    get name() {
        return this._name;
    }

    get type() {
        return this._type;
    }

    get value() {
        return this._value;
    }

    get visible() {
        return this._visible == false ? false : true;
    }

    static _convert(value) {
        if (Array.isArray(value) || value !== Object(value)) {
            return value;
        }
        let obj = {};
        if (value.class_name) {
            obj.__type__ = value.class_name;
        }
        for (const key of Object.keys(value.config)) {
            obj[key] = keras.Attribute._convert(value.config[key]);
        }
        return obj;
    }

    static _isEquivalent(a, b) {
        if (a === b) {
            return a !== 0 || 1 / a === 1 / b;
        }
        if (a == null || b == null) {
            return false;
        }
        if (a !== a) {
            return b !== b;
        }
        let type = typeof a;
        if (type !== 'function' && type !== 'object' && typeof b != 'object') {
            return false;
        }
        let className = toString.call(a);
        if (className !== toString.call(b)) {
            return false;
        }
        switch (className) {
            case '[object RegExp]':
            case '[object String]':
                return '' + a === '' + b;
            case '[object Number]':
                if (+a !== +a) {
                    return +b !== +b;
                }
                return +a === 0 ? 1 / +a === 1 / b : +a === +b;
            case '[object Date]':
            case '[object Boolean]':
                return +a === +b;
            case '[object Array]': {
                let length = a.length;
                if (length !== b.length) {
                    return false;
                }
                while (length--) {
                    if (!keras.Attribute._isEquivalent(a[length], b[length])) {
                        return false;
                    }
                }
                return true;
            }
        }

        let keys = Object.keys(a);
        let size = keys.length;
        if (Object.keys(b).length != size) {
            return false;
        } 
        while (size--) {
            let key = keys[size];
            if (!(Object.prototype.hasOwnProperty.call(b, key) && keras.Attribute._isEquivalent(a[key], b[key]))) {
                return false;
            }
        }
        return true;
    }
};

keras.Tensor = class {

    constructor(name, type, shape, littleEndian, data, reference) {
        this._name = name;
        this._type = new keras.TensorType(type, new keras.TensorShape(shape));
        this._littleEndian = littleEndian;
        this._data = data;
        this._reference = reference;
    }

    get kind() {
        return 'Weights';
    }

    get name() {
        return this._name;
    }

    get type() {
        return this._type;
    }

    get reference() {
        return this._reference;
    }

    get state() {
        return this._context().state;
    }

    get value() {
        let context = this._context();
        if (context.state) {
            return null;
        }
        context.limit = Number.MAX_SAFE_INTEGER;
        return this._decode(context, 0);
    }

    toString() {
        let context = this._context();
        if (context.state) {
            return '';
        }
        context.limit = 10000;
        let value = this._decode(context, 0);
        return keras.Tensor._stringify(value, '', '    ');
    }

    _context() {
        let context = {};
        context.index = 0;
        context.count = 0;
        context.state = null;
        if (this._reference) { 
            context.state = 'Tensor reference not implemented.';
            return context;
        }
        if (!this._data) {
            context.state = 'Tensor data is empty.';
            return context;
        }
        switch (this._type.dataType) {
            case 'float16':
                context.precision = 16;
                break;
            case 'float32':
                context.precision = 32;
                break;
            case 'float64':
                context.precision = 64;
                break;
            default:
                context.state = 'Tensor data type is not supported.';
                break;
        }
        context.dimensions = this._type.shape.dimensions;
        context.littleEndian = this._littleEndian;
        context.rawData = new DataView(this._data.buffer, this._data.byteOffset, this._data.byteLength);
        return context;
    }

    _decode(context, dimension) {
        let results = [];
        const size = context.dimensions[dimension];
        const littleEndian = context.littleEndian;
        if (dimension == context.dimensions.length - 1) {
            for (let i = 0; i < size; i++) {
                if (context.count > context.limit) {
                    results.push('...');
                    return results;
                }
                if (context.rawData) {
                    switch (context.precision) {
                        case 16:
                            results.push(context.rawData.getFloat16(context.index, littleEndian));
                            context.index += 2;
                            break;
                        case 32:
                            results.push(context.rawData.getFloat32(context.index, littleEndian));
                            context.index += 4;
                            break;
                        case 64:
                            results.push(context.rawData.getFloat64(context.index, littleEndian));
                            context.index += 8;
                            break;
                    }
                    context.count++;
                }
            }
        }
        else {
            for (let j = 0; j < size; j++) {
                if (context.count > context.limit) {
                    results.push('...');
                    return results;
                }
                results.push(this._decode(context, dimension + 1));
            }
        }
        return results;
    }

    static _stringify(value, indentation, indent) {
        if (Array.isArray(value)) {
            let result = [];
            result.push(indentation + '[');
            const items = value.map((item) => keras.Tensor._stringify(item, indentation + indent, indent));
            if (items.length > 0) {
                result.push(items.join(',\n'));
            }
            result.push(indentation + ']');
            return result.join('\n');
        }
        if (typeof value == 'string') {
            return indentation + value;
        }
        if (value == Infinity) {
            return indentation + 'Infinity';
        }
        if (value == -Infinity) {
            return indentation + '-Infinity';
        }
        if (isNaN(value)) {
            return indentation + 'NaN';
        }
        return indentation + value.toString();
    }
};

keras.TensorType = class {

    constructor(dataType, shape) {
        this._dataType = dataType;
        this._shape = shape;
    }

    get dataType() {
        return this._dataType;
    }

    get shape() {
        return this._shape;
    }

    toString() {
        return this._dataType + this._shape.toString();
    }
};

keras.TensorShape = class {

    constructor(dimensions) {
        this._dimensions = dimensions;
    }

    get dimensions() {
        return this._dimensions;
    }

    toString() {
        return this._dimensions ? ('[' + this._dimensions.map((dimension) => dimension.toString()).join(',') + ']') : '';
    }
};

keras.Metadata = class {

    static open(host) {
        if (keras.Metadata._metadata) {
            return Promise.resolve(keras.Metadata._metadata);
        }
        return host.request(null, 'keras-metadata.json', 'utf-8').then((data) => {
            keras.Metadata._metadata = new keras.Metadata(data);
            return keras.Metadata._metadata;
        }).catch(() => {
            keras.Metadata._metadata = new keras.Metadata(null);
            return keras.Metadata._metadatas;
        });
    }

    constructor(data) {
        this._map = {};
        this._attributeCache = {};
        if (data) {
            let items = JSON.parse(data);
            if (items) {
                for (const item of items) {
                    if (item.name && item.schema) {
                        this._map[item.name] = item.schema;
                    }
                }
            }
        }
    }

    getSchema(operator) {
        return this._map[operator] || null;
    }

    getAttributeSchema(operator, name) {
        let map = this._attributeCache[operator];
        if (!map) {
            map = {};
            const schema = this.getSchema(operator);
            if (schema && schema.attributes && schema.attributes.length > 0) {
                for (const attribute of schema.attributes) {
                    map[attribute.name] = attribute;
                }
            }
            this._attributeCache[operator] = map;
        }
        return map[name] || null;
    }
};

keras.Group = class {

    constructor(group) {
        this._group = group;
    }

    attribute(name) {
        let value = this._group.attribute(name);
        if (!value) {
            if (this._group.attribute(name + '0')) {
                let index = 0;
                value = [];
                for (;;) {
                    let chunk = this._group.attribute(name + index.toString());
                    if (!chunk) {
                        break;
                    }
                    value = value.concat(chunk);
                    index++;
                }
            }
        }
        return value;
    }

    group(name) {
        let value = this._group.group(name);
        if (value) {
            return new keras.Group(value);
        }
        return null;
    }

    get value() {
        return this._group.value;
    }
};

keras.Error = class extends Error {

    constructor(message) {
        super(message);
        this.name = 'Error loading Keras model.';
    }
};

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports.ModelFactory = keras.ModelFactory;
}