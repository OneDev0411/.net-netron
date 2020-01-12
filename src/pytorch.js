/* jshint esversion: 6 */
/* eslint "indent": [ "error", 4, { "SwitchCase": 1 } ] */

// Experimental

var pytorch = pytorch || {};
var base = base || require('./base');
var long = long || { Long: require('long') };
var marked = marked || require('marked');

pytorch.ModelFactory = class {

    match(context) {
        const identifier = context.identifier; 
        const extension = identifier.split('.').pop().toLowerCase();
        if (extension === 'pth' || extension === 'pkl' || extension === 'pt' || extension === 'bin' ||
            extension === 'h5' || extension === 't7' || extension === 'dms' || extension === 'model' ||
            extension === 'ckpt' || extension == 'pt1' || identifier.toLowerCase().endsWith('.pth.tar')) {
            if (pytorch.ModelFactory._container(context, null, null, null)) {
                return true;
            }
        }
        return false;
    }

    open(context, host) {
        const identifier = context.identifier;
        return host.require('./pickle').then((pickle) => {
            return host.require('./python').then((python) => {
                let container = pytorch.ModelFactory._container(context, pickle, python, (error, fatal) => {
                    let message = error && error.message ? error.message : error.toString();
                    message = message.endsWith('.') ? message.substring(0, message.length - 1) : message;
                    host.exception(new pytorch.Error(message + " in '" + identifier + "'."), fatal);
                });
                return pytorch.Metadata.open(host).then((metadata) => {
                    try {
                        return new pytorch.Model(metadata, container);
                    }
                    catch (error) {
                        host.exception(error, false);
                        let message = error && error.message ? error.message : error.toString();
                        message = message.endsWith('.') ? message.substring(0, message.length - 1) : message;
                        throw new pytorch.Error(message + " in '" + identifier + "'.");
                    }
                });
            });
        });
    }

    static _container(context, pickle, python, exception) {
        const identifier = context.identifier;
        if (context.entries('zip').some((entry) => entry.name === 'model.json' || entry.name === 'data.pkl' || entry.name.endsWith('/model.json') || entry.name.endsWith('/data.pkl'))) {
            return new pytorch.ZipContainer(identifier, context.entries('zip'), pickle, python, exception);
        }
        const buffer = context.buffer;
        const signature = [ 0x8a, 0x0a, 0x6c, 0xfc, 0x9c, 0x46, 0xf9, 0x20, 0x6a, 0xa8, 0x50, 0x19 ];
        if (buffer && buffer.length > 14 && buffer[0] == 0x80 && buffer[1] < 0x05 && signature.every((v, i) => v == buffer[i + 2])) {
            return new pytorch.PickleContainer(identifier, buffer, pickle, exception);
        }
        if (context.entries('tar').some((entry) => entry.name == 'pickle')) {
            return new pytorch.TarContainer(identifier, context.entries('tar'), pickle, exception);
        }
        return null;
    }
};

pytorch.Model = class { 

    constructor(metadata, container) {
        this._format = container.format;
        this._producer = container.producer || '';
        this._graphs = [];
        this._graphs.push(new pytorch.Graph(metadata, container));
    }

    get format() {
        return this._format;
    }

    get graphs() {
        return this._graphs;
    }
};

pytorch.Graph = class {

    constructor(metadata, container) {
        this._metadata = metadata;
        this._nodes = [];
        this._inputs = [];
        this._outputs = [];
        this._groups = true;
        this._littleEndian = container.littleEndian;

        if (container.script) {
            this._name = container.name;
            let traced = container.trace();
            let parameters = {};
            if (container.data) {
                let queue = [ container.data ];
                while (queue.length > 0) {
                    let module = queue.shift();
                    for (const key of Object.keys(module)) {
                        if (key !== '__module__' && key !== '__name__' && key !== '__parent__') {
                            let obj = module[key];
                            if (!Array.isArray(obj) && obj === Object(obj)) {
                                if (pytorch.Utility.isTensor(obj)) {
                                    let parameter = obj;
                                    if (!parameter.initializer) {
                                        parameter.initializer = new pytorch.Tensor(parameter.name, parameter, true);
                                    }
                                    if (parameter.__outputs__ && parameter.__outputs__.length == 1) {
                                        parameters[parameter.__outputs__[0]] = parameter;
                                    }
                                }
                                else if (obj && obj.__module__ && obj.__name__) {
                                    obj.__parent__ = module;
                                    if (!obj.__id__) {
                                        obj.__id__ = key;
                                    }
                                    queue.push(obj);
                                }
                            }
                        }
                    }
                }
            }
    
            if (traced) {
                if (container.inputs) {
                    for (const input of container.inputs) {
                        this._inputs.push(new pytorch.Parameter(input, true, [
                            new pytorch.Argument(input, null, null)
                        ]));
                    }
                }
                if (container.outputs) {
                    for (const output of container.outputs) {
                        this._outputs.push(new pytorch.Parameter(output, true, [
                            new pytorch.Argument(output, null, null)
                        ]));
                    }
                }
                if (container.nodes) {
                    for (const node of container.nodes) {
                        this._nodes.push(new pytorch.ScriptNode(metadata, container, null, node, parameters));
                    }
                }
            }
    
            if (container.data) {
                this._loadScriptModule(metadata, container, container.data, parameters);
            }
        }
        else if (container.data) {
            const data = container.data;
            this._type = (data.__module__ && data.__name__) ? (data.__module__ + '.' + data.__name__) : '';
            const input = 'data';
            this._inputs.push(new pytorch.Parameter(input, true, [ new pytorch.Argument(input, null, null) ]));
            const outputs = this._loadModule(container.data, [], [ input ]);
            for (const output of outputs) {
                this._outputs.push(new pytorch.Parameter(output, true, [ new pytorch.Argument(output, null, null) ]));
            }
        }
        else if (container.state) {
            for (const state_group of container.state) {
                const attributes = state_group.attributes || [];
                const inputs = state_group.states.map((state) => {
                    const tensor = new pytorch.Tensor(state.id, state.value, this._littleEndian);
                    const visible = state_group.states.length === 0 || tensor.type.toString() !== 'int64' || tensor.value < 1000;
                    return new pytorch.Parameter(state.name, visible, [
                        new pytorch.Argument(state.id, null, tensor)
                    ]);
                });
                this._nodes.push(new pytorch.Node(this._metadata, '', state_group.name, 'torch.nn.Module', attributes, inputs, []));
            }
        }
    }

    _loadModule(parent, groups, inputs) {

        if (parent.__module__ &&
            !parent.__module__ === 'torch.nn.modules.container' &&
            (!parent._modules || parent._modules.length == 0)) {
            this._createNode(groups, '', parent, inputs);
            return [];
        }

        if (!parent._modules) {
            throw new pytorch.Error('Module does not contain modules.');
        }

        for (const module of parent._modules) {
            if (module && module.value) {
                const type = module.value.__module__ + '.' + module.value.__name__;
                switch (type) {
                    case 'torch.nn.modules.container.Sequential':
                        groups.push(module.key);
                        inputs = this._loadModule(module.value, groups, inputs);
                        groups.pop(module.key);
                        break;
                    case 'torchvision.models.densenet._Transition':
                    case 'torchvision.models.resnet.Bottleneck':
                    case 'torchvision.models.densenet._DenseBlock':
                    case 'torchvision.models.densenet._DenseLayer':
                    case 'torchvision.models.inception.BasicConv2d':
                    case 'torchvision.models.inception.InceptionAux':
                    case 'torchvision.models.inception.InceptionA':
                    case 'torchvision.models.inception.InceptionB':
                    case 'torchvision.models.inception.InceptionC':
                    case 'torchvision.models.inception.InceptionD':
                    case 'torchvision.models.inception.InceptionE': {
                        groups.push(module.key);
                        const node = this._createNode(groups, module.key, module.value, inputs, this._littleEndian);
                        inputs = [ node.name ];
                        groups.pop(module.key);
                        break; 
                    }
                    default: {
                        const node = this._createNode(groups, module.key, module.value, inputs);
                        inputs = [ node.name ];
                        break;
                    }
                }
            }
        }
        return inputs;
    }

    _createNode(groups, key, obj, args) {

        const type = obj.__module__ + '.' + obj.__name__;
        const schema = this._metadata.getSchema(type);

        let inputSchema = [ { name: 'input'} ];
        if (schema && schema.inputs && schema.inputs.length > 0) {
            inputSchema = schema.inputs.slice();
        }

        let inputs = [];
        inputs.push(new pytorch.Parameter(inputSchema.shift().name, true, args.map((argument) => {
            return new pytorch.Argument(argument, null, null);
        })));

        let parameters = [];
        if (obj._parameters) {
            parameters = parameters.concat(obj._parameters);
        }
        if (obj._buffers) {
            parameters = parameters.concat(obj._buffers);
        }

        for (const parameter of parameters) {
            let visible = true;
            let inputName = ''; 
            if (inputSchema.length > 0) {
                const input = inputSchema.shift();
                inputName = input.name;
                visible = input.visible === false ? false : true;
            }
            if (parameter && parameter.value && (parameter.value.data || parameter.value.storage)) {
                let initializer = null;
                if (parameter.value.data) {
                    initializer = new pytorch.Tensor('', parameter.value.data, this._littleEndian);
                }
                else if (parameter.value.storage) {
                    initializer = new pytorch.Tensor('', parameter.value, this._littleEndian);
                }
                inputs.push(new pytorch.Parameter(inputName || parameter.key, visible, [ new pytorch.Argument('', null, initializer) ]));
            }
        }

        const group = groups.join('/');
        const name = group ? (group + '/' + key) : key;

        const outputs = [ new pytorch.Parameter('output', true, [ new pytorch.Argument(name, null, null) ]) ];

        let attributes = [];
        for (const name of Object.keys(obj)) {
            if (!name.startsWith('_')) {
                attributes.push({ name: name, value: obj[name] });
            }
        }

        const node = new pytorch.Node(this._metadata, group, name, type, attributes, inputs, outputs);
        this._nodes.push(node);
        return node;
    }

    _loadScriptModule(metadata, container, module, parameters) {
        if (module) {
            if (pytorch.Graph._getParameters(module).length > 0 && !module.__hide__) {
                let node = new pytorch.ScriptNode(metadata, container, module, null, parameters);
                this._nodes.push(node);
            }
            let submodules = pytorch.Graph._getSubmodules(module);
            for (const submodule of submodules) {
                this._loadScriptModule(metadata, container, submodule, parameters);
            }
        }
    }

    static _getParameters(module) {
        let parameters = [];
        if (module && module.__module__ && module.__name__) {
            for (const key of Object.keys(module)) {
                if (pytorch.Utility.isTensor(module[key])) {
                    const parameter = module[key];
                    parameter.__id__ = key;
                    parameters.push(parameter);
                }
            }
        }
        return parameters;
    }

    static _getSubmodules(module) {
        let submodules = [];
        if (module && module.__module__ && module.__name__) {
            for (const key of Object.keys(module)) {
                if (!key.startsWith('__')) {
                    const value = module[key];
                    if (value && value.__module__ && value.__name__ && !pytorch.Utility.isTensor(value)) {
                        submodules.push(value);
                    }
                }
            }
        }
        return submodules;
    }

    get type() {
        return this._type;
    }

    get name() {
        return this._name;
    }

    get groups() {
        return this._groups;
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
};

pytorch.Parameter = class {

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

pytorch.Argument = class {

    constructor(id, type, initializer) {
        this._id = id;
        this._type = type;
        this._initializer = initializer;
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

pytorch.Node = class {

    constructor(metadata, group, name, type, attributes, inputs, outputs) {
        this._metadata = metadata;
        this._group = group || '';
        this._name = name || '';
        this._type = type;
        this._inputs = inputs;
        this._outputs = outputs;
        this._attributes = attributes.map((attribute) => {
            const schema = metadata.getAttributeSchema(this._type, attribute.name);
            return new pytorch.Attribute(schema, attribute.name, attribute.value)
        });
    }

    get name() {
        return this._name;
    }

    get group() {
        return this._group;
    }

    get operator() {
        return this._type.split('.').pop();
    }

    get category() {
        const schema = this._metadata.getSchema(this._type);
        return (schema && schema.category) ? schema.category : '';
    }

    get documentation() {
        let schema = this._metadata.getSchema(this._type);
        if (schema) {
            schema = JSON.parse(JSON.stringify(schema));
            schema.name = this.operator;
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
            return schema;
        }
        return '';
    }

    get function() {
        return !this._type.startsWith('torch.nn.modules.') && this._type !== 'torch.nn.Module';
    }

    get attributes() {
        return this._attributes;
    }

    get inputs() {
        return this._inputs;
    }

    get outputs() {
        return this._outputs;
    }
};

pytorch.Attribute = class {

    constructor(schema, name, value) {
        this._name = name;
        this._value = value;

        if (value && value.type) {
            switch (value.type) {
                case 'number':
                    this._value = value.value;
                    break;
                case 'string':
                    this._value = value.value;
                    break;
                case 'boolean':
                    this._value = value.value;
                    break;
                case 'id':
                    this._value = value.value;
                    break;
            }
        }

        if (schema) {
            if (Object.prototype.hasOwnProperty.call(schema, 'type')) {
                this._type = schema.type;
            }

            switch (this._type) {
                case 'boolean':
                    if (this._value == 'False') {
                        this._value = false;
                    }
                    else if (this._value == 'True') {
                        this._value = true;
                    }
                    break;
                case 'int32':
                case 'int64':
                    if (typeof this._value !== 'number') {
                        if (typeof this._value === 'string') {
                            this._value = parseInt(this._value, 10);
                        }
                        else {
                            this._value = pytorch.Utility.format(this._value);
                        }
                    }
                    break;
                case 'float32':
                case 'float64':
                    if (typeof this._value !== 'number') {
                        if (typeof this._value === 'string') {
                            this._value = parseFloat(this._value);
                        }
                        else {
                            this._value = pytorch.Utility.format(this._value);
                        }
                    }
                    break;
                case 'int32[]':
                case 'int64[]': {
                    switch (this._value.type) {
                        case 'list':
                            this._value = this._value.value.map((item) => {
                                if (item.type === 'number') {
                                    let number = parseInt(item.value, 10);
                                    if (!Number.isNaN(item.value - number)) {
                                        return number;
                                    }
                                }
                                if (item.type === 'call') {
                                    return pytorch.Utility.format(item);
                                }
                                return item;
                            });
                            break;
                        case 'call':
                            this._value = pytorch.Utility.format(this._value);
                            break;
                    }
                    break;
                }
            }

            if (Object.prototype.hasOwnProperty.call(schema, 'visible') && !schema.visible) {
                this._visible = false;
            }
            else if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
                if (JSON.stringify(schema.default) == JSON.stringify(this._value)) {
                    this._visible = false;
                }
                else if (Array.isArray(this._value) && 
                    !Array.isArray(schema.default) &&
                    this.value.every((item) => item == schema.default)) {
                    this._visible = false;
                }
            }
        }

        if (Array.isArray(value) && value.length > 0 && value.every((obj) => obj.__module__ && obj.__module__.startsWith('torch.nn'))) {
            this._value = '?';
        }
    }

    get type() {
        return this._type;
    }

    get name() {
        return this._name;
    }

    get value() {
        return this._value;
    }

    get visible() {
        return (this._visible == false || this.name == 'training') ? false : true;
    }
};

pytorch.Tensor = class {

    constructor(name, tensor, littleEndian) {
        this._name = name || '';
        this._type = new pytorch.TensorType(tensor.storage.dataType, new pytorch.TensorShape(tensor.size));
        this._data = tensor.storage.data;
        this._littleEndian = littleEndian;
    }

    get kind() {
        return 'Tensor';
    }

    get name() {
        return this._name;
    }

    get type() {
        return this._type;
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
        const value = this._decode(context, 0);
        return pytorch.Tensor._stringify(value, '', '    ');
    }

    _context() {
        let context = {};
        context.state = null;
        context.index = 0;
        context.count = 0;

        if (!this._type.dataType) {
            context.state = 'Tensor has no data type.';
            return context;
        }
        switch (this._type.dataType) {
            case 'uint8':
            case 'qint8':
            case 'int8':
            case 'int16':
            case 'int32':
            case 'int64':
            case 'float16':
            case 'float32':
            case 'float64':
                break;
            default:
                context.state = "Tensor data type '" + this._type.dataType + "' is not supported.";
                return context;
        }
        if (!this._type.shape) {
            context.state = 'Tensor has no dimensions.';
            return context;
        }
        if (!this._data) {
            context.state = 'Tensor data is empty.';
            return context;
        }

        context.data = this._data;
        context.dataType = this._type.dataType;
        context.dimensions = this._type.shape.dimensions;
        context.dataView = new DataView(context.data.buffer, context.data.byteOffset, context.data.byteLength);
        return context;
    }

    _decode(context, dimension) {
        let results = [];
        const dimensions = (context.dimensions.length == 0) ? [ 1 ] : context.dimensions;
        const size = dimensions[dimension];
        if (dimension == dimensions.length - 1) {
            for (let i = 0; i < size; i++) {
                if (context.count > context.limit) {
                    results.push('...');
                    return results;
                }
                switch (context.dataType) {
                    case 'uint8':
                        results.push(context.dataView.getUint8(context.index, this._littleEndian));
                        context.index++;
                        context.count++;
                        break;
                    case 'qint8':
                    case 'int8':
                        results.push(context.dataView.getInt8(context.index, this._littleEndian));
                        context.index++;
                        context.count++;
                        break;
                    case 'int16':
                        results.push(context.dataView.getInt16(context.index, this._littleEndian));
                        context.index += 2;
                        context.count++;
                        break;
                    case 'int32':
                        results.push(context.dataView.getInt32(context.index, this._littleEndian));
                        context.index += 4;
                        context.count++;
                        break;
                    case 'int64':
                        results.push(new long.Long(context.dataView.getUint32(context.index, true), context.dataView.getUint32(context.index + 4, true), false));
                        context.index += 8;
                        context.count++;
                        break;
                    case 'float16':
                        results.push(context.dataView.getFloat16(context.index, this._littleEndian));
                        context.index += 2;
                        context.count++;
                        break;
                    case 'float32':
                        results.push(context.dataView.getFloat32(context.index, this._littleEndian));
                        context.index += 4;
                        context.count++;
                        break;
                    case 'float64':
                        results.push(context.dataView.getFloat64(context.index, this._littleEndian));
                        context.index += 8;
                        context.count++;
                        break;
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
        if (context.dimensions.length == 0) {
            return results[0];
        }
        return results;
    }

    static _stringify(value, indentation, indent) {
        if (Array.isArray(value)) {
            let result = [];
            result.push(indentation + '[');
            const items = value.map((item) => pytorch.Tensor._stringify(item, indentation + indent, indent));
            if (items.length > 0) {
                result.push(items.join(',\n'));
            }
            result.push(indentation + ']');
            return result.join('\n');
        }
        if (value && long.Long.isLong(value)) {
            return indentation + value.toString();
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

pytorch.TensorType = class {

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

pytorch.TensorShape = class {

    constructor(dimensions) {
        this._dimensions = dimensions || [];
    }

    get dimensions() {
        return this._dimensions;
    }

    toString() {
        if (this._dimensions && this._dimensions.length > 0) {
            return '[' + this._dimensions.map((dimension) => dimension.toString()).join(',') + ']';
        }
        return '';
    }
};

pytorch.Metadata = class {

    static open(host) {
        if (pytorch.Metadata._metadata) {
            return Promise.resolve(pytorch.Metadata._metadata);
        }
        else {
            return host.request(null, 'pytorch-metadata.json', 'utf-8').then((data) => {
                pytorch.Metadata._metadata = new pytorch.Metadata(data);
                return pytorch.Metadata._metadata;
            }).catch(() => {
                pytorch.Metadata._metadata = new pytorch.Metadata(null);
                return pytorch.Metadata._metadata;
            });
        }
    }

    constructor(data) {
        this._map = {};
        this._attributeCache = {};
        if (data) {
            const items = JSON.parse(data);
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

pytorch.Error = class extends Error {
    constructor(message) {
        super(message);
        this.name = 'Error loading PyTorch model.';
    }
};

pytorch.ScriptNode = class {

    constructor(metadata, container, module, node, parameters) {

        this._metadata = metadata;
        this._attributes = [];
        this._inputs = [];
        this._outputs = [];

        if (module) {
            this._operator = 'Module';
            let parameters = pytorch.Graph._getParameters(module);
            for (const parameter of parameters) {
                this._inputs.push(new pytorch.Parameter(parameter.__id__, true, [
                    new pytorch.Argument('', null, parameter.initializer || null)
                ]));
                if (parameter.__outputs__) {
                    this._outputs.push(new pytorch.Parameter(parameter.__id__, true,
                        parameter.__outputs__.map((id) => new pytorch.Argument(id, null, null))
                    ));
                }
            }
        }

        if (node) {
            this._operator = node.name;
            this._name = '';

            const schema = metadata.getSchema(this._operator);

            module = null; 
            let match = true;
            let count = 0;
            for (const input of node.inputs) {
                for (const argument of input) {
                    const parameter = parameters[argument.id];
                    if (parameter) {
                        if (parameter.__parent__ && (module == null || module == parameter.__parent__)) {
                            module = parameter.__parent__;
                            count++;
                        }
                        else {
                            match = false;
                            break;
                        }
                    }
                }
                if (!match) {
                    break;
                }
            }
            if (module) {
                const params = pytorch.Graph._getParameters(module).filter((p) => p.__id__ !== 'num_batches_tracked');
                if (params.length == count && match) {
                    module.__hide__ = true;
                    for (const input of node.inputs) {
                        for (const argument of input) {
                            const parameter = parameters[argument.id];
                            if (parameter && parameter.initializer) {
                                argument.initializer = parameter.initializer;
                            }
                        }
                    }
                }
                else {
                    module = null;
                }
            }

            for (let inputIndex = 0; inputIndex < node.inputs.length; inputIndex++) {
                let inputName = inputIndex.toString(); 
                if (schema && schema.inputs && schema.inputs.length > inputIndex) {
                    inputName = schema.inputs[inputIndex].name;
                }
                this._inputs.push(new pytorch.Parameter(inputName, true,
                    node.inputs[inputIndex].map((input) => new pytorch.Argument(input.id, null, input.initializer || null))
                ));
            }

            for (let outputIndex = 0; outputIndex < node.outputs.length; outputIndex++) {
                let outputName = outputIndex.toString(); 
                if (schema && schema.outputs && schema.outputs.length > outputIndex) {
                    outputName = schema.outputs[outputIndex].name;
                }
                this._outputs.push(new pytorch.Parameter(outputName, true, [
                    new pytorch.Argument(node.outputs[outputIndex], null, null)
                ]));
            }

            for (let i = 0; i < node.attributes.length; i++) {
                let attributeSchema = null;
                let name = i.toString();
                let value = node.attributes[i];
                if (value && value.type === '=' && value.target.type == 'id') {
                    name = value.target.value;
                    value = value.expression;
                    if (schema && schema.attributes) {
                        attributeSchema = schema.attributes.find((s) => s.name == name);
                    }
                }
                else {
                    if (schema && schema.attributes && schema.attributes.length > i) {
                        attributeSchema = schema.attributes[i];
                        name = attributeSchema.name;
                    }
                }
                this._attributes.push(new pytorch.Attribute(attributeSchema, name, value));
            }
        }

        if (module) {
            if (module.__id__) {
                let current = module;
                this._name = current.__id__;
                while (current.__parent__ != null) {
                    current = current.__parent__;
                    if (!current.__parent__ && !current.__id__) {
                        break;
                    }
                    this._name = [ current.__id__, this._name ].join('.')
                }
            }
        }
    }

    get name() {
        return this._name;
    }

    get group() {
        return this._group;
    }

    get operator() {
        return this._operator.split('.').pop();
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
            return schema;
        }
        return '';
    }

    get function() {
        return false;
    }

    get attributes() {
        return this._attributes;
    }

    get inputs() {
        return this._inputs;
    }

    get outputs() {
        return this._outputs;
    }
};

pytorch.Execution = class {

    constructor(python, sources, exception) {
        const self = this;
        this._python = python;
        this._sources = sources;
        this._exception = exception;
        this._utf8Decoder = new TextDecoder('utf-8');
        this._unknownNameMap = new Set();
        this._knownPackageMap = new Set([ 'torch', 'torchvision', 'collections', '__builtin__', '_codecs', 'argparse', 'numpy' ]);
        this._packages = new Map();
        this._context = new pytorch.Context();
        this._context.scope.builtins = {};
        this._context.scope.builtins.type = { __module__: 'builtins', __name__: 'type' };
        this._context.scope.builtins.module = { __module__: 'builtins', __name__: 'module', __class__: this._context.scope.builtins.type };
        this._context.scope.builtins.function = { __module__: 'builtins', __name__: 'function', __class__:this._context.scope.builtins.type };
        this._registerConstructor('argparse.Namespace', function (args) {
            this.args = args;
        });
        this._registerConstructor('torch.autograd.variable.Variable', function() {});
        this._registerConstructor('torch.backends.cudnn.rnn.Unserializable', function() {});
        this._registerConstructor('torch.device', function(type, index) {
            this.type = type;
            this.index = index;
        });
        this._registerConstructor('torch.distributions.multivariate_normal.MultivariateNormal', function() {});
        this._registerConstructor('torch.nn.backends.thnn._get_thnn_function_backend', function() {});
        this._registerConstructor('torch.nn.quantized.modules.functional_modules.FloatFunctional', function() {});
        this._registerConstructor('torch.nn.modules.activation.ELU', function() {});
        this._registerConstructor('torch.nn.modules.activation.GLU', function() {});
        this._registerConstructor('torch.nn.modules.activation.Hardtanh', function() {});
        this._registerConstructor('torch.nn.modules.activation.LeakyReLU', function() {});
        this._registerConstructor('torch.nn.modules.activation.LogSigmoid', function() {});
        this._registerConstructor('torch.nn.modules.activation.LogSoftmax', function() {});
        this._registerConstructor('torch.nn.modules.activation.ReLU', function() {});
        this._registerConstructor('torch.nn.modules.activation.ReLU6', function() {});
        this._registerConstructor('torch.nn.modules.activation.PReLU', function() {});
        this._registerConstructor('torch.nn.modules.activation.SELU', function() {});
        this._registerConstructor('torch.nn.modules.activation.Sigmoid', function() {});
        this._registerConstructor('torch.nn.modules.activation.Softmax', function() {});
        this._registerConstructor('torch.nn.modules.activation.Softmax2d', function() {});
        this._registerConstructor('torch.nn.modules.activation.Softplus', function() {});
        this._registerConstructor('torch.nn.modules.activation.Tanh', function() {});
        this._registerConstructor('torch.nn.modules.activation.Threshold', function() {});
        this._registerConstructor('torch.nn.modules.batchnorm.BatchNorm1d', function() {});
        this._registerConstructor('torch.nn.modules.batchnorm.BatchNorm2d', function() {});
        this._registerConstructor('torch.nn.modules.batchnorm.BatchNorm3d', function() {});
        this._registerConstructor('torch.nn.modules.batchnorm.SyncBatchNorm', function() {});
        this._registerConstructor('torch.nn.modules.container.ModuleDict', function() {});
        this._registerConstructor('torch.nn.modules.container.ModuleList', function() {});
        this._registerConstructor('torch.nn.modules.container.ParameterList', function() {});
        this._registerConstructor('torch.nn.modules.container.Sequential', function() {});
        this._registerConstructor('torch.nn.modules.conv.Conv1d', function() {});
        this._registerConstructor('torch.nn.modules.conv.Conv2d', function() {});
        this._registerConstructor('torch.nn.modules.conv.Conv3d', function() {});
        this._registerConstructor('torch.nn.modules.conv.ConvTranspose1d', function() {});
        this._registerConstructor('torch.nn.modules.conv.ConvTranspose2d', function() {});
        this._registerConstructor('torch.nn.modules.conv.ConvTranspose3d', function() {});
        this._registerConstructor('torch.nn.modules.distance.CosineSimilarity', function() {});
        this._registerConstructor('torch.nn.modules.dropout.Dropout', function() {});
        this._registerConstructor('torch.nn.modules.dropout.Dropout2d', function() {});
        this._registerConstructor('torch.nn.modules.dropout.Dropout3d', function() {});
        this._registerConstructor('torch.nn.modules.fold.Unfold', function() {});
        this._registerConstructor('torch.nn.modules.instancenorm.InstanceNorm1d', function() {});
        this._registerConstructor('torch.nn.modules.instancenorm.InstanceNorm2d', function() {});
        this._registerConstructor('torch.nn.modules.instancenorm.InstanceNorm3d', function() {});
        this._registerConstructor('torch.nn.modules.linear.Linear', function() {});
        this._registerConstructor('torch.nn.modules.linear.Identity', function() {});
        this._registerConstructor('torch.nn.modules.loss.BCELoss', function() {});
        this._registerConstructor('torch.nn.modules.loss.BCEWithLogitsLoss', function() {}); 
        this._registerConstructor('torch.nn.modules.loss.CrossEntropyLoss', function() {});
        this._registerConstructor('torch.nn.modules.loss.L1Loss', function() {});
        this._registerConstructor('torch.nn.modules.loss.MSELoss', function() {});
        this._registerConstructor('torch.nn.modules.loss.NLLLoss', function() {});
        this._registerConstructor('torch.nn.modules.loss.SmoothL1Loss', function() {});
        this._registerConstructor('torch.nn.modules.normalization.CrossMapLRN2d', function() {});
        this._registerConstructor('torch.nn.modules.normalization.GroupNorm', function() {});
        this._registerConstructor('torch.nn.modules.normalization.LayerNorm', function() {});
        this._registerConstructor('torch.nn.modules.normalization.LocalResponseNorm', function() {});
        this._registerConstructor('torch.nn.modules.padding.ReflectionPad1d', function() {});
        this._registerConstructor('torch.nn.modules.padding.ReflectionPad2d', function() {});
        this._registerConstructor('torch.nn.modules.padding.ReplicationPad1d', function() {});
        this._registerConstructor('torch.nn.modules.padding.ReplicationPad2d', function() {});
        this._registerConstructor('torch.nn.modules.padding.ReplicationPad3d', function() {});
        this._registerConstructor('torch.nn.modules.padding.ZeroPad2d', function() {});
        this._registerConstructor('torch.nn.modules.padding.ConstantPad1d', function() {});
        this._registerConstructor('torch.nn.modules.padding.ConstantPad2d', function() {});
        this._registerConstructor('torch.nn.modules.padding.ConstantPad3d', function() {});
        this._registerConstructor('torch.nn.modules.pixelshuffle.PixelShuffle', function() {});
        this._registerConstructor('torch.nn.modules.pooling.AdaptiveAvgPool1d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.AdaptiveAvgPool2d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.AdaptiveAvgPool3d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.AdaptiveMaxPool1d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.AdaptiveMaxPool2d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.AdaptiveMaxPool3d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.AvgPool1d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.AvgPool2d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.AvgPool3d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.FractionalMaxPool2d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.MaxPool1d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.MaxPool2d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.MaxPool3d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.MaxUnpool1d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.MaxUnpool2d', function() {});
        this._registerConstructor('torch.nn.modules.pooling.MaxUnpool3d', function() {});
        this._registerConstructor('torch.nn.modules.rnn.GRU', function() {});
        this._registerConstructor('torch.nn.modules.rnn.GRUCell', function() {});
        this._registerConstructor('torch.nn.modules.rnn.LSTM', function() {});
        this._registerConstructor('torch.nn.modules.rnn.LSTMCell', function() {});
        this._registerConstructor('torch.nn.modules.rnn.RNN', function() {});
        this._registerConstructor('torch.nn.modules.sparse.Embedding', function() {});
        this._registerConstructor('torch.nn.modules.upsampling.Upsample', function() {});
        this._registerConstructor('torch.nn.modules.upsampling.UpsamplingBilinear2d', function() {});
        this._registerConstructor('torch.nn.modules.upsampling.UpsamplingNearest2d', function() {});
        this._registerConstructor('torch.nn.parallel.data_parallel.DataParallel', function() {}); 
        this._registerConstructor('torch.nn.parallel.distributed.DistributedDataParallel', function() {});
        this._registerConstructor('torch.nn.parameter.Parameter', function(data, requires_grad) {
            this.data = data;
            this.requires_grad = requires_grad;
        });
        this._registerConstructor('torch.nn.utils.spectral_norm.SpectralNorm', function() {});
        this._registerConstructor('torch.nn.utils.spectral_norm.SpectralNormStateDictHook', function() {});
        this._registerConstructor('torch.nn.utils.spectral_norm.SpectralNormLoadStateDictPreHook', function() {});
        this._registerConstructor('torch.nn.utils.weight_norm.WeightNorm', function() {});
        this._registerConstructor('torch.optim.adam.Adam', function() {});
        this._registerConstructor('torch.optim.adagrad.Adagrad', function() {});
        this._registerConstructor('torch.optim.lr_scheduler.MultiStepLR', function() {});
        this._registerConstructor('torch.optim.lr_scheduler.StepLR', function() {});
        this._registerConstructor('torch.optim.rmsprop.RMSprop', function() {});
        this._registerConstructor('torch.optim.sgd.SGD', function() {});
        this._registerConstructor('torch.quantization.stubs.DeQuantStub', function() {});
        this._registerConstructor('torch.quantization.stubs.QuantStub', function() {});
        this._registerConstructor('torchvision.datasets.folder.ImageFolder', function() {});
        this._registerConstructor('torchvision.models.alexnet.AlexNet', function() {});
        this._registerConstructor('torchvision.models.densenet.DenseNet', function() {});
        this._registerConstructor('torchvision.models.densenet._DenseBlock', function() {});
        this._registerConstructor('torchvision.models.densenet._DenseLayer', function() {});
        this._registerConstructor('torchvision.models.densenet._Transition', function() {});
        this._registerConstructor('torchvision.models.detection._utils.BalancedPositiveNegativeSampler', function() {});
        this._registerConstructor('torchvision.models.detection._utils.BoxCoder', function() {});
        this._registerConstructor('torchvision.models.detection._utils.Matcher', function() {});
        this._registerConstructor('torchvision.models.detection.backbone_utils.BackboneWithFPN', function() {});
        this._registerConstructor('torchvision.models.detection.faster_rcnn.FasterRCNN', function() {});
        this._registerConstructor('torchvision.models.detection.faster_rcnn.FastRCNNPredictor', function() {});
        this._registerConstructor('torchvision.models.detection.faster_rcnn.TwoMLPHead', function() {});
        this._registerConstructor('torchvision.models.detection.roi_heads.RoIHeads', function() {});
        this._registerConstructor('torchvision.models.detection.rpn.AnchorGenerator', function() {});
        this._registerConstructor('torchvision.models.detection.rpn.RegionProposalNetwork', function() {});
        this._registerConstructor('torchvision.models.detection.rpn.RPNHead', function() {});
        this._registerConstructor('torchvision.models.detection.transform.GeneralizedRCNNTransform', function() {});
        this._registerConstructor('torchvision.models.googlenet.BasicConv2d', function() {});
        this._registerConstructor('torchvision.models.googlenet.GoogLeNet', function() {});
        this._registerConstructor('torchvision.models.googlenet.Inception', function() {});
        this._registerConstructor('torchvision.models.inception.BasicConv2d', function() {});
        this._registerConstructor('torchvision.models.inception.Inception3', function() {});
        this._registerConstructor('torchvision.models.inception.InceptionAux', function() {});
        this._registerConstructor('torchvision.models.inception.InceptionA', function() {});
        this._registerConstructor('torchvision.models.inception.InceptionB', function() {});
        this._registerConstructor('torchvision.models.inception.InceptionC', function() {});
        this._registerConstructor('torchvision.models.inception.InceptionD', function() {});
        this._registerConstructor('torchvision.models.inception.InceptionE', function() {});
        this._registerConstructor('torchvision.models.mobilenet.ConvBNReLU', function() {});
        this._registerConstructor('torchvision.models.mobilenet.MobileNetV2', function() {});
        this._registerConstructor('torchvision.models.mobilenet.InvertedResidual', function() {});
        this._registerConstructor('torchvision.models.resnet.Bottleneck', function() {});
        this._registerConstructor('torchvision.models.resnet.BasicBlock', function() {});
        this._registerConstructor('torchvision.models.segmentation.deeplabv3.ASPP', function() {});
        this._registerConstructor('torchvision.models.segmentation.deeplabv3.ASPPConv', function() {}); 
        this._registerConstructor('torchvision.models.segmentation.deeplabv3.ASPPPooling', function() {});
        this._registerConstructor('torchvision.models.segmentation.deeplabv3.DeepLabHead', function() {});
        this._registerConstructor('torchvision.models.segmentation.deeplabv3.DeepLabV3', function() {});
        this._registerConstructor('torchvision.models.segmentation.fcn.FCN', function() {});
        this._registerConstructor('torchvision.models.segmentation.fcn.FCNHead', function() {});
        this._registerConstructor('torchvision.models.shufflenetv2.ShuffleNetV2', function() {});
        this._registerConstructor('torchvision.models.shufflenetv2.InvertedResidual', function() {});
        this._registerConstructor('torchvision.models.squeezenet.Fire', function() {});
        this._registerConstructor('torchvision.models.squeezenet.SqueezeNet', function() {});
        this._registerConstructor('torchvision.models.resnet.ResNet', function() {});
        this._registerConstructor('torchvision.models.vgg.VGG', function() {});
        this._registerConstructor('torchvision.models._utils.IntermediateLayerGetter', function() {});
        this._registerConstructor('torchvision.ops.feature_pyramid_network.FeaturePyramidNetwork', function() {});
        this._registerConstructor('torchvision.ops.feature_pyramid_network.LastLevelMaxPool', function() {});
        this._registerConstructor('torchvision.ops.misc.FrozenBatchNorm2d', function() {});
        this._registerConstructor('torchvision.ops.poolers.LevelMapper', function() {});
        this._registerConstructor('torchvision.ops.poolers.MultiScaleRoIAlign', function() {});
        this._registerConstructor('torchvision.transforms.transforms.Compose', function() {});
        this._registerConstructor('torchvision.transforms.transforms.Normalize', function() {});
        this._registerConstructor('torchvision.transforms.transforms.Resize', function() {});
        this._registerConstructor('torchvision.transforms.transforms.ToTensor', function() {});
        this._registerConstructor('torch.ByteStorage', function (size) { 
            this.size = size; this.dataTypeSize = 1; this.dataType = 'uint8'; 
        });
        this._registerConstructor('torch.CharStorage', function (size) { 
            this.size = size; this.dataTypeSize = 1; this.dataType = 'int8'; 
        });
        this._registerConstructor('torch.ShortStorage', function (size) { 
            this.size = size; this.dataTypeSize = 2; this.dataType = 'int16';
        });
        this._registerConstructor('torch.IntStorage', function (size) { 
            this.size = size; this.dataTypeSize = 4; this.dataType = 'int32';
        });
        this._registerConstructor('torch.LongStorage', function (size) { 
            this.size = size; this.dataTypeSize = 8; this.dataType = 'int64';
        });
        this._registerConstructor('torch.HalfStorage', function (size) {
            this.size = size; this.dataTypeSize = 2; this.dataType = 'float16';
        });
        this._registerConstructor('torch.FloatStorage', function (size) {
            this.size = size; this.dataTypeSize = 4; this.dataType = 'float32';
        });
        this._registerConstructor('torch.DoubleStorage', function (size) { 
            this.size = size; this.dataTypeSize = 8; this.dataType = 'float64';
        });
        this._registerConstructor('torch.QInt8Storage', function (size) { 
            this.size = size; this.dataTypeSize = 1; this.dataType = 'qint8';
        });
        this._registerConstructor('torch.FloatTensor', function () {
            this.__setstate__ = function(state) {
                this.storage = state[0];
                this.storage_offset = state[1];
                this.size = state[2];
                this.stride = state[3];
            };
        });
        this._registerConstructor('torch.DoubleTensor', function () {
            this.__setstate__ = function(state) {
                this.storage = state[0];
                this.storage_offset = state[1];
                this.size = state[2];
                this.stride = state[3];
            };
        });
        this._registerConstructor('torch.cuda.FloatTensor', function () {
            this.__setstate__ = function(state) {
                this.storage = state[0];
                this.storage_offset = state[1];
                this.size = state[2];
                this.stride = state[3];
            };
        });
        this._registerConstructor('torch.cuda.DoubleTensor', function () {
            this.__setstate__ = function(state) {
                this.storage = state[0];
                this.storage_offset = state[1];
                this.size = state[2];
                this.stride = state[3];
            };
        });
        this._registerConstructor('numpy.dtype', function(obj, align, copy) { 
            switch (obj) {
                case 'i1': this.name = 'int8'; this.itemsize = 1; break;
                case 'i2': this.name = 'int16'; this.itemsize = 2; break;
                case 'i4': this.name = 'int32'; this.itemsize = 4; break;
                case 'i8': this.name = 'int64'; this.itemsize = 8; break;
                case 'u1': this.name = 'uint8'; this.itemsize = 1; break;
                case 'u2': this.name = 'uint16'; this.itemsize = 2; break;
                case 'u4': this.name = 'uint32'; this.itemsize = 4; break;
                case 'u8': this.name = 'uint64'; this.itemsize = 8; break;
                case 'f4': this.name = 'float32'; this.itemsize = 4; break;
                case 'f8': this.name = 'float64'; this.itemsize = 8; break;
                default:
                    if (obj.startsWith('V')) {
                        this.itemsize = Number(obj.substring(1));
                        this.name = 'void' + (this.itemsize * 8).toString();
                    }
                    else if (obj.startsWith('O')) {
                        this.itemsize = Number(obj.substring(1));
                        this.name = 'object';
                    }
                    else if (obj.startsWith('S')) {
                        this.itemsize = Number(obj.substring(1));
                        this.name = 'string';
                    }
                    else if (obj.startsWith('U')) {
                        this.itemsize = Number(obj.substring(1));
                        this.name = 'string';
                    }
                    else if (obj.startsWith('M')) {
                        this.itemsize = Number(obj.substring(1));
                        this.name = 'datetime';
                    }
                    else {
                        throw new pytorch.Error("Unknown dtype '" + obj.toString() + "'.");
                    }
                    break;
            }
            this.align = align;
            this.copy = copy;
            this.__setstate__ = function(state) {
                switch (state.length) {
                    case 8:
                        this.version = state[0];
                        this.byteorder = state[1];
                        this.subarray = state[2];
                        this.names = state[3];
                        this.fields = state[4];
                        this.elsize = state[5];
                        this.alignment = state[6];
                        this.int_dtypeflags = state[7];
                        break;
                    default:
                        throw new pytorch.Error("Unknown numpy.dtype setstate length '" + state.length.toString() + "'.");
                }
            };
        });
        this._registerConstructor('numpy.core.multiarray._reconstruct', function(subtype, shape, dtype) {
            this.subtype = subtype;
            this.shape = shape;
            this.dtype = dtype;
            this.__setstate__ = function(state) {
                this.version = state[0];
                this.shape = state[1];
                this.typecode = state[2];
                this.is_f_order = state[3];
                this.rawdata = state[4];
            };
            this.__read__ = function(unpickler) {
                let array = {};
                const subtype = this.subtype.split('.');
                array.__name__ = subtype.pop();
                array.__module__ = subtype.join('.');
                array.dtype = this.typecode;
                array.shape = this.shape;
                let size = array.dtype.itemsize;
                for (let i = 0; i < array.shape.length; i++) {
                    size = size * array.shape[i];
                }
                if (typeof this.rawdata == 'string') {
                    array.data = unpickler.unescape(this.rawdata, size);
                    if (array.data.length != size) {
                        throw new pytorch.Error('Invalid string array data size.');
                    }
                }
                else {
                    array.data = this.rawdata;
                    if (array.data.length != size) {
                        throw new pytorch.Error('Invalid array data size.');
                    }
                }
                return array;
            };
        });
        this._registerFunction('collections.Counter', function(/* iterable */) {
            return {};
        });
        this._registerFunction('collections.OrderedDict', function(args) {
            let obj = [];
            obj.__setitem__ = function(key, value) {
                obj.push({ key: key, value: value });
            };
            if (args) {
                for (const arg of args) {
                    obj.__setitem__(arg[0], arg[1]);
                }
            }
            return obj;
        });
        this._registerFunction('torch._utils._rebuild_tensor', function (storage, storage_offset, size, stride) {
            return {
                __module__: storage.__module__,
                __name__: storage.__name__.replace('Storage', 'Tensor'),
                storage: storage,
                storage_offset: storage_offset,
                size: size,
                stride: stride
            };
        });
        this._registerFunction('torch._utils._rebuild_tensor_v2', function (storage, storage_offset, size, stride, requires_grad, backward_hooks) {
            return {
                __module__: storage.__module__,
                __name__: storage.__name__.replace('Storage', 'Tensor'),
                storage: storage,
                storage_offset: storage_offset,
                size: size,
                stride: stride,
                requires_grad: requires_grad,
                backward_hooks:  backward_hooks
            };
        });
        this._registerFunction('torch._utils._rebuild_parameter', function(data, requires_grad, backward_hooks) {
            let obj = self.invoke('torch.nn.parameter.Parameter', [ data, requires_grad ]);
            obj.backward_hooks = backward_hooks;
            return obj;
        });
        this._registerFunction('torch._utils._rebuild_qtensor', function(storage, storage_offset, size, stride, quantizer_params, requires_grad, backward_hooks) {
            return {
                __module__: storage.__module__,
                __name__: storage.__name__.replace('Storage', 'Tensor'),
                storage: storage,
                storage_offset: storage_offset,
                size: size,
                stride: stride,
                quantizer_params: quantizer_params,
                requires_grad:requires_grad,
                backward_hooks: backward_hooks
            };
        });
        this._registerFunction('numpy.core.multiarray.scalar', function(dtype, rawData) {
            let data = rawData;
            if (rawData.constructor !== Uint8Array) {
                data = new Uint8Array(rawData.length);
                for (let i = 0; i < rawData.length; i++) {
                    data[i] = rawData.charCodeAt(i);
                }
            }
            let dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
            switch (dtype.name) {
                case 'float32':
                    return dataView.getFloat32(0, true);
                case 'float64':
                    return dataView.getFloat64(0, true);
                case 'int8':
                    return dataView.getInt8(0, true);
                case 'int16':
                    return dataView.getInt16(0, true);
                case 'int32':
                    return dataView.getInt32(0, true);
                case 'int64':
                    return new long.Long(dataView.getInt32(0, true), dataView.getInt32(4, true), false);
            }
            throw new pytorch.Error("Unknown scalar type '" + dtype.name + "'.");
        });
        this._registerFunction('_codecs.encode', function(obj /*, econding */) {
            return obj;
        });
        this._registerFunction('collections.defaultdict', function(/* default_factory */) {
            return {};
        });
        this._registerFunction('annotate', function(type, value) {
            return value;
        });
        this._registerFunction('int', function(/* tensor */) {
            return 0; // TODO
        });
        this._registerFunction('float', function(/* tensor */) {
            return 0.0; // TODO
        });
        this._registerFunction('getattr', function(obj, name, defaultValue) {
            if (Object.prototype.hasOwnProperty.call(obj, name)) {
                return obj[name];
            }
            return defaultValue;
        });
        this._registerFunction('unchecked_cast', function(type, value) {
            return value;
        });
        this._registerFunction('ops.prim.unchecked_unwrap_optional', function(value) {
            return value;
        });
        this._registerFunction('ops.prim.NumToTensor', function(value) {
            return { __module__: 'torch', __name__: 'Tensor', value: value }; // TODO
        });
        this._registerFunction('ops.quantized.conv_prepack', function(/* weight, bias, stride, padding, dilation, groups */) {
            return { __module__: 'torch', __name__: '__conv_prepack__' }; // TODO
        });
        this._registerFunction('ops.quantized.linear_prepack', function(/* weight, bias */) {
            return { __module__: 'torch', __name__: '__linear_prepack__' }; // TODO
        });

        this._registerFunction('ops.prim.RaiseException', function(message) {
            throw new pytorch.Error(message);
        });
        this._registerFunction('torch.__is__', function(left, right) {
            if (left === null && right === null) {
                return true;
            }
            if ((left !== null && right === null) || (left === null && right !== null)) {
                return false;
            }
            throw new pytorch.Error('Unknown expression type.');
        });
        this._registerFunction('torch.__isnot__', function(left, right) {
            if (left === null && right === null) {
                return false;
            }
            if ((left !== null && right === null) || (left === null && right !== null)) {
                return true;
            }
            throw new pytorch.Error('Unknown expression type.');
        });
        this._registerFunction('torch.__not__', function(value) {
            if (typeof value === 'boolean') {
                return !value;
            }
            throw new pytorch.Error('Unknown expression type.');
        });
        this._registerFunction('torch._unwrap_optional', function(value) {
            return value; // TODO
        });
        this._registerFunction('torch.dim', function(tensor) {
            if (tensor && tensor.size) {
                return tensor.size.length;
            }
            return 0; // TODO
        });
        this._registerFunction('torch.eq', function(left, right) {
            if (typeof left === 'string' && typeof right === 'string') {
                return left === right;
            }
            if (typeof left === 'number' && typeof right === 'number') {
                return left === right;
            }
            throw new pytorch.Error('Unknown expression type.');
        });
        this._registerFunction('torch.gt', function(left, right) {
            if (typeof left === 'number' && typeof right === 'number') {
                return left > right;
            }
            throw new pytorch.Error('Unknown expression type.');
        });
        this._registerFunction('torch.jit._pickle.build_boollist', function(data) {
            return data;
        });
        this._registerFunction('torch.jit._pickle.build_doublelist', function(data) {
            return data;
        });
        this._registerFunction('torch.jit._pickle.build_intlist', function(data) {
            return data;
        });
        this._registerFunction('torch.jit._pickle.build_tensorlist', function(data) {
            return data;
        });
        this._registerFunction('torch.lt', function(left, right) {
            if (typeof left === 'number' && typeof right === 'number') {
                return left < right;
            }
            throw new pytorch.Error('Unknown expression type.');
        });
        this._registerFunction('torch.mul', function(left, right) {
            if (typeof left === 'number' && typeof right === 'number') {
                return left * right;
            }
            if (pytorch.Utility.isTensor(left) && pytorch.Utility.isTensor(right)) {
                return { __module__: 'torch', __name__: 'Tensor' };
            }
            throw new pytorch.Error('Unknown expression type.');
        });
        this._registerFunction('torch.ne', function(left, right) {
            if (typeof left === 'number' && typeof right === 'number') {
                return left !== right;
            }
            throw new pytorch.Error('Unknown expression type.');
        });
        this._registerFunction('torch.q_scale', function(/* tensor */) {
            return -1; // TODO
        });
        this._registerFunction('torch.t', function(tensor) {
            return tensor;
        });
        this._registerFunction('uninitialized', function(type) {
            return ({ __module__: 'torch', __name__: type });
        });
        this._registerOperator('torch._convolution', 1);
        this._registerOperator('torch.addmm', 1);
        this._registerOperator('torch.relu_', 1);
        this._registerOperator('torch.relu', 1);
        this._registerOperator('torch.max_pool2d', 1);
        this._registerOperator('torch.view', 1);
        this._registerOperator('torch.matmul', 1);
        this._registerOperator('torch.flatten', 1);
        this._registerOperator('torch.add_', 1);
        this._registerOperator('torch.add', 1);
        this._registerOperator('torch.mul_', 1);
        this._registerOperator('torch.mean', 1);
        this._registerOperator('torch.log_softmax', 1);
        this._registerOperator('torch.dropout', 1);
        this._registerOperator('torch.dropout_', 1);
        this._registerOperator('torch.adaptive_avg_pool2d', 1);
        this._registerOperator('torch.batch_norm', 1);
        this._registerOperator('torch.cat', 1);
        this._registerOperator('torch.select', 1);
        this._registerOperator('torch.unsqueeze', 1);
        this._registerOperator('ops.quantized.conv2d_relu', 1);
    }

    parse(file) {
        const data = this._sources[file];
        const code = this._utf8Decoder.decode(data);
        const reader = new this._python.Parser(code, file);
        const program = reader.parse();
        if (!program) {
            throw new pytorch.Error("Module '" + file + "' not found.");
        }
        return program;
    }

    package(name, file, raw) {
        if (this._python && !this._packages.has(name)) {
            file = file || 'code/' + name.split('.').join('/') + '.py';
            const program = this.parse(file);
            let globals = this._context.getx(name);
            if (globals === undefined) {
                globals = {};
                this._context.setx(name, globals);
            }
            globals.__class__ = this._context.scope.builtins.module;
            globals.__name__ = name;
            globals.__file__ = file;
            this._packages.set(name, globals);
            let context = this._context.push(globals);
            this._block(program.body, null, context);
            if (raw) {
                return program;
            }
        }
        return this._packages.get(name);
    }

    type(name) {
        const type = this._context.getx(name);
        if (type !== undefined) {
            return type;
        }
        let parts = name.split('.');
        const className = parts.pop();
        const moduleName = parts.join('.');
        const module = this.package(moduleName);
        if (module) {
            return module[className];
        }
        return null;
    }

    invoke(name, args) {
        const target = this.type(name);
        if (target) {
            if (target.__class__ === this._context.scope.builtins.type) {
                let obj = {};
                obj.__proto__ = target;
                if (obj.__init__ && typeof obj.__init__ === 'function') {
                    obj.__init__.apply(obj, args);
                }
                return obj;
            }
            else if (target.__class__ === this._context.scope.builtins.function) {
                return target.apply(null, args);
            }
        }
        this._raiseUnkownName(name);
        const nameParts = name.split('.');
        const className = nameParts.pop();
        const moduleName = nameParts.join('.');
        return {
            __module__: moduleName,
            __name__: className
        };
    }

    _apply(method, obj, context, args) {
        args = Array.prototype.slice.call(args);
        context = context.push();
        for (const parameter of method.parameters) {
            if (parameter.name == 'self') {
                context.set('self', obj);
            }
            else {
                context.set(parameter.name, args.shift());
            }
        }
        return this._block(method.body.statements, obj, context)
    }

    _block(statements, obj, context) {
        statements = Array.prototype.slice.call(statements);
        while (statements.length > 0) {
            const statement = statements.shift();
            switch (statement.type) {
                case 'pass': {
                    break;
                }
                case 'return': {
                    return this._expression(statement.expression, obj, context);
                }
                case 'def': {
                    const module = context.get('__name__');
                    const method = statement;
                    const methodContext = context;
                    const self = this;
                    const callback = function() {
                        return self._apply(method, this, methodContext, arguments);
                    };
                    callback.__class__ = this._context.scope.builtins.function;
                    callback.__module__ = module;
                    callback.__name__ = statement.name;
                    context.set(statement.name, callback);
                    break;
                }
                case 'class': {
                    const scope = {
                        __class__:this._context.scope.builtins.type,
                        __module__: context.get('__name__'),
                        __name__: statement.name,
                    };
                    context.set(statement.name, scope)
                    context = context.push(scope);
                    this._block(statement.body.statements, null, context);
                    context = context.pop();
                    break;
                }
                case 'var': {
                    context.set(statement.name, undefined);
                    break;
                }
                case '=': {
                    this._expression(statement, obj, context);
                    break;
                }
                case 'if': {
                    const condition = this._expression(statement.condition, obj, context);
                    if (condition === true) {
                        statements = statement.then.statements.concat(statements);
                        break;
                    }
                    else if (condition === false) {
                        statements = statement.else.statements.concat(statements);
                        break;
                    }
                    throw new pytorch.Error("Unknown condition.");
                }
                case 'call': {
                    this._expression(statement, obj, context);
                    break;
                }
                case 'import': {
                    for (const module of statement.modules) {
                        const moduleName = pytorch.Utility.target(module.name);
                        const globals = this.package(moduleName);
                        if (module.as) {
                            context.set(module.as, globals);
                        }
                    }
                    break;
                }
                default: {
                    throw new pytorch.Error("Unknown statements.");
                }
            }
        }
    }

    _expression(expression, obj, context) {
        switch (expression.type) {
            case '=': {
                const target = expression.target;
                if (target.type === 'id') {
                    context.set(target.value, this._expression(expression.expression, obj, context));
                    return;
                }
                else if (target.type === '[]') {
                    if (target.target.type === 'id' &&
                        target.arguments.type === 'list' &&
                        target.arguments.value.length === 1) {
                        const index = this._expression(target.arguments.value[0], obj, context);
                        if (target.target.value === '__annotations__') {
                            context.set(target.target.value, context.get(target.target.value) || {});
                        }
                        context.get(target.target.value)[index] = this._expression(expression.expression, obj, context);
                        return;
                    }
                }
                else if (target.type === '.' && 
                    target.member.type === 'id') {
                    this._expression(target.target, obj, context)[target.member.value] = this._expression(expression.expression, obj, context);
                    return;
                }
                else if (target.type === 'tuple') {
                    const value = this._expression(expression.expression, obj, context);
                    if  (target.value.length == value.length && target.value.every((item) => item.type === 'id')) {
                        for (let i = 0; i < value.length; i++) {
                            context.set(target.value[i].value, value[i]);
                        }
                        return;
                    }
                }
                break;
            }
            case 'list': {
                return expression.value.map((item) => this._expression(item, obj, context));
            }
            case 'string': {
                return expression.value.substring(1, expression.value.length - 1);
            }
            case 'number': {
                return Number(expression.value);
            }  
            case '[]': {
                if (expression.target.type === 'id' &&
                    expression.arguments.type === 'list' &&
                    expression.arguments.value.length === 1) {
                    if (context.get(expression.target.value)) {
                        const index = this._expression(expression.arguments.value[0], obj, context);
                        return context.get(expression.target.value)[index];
                    }
                    if (expression.target.value === 'List' || expression.target.value === 'Optional') {
                        if (expression.arguments.value.every((item) => item.type === 'id')) {
                            throw new pytorch.Error('Unsupported index expression.');
                            // return { __typeref__: expression.target.value + '[' + expression.arguments.value.map((item) => item.value).join(',') + ']' };
                        }
                    }
                }
                break;
            }
            case '.': {
                if (expression.member.type == 'id') {
                    const target = this._target(expression.target, obj, context);
                    return target[expression.member.value];
                }
                throw new pytorch.Error("Unsupported field expression.");
            }
            case 'call': {
                if (expression.target.type === '.') {
                    const target = this._target(expression.target.target, obj, context);
                    const args = expression.arguments.map((argument) => this._expression(argument, obj, context));
                    if (!target[expression.target.member.value]) {
                        throw new pytorch.Error("Unsupported call expression.");
                    }
                    return target[expression.target.member.value].apply(target, args);
                }
                const target = this._expression(expression.target, obj, context);
                const args = expression.arguments.map((argument) => this._expression(argument, obj, context));
                return target.apply(obj, args);
            }
            case 'id': {
                switch (expression.value) {
                    case 'self': return obj;
                    case 'None': return null;
                    case 'True': return true;
                    case 'False': return false;
                }
                const value = context.get(expression.value);
                if (value !== undefined) {
                    return value;
                }
                if (expression.value === 'Tensor') {
                    throw new Error("Unsupported '" + expression.value + "'.");
                    // return { __typeref__: expression.value };
                }
                if (expression.value === 'int') {
                    throw new Error("Unsupported '" + expression.value + "'.");
                    // return { __typeref__: expression.value };
                }
                if (expression.value === 'CONSTANTS') {
                    let constants = context.get('CONSTANTS')
                    if (!constants) {
                        constants = {};
                        for (let i = 0; i < this.constants.length; i++) {
                            constants['c' + i.toString()] = this.constants[i];
                        }
                        context.set('CONSTANTS', constants);
                    }
                    return constants;
                }
                break;
            }
            case 'tuple': {
                return expression.value.map((expression) => this._expression(expression, obj, context));
            }
        }
        throw new pytorch.Error("Unknown expression.");
    }

    _target(expression, obj, context) {
        let current = expression;
        let packageName = '';
        for (;;) {
            if (current.type === '.' && current.member && current.member.type === 'id') {
                packageName = '.' + current.member.value + packageName;
                current = current.target;
            }
            else if (current.type === 'id' && current.value !== 'self') {
                packageName = current.value + packageName;
                break;
            }
            else {
                packageName = null;
                break;
            }
        }
        if (packageName) {
            let target = context.getx(packageName);
            if (!target) {
                target = this.package(packageName);
                if (!target) {
                    throw new pytorch.Error("Failed to resolve module '" + packageName + "'.");
                }
            }
            return target;
        }
        return this._expression(expression, obj, context);
        /*
        debugger;
        if (packageName && packageName.startsWith('__torch__.')) {
            debugger;
        }

        debugger;
        target = this._expression(expression.target, obj, context)
        if (!target) {
            target = this.package(pytorch.Utility.target(expression.target));
        }
        return target
        */
    }

    _registerFunction(name, callback) {
        if (this._context.getx(name)) {
            throw new pytorch.Error("Function '" + name + "' is already registered.");
        }
        const parts = name.split('.');
        callback.__class__ = this._context.scope.builtins.function;
        callback.__name__ = parts.pop();
        callback.__module__ = parts.join('.');
        this._context.setx(name, callback);
    }

    _registerConstructor(name, callback) {
        if (this._context.getx(name)) {
            throw new pytorch.Error("Constructor '" + name + "' is already registered.");
        }
        const parts = name.split('.');
        let type = {};
        type.__class__ = this._context.scope.builtins.type;
        type.__name__ = parts.pop();
        type.__module__ = parts.join('.');
        type.__init__ = function() {
            callback.apply(this, arguments);
        }
        this._context.setx(name, type);
    }

    _registerOperator(name, output_count) {
        // const self = this;
        this._context.setx(name, function() {
            let outputs = [];
            for (let i = 0; i < output_count; i++) {
                outputs.push({ __module__: 'torch', __name__: 'Tensor' });
            }
            // self._add(name, arguments, outputs);
            return outputs;
        });
    }

    _raiseUnkownName(name) {
        if (name && !this._unknownNameMap.has(name)) {
            this._unknownNameMap.add(name);
            if (this._knownPackageMap.has(name.split('.').shift())) {
                this._exception(new pytorch.Error("Unknown function '" + name + "'."), false);
            }
        }
    }
}

pytorch.TarContainer = class {

    constructor(identifier, entries, pickle, exception) {
        this._identifier = identifier;
        this._entries = entries;
        this._pickle = pickle;
        this._exception = exception;
    }

    get format() {
        return 'PyTorch Eager v0.1.1'
    }

    get data() {
        this._open();
        return this._data;
    }

    get state() {
        this._open();
        return this._state;
    }

    get littleEndian() {
        this._open();
        return this._littleEndian;
    }

    _open() {
        if (this._opened) {
            return;
        }
        this._opened = true;
        this._data = null;
        this._state = null;
        this._littleEndian = true;
 
        const execution = new pytorch.Execution(null, [], this._exception);

        let entries = {};
        for (const entry of this._entries) {
            switch (entry.name) {
                case 'sys_info': entries.sys_info = entry.data; break;
                case 'pickle': entries.pickle = entry.data; break;
                case 'storages': entries.storages = entry.data; break;
                case 'tensors': entries.tensors = entry.data; break;
            }
        }
        if (entries.sys_info) {
            const unpickler = new this._pickle.Unpickler(entries.sys_info);
            const sys_info = unpickler.load((name, args) => execution.invoke(name, args));
            if (sys_info.protocol_version != 1000) {
                throw new pytorch.Error("Unsupported protocol version '" + sys_info.protocol_version + "'.");
            }
            if (sys_info.type_sizes &&
                ((sys_info.type_sizes.int && sys_info.type_sizes.int != 4) ||
                (sys_info.type_sizes.long && sys_info.type_sizes.long != 4) ||
                (sys_info.type_sizes.short && sys_info.type_sizes.short != 2))) {
                throw new pytorch.Error('Unsupported type sizes.');
            }
            this._littleEndian = sys_info.little_endian;
        }

        let deserialized_objects = {};
        if (entries.storages) {
            const unpickler = new this._pickle.Unpickler(entries.storages);
            const num_storages = unpickler.load((name, args) => execution.invoke(name, args));
            for (let i = 0; i < num_storages; i++) {
                const storage_args = unpickler.load();
                const storage_key = storage_args[0];
                const storage_type = storage_args[2];
                const size = long.Long.fromBytesLE(unpickler.read(8), false).toNumber();
                const storage = execution.invoke(storage_type, [ size ]);
                storage.data = unpickler.read(storage.dataTypeSize * storage.size);
                deserialized_objects[storage_key] = storage;
            }
            /*
            let storage_views = unpickler.load();
            for target_cdata, root_cdata, offset, size in storage_views:
                root = deserialized_objects[root_cdata]
                deserialized_objects[target_cdata] = root[offset:offset + size]
            */
        }

        if (entries.tensors) {
            const unpickler = new this._pickle.Unpickler(entries.tensors);
            const num_tensors = unpickler.load((name, args) => execution.invoke(name, args));
            for (let j = 0; j < num_tensors; j++) {
                const tensor_args = unpickler.load();
                const tensor_key = tensor_args[0];
                const storage_id = tensor_args[1];
                const storage = deserialized_objects[storage_id];
                const ndim = long.Long.fromBytesLE(unpickler.read(4), false).toNumber();
                unpickler.read(4);
                let shape = [];
                for (let k = 0; k < ndim; k++) {
                    shape.push(long.Long.fromBytesLE(unpickler.read(8), false).toNumber())
                }
                let stride = [];
                for (let l = 0; l < ndim; l++) {
                    stride.push(long.Long.fromBytesLE(unpickler.read(8), false).toNumber())
                }
                const storage_offset = long.Long.fromBytesLE(unpickler.read(8), false).toNumber();
                const tensor_type_name = storage.__name__.replace('Storage', 'Tensor');
                const tensor = execution.invoke(storage.__module__ + '.' + tensor_type_name, []);
                tensor.__setstate__([ storage, storage_offset, shape, stride ]);
                deserialized_objects[tensor_key] = tensor;
            }
        }

        if (entries.pickle) {
            const unpickler = new this._pickle.Unpickler(entries.pickle);
            const persistent_load = (saved_id) => {
                return deserialized_objects[saved_id];
            };
            let obj = unpickler.load((name, args) => execution.invoke(name, args), persistent_load);
            if (obj) {
                if (!Array.isArray(obj)) {
                    let array = [];
                    for (const key of Object.keys(obj)) {
                        array.push({ key: key, value: obj[key] });
                    }
                    obj = array;
                }
                this._state = [];
                let state_map = {};
                if (obj && Array.isArray(obj)) {
                    for (const item of obj) {
                        if (!item || !item.key || !item.value) {
                            this._state = null;
                            break;
                        }
                        let state = {};
                        state.id = item.key;
                        state.value = null;
                        if (item.value && item.value.__module__ === 'torch.nn.parameter' && item.value.__name__ === 'Parameter') {
                            state.value = item.value[0];
                        }
                        else if (pytorch.Utility.isTensor(item.value)) {
                            state.value = item.value;
                        }
                        if (!state.value) {
                            this._state = null;
                            break;
                        }
                        const split = state.id.split('.');
                        if (split.length < 2) {
                            this._state = null;
                            break;
                        }
                        state.name = split.pop();
                        const state_group_name = split.join('.');
                        let state_group = state_map[state_group_name];
                        if (!state_group) {
                            state_group = {};
                            state_group.name = state_group_name;
                            state_group.states = [];
                            state_map[state_group_name] = state_group;
                            this._state.push(state_group);
                        }
                        state_group.states.push(state);
                    }
                }
            }
        }
    }
}

pytorch.PickleContainer = class {

    constructor(identifier, buffer, pickle, exception) {
        this._identifier = identifier;
        this._buffer = buffer;
        this._pickle = pickle;
        this._exception = exception;
    }

    get format() {
        return 'PyTorch Eager v0.1.10'
    }

    get data() {
        this._open();
        return this._data;
    }

    get state() {
        this._open();
        return this._state;
    }

    get littleEndian() {
        this._open();
        return this._littleEndian;
    }

    _open() {
        if (this._opened) {
            return;
        }
        this._opened = true;
        const execution = new pytorch.Execution(null, [], this._exception);
        const unpickler = new this._pickle.Unpickler(this._buffer);
        unpickler.load(); // magic_number
        const protocol_version = unpickler.load();
        if (protocol_version != 1001) {
            throw new pytorch.Error("Unsupported protocol version '" + protocol_version + "'.");
        }
        const sys_info = unpickler.load();
        if (sys_info.protocol_version != 1001) {
            throw new pytorch.Error("Unsupported protocol version '" + sys_info.protocol_version + "'.");
        }
        if (sys_info.type_sizes &&
            ((sys_info.type_sizes.int && sys_info.type_sizes.int != 4) ||
            (sys_info.type_sizes.long && sys_info.type_sizes.long != 4) ||
            (sys_info.type_sizes.short && sys_info.type_sizes.short != 2))) {
            throw new pytorch.Error('Unsupported type sizes.');
        }
        this._littleEndian = sys_info.little_endian;

        let module_source_map = new Map();
        let deserialized_objects = new Map();
        const persistent_load = (saved_id) => {
            const typename = saved_id.shift();
            const data = saved_id;
            switch (typename) {
                case 'module': {
                    const module = data[0];
                    const source = data[2];
                    module_source_map.set(module, source);
                    return data[0];
                }
                case 'storage': {
                    const data_type = data.shift();
                    const root_key = data.shift();
                    data.shift(); // location
                    const size = data.shift();
                    const view_metadata = data.shift();
                    if (!deserialized_objects.has(root_key)) {
                        const storage = execution.invoke(data_type, [ size ]);
                        deserialized_objects.set(root_key, storage);
                    }
                    if (view_metadata) {
                        const view_key = view_metadata.shift();
                        view_metadata.shift(); // view_offset
                        view_metadata.shift(); // view_size
                        if (!deserialized_objects.has(view_key)) {
                            const view = null; // storage.slice(view_offset, view_offset + view_size);
                            deserialized_objects.set(view_key, view);
                        }
                        return deserialized_objects.get(view_key);
                    }
                    return deserialized_objects.get(root_key);
                }
            }
            throw new pytorch.Error("Unknown persistent load type '" + typename + "'.");
        };

        const data = unpickler.load((name, args) => execution.invoke(name, args), persistent_load);
        if (!data) {
            throw new pytorch.Error('File format is not PyTorch.');
        }

        const deserialized_storage_keys = unpickler.load();
        for (const deserialized_storage_key of deserialized_storage_keys) {
            const storage = deserialized_objects.get(deserialized_storage_key);
            const size = long.Long.fromBytesLE(unpickler.read(8), false).toNumber();
            if (size != storage.size) {
                throw new pytorch.Error('Storage size mismatch.');
            }
            storage.data = unpickler.read(storage.dataTypeSize * storage.size);
        }

        this._data = pytorch.PickleContainer._findRootModule(data);
        if (!this._data) {
            this._state = pytorch.PickleContainer._findStateDict(data);
            if (!this._state) {
                throw new pytorch.Error('File does not contain root module or state dictionary.');
            }
        }

        this._buffer = null;
    }

    static _findRootModule(root) {
        const candidates = [ root, root.model, root.net ];
        for (const obj of candidates) {
            if (obj && obj._modules) {
                return obj;
            }
        }
        return null;
    }

    static _findStateDict(root) {
        if (root) {
            if (root.encoder && Array.isArray(root.encoder) && 
                root.decoder && Array.isArray(root.decoder) && !root.state_dict) {
                root = root.encoder.concat(root.decoder);
            }
            if (Array.isArray(root) && root.every((item) => item.key && item.value)) {
                let obj = {};
                for (const item of root) {
                    obj[item.key] = item.value;
                }
                root = obj;
            }
        }
        const candidates = [ 
            root, root.state_dict, root.state,
            root.model_state, root.model, root.model_state_dict, root.net_dict,
            root.params, root.generator, root.discriminator, root.g_state,
            root.network, root.net, root.netG,
            root.state_dict_stylepredictor, root.state_dict_ghiasi
        ];
        for (const dict of candidates) {
            let state_dict = null;
            state_dict = state_dict || pytorch.PickleContainer._convertStateDictList(dict);
            state_dict = state_dict || pytorch.PickleContainer._convertStateDictMap(dict);
            state_dict = state_dict || pytorch.PickleContainer._convertStateDictGroupMap(dict);
            if (state_dict) {
                return state_dict;
            }
        }
        return null;
    }

    static _convertStateDictList(list) {
        if (!list || 
            !Array.isArray(list) || 
            !list.every((item) => item && item.key && (item.value === null || pytorch.Utility.isTensor(item.value)))) {
            return null;
        }
        let state_dict = [];
        let state_map = {};
        for (const item of list) {
            if (item.value === null) {
                continue;
            }
            const split = item.key.split('.');
            if (split.length < 2) {
                return null;
            }
            let state = {};
            state.id = item.key;
            state.name = split.pop();
            state.value = item.value;
            const state_group_name = split.join('.');
            let state_group = state_map[state_group_name];
            if (!state_group) {
                state_group = {};
                state_group.name = state_group_name;
                state_group.states = [];
                state_map[state_group_name] = state_group;
                state_dict.push(state_group);
            }
            state_group.states.push(state);
        }
        return state_dict;
    }

    static _convertStateDictMap(obj) {
        if (!obj || Array.isArray(obj)) {
            return null
        }
        let state_dict = [];
        let state_map = {};
        for (const key in obj) {
            const split = key.split('.');
            if (split.length < 1) {
                return null;
            }
            let state = {};
            state.id = key;
            state.name = split.pop();
            state.value = obj[key];
            if (state.value && state.value.__module__ === 'torch.nn.parameter' && state.value.__name__ === 'Parameter') {
                if (pytorch.Utility.isTensor(state.value.data)) {
                    state.value = state.value.data;
                }
            }
            if (!pytorch.Utility.isTensor(state.value)) {
                return null;
            }
            const state_group_name = split.join('.');
            let state_group = state_map[state_group_name];
            if (!state_group) {
                state_group = {};
                state_group.name = state_group_name;
                state_group.states = [];
                state_map[state_group_name] = state_group;
                state_dict.push(state_group);
            }
            state_group.states.push(state);
        }
        return state_dict;
    }

    static _convertStateDictGroupMap(obj) {
        if (!obj || Array.isArray(obj)) {
            return null;
        }
        let state_dict = [];
        let state_map = {};
        for (const state_group_name in obj) {
            let state_group = state_map[state_group_name];
            if (!state_group) {
                state_group = {};
                state_group.name = state_group_name;
                state_group.states = [];
                state_group.attributes = [];
                state_map[state_group_name] = state_group;
                state_dict.push(state_group);
            }
            const item = obj[state_group_name];
            if (!item) {
                return null;
            }
            if (Array.isArray(item)) {
                for (const entry of item) {
                    if (!entry || !entry.key || !entry.value || !pytorch.Utility.isTensor(entry.value)) {
                        return null;
                    }
                    state_group.states.push({
                        id: state_group_name + '.' + entry.key,
                        name: entry.key,
                        value: entry.value
                    });
                }
            }
            else if (Object(item) === item) {
                let hasTensors = false;
                for (const key in item) {
                    const value = item[key];
                    if (pytorch.Utility.isTensor(value)) {
                        state_group.states.push({ name: key, value: value, id: state_group_name + '.' + key });
                        hasTensors = true;
                    }
                    else if (value !== Object(value)) {
                        state_group.attributes.push({ name: key, value: value });
                    }
                    else if (value && value.data && value.__module__ === 'torch.nn.parameter' && value.__name__ === 'Parameter') {
                        state_group.states.push({ name: key, value: value.data, id: state_group_name + '.' + key });
                        hasTensors = true;
                    }
                    else {
                        return null;
                    }
                }
                if (!hasTensors) {
                    return null;
                }
            }
            else {
                return null;
            }
        }
        return state_dict;
    }
}

pytorch.ZipContainer = class {

    constructor(identifier, entries, pickle, python, exception) {
        this._identifier = identifier;
        this._entries = entries;
        this._pickle = pickle;
        this._python = python;
        this._exception = exception;
        // https://github.com/pytorch/pytorch/blob/master/torch/csrc/jit/docs/serialization.md
        const entry = this._entries.find((entry) => entry.name == 'model.json' || entry.name == 'data.pkl' || entry.name.endsWith('/model.json') || entry.name.endsWith('/data.pkl'));
        if (!entry) {
            throw new pytorch.Error("PyTorch Zip container does not contain 'data.pkl' or 'model.json'.");
        }
        const lastIndex = entry.name.lastIndexOf('/');
        this._prefix = lastIndex === -1 ? '' : entry.name.substring(0, lastIndex + 1);
        this._utf8Decoder = new TextDecoder('utf-8');
    }

    get identifier() {
        return this._identifier;
    }

    get name() {
        return this._name;
    }

    get format() {
        const versionEntry = this._entries.find((entry) => entry.name === this._prefix + 'version');
        const version = versionEntry ? this._utf8Decoder.decode(versionEntry.data).split('\n').shift() : '';
        const modelEntry = this._entries.find((entry) => entry.name === this._prefix + 'model.json');
        const dataEntry = this._entries.find((entry) => entry.name === this._prefix + 'data.pkl');
        if (version === '' || version === '1' || version === '2') {
            if (modelEntry) {
                return 'PyTorch Script v1.0';
            }
            if (dataEntry) {
                if (this._entries.find((entry) => entry.name.startsWith(this._prefix + 'code/'))) {
                    return version === '2' ? 'PyTorch Script v1.4' : 'PyTorch Script v1.3';
                }
                return 'PyTorch Eager v1.4';
            }
        }
        throw new pytorch.Error("Unsupported PyTorch Zip version '" + version + "'.");
    }

    get producer() {
        return this.data ? this._producer : '';
    }

    get script() {
        return this.execution ? this._script : false;
    }

    get data() {
        if (this._data === undefined) {
            this._data = null;
            const dataEntry = this._entries.find((entry) => entry.name == this._prefix + 'data.pkl');
            if (dataEntry && dataEntry.data) {
                this._data = this._unpickle(dataEntry.data, this._storage('data'));
            }
            else {
                const modelEntry = this._entries.find((entry) => entry.name == this._prefix + 'model.json');
                if (modelEntry) {
                    const model = JSON.parse(this._utf8Decoder.decode(modelEntry.data))
                    this._producer = model.producerName + (model.producerVersion ? ' v' + model.producerVersion : '');
                    this._data = model.mainModule || {};
                    this._name = this._data.name || '';
                    if (this._data.torchscriptArena) {
                        this._torchscriptArena = this._data.torchscriptArena.key;
                    }
                    let queue = [ this._data ];
                    let entries = new Map();
                    for (const entry of this._entries) {
                        entries.set(entry.name, entry.data);
                    }
                    const tensorTypeMap = new Map([
                        [ 'FLOAT', 'Float' ],
                        [ 'FLOAT16', 'Half' ],
                        [ 'DOUBLE', 'Double' ],
                        [ 'INT8', 'Char' ],
                        [ 'INT32', 'Int' ],
                        [ 'INT64', 'Long' ]
                    ]);
                    const tensors = model.tensors;
                    this._constants = tensors;
                    for (const tensor of tensors) {
                        const key = this._prefix + tensor.data.key;
                        if (!tensorTypeMap.has(tensor.dataType)) {
                            throw new pytorch.Error("Unknown tensor data type '" + tensor.dataType + "'.");
                        }
                        const type = tensorTypeMap.get(tensor.dataType);
                        tensor.__module__ = 'torch';
                        tensor.__name__ = 'Tensor';
                        tensor.name = tensor.data.key;
                        tensor.size = tensor.dims ? tensor.dims.map((dim) => parseInt(dim, 10)) : null;
                        tensor.storage = this.execution.invoke('torch.' + type + 'Storage', [ tensor.size ]);
                        tensor.storage.data = entries.get(key);
                    }
                    while (queue.length > 0) {
                        let module = queue.shift();
                        module.__module__ = module.__module__ || 'torch'
                        module.__name__ = module.__name__ || 'Module';
                        if (module.name) {
                            module.__id__ = module.name;
                        }
                        if (module.submodules) {
                            for (const submodule of module.submodules) {
                                module[submodule.name] = submodule;
                                submodule.__parent__ = module;
                                queue.push(submodule);
                            }
                            delete module.submodules;
                        }
                        let parameters = [];
                        if (module.parameters) {
                            parameters = parameters.concat(module.parameters);
                            delete module.parameters;
                        }
                        if (module.arguments) {
                            parameters = parameters.concat(module.arguments);
                            delete module.arguments;
                        }
                        for (const parameter of parameters) {
                            const tensor = tensors[parameter.tensorId];
                            module[parameter.name] = tensor;
                            if (!parameter.__module__ || !parameter.__name__) {
                                parameter.__module__ = 'torch';
                                parameter.__name__ = 'Tensor';
                            }
                        }
                    }
                }
            }
        }
        return this._data;
    }

    get body() {
        if (this._body === undefined) {
            this._body = null;
            const data = this.data;
            if (this._torchscriptArena) {
                const program = this.execution.parse(this._torchscriptArena);
                this._body = program.body;
            }
            else if (data) {
                const type = this._type(data.__module__ + '.' + data.__name__);
                if (type) {
                    this._body = type.body.statements;
                }
            }
        }
        return this._body;
    }

    get attributes() {
        if (this._attributes ===  undefined) {
            this._attributes = null;
            const entry = this._entries.find((entry) => entry.name == this._prefix + 'attributes.pkl');
            if (entry && entry.data) {
                this._attributes = this._unpickle(entry.data, null);
            }
        }
        return this._attributes;
    }

    get constants() {
        if (this._constants ===  undefined) {
            this._constants = null;
            const entry = this._entries.find((entry) => entry.name == this._prefix + 'constants.pkl');
            if (entry && entry.data) {
                this._constants = this._unpickle(entry.data, this._storage('constants'));
            }
        }
        return this._constants;
    }

    _storage(dirname) {
        let map = new Map();
        const prefix = this._prefix + dirname + '/';
        for (const entry of this._entries) {
            if (entry.name.startsWith(prefix)) {
                const key = entry.name.substring(prefix.length);
                map.set(key, entry.data);
            }
        }
        return map;
    }

    get execution() {
        if (this._execution === undefined) {
            this._types = new Map(); // TODO
            this._script = false;
            let sources = {};
            for (const entry of this._entries) {
                if (entry.name.startsWith(this._prefix + 'code')) {
                    const file = entry.name.substring(this._prefix.length);
                    if (sources[file]) {
                        throw new pytorch.Error("Duplicate source file '" + file + "'.");
                    }
                    sources[file] = entry.data;
                    this._script = true;
                }
            }
            this._execution = new pytorch.Execution(this._python, sources, this._exception);
        }
        return this._execution;
    }

    _unpickle(data, storage_map) {
        let deserialized_objects = new Map();
        const persistent_load = (saved_id) => {
            const typename = saved_id.shift();
            if (typename !== 'storage') {
                throw new pytorch.Error("Unknown persistent load type '" + typename + "'.");
            }
            const data_type = saved_id.shift();
            const root_key = saved_id.shift();
            saved_id.shift(); // location
            const size = saved_id.shift();
            let storage = null;
            if (deserialized_objects.has(root_key)) {
                storage = deserialized_objects.get(root_key);
            }
            else {
                storage = this.execution.invoke(data_type, [ size ]);
                storage.data = storage_map.get(root_key);
                deserialized_objects[root_key] = storage;
            }
            const view_metadata = saved_id.shift();
            if (view_metadata) {
                let view_key = view_metadata.shift();
                view_metadata.shift(); // view_offset
                view_metadata.shift(); // view_size
                let view = deserialized_objects[view_key];
                if (!view) {
                    view = null; // storage.slice(view_offset, view_offset + view_size);
                    deserialized_objects[view_key] = view;
                }
                return view;
            }
            return storage;
        };
        return new this._pickle.Unpickler(data).load((name, args) => this.execution.invoke(name, args), persistent_load);
    }

    _type(name) {
        if (!this._types.has(name)) {
            let parts = name.split('.');
            const className = parts.pop();
            const file = 'code/' + parts.join('/') + '.py';
            const program = this.execution.parse(file);
            if (program) {
                for (const statement of program.body) {
                    if (statement.type === 'class' && statement.name == className) {
                        this._types.set(name, statement);
                        break;
                    }
                }
            }
        }
        return this._types.get(name);
    }

    trace() {

        // this.data.forward({ __module__: 'torch', __name__: 'Tensor' });

        this._inputs = [];
        this._outputs = [];
        this._nodes = [];

        this._moduleMap = new Map();
        this._state = {};

        try {
            let statements = this.body;
            let method = statements.find((statement) => statement.type == 'def' && statement.name == 'forward');
            if (!method) {
                throw new pytorch.Error("Method 'forward' not found.");
            }
    
            // container.trace(this.data, method);
    
            this._body = method.body.statements;
            let methodParameters = method.parameters;
            if (methodParameters.length > 0 && methodParameters[0].name == 'self') {
                methodParameters.shift();
            }
            for (const parameter of methodParameters) {
                this._parameter(parameter);
            }
    
            if (this._body.length >= 2) {
                // x = ...
                // return x
                let returnStatement = this._body[this._body.length - 1];
                let assignStatement = this._body[this._body.length - 2];
                if (returnStatement.type === 'return' && 
                    returnStatement.expression.type === 'id' &&
                    assignStatement.type === '=' &&
                    assignStatement.target.type === 'id' &&
                    assignStatement.target.value === returnStatement.expression.value) {
                    returnStatement.expression = assignStatement.expression;
                    this._body.pop();
                    this._body.pop();
                    this._body.push(returnStatement);
                }
            }
    
            while (this._body.length > 0) {
                let statement = this._body.shift();
                if (this._conditionStatement(statement)) {
                    continue;
                }
                if (this._assignStatement(statement)) {
                    continue;
                }
                if (this._argumentStatement(statement)) {
                    continue;
                }
                if (this._nodeStatement(statement)) {
                    continue;
                }
                if (this._returnStatement(statement)) {
                    continue;
                }
                if (statement.type === 'pass') {
                    continue;
                }
                if (this._isCall(statement, 'torch.warn', [ {}, {} ])) {
                    continue;
                }
                throw new pytorch.Error('Unknown statement.');
                // throw new pytorch.Error('Unknown statement' + statement.location + '.');
            }
            return true;
        }
        catch (error) {
            this._exception(error, false);
        }
        return false;
    }

    /*
    trace(obj, method) {
        let args = [];
        this._tensors = new Set();
        for (const parameter of method.parameters) {
            if (parameter.name !== 'self') {
                this._tensors.add(parameter.name);
                args.push({});
            }
        }
        this._apply(method, obj, args);
        this._tensors = null;
    }

    _trace(name, args) {
        let namespace = 'torch.';
        if (name.startsWith(namespace)) {
            switch (name) {
                case 'torch.conv2d':
                    return { __module__: 'torch', __name__: 'Tensor', size: [ 0, 0, 0, 0 ] }; // TODO
                case 'torch._convolution':
                case 'torch.addmm':
                case 'torch.relu_':
                case 'torch.relu':
                case 'torch.max_pool2d':
                case 'torch.view':
                case 'torch.matmul':
                case 'torch.flatten':
                case 'torch.add_':
                case 'torch.add':
                case 'torch.mul_':
                case 'torch.mean':
                case 'torch.log_softmax':
                case 'torch.dropout':
                case 'torch.dropout_':
                case 'torch.adaptive_avg_pool2d':
                case 'torch.batch_norm':
                case 'torch.cat':
                case 'torch.select':
                case 'torch.unsqueeze':
                    return [ { __module__: 'torch', __name__: 'Tensor' } ]; // TODO
                case 'torch.max_pool2d_with_indices':
                    return [ { __module__: 'torch', __name__: 'Tensor' }, { __module__: 'torch', __name__: 'Tensor' } ]; // TODO
                case 'torch.list_with_default':
                    return [0]; // TODO
                case 'torch.size':
                    return 0; // TODO
            }
        }
        throw new pytorch.Error("Unknown symbol '" + name + "'.");
    }
    */

    _parameter(parameter) {
        let type = parameter.parameterType; 
        if (type.type == 'type' && type.value == 'Tuple' && type.arguments && type.arguments.length > 0) {
            if (this._body.length > 0) {
                let statement = this._body[0];
                if (statement.expression.type == 'id' && statement.expression.value == parameter.name) {
                    if (statement.type === '=' && statement.target.type === 'tuple') {
                        for (const input of statement.target.value) {
                            if (input) {
                                this._inputs.push(input.value);
                            }
                        }
                        this._body.shift();
                    }
                }
            }
        }
        else {
            this._inputs.push(parameter.name);
        }
    }

    _conditionStatement(statement) {
        if (statement.type === 'if') {
            let expression = statement.condition;
            if (!this._isBooleanLiteral(expression)) {
                if (expression.type == 'id' && this._state[expression.value]) {
                    expression = this._state[expression.value]
                }
                else {
                    expression = this._evaluateBooleanExpression(statement.condition);
                }
            }
            if (this._isBooleanLiteral(expression)) {
                switch (expression.value) {
                    case 'True':
                        this._body = statement.then.statements.concat(this._body);
                        return true;
                    case 'False':
                        this._body = statement.else.statements.concat(this._body);
                        return true;
                }
            }
        }
        return false;
    }

    _returnStatement(statement) {
        if (statement.type == 'return') {
            let variable = this._variable();
            let expression = statement.expression;
            if (this._nodeExpression(expression, variable)) {
                this._outputs.push(variable.value);
                return true;
            }
            if (expression.type == 'id' && this._state[expression.value] && this._state[expression.value].type === 'tuple' ) {
                expression = this._state[expression.value];
            }
            if (expression.type == 'id') {
                this._outputs.push(expression.value);
                return true;
            }
            if (expression.type == 'tuple') {
                let outputs = [];
                for (const item of expression.value) {
                    variable = this._variable();
                    if (this._nodeExpression(item, variable)) {
                        outputs.push(variable.value);
                        continue;
                    }
                    if (item.type == 'id') {
                        outputs.push(item.value);
                        continue;
                    }
                    return false;
                }
                this._outputs = this._outputs.concat(outputs);
                return true;
            }
        }
        return false;
    }

    _nodeExpression(expression, target) {
        if (expression.type == 'call' && (target.type == 'id' || target.type == 'tuple')) {
            let name = pytorch.Utility.target(expression.target);
            if (name.startsWith('torch.') || name.startsWith('ops.quantized')) {
                let inputs = [];
                let outputs = [];
                let args = expression.arguments;
                while (args.length > 0) {
                    let argumentExpression = args[0];
                    argumentExpression = this._moduleTensor(argumentExpression);
                    if (this._isCall(argumentExpression, 'ops.prim.data', [ {} ])) {
                        argumentExpression = argumentExpression.arguments[0];
                    }
                    if (argumentExpression.type == 'id' &&
                        this._state[argumentExpression.value]) {
                        const valueExpression = this._state[argumentExpression.value];
                        if (!pytorch.Utility.isTensor(valueExpression)) {
                            argumentExpression = this._state[argumentExpression.value];
                        }
                    }
                    if (argumentExpression.type === 'id') {
                        if (this._isBooleanLiteral(argumentExpression)) {
                            break;
                        }
                        let argument = argumentExpression.value;
                        inputs.push([ { id: argument } ]);
                        args.shift();
                        continue;
                    }
                    if (argumentExpression.type == 'list') {
                        let list = [];
                        for (const input of argumentExpression.value) {
                            let variable = this._variable();
                            if (this._nodeExpression(input, variable)) {
                                list.push({ id: variable.value });
                            }
                            else if (this._argumentExpression(input, variable)) {
                                list.push({ id: variable.value });
                            }
                            else if (input.type == 'id') {
                                list.push({ id: input.value });
                            }
                            else {
                                list = null;
                                break;
                            }
                        }
                        if (list) {
                            inputs.push(list);
                            args.shift();
                            continue;
                        }
                    }
                    if (argumentExpression.type == 'list') {
                        break;
                    }
                    if (argumentExpression.type === 'number' || argumentExpression.type == 'string' || argumentExpression.type == 'boolean') {
                        break;
                    }
                    if (argumentExpression.type === '=') {
                        break;
                    }
                    if (this._isCall(argumentExpression, 'torch.list_with_default', [ {}, {} ])) {
                        break;
                    }
                    if (this._isCall(argumentExpression, 'torch.device', [ { type: 'string' } ])) {
                        break;
                    }
                    if (this._isCall(argumentExpression, 'int', [ {} ]) ||
                        this._isCall(argumentExpression, 'float', [ {} ])) {
                        break;
                    }
                    const variable = this._variable();
                    if (this._nodeExpression(argumentExpression, variable)) {
                        inputs.push([ { id: variable.value } ]);
                        args.shift();
                        continue;
                    }
                    if (this._argumentExpression(argumentExpression, variable)) {
                        inputs.push([ { id: variable.value } ]);
                        args.shift();
                        continue;
                    }
                    if (argumentExpression.type == '.' &&
                        argumentExpression.target.type == 'id' &&
                        argumentExpression.target.value == 'CONSTANTS' &&
                        argumentExpression.member.type == 'id' &&
                        argumentExpression.member.value.startsWith('c')) {
                        const constantId = [ argumentExpression.target.value, argumentExpression.member.value ].join('.');
                        const constantIndex = parseInt(argumentExpression.member.value.substring(1), 10);
                        const constants = this.constants;
                        if (!constants || constantIndex >= constants.length) {
                            throw new pytorch.Error("Invalid constant '" + constantId + "'.");
                        }
                        const tensor = constants[constantIndex];
                        const constantTensor = new pytorch.Tensor(tensor.name, tensor, true);
                        inputs.push([ { id: constantId, initializer: constantTensor } ]);
                        args.shift();
                        continue;
                    }
                    if (argumentExpression.type == '.') {
                        const value = this._evaluateExpression(argumentExpression);
                        if (!pytorch.Utility.isTensor(value)) {
                            break;
                        }
                    }
                    throw new pytorch.Error('Unknown function argument.');
                }
                let attributes = [];
                while (args.length > 0) {
                    let attributeExpression = args[0]; 
                    if (this._isCall(attributeExpression, 'int', [ {} ]) ||
                        this._isCall(attributeExpression, 'float', [ {} ])) {
                        const tensor = this._evaluateExpression(attributeExpression.arguments[0]);
                        if (tensor && tensor.size && tensor.size.length === 1 && tensor.size[0] === 1 &&
                            tensor.storage && tensor.storage.data) {
                            const dataView = new DataView(tensor.storage.data.buffer, tensor.storage.byteOffset, tensor.storage.byteLength);
                            switch (tensor.dataType) {
                                case 'float32': {
                                    attributes.push(dataView.getFloat32(0, true));
                                    break;
                                }
                                case 'int32': {
                                    attributes.push(dataView.getInt32(0, true));
                                    break;
                                }
                            }
                            args.shift();
                            continue;
                        }
                    }
                    let intExpression = this._attributeExpression(attributeExpression);
                    if (intExpression.type == 'list' && intExpression.value.every((item) => item.type === 'number')) {
                        intExpression = intExpression.value.map((item) => parseInt(item.value, 10)); 
                    }
                    if (intExpression) {
                        attributeExpression = intExpression;
                    }
                    attributes.push(attributeExpression);
                    args.shift();
                }
                if (target.type == 'id') {
                    outputs.push(target.value);
                }
                if (target.type == 'tuple') {
                    for (const identifier of target.value) {
                        outputs.push(identifier.value);
                    }
                }
                this._nodes.push({
                    name: name,
                    attributes: attributes,
                    inputs: inputs,
                    outputs: outputs
                });
                return true;
            }
        }
        return false;
    }

    _nodeStatement(statement) {
        if (statement.type == '=') {
            const target = statement.target;
            const expression = statement.expression;
            if (target.type == 'id') {
                if (this._nodeExpression(expression, target)) {
                    this._state[target.value] = { __module__: 'torch', __name__: 'Tensor' };
                    return true;
                }
            }
            if (target.type == 'tuple' && target.value.every((e) => e.type == 'id')) {
                if (this._nodeExpression(expression, target)) {
                    for (const item of target.value) {
                        this._state[item.value] = { __module__: 'torch', __name__: 'Tensor' };
                    }
                    return true;
                }
            }
            if (target.type == 'id' &&
                expression.type == 'id' &&
                this._state[expression.value]) {
                this._state[target.value] = expression;
                return true;
            }
        }
        return false;
    }

    _attributeExpression(expression) {
        if (expression.type == 'id') {
            if (this._state[expression.value]) {
                return this._evaluateExpression(this._state[expression.value]);
            }
        }
        return this._evaluateExpression(expression);
    }

    _assignStatement(statement) {
        if (statement.type == '=') {
            const target = statement.target;
            const expression = statement.expression;
            if (target.type == 'id') {
                // _0 = ops.prim.NumToTensor(...)
                if (this._isCall(expression, 'ops.prim.NumToTensor', [ {} ])) { 
                    let sizeExpression = expression.arguments[0];
                    if (this._isCall(sizeExpression, 'torch.size', [ { type: 'id' }, {} ])) { 
                        this._state[target.value] = sizeExpression;
                        return true;
                    }
                    if (sizeExpression.type == 'id') {
                        let duplicate1 = this._state[sizeExpression.value];
                        if (duplicate1) {
                            this._state[target.value] = duplicate1;
                            return true;
                        }
                    }
                }

                // _stride_3 = torch._unwrap_optional(_3)
                // _stride_3 = ops.prim.unchecked_unwrap_optional(_127)
                if (this._isCall(expression, 'torch._unwrap_optional', [ {} ]) ||
                    this._isCall(expression, 'ops.prim.unchecked_unwrap_optional', [ {} ])) {
                    let argument = expression.arguments[0];
                    if (argument && 
                        argument.type == 'id' && 
                        this._state[argument.value] &&
                        !pytorch.Utility.isTensor(this._state[argument.value])) {
                        argument = this._state[argument.value];
                    }
                    this._state[target.value] = argument;
                    return true;
                }
                // stride = unchecked_cast(List[int], _134)
                if (this._isCall(expression, 'unchecked_cast', [ {}, { type: 'id' } ])) {
                    this._state[target.value] = expression.arguments[1];
                    return true;
                }
                // stride = annotate(List[int], [])
                if (this._isCall(expression, 'annotate', [ {}, {} ])) {
                    this._state[target.value] = expression.arguments[1];
                    return true;
                }
                // _0 = torch.size(... , ...)
                if (this._isCall(expression, 'torch.size', [ { type: 'id' }, { type: 'number' } ])) {
                    this._state[target.value] = expression;
                    return true;
                }
                // _0 = torch.len(...)
                if (this._isCall(expression, 'torch.len', [ {} ])) {
                    this._state[target.value] = expression;
                    return true;
                }
                // _output_size = torch.list_with_default([7, 7], torch.size(x0))
                if (this._isCall(expression, 'torch.list_with_default', [ {}, {} ])) {
                    this._state[target.value] = expression;
                    return true;
                }
                // _0 = int(...)
                if (this._isCall(expression, 'int', [ { type: 'id' }] )) {
                    let duplicate2 = this._state[statement.expression.arguments[0].value];
                    if (duplicate2) {
                        this._state[target.value] = duplicate2;
                        return true;
                    }
                }
                // _14 = _15
                if (expression.type === 'id' && this._isBooleanLiteral(this._state[expression.value])) {
                    this._state[target.value] = this._state[expression.value];
                    return true;
                }
                // exponential_average_factor = 0.10000000000000001
                if (expression.type === 'number') {
                    this._state[target.value] = expression;
                    return true;
                }
                // _8 = (empty, empty)
                if (expression.type === 'tuple') {
                    this._state[target.value] = expression;
                    return true;
                }
                const valueExpression = this._evaluateExpression(expression);
                if (valueExpression.type === 'number' || 
                    this._isBooleanLiteral(valueExpression) ||
                    valueExpression.type === 'tuple' ||
                    (valueExpression.type === 'list' && valueExpression.value.every((item) => item.type == 'number'))) {
                    this._state[target.value] = valueExpression;
                    return true;
                }
                if (expression.type === 'id') {
                    // _aux = None
                    if (expression.value === 'None') {
                        this._state[target.value] = expression;
                        return true;
                    }
                }
                // _0 = <boolean expression>
                const booleanExpression = this._evaluateBooleanExpression(expression);
                if (booleanExpression) {
                    this._state[target.value] = booleanExpression;
                    return true;
                }
                // _0 = self.features
                const moduleName = target.value;
                const module = this._getModule(expression);
                if (module) {
                    this._moduleMap.set(moduleName, module);
                    return true;
                }
                // _14190 = __torch__.torchvision.models.inception.InceptionOutputs(x219, aux)
                if (expression.type == 'call') {
                    const className = pytorch.Utility.target(expression.target);
                    if (className.startsWith('__torch__')) {
                        const tuple = this._type(className);
                        if (tuple && tuple.base && tuple.base.length > 0 &&
                            tuple.base[0].type === 'id' && tuple.base[0].value === 'NamedTuple') {
                            this._state[target.value] = { type: 'tuple', value: expression.arguments };
                            return true;
                        }
                    }
                }
            }
            if (target.type === 'tuple' && 
                target.value.every((item) => item.type === 'id')) {
                // _30, _31, = _24
                if (expression.type === 'id' && this._state[expression.value]) {
                    const valueExpression = this._state[expression.value];
                    if ((valueExpression.type === 'list' || valueExpression.type === 'tuple')  &&
                        target.value.length === valueExpression.value.length) {
                        for (let i = 0; i < target.value.length; i++) {
                            this._state[target.value[i].value] = valueExpression.value[i];
                        }
                        return true;
                    }
                }
            }
        }
        return false;
    }

    _getParameter(expression) {
        expression = this._moduleTensor(expression);
        if (expression.type === '.' && expression.member.type == 'id') {
            let targetModule = this._getModule(expression.target);
            if (targetModule) {
                let obj = targetModule[expression.member.value];
                if (pytorch.Utility.isTensor(obj)) {
                    obj.__parent__ = targetModule;
                    return obj;
                }
            }
        }
        return null;
    }

    _getSubmodule(module, name) {
        const obj = module[name];
        if (obj && !Array.isArray(obj) && obj.__module__ && (!obj.__name__ || !obj.__name__.endsWith('Tensor'))) {
            return obj;
        }
        return null;
    }

    _getModule(expression) {
        if (expression.type === '.') {
            let module = this._getModule(expression.target);
            if (module) {
                let submodule = this._getSubmodule(module, expression.member.value);
                if (submodule) {
                    return submodule;
                }
            }
        }
        if (expression.type == 'call' && 
            expression.target.type == 'id' && expression.target.value == 'getattr' && expression.arguments.length == 2) {
            let module = this._getModule(expression.arguments[0]);
            if (!module) {
                return null;
            }
            let name = null;
            if (expression.arguments[1].type == 'string') {
                name = expression.arguments[1].value.substring(1, expression.arguments[1].value.length - 1);
            }
            if (module) {
                let submodule = this._getSubmodule(module, name);
                if (submodule) {
                    return submodule;
                }
            }
        }
        if (expression.type == 'id') {
            if (expression.value == 'self') {
                return this.data;
            }
            const moduleName = expression.value;
            if (this._moduleMap.has(moduleName)) {
                return this._moduleMap.get(moduleName);
            }
        }
        return null;
    }

    _argumentExpression(expression, target) {
        const parameter = this._getParameter(expression);
        if (parameter) {
            parameter.__outputs__ = parameter.__outputs__ || [];
            parameter.__outputs__.push(target.value);
            this._state[target.value] = parameter;
            return true;
        }
        return false;
    }

    _argumentStatement(statement) {
        if (statement.type === '=' && 
            statement.target.type === 'id') {
            const target = statement.target;
            const expression = statement.expression;
            // _1 = self.conv1
            if (this._argumentExpression(expression, target)) {
                return true;
            }
            if (expression.type == 'list') {
                this._state[target.value] = expression;
                return true;
            }
            // _0 = "Implicit dimension choice for {} has been deprecated. Change the call to include dim=X as an argument."
            if (expression.type == 'string') {
                this._state[target.value] = expression;
                return true;
            }
            // _5 = False
            if (this._isBooleanLiteral(expression)) {
                this._state[target.value] = expression;
                return true;
            }
            // _3 = uninitialized(Tensor)
            if (this._isCall(expression, 'uninitialized', [ {} ])) {
                this._state[target.value] = expression;
                return true;
            }
            // output = (result)[0]
            if (expression.type === '[]' &&
                expression.target.type === 'id' &&
                expression.arguments.value.length === 1 &&
                expression.arguments.value[0].type === 'number') {
                const arrayExpression = this._state[expression.target.value];
                if (arrayExpression.type === 'tuple') {
                    const index = Number(expression.arguments.value[0].value);
                    this._state[target.value] = arrayExpression.value[index];
                    return true;
                }
            }
        }
        // _4, _5 = False, _3
        if (statement.type === '=' &&
            statement.target.type === 'tuple' &&
            statement.expression.type === 'tuple' &&
            statement.target.value.length == statement.expression.value.length) {
            for (let i = 0; i < statement.target.value.length; i++) {
                const target = statement.target.value[i];
                const expression = statement.expression.value[i];
                if (target.type == 'id') {
                    if (this._isBooleanLiteral(expression)) {
                        this._state[target.value] = expression;
                        continue;
                    }
                    if (expression.type === 'id') {
                        const tensorExpression = this._state[expression.value];
                        if (pytorch.Utility.isTensor(tensorExpression)) {
                            this._state[target.value] = tensorExpression;
                            continue;
                        }
                        if (tensorExpression.type === 'tuple' && tensorExpression.value.every((item) => item.type === 'id' && (item.value === 'zeros'|| item.value === 'empty'))) {
                            this._state[target.value] = tensorExpression;
                            continue;
                        }
                    }
                }
                if (this._argumentExpression(expression, target)) {
                    continue;
                }
            }
            return true;
        }
        return false;
    }

    _variable() {
        return { type: 'id', value: '_gen' + Math.random().toString(36).substring(7) };
    }

    _moduleTensor(expression) {
        if (this._isCall(expression, 'torch.t', [ {} ])) {
            return expression.arguments[0];
        }
        return expression;
    }

    _isCall(expression, name, args) {
        if (expression.type !== 'call') {
            return false;
        }
        if (pytorch.Utility.target(expression.target) !== name) {
            return false;
        }
        if (expression.arguments.length !== args.length) {
            return false;
        }
        for (let i = 0; i < args.length; i++) {
            const argument = args[i];
            if (argument.type && argument.type !== expression.arguments[i].type) {
                return false;
            }
            if (argument.value && argument.value !== expression.arguments[i].value) {
                return false;
            }
        }
        return true;
    }

    _toBooleanLiteral(value) {
        return { 'type': 'id', 'value': value ? 'True' : 'False' }; 
    }

    _isBooleanLiteral(expression) {
        return expression && expression.type === 'id' && (expression.value === 'True' || expression.value === 'False');
    }

    _evaluateExpression(expression) {
        // _150.drop_rate
        if (expression.type === '.') {
            const module = this._getModule(expression.target);
            if (module &&
                expression.member.type === 'id' &&
                Object.prototype.hasOwnProperty.call(module, expression.member.value)) {
                const value = module[expression.member.value];
                if (typeof value === 'number') {
                    return { type: 'number', value: value };
                }
                if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
                    const array = value;
                    return { type: 'list', value: array.map((item) => { return { type: 'number', value: item }; }) };
                }
                if (pytorch.Utility.isTensor(value)) {
                    return value;
                }
            }
        }
        if (expression.type === 'list') {
            const value = expression.value.map((item) => this._evaluateExpression(item));
            return { type: 'list', value: value };
        }
        // int(x)
        if (this._isCall(expression, 'int', [ {} ])) {
            return this._evaluateExpression(expression.arguments[0]);
        }
        // float(x)
        if (this._isCall(expression, 'float', [ {} ])) {
            return this._evaluateExpression(expression.arguments[0]);
        }
        // annotate(Optional[int], None)
        // annotate(List[int], [])
        if (this._isCall(expression, 'annotate', [ {}, {} ])) {
            return expression.arguments[1];
        }
        // _foo
        if (expression.type == 'id' && this._state[expression.value]) {
            return this._state[expression.value];
        }
        return expression;
    }

    _evaluateBooleanExpression(expression) {
        // torch.eq("zeros", "circular"):
        if (this._isCall(expression, 'torch.eq', [ {}, {} ])) {
            const left = this._evaluateExpression(expression.arguments[0]);
            const right = this._evaluateExpression(expression.arguments[1]);
            if (left.type === 'number' && right.type === 'number') {
                return this._toBooleanLiteral(Number(left.value) === Number(right.value));
            }
            if (left.type === 'string' && right.type === 'string') {
                return this._toBooleanLiteral(left.value === right.value);
            }
        }
        // torch.eq(torch.dim(x4), 2):
        if (this._isCall(expression, 'torch.eq', [ {}, { type: 'number' } ]) &&
            this._isCall(expression.arguments[0], 'torch.dim', [ { type: 'id' } ])) {
            return this._toBooleanLiteral(true); // TODO
        }
        // torch.ne(torch.dim(x4), 4):
        if (this._isCall(expression, 'torch.ne', [ {}, {} ])) {
            const right = this._evaluateExpression(expression.arguments[1]);
            const left = this._evaluateExpression(expression.arguments[0]);
            if (right.type === 'number') {
                if (this._isCall(expression.arguments[0], 'torch.dim', [ { type: 'id' } ]) ||
                    this._isCall(expression.arguments[0], 'torch.len', [ {} ])) {
                    return this._toBooleanLiteral(false); // TODO
                }
            }
            if (left.type === 'number') {
                if (this._isCall(expression.arguments[1], 'torch.size', [ {}, {} ])) {
                    return this._toBooleanLiteral(false); // TODO
                }
            }
            return this._toBooleanLiteral(false); // TODO
        }
        // torch.__is__(None, None)
        if (this._isCall(expression, 'torch.__is__', [ { type: 'id', value: 'None' }, { type: 'id', value: 'None' } ])) {
            return this._toBooleanLiteral(true);
        }
        // torch.__is__(<id>, None)
        if (this._isCall(expression, 'torch.__is__', [ { type: 'id' }, { type: 'id', value: 'None' } ])) {
            const argument = this._state[expression.arguments[0].value];
            return this._toBooleanLiteral(!argument && argument.value == 'None');
        }
        // torch.__is__(annotate(Optional[int], None), None)
        if (this._isCall(expression, 'torch.__is__', [ { type: 'call' }, { type: 'id', value: 'None' } ])) {
            const left = this._evaluateExpression(expression.arguments[0]);
            const right = this._evaluateExpression(expression.arguments[1]);
            if (left.type === 'id' && left.value === 'None' && right.type === 'id' && right.value === 'None') {
                return this._toBooleanLiteral(true);
            }
        }
        // _torch.__is__(1, None)
        if (this._isCall(expression, 'torch.__is__', [ { type: 'number' }, { type: 'id', value: 'None' } ])) {
            return this._toBooleanLiteral(false);
        }
        // torch.__isnot__(<id>, None)
        if (this._isCall(expression, 'torch.__isnot__', [ { type: 'id' }, { type: 'id', value: 'None' } ])) {
            let argumentExpression = expression.arguments[0];
            if (this._state[argumentExpression.value]) {
                argumentExpression = this._state[argumentExpression.value];
            }
            if (argumentExpression) {
                return this._toBooleanLiteral(argumentExpression.value !== 'None');
            }
        }
        // torch.__isnot__(self.fc1.bias, None)
        if (this._isCall(expression, 'torch.__isnot__', [ { type: '.' }, { type: 'id', value: 'None' } ])) {
            const parameter = this._getParameter(expression.arguments[0]);
            if (parameter) {
                return this._toBooleanLiteral(true);
            }
        }
        // torch.lt(0.5, 0.)
        if (this._isCall(expression, 'torch.lt', [ { type: 'number' }, { type: 'number' } ])) {
            return this._toBooleanLiteral(Number(expression.arguments[0].value) < Number(expression.arguments[1].value));
        }
        // torch.gt(0.5, 0.)
        if (this._isCall(expression, 'torch.gt', [ {}, {} ])) {
            const left = this._evaluateExpression(expression.arguments[0]);
            const right = this._evaluateExpression(expression.arguments[1]);
            if (left.type === 'number' && right.type === 'number') {
                return this._toBooleanLiteral(Number(left.value) > Number(right.value));
            }
        }
        // torch.__not__(...)
        if (this._isCall(expression, 'torch.__not__', [ { type: 'id' } ])) {
            let argumentExpression = expression.arguments[0];
            if (!this._isBooleanLiteral(argumentExpression)) {
                argumentExpression = this._state[argumentExpression.value];
            }
            if (this._isBooleanLiteral(argumentExpression)) {
                switch (argumentExpression.value) {
                    case 'True': return this._toBooleanLiteral(false);
                    case 'False': return this._toBooleanLiteral(true);
                }
            }
        }
        // torch.is_scripting()
        if (this._isCall(expression, 'torch.is_scripting', [])) {
            return this._toBooleanLiteral(true);
        }
        // _2.training
        if (expression.type === '.') {
            const module = this._getModule(expression.target);
            if (module &&
                expression.member.type === 'id' &&
                Object.prototype.hasOwnProperty.call(module, expression.member.value)) {
                const value = module[expression.member.value];
                if (Object(value) !== value) {
                    if (value === true || value === false) {
                        return this._toBooleanLiteral(value);
                    } 
                }
            }
        }
        return null;
    }

    _add(/* name, args, outputs */) {
        /*
        args = Array.prototype.slice.call(args);

        let node = {};
        let parts = name.split('.');

        node.name = parts.pop();
        node.inputs = [];
        node.outputs = [];
        node.attributes = [];

        while (args.length > 0) {
            let argument = args[0]
            if (pytorch.Utility.isTensor(argument)) {
                node.inputs.push([ argument ]);
                args.shift();
                continue;
            }
            if (Array.isArray(argument) && argument.every((tensor) => pytorch.Utility.isTensor(tensor))) {
                node.inputs.push([ argument ]);
                args.shift();
                continue;
            }
            break;
        }
        while (args.length > 0) {
            let argument = args[0]
            node.attributes.push(argument);
            args.shift();
        }

        this._nodes.push(node);
        */
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
}

pytorch.Context = class {

    constructor(parent, scope) {
        this._parent = parent || null;
        this._scope = scope || {};
    }

    push(scope) {
        return new pytorch.Context(this, scope);
    }

    pop() {
        return this._parent;
    }

    get scope() {
        return this._scope;
    }

    set(name, value) {
        this._scope[name] = value;
    }

    get(name) {
        if (name in this._scope) {
            return this._scope[name]
        }
        if (this._parent) {
            return this._parent.get(name);
        }
        return undefined;
    }

    setx(name, value) {
        let parts = name.split('.');
        if (parts.length == 1) {
            this.set(parts[0], value)
        }
        else {
            let parent = this.get(parts[0]);
            if (!parent) {
                parent = {};
                this.set(parts[0], parent)
            }
            parts.shift();
            while (parts.length > 1) {
                const part = parts.shift();
                parent[part] = parent[part] || {};
                parent = parent[part];
            }
            parent[parts[0]] = value;
        }
    }

    getx(name) {
        let parts = name.split('.');
        let value = this.get(parts[0]);
        if (value) {
            parts.shift();
            while (parts.length > 0 && value[parts[0]]) {
                value = value[parts[0]];
                parts.shift();
            }
            if (parts.length === 0) {
                return value;
            }
        }
        return undefined;
    }
}

pytorch.Utility = class {

    static target(expression) {
        if (expression.type == 'id') {
            return expression.value;
        }
        if (expression.type == '.') {
            return pytorch.Utility.target(expression.target) + '.' + pytorch.Utility.target(expression.member)
        }
        throw new pytorch.Error("Failed to resolve name '" + JSON.stringify(expression) + "'.");
    }

    static format(expression) {
        switch (expression.type) {
            case 'call': {
                let builder = [];
                for (const argument of expression.arguments) {
                    builder.push(pytorch.Utility.format(argument));
                }
                return this.target(expression.target) + '(' + builder.join(',') + ')';
            }
            case 'number':
            case 'id': {
                return expression.value;
            }
            case 'list': {
                let builder = [];
                for (const item of expression.value) {
                    builder.push(pytorch.Utility.format(item));
                }
                return '[' + builder.join(',') + ']';
            }
            case '.': {
                return pytorch.Utility.target(expression);
            }
            default:
                throw new pytorch.Error("Unknown expression type '" + expression.type + "'.");
        }
    }

    static isTensor(obj) {
        return obj && (obj.__module__ === 'torch' || obj.__module__ === 'torch.cuda') && obj.__name__ && obj.__name__.endsWith('Tensor');
    }
}

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports.ModelFactory = pytorch.ModelFactory;
}
