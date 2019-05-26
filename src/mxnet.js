/* jshint esversion: 6 */
/* eslint "indent": [ "error", 4, { "SwitchCase": 1 } ] */

var mxnet = mxnet || {};
var marked = marked || require('marked');
var long = long || { Long: require('long') };
var zip = zip || require('./zip');

mxnet.ModelFactory = class {

    match(context) {
        var extension = context.identifier.split('.').pop().toLowerCase();
        if (extension == 'model') {
            var buffer = context.buffer;
            if (buffer && buffer.length > 2 && buffer[0] == 0x50 && buffer[1] == 0x4B) {
                return true;
            }
        }
        if (extension == 'json') {
            var json = context.text;
            if (json.indexOf('"nodes":', 0) != -1) {
                try {
                    var symbol = JSON.parse(json);
                    if (symbol && symbol.nodes && symbol.arg_nodes && symbol.heads) {
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
        var identifier = context.identifier;
        var extension = context.identifier.split('.').pop().toLowerCase();
        var symbol = null;
        var params = null;
        var format = null;
        switch (extension) {
            case 'json':
                try {
                    symbol = JSON.parse(context.text);
                    if (symbol && symbol.nodes && symbol.nodes.some((node) => node && node.op == 'tvm_op')) {
                        format  = 'TVM';
                    }
                    var mxnet_extension = '-symbol.json';
                    if (identifier.toLowerCase().endsWith(mxnet_extension)) {
                        var paramsIdentifier = identifier.substring(0, identifier.length - mxnet_extension.length) + '-0000.params';
                        return context.request(paramsIdentifier, null).then((data) => {
                            params = data;
                            return this._openModel(identifier, format, null, symbol, null, params, host);
                        }).catch(() => {
                            return this._openModel(identifier, format, null, symbol, null, params, host);
                        });
                    }
                    return this._openModel(identifier, format, null, symbol, null, null, host);
                }
                catch (error) {
                    host.exception(error, false);
                    throw new mxnet.Error(error.message), null;
                }
            case 'model':
                var entries = {};
                try {
                    var archive = new zip.Archive(context.buffer, host.inflateRaw);
                    for (var entry of archive.entries) {
                        entries[entry.name] = entry;
                    }
                }
                catch (err) {
                    throw new mxnet.Error('Failed to decompress ZIP archive. ' + err.message);
                }

                var manifestEntry = entries['MANIFEST.json'];
                var rootFolder = '';
                if (!manifestEntry) {
                    var folders = Object.keys(entries).filter((name) => name.endsWith('/')).filter((name) => entries[name + 'MANIFEST.json']);
                    if (folders.length != 1) {
                        throw new mxnet.Error("Manifest not found in '" + context.identifier + "'.");
                    }
                    rootFolder = folders[0];
                    manifestEntry = entries[rootFolder + 'MANIFEST.json'];
                }

                var decoder = new TextDecoder('utf-8');
                var manifest = null;
                try {
                    manifest = JSON.parse(decoder.decode(manifestEntry.data));
                }
                catch (err) {
                    throw new mxnet.Error('Failed to read manifest. ' + err.message);
                }
        
                if (!manifest.Model) {
                    throw new mxnet.Error('Manifest does not contain model.');
                }

                var modelFormat = manifest.Model['Model-Format'];
                if (modelFormat && modelFormat != 'MXNet-Symbolic') {
                    throw new mxnet.Error('Model format \'' + modelFormat + '\' not supported.');
                }
        
                if (!manifest.Model.Symbol) {
                    throw new mxnet.Error('Manifest does not contain symbol entry.');
                }

                try {
                    var symbolEntry = entries[rootFolder + manifest.Model.Symbol];
                    symbol = JSON.parse(decoder.decode(symbolEntry.data));
                }
                catch (err) {
                    throw new mxnet.Error('Failed to load symbol entry. ' + err.message);
                }

                var signature = null;
                try {
                    if (manifest.Model.Signature) {
                        var signatureEntry = entries[rootFolder + manifest.Model.Signature];
                        if (signatureEntry) {
                            signature = JSON.parse(decoder.decode(signatureEntry.data));
                        }
                    }
                }
                catch (err) {
                    // continue regardless of error
                }
                try {
                    if (manifest.Model.Parameters) {
                        var parametersEntry = entries[rootFolder + manifest.Model.Parameters];
                        if (parametersEntry) {
                            params = parametersEntry.data;
                        }
                    }
                }
                catch (err) {
                    // continue regardless of error
                }

                try {
                    if (manifest) {
                        format = 'MXNet Model Server';
                        if (manifest['Model-Archive-Version']) {
                            format += ' v' + manifest['Model-Archive-Version'].toString();
                        }
                    }
                    return this._openModel(identifier, format, manifest, symbol, signature, params, host);
                }
                catch (error) {
                    var message = error && error.message ? error.message : error.toString();
                    message = message.endsWith('.') ? message.substring(0, message.length - 1) : message;
                    throw new mxnet.Error(message + " in '" + identifier + "'.");
                }
            default:
                throw new mxnet.Error('Unsupported file extension.');
        }
    }

    _openModel(identifier, format, manifest, symbol, signature, params, host) {
        return mxnet.Metadata.open(host).then((metadata) => {
            var parameters = {};
            if (params) {
                try {
                    var stream = new ndarray.Stream(params);
                    for (var key of Object.keys(stream.arrays)) {
                        var name = key;
                        if (name.startsWith('arg:') || name.startsWith('aux:')) {
                            name = key.substring(4);
                        }
                        parameters[name] = stream.arrays[key];
                    }
                }
                catch (error) {
                    // continue regardless of error
                }
            }
            try {
                return new mxnet.Model(metadata, format, manifest, symbol, signature, parameters);
            }
            catch (error) {
                host.exception(error, false);
                var message = error && error.message ? error.message : error.toString();
                message = message.endsWith('.') ? message.substring(0, message.length - 1) : message;
                throw new mxnet.Error(message + " in '" + identifier + "'.");
            }
        });
    }
};

mxnet.Model = class {

    constructor(metadata, format, manifest, symbol, signature, parameters) {
        if (!symbol) {
            throw new mxnet.Error('JSON file does not contain MXNet data.');
        }
        if (!symbol.hasOwnProperty('nodes')) {
            throw new mxnet.Error('JSON file does not contain an MXNet \'nodes\' property.');
        }
        if (!symbol.hasOwnProperty('arg_nodes')) {
            throw new mxnet.Error('JSON file does not contain an MXNet \'arg_nodes\' property.');
        }
        if (!symbol.hasOwnProperty('heads')) {
            throw new mxnet.Error('JSON file does not contain an MXNet \'heads\' property.');
        }

        this._format = format;

        if (manifest) {
            if (manifest.Model && manifest.Model['Model-Name']) {
                this._name = manifest.Model['Model-Name'];
            }
            if (manifest.Model && manifest.Model.Description && this._name != manifest.Model.Description) {
                this._description = manifest.Model.Description;
            }
            if (manifest.Engine && manifest.Engine.MXNet) {
                var engineVersion = mxnet.Model._convert_version(manifest.Engine.MXNet);
                this._engine = 'MXNet v' + (engineVersion ? engineVersion : manifest.Engine.MXNet.toString());
            }
        }

        if (!this._format) {
            if (symbol.attrs && symbol.attrs.mxnet_version) {
                var version = mxnet.Model._convert_version(symbol.attrs.mxnet_version);
                if (version) {
                    this._format = 'MXNet v' + version;
                }
            }
        }

        if (!this._format) {
            this._format = 'MXNet';
        }

        this._graphs = [];
        this._graphs.push(new mxnet.Graph(metadata, manifest, symbol, signature, parameters));
    }

    get name() {
        return this._name;
    }

    get format() {
        return this._format;
    }

    get description() {
        return this._description;
    }

    get runtime() {
        return this._engine;
    }

    get graphs() {
        return this._graphs;
    }

    static _convert_version(value) {
        if (Array.isArray(value)) {
            if (value.length == 2 && value[0] == 'int') {
                var major = Math.floor(value[1] / 10000) % 100;
                var minor = Math.floor(value[1] / 100) % 100;
                var patch = Math.floor(value[1]) % 100;
                return [ major.toString(), minor.toString(), patch.toString() ].join('.');
            }
        }
        return null;
    }
};

mxnet.Graph = class {

    constructor(metadata, manifest, symbol, signature, parameters)
    {
        this._metadata = metadata;
        this._nodes = [];

        var node;
        var nodes = symbol.nodes;
        for (node of nodes) {
            if (node.op && node.op != 'null') { 
                var operator = node.op;
                var attrs = node.attrs || node.attr || node.param;
                if (operator == 'tvm_op' && attrs && attrs.func_name) {
                    operator = attrs.func_name;
                }
            }
        }

        var inputs = {};
        var input;
        if (signature && signature.inputs) {
            for (input of signature.inputs) {
                inputs[input.data_name] = input;
            }
        }
        var outputs = {};
        var output;
        if (signature && signature.outputs) {
            for (output of signature.outputs) {
                outputs[output.data_name] = output;
            }
        }

        for (node of nodes) {
            node.outputs = [];
        }
        for (node of nodes) {
            node.inputs = node.inputs.map((input) => {
                return mxnet.Graph._updateOutput(nodes, input);
            });
        }

        var outputCountMap = {};
        for (node of nodes) {
            for (output of node.outputs) {
                outputCountMap[output] = (outputCountMap[output] || 0) + 1;
            }
        }

        var argumentMap = {};
        for (var index of symbol.arg_nodes) {
            argumentMap[index] = (index < nodes.length) ? nodes[index] : null;
        }

        this._outputs = [];
        for (var i = 0; i < symbol.heads.length; i++) {
            var head = symbol.heads[i];
            var outputId = mxnet.Graph._updateOutput(nodes, head);
            var outputName = nodes[outputId[0]] ? nodes[outputId[0]].name : ('output' + ((i == 0) ? '' : (i + 1).toString()));
            var outputType = null;
            var outputSignature = outputs[outputName];
            if (outputSignature && outputSignature.data_shape) {
                outputType = new mxnet.TensorType(null, new mxnet.TensorShape(outputSignature.data_shape));
            }
            this._outputs.push(new mxnet.Argument(outputName, [ new mxnet.Connection('[' + outputId.join(',') + ']', outputType, null) ]));
        }

        var initializerMap = {};
        for (node of nodes.filter((node, index) => !argumentMap[index])) {
            this._nodes.push(new mxnet.Node(this._metadata, node, argumentMap, initializerMap, parameters));
        }

        this._inputs = [];
        for (var argumentKey of Object.keys(argumentMap)) {
            var argument = argumentMap[argumentKey];
            if (argument && (!argument.inputs || argument.inputs.length == 0) && (argument.outputs && argument.outputs.length == 1)) {
                var inputId = argument.outputs[0];
                var inputName = argument.name;
                var inputType = null;
                var inputSignature = inputs[inputName];
                if (inputSignature && inputSignature.data_shape) {
                    inputType = new mxnet.TensorType(null, new mxnet.TensorShape(inputSignature.data_shape));
                }
                this._inputs.push(new mxnet.Argument(inputName, [ new mxnet.Connection('[' + inputId.join(',') + ']', inputType) ]));
            }
        }
    }

    get name() {
        return '';
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

    static _updateOutput(nodes, input) {
        var nodeIndex = input[0];
        var node = nodes[nodeIndex];
        var outputIndex = input[1];
        if (node) {
            while (outputIndex >= node.outputs.length) {
                node.outputs.push([ nodeIndex, node.outputs.length ]);
            }
        }
        return [ nodeIndex, outputIndex ];
    }
};

mxnet.Argument = class {
    constructor(name, connections) {
        this._name = name;
        this._connections = connections;
    }

    get name() {
        return this._name;
    }

    get visible() {
        return true;
    }

    get connections() {
        return this._connections;
    }
};

mxnet.Connection = class {
    constructor(id, type, initializer) {
        this._id = id;
        this._type = type || null;
        this._initializer = initializer || null;
    }

    get id() {
        if (this._initializer) {
            return this._initializer.name;
        }
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

mxnet.Node = class {

    constructor(metadata, node, argumentMap, initializerMap, parameters) {
        this._metadata = metadata;
        this._operator = node.op;
        this._name = node.name;
        this._inputs = node.inputs;
        this._outputs = node.outputs;
        this._attributes = [];
        var attrs = node.attrs || node.attr || node.param;
        if (attrs) {
            if (this._operator == 'tvm_op' && attrs.func_name) {
                this._operator = attrs.func_name;
            }
            for (var attributeName of Object.keys(attrs)) {
                if (this._operator != 'tvm_op' && attributeName != 'func_name') {
                    this._attributes.push(new mxnet.Attribute(this._metadata, this.operator, attributeName, attrs[attributeName]));
                }
            }
        }
        if (this._operator == 'RNN') {
            this._inputs = this._inputs.map((input) => {
                var argumentNodeIndex = input[0];
                var argument = argumentMap[argumentNodeIndex];
                if (argument && argument.op == 'null' && argument.name &&
                    argument.name.endsWith('_parameters') && argument.attr && argument.attr.__init__) {
                    this._attributes.push(new mxnet.Attribute(this._metadata, this.operator, argument.name, argument.attr.__init__));
                    delete argumentMap[argumentNodeIndex];
                    return null;
                }
                return input;
            }); 
            this._inputs = this._inputs.filter((item) => item != null);
        }

        this._initializers = {};
        for (var input of this._inputs) {
            var id = '[' + input.join(',') + ']';
            var initializer = initializerMap[id];
            if (!initializer) {
                var argumentNodeIndex = input[0];
                var argument = argumentMap[argumentNodeIndex];
                if (argument && argument.name &&
                    (!argument.inputs || argument.inputs.length == 0) &&
                    (argument.outputs && argument.outputs.length == 1)) {
                    var parameter = parameters[argument.name];
                    if (parameter) {
                        initializer  = new mxnet.Tensor('Initializer', argument.name, parameter.dataType, parameter.shape.dimensions, parameter.data);
                        delete argumentMap[argumentNodeIndex];
                    }
                    else {
                        var prefix = this._name;
                        if (prefix.endsWith('_fwd')) {
                            prefix = prefix.slice(0, -3);
                        }
                        if (argument.name && (argument.name.startsWith(prefix + '_') || argument.name.startsWith(prefix + '.'))) {
                            var dataType = '?';
                            var shape = [];
                            if (argument.attrs && argument.attrs.__dtype__ && argument.attrs.__shape__) {
                                try {
                                    dataType = parseInt(argument.attrs.__dtype__);
                                    shape = JSON.parse('[' + argument.attrs.__shape__.replace('(', '').replace(')', '').split(' ').join('').split(',').map((dimension => dimension || '"?"' )).join(',') + ']');
                                }
                                catch (err) {
                                    // continue regardless of error
                                }
                            }
                            initializer = new mxnet.Tensor('Initializer', argument.name, dataType, shape, null);
                            delete argumentMap[argumentNodeIndex];
                        }
                    }
                }
            }
            if (initializer) {
                this._initializers[id] = initializer;
                initializerMap[id] = initializer;
            }
        }
    }

    get operator() {
        return this._operator;
    }

    get category() {
        var schema = this._metadata.getSchema(this._operator); 
        return schema && schema.category ? schema.category : '';
    }

    get documentation() {
        var schema = this._metadata.getSchema(this._operator); 
        if (schema) {
            schema = JSON.parse(JSON.stringify(schema));
            schema.name = this._operator;
            if (schema.description) {
                schema.description = marked(schema.description);
            }
            if (schema.attributes) {
                for (var attribute of schema.attributes) {
                    if (attribute.description) {
                        attribute.description = marked(attribute.description);
                    }
                }
            }
            if (schema.inputs) {
                for (var input of schema.inputs) {
                    if (input.description) {
                        input.description = marked(input.description);
                    }
                }
            }
            if (schema.outputs) {
                for (var output of schema.outputs) {
                    if (output.description) {
                        output.description = marked(output.description);
                    }
                }
            }
            return schema;
        }
        return '';
    }

    get name() {
        return this._name;
    }

    get inputs() {
        var args = [];
        var inputIndex = 0;
        var inputs = this._inputs;
        var schema = this._metadata.getSchema(this.operator);
        if (schema && schema.inputs) {
            for (var inputDef of schema.inputs) {
                if (inputIndex < inputs.length || inputDef.option != 'optional') {
                    var inputCount = (inputDef.option == 'variadic') ? (inputs.length - inputIndex) : 1;
                    var inputConnections = [];
                    for (var input of inputs.slice(inputIndex, inputIndex + inputCount)) {
                        var id = '[' + input.join(',') + ']';
                        if (id != '' || inputDef.option != 'optional') {
                            inputConnections.push(new mxnet.Connection(id, inputDef.type, this._initializers[id]));
                        }
                    }
                    args.push(new mxnet.Argument(inputDef.name, inputConnections));
                    inputIndex += inputCount;
                }
            }
        }
        if (inputIndex < inputs.length) {
            args = args.concat(inputs.slice(inputIndex).map((input, index) => {
                var id = '[' + input.join(',') + ']';
                return new mxnet.Argument((inputIndex + index).toString(), [ 
                    new mxnet.Connection(id, null, this._initializers[id])
                ]);
            }));
        }
        return args;
    }

    get outputs() {
        var args = [];
        var outputIndex = 0;
        var outputs = this._outputs;
        var schema = this._metadata.getSchema(this.operator);
        if (schema && schema.outputs) {
            for (var outputDef of schema.outputs) {
                if (outputIndex < outputs.length || outputDef.option != 'optional') {
                    var outputConnections = [];
                    var outputCount = (outputDef.option == 'variadic') ? (outputs.length - outputIndex) : 1;
                    for (var output of outputs.slice(outputIndex, outputIndex + outputCount)) {
                        outputConnections.push(new mxnet.Connection('[' + output.join(',') + ']', null, null));
                    }
                    args.push(new mxnet.Argument(outputDef.name, outputConnections));
                    outputIndex += outputCount;
                }
            }
        }
        if (outputIndex < outputs.length) {
            args = args.concat(outputs.slice(outputIndex).map((output, index) => {
                return new mxnet.Argument((outputIndex + index).toString(), [ 
                    new mxnet.Connection('[' + output.join(',') + ']', null, null)
                ]);
            }));
        }
        return args;
    }

    get attributes() {
        return this._attributes;
    }
};

mxnet.Attribute = class {

    constructor(metadata, operator, name, value) {
        this._name = name;
        this._value = value;

        var number;
        var schema = metadata.getAttributeSchema(operator, name);
        if (schema && schema.type) {
            switch (schema.type) {
                case 'boolean':
                    switch (value) {
                        case 'True':
                            this._value = true;
                            break;
                        case 'False':
                            this._value = false;
                            break;
                    }
                    break;
                case 'int32':
                    number = Number.parseInt(this._value, 10);
                    this._value = Number.isNaN(this._value - number) ? value : number;
                    break;
                case 'float32':
                case 'float64':
                    number = Number.parseFloat(this._value);
                    this._value = Number.isNaN(this._value - number) ? value : number;
                    break;
                case 'int32[]':
                    if (this._value.length > 2 && this._value.startsWith('(') && this._value.endsWith(')')) {
                        var array = [];
                        var items = this._value.substring(1, this._value.length - 1).split(',')
                            .map((item) => item.trim())
                            .map((item) => item.endsWith('L') ? item.substring(0, item.length - 1) : item);
                        for (var item of items) {
                            number = Number.parseInt(item, 10);
                            if (Number.isNaN(item - number)) {
                                array = null;
                            }
                            else if (array != null) {
                                array.push(number);
                            }
                        }
                        if (array != null) {
                            this._value = array;
                        }
                    }
                    break;
            }
        }

        if (schema) {
            if (schema.hasOwnProperty('visible') && !schema.visible) {
                this._visible = false;
            }
            else if (schema.hasOwnProperty('default')) {
                var defaultValue = schema.default;
                if (this._value == defaultValue) {
                    this._visible = false;
                }
                else if (Array.isArray(this._value) && Array.isArray(defaultValue)) {
                    defaultValue = defaultValue.slice(0, defaultValue.length);
                    if (defaultValue.length > 1 && defaultValue[defaultValue.length - 1] == null) {
                        defaultValue.pop();
                        while (defaultValue.length < this._value.length) {
                            defaultValue.push(defaultValue[defaultValue.length - 1]); 
                        }
                    }
                    if (this._value.every((item, index) => { return item == defaultValue[index]; })) {
                        this._visible = false;
                    }
                }
            }
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
};

mxnet.Tensor = class {
    
    constructor(kind, name, dataType, shape, data) {
        this._kind = kind;
        this._name = name;
        this._dataType = dataType;
        this._data = data;
        this._type = new mxnet.TensorType(dataType, new mxnet.TensorShape(shape));
    }

    get kind() {
        return 'Initializer';
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
        var context = this._context();
        if (context.state) {
            return null;
        }
        context.limit = Number.MAX_SAFE_INTEGER;
        return this._decode(context, 0);
    }

    toString() {
        var context = this._context();
        if (context.state) {
            return '';
        }
        context.limit = 10000;
        var value = this._decode(context, 0);
        return JSON.stringify(value, null, 4);
    }

    _context() {

        var context = {};
        context.state = null;
        context.index = 0;
        context.count = 0;

        if (!this._data) {
            context.state = 'Tensor data is empty.';
            return context;
        }

        if (this._type.dataType == '?') {
            context.state = 'Tensor has no data type.';
            return context;
        }

        if (this._type.dataType.length <= 1) {
            context.state = 'Tensor has unknown data type.';
            return context;
        }

        if (this._type.shape.length < 1) {
            context.state = 'Tensor has unknown shape.';
            return context;
        }

        context.dimensions = this._type.shape.dimensions;
        context.data = new DataView(this._data.buffer, this._data.byteOffset, this._data.byteLength);
        return context;
    }

    _decode(context, dimension) {
        var results = [];
        var size = context.dimensions[dimension];
        if (dimension == context.dimensions.length - 1) {
            for (var i = 0; i < size; i++) {
                if (context.count > context.limit) {
                    results.push('...');
                    return results;
                }
                switch (this._dataType)
                {
                    case 0: // float32
                        results.push(context.data.getFloat32(context.index, true));
                        context.index += 4;
                        context.count++;
                        break;
                    case 1: // float64
                        results.push(context.data.getFloat64(context.index, true));
                        context.index += 8;
                        context.count++;
                        break;
                    case 2: // float16:
                        results.push(mxnet.Tensor._decodeNumberFromFloat16(context.data.getUint16(context.index, true)));
                        context.index += 2;
                        context.count++;
                        break;
                    case 3: // uint8
                        results.push(context.data.getUint8(context.index, true));
                        context.index += 1;
                        context.count++;
                        break;
                    case 4: // int32
                        results.push(context.data.getInt32(context.index, true));
                        context.index += 4;
                        context.count++;
                        break;
                    case 5: // int8
                        results.push(context.data.getInt8(context.index, true));
                        context.index += 1;
                        context.count++;
                        break;
                    case 6: // int64
                        results.push(new long.Long(context.data.getUint32(context.index, true), context.data.getUint32(context.index + 4, true), true));
                        context.index += 8;
                        context.count++;
                        break;
                }
            }
        }
        else {
            for (var j = 0; j < size; j++) {
                if (context.count > context.limit) {
                    results.push('...');
                    return results;
                }
                results.push(this._decode(context, dimension + 1));
            }
        }
        return results;
    }

    static _decodeNumberFromFloat16(value) {
        var s = (value & 0x8000) >> 15;
        var e = (value & 0x7C00) >> 10;
        var f = value & 0x03FF;
        if(e == 0) {
            return (s ? -1 : 1) * Math.pow(2, -14) * (f / Math.pow(2, 10));
        }
        else if (e == 0x1F) {
            return f ? NaN : ((s ? -1 : 1) * Infinity);
        }
        return (s ? -1 : 1) * Math.pow(2, e-15) * (1 + (f / Math.pow(2, 10)));
    }
};

mxnet.TensorType = class {

    constructor(dataType, shape) {
        mxnet.TensorType._dataTypeNameTable = mxnet.Tensor._dataTypeTable || [ 'float32', 'float64', 'float16', 'uint8', 'int32', 'int8', 'int64' ];
        this._dataType = dataType;
        this._shape = shape;
    }

    get dataType() {
        var dataType = '?';
        if (this._dataType || this._dataType === 0) {
            if (this._dataType < mxnet.TensorType._dataTypeNameTable.length) {
                dataType = mxnet.TensorType._dataTypeNameTable[this._dataType];
            }
            else {
                dataType = this._dataType.toString();
            }
        }
        return dataType;
    }

    get shape() {
        return this._shape;
    }

    toString() {
        return (this.dataType || '?') + this._shape.toString();
    }
};

mxnet.TensorShape = class {

    constructor(dimensions) {
        this._dimensions = dimensions;
    }

    get dimensions() {
        return this._dimensions;
    }

    toString() {
        if (this._dimensions) {
            if (this._dimensions.length == 0) {
                return '';
            }
            return '[' + this._dimensions.map((dimension) => dimension.toString()).join(',') + ']';
        }
        return '';
    }
};

mxnet.Metadata = class {

    static open(host) {
        if (mxnet.Metadata._metadata) {
            return Promise.resolve(mxnet.Metadata._metadata);
        }
        return host.request(null, 'mxnet-metadata.json', 'utf-8').then((data) => {
            mxnet.Metadata._metadata = new mxnet.Metadata(data);
            return mxnet.Metadata._metadata;
        }).catch(() => {
            mxnet.Metadata._metadata = new mxnet.Metadata(null);
            return mxnet.Metadata._metadata;
        });
    }

    constructor(data) {
        this._map = {};
        this._attributeCache = {};
        if (data) {
            var items = JSON.parse(data);
            if (items) {
                for (var item of items) {
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
        var map = this._attributeCache[operator];
        if (!map) {
            map = {};
            var schema = this.getSchema(operator);
            if (schema && schema.attributes) {
                for (var attribute of schema.attributes) {
                    map[attribute.name] = attribute;
                }
            }
            this._attributeCache[operator] = map;
        }
        return map[name] || null;
    }
};

mxnet.Error = class extends Error {

    constructor(message) {
        super(message);
        this.name = 'Error loading MXNet model.';
    }
};

var ndarray = ndarray || {};

ndarray.Stream = class {

    constructor(buffer) {

        this._arrays = {};

        var reader = new ndarray.Reader(buffer);
        if (!reader.checkSignature([ 0x12, 1, 0, 0, 0, 0, 0, 0 ])) {
            throw new ndarray.Error('Invalid signature.');
        }
        if (!reader.checkSignature([ 0, 0, 0, 0, 0, 0, 0, 0 ])) {
            throw new ndarray.Error('Invalid reserved block.');
        }

        var data = [];
        for (var dataSize = reader.uint64(); dataSize > 0; dataSize--) {
            data.push(new ndarray.Array(reader));
        }

        var decoder = new TextDecoder('ascii');
        var names = [];
        for (var namesSize = reader.uint64(); namesSize > 0; namesSize--) {
            var length = reader.uint64();
            var name = decoder.decode(reader.read(length));
            names.push(name);
        }

        if (names.length != data.length) {
            throw new ndarray.Error('Label count mismatch.');
        }

        for (var i = 0; i < names.length; i++) {
            this._arrays[names[i]] = data[i];
        }
    }

    get arrays() {
        return this._arrays;
    }

};

ndarray.Array = class { 

    constructor(reader) {

        ndarray.Array._dataTypeSizeTable = [ 4, 8, 2, 1, 4, 1, 8 ];

        if (reader.checkSignature([ 0xc9, 0xfa, 0x93, 0xF9 ])) {
            this._loadV2(reader);
        }
        else if (reader.checkSignature([ 0xc8, 0xfa, 0x93, 0xF9 ])) {
            this._loadV1(reader);
        }
        else {
            this._loadV0(reader);
        }
    }

    _loadV2(reader) {
        var stype = reader.uint32();
        var num_aux_data = 0;
        switch (stype) {
            case 0: num_aux_data = 0; break; // kDefaultStorage
            case 1: num_aux_data = 1; break; // kRowSparseStorage
            case 2: num_aux_data = 2; break; // kCSRStorage
        }
        this.sshape = null;
        if (num_aux_data > 0) {
            this.sshape = new ndarray.Shape(reader, true);
        }
        this._shape = new ndarray.Shape(reader, true);
        if (this._shape.dimensions.length == 0) {
            return;
        }
        this._context = new ndarray.Context(reader);
        this._dataType = reader.uint32();
        if (num_aux_data > 0) {
            throw new ndarray.Error('Not implemented.');
        }
        var dataTypeSize = (this._dataType < ndarray.Array._dataTypeSizeTable.length) ? ndarray.Array._dataTypeSizeTable[this._dataType] : 0;
        var size = dataTypeSize * this._shape.size();
        this._data = reader.read(size);
    }

    _loadV1(reader) {
        this._shape = new ndarray.Shape(reader, true);
        if (this._shape.dimensions.length == 0) {
            return;
        }
        this._context = new ndarray.Context(reader);
        this._dataType = reader.uint32();
        var dataTypeSize = (this._dataType < ndarray.Array._dataTypeSizeTable.length) ? ndarray.Array._dataTypeSizeTable[this._dataType] : 0;
        var size = dataTypeSize * this._shape.size();
        this._data = reader.read(size);
    }

    _loadV0(reader) {
        this._shape = new ndarray.Shape(reader, false);
        this._context = new ndarray.Context(reader);
        this._dataType = reader.uint32();
        var dataTypeSize = (this._dataType < ndarray.Array._dataTypeSizeTable.length) ? ndarray.Array._dataTypeSizeTable[this._dataType] : 0;
        var size = dataTypeSize * this._shape.size();
        this._data = reader.read(size);
    }

    get dataType() {
        return this._dataType;
    }

    get shape() { 
        return this._shape;
    }

    get data() {
        return this._data;
    }
};

ndarray.Shape = class {

    constructor(reader, uint64) {
        var ndim = reader.uint32();
        this._dimensions = [];
        for (var i = 0; i < ndim; i++) {
            this._dimensions.push(uint64 ? reader.uint64() : reader.uint32());
        }
    }

    get dimensions() {
        return this._dimensions;
    }

    size() {
        var result = 1;
        for (var dimension of this._dimensions) {
            result *= dimension;
        }
        return result;
    }
};

ndarray.Context = class {

    constructor(reader) {
        this._deviceType = reader.uint32();
        this._deviceId = reader.uint32();
    }
};

ndarray.Reader = class { 

    constructor(buffer) {
        this._buffer = buffer;
        this._position = 0;
        this._end = buffer.length;
    }

    checkSignature(signature) {
        if (this._position + signature.length <= this._end) {
            for (var i = 0; i < signature.length; i++) {
                if (this._buffer[this._position + i] != signature[i]) {
                    return false;
                }
            }
        }
        this._position += signature.length;
        return true;
    }

    read(size) {
        if (this._position + size > this._end) {
            throw new ndarray.Error('Data not available.');
        }
        var data = this._buffer.subarray(this._position, this._position + size);
        this._position += size;
        return data;
    }

    uint16() {
        if (this._position + 2 > this._end) {
            throw new ndarray.Error('Data not available.');
        }
        var value = this._buffer[this._position] | (this._buffer[this._position + 1] << 8);
        this._position += 2;
        return value;
    }

    uint32() {
        return this.uint16() | (this.uint16() << 16);
    }

    uint64() {
        var value = this.uint32();
        if (this.uint32() != 0) {
            throw new ndarray.Error('Large int64 value.');
        }
        return value;
    }
};

ndarray.Error = class extends Error {
    constructor(message) {
        super(message);
        this.name = 'NDArray Error';
    }
};

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports.ModelFactory = mxnet.ModelFactory;
}