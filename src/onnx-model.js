/*jshint esversion: 6 */

var onnx = null;

class OnnxModelFactory {

    match(buffer, identifier) {
        var extension = identifier.split('.').pop();
        return (identifier != 'saved_model.pb') && (identifier != 'predict_net.pb') && (extension == 'onnx' || extension == 'pb');
    }

    open(buffer, identifier, host, callback) { 
        host.import('/onnx.js', (err) => {
            if (err) {
                callback(err, null);
                return;
            }
            var model = null;
            try {
                onnx = protobuf.roots.onnx.onnx;
                model = onnx.ModelProto.decode(buffer);
            }
            catch (error) {
                callback(new OnnxError('Protocol Buffer loader failed to decode ModelProto input stream (' + error.message + ').'), null);
                return;
            }
            var result = null;
            try {
                result = new OnnxModel(model);
            }
            catch (error) {
                callback(new OnnxError(error.message), null);
                return;
            }
            OnnxOperatorMetadata.open(host, (err, metadata) => {
                callback(null, result);
            });
        });
    }
}

class OnnxModel {

    constructor(model) {
        this._model = model;
        this._irVersion = model.irVersion;
        this._opsetImport = model.opsetImport;
        this._producerName = model.producerName;
        this._producerVersion = model.producerVersion;
        this._domain = model.domain;
        this._modelVersion = model.modelVersion;
        this._docString = model.docString;
        this._metadataProps = model.metadataProps;
    }

    get properties() {
        var results = [];
        var format = 'ONNX';
        if (this._irVersion) {
            format = format + ' v' + this._irVersion.toString();
        }
        results.push({ name: 'format', value: format });
        if (this._opsetImport && this._opsetImport.length > 0) {
            var opsetImports = [];
            this._opsetImport.forEach((opsetImport) => {
                var domain = opsetImport.domain ? opsetImport.domain : 'ai.onnx';
                var result = domain + ' v' + opsetImport.version;
                if (!opsetImports.includes(result)) {
                    opsetImports.push(result);
                }
            });
            results.push({ name: 'imports', value: opsetImports.join(', ') });
        }
        var producer = [];
        if (this._producerName) {
            producer.push(this._producerName);
        }
        if (this._producerVersion && this._producerVersion.length > 0) {
            producer.push(this._producerVersion);
        }
        if (producer.length > 0) {
            results.push({ 'name': 'producer', 'value': producer.join(' ') });
        }
        if (this._domain) {
            results.push({ name: 'domain', value: this._domain });
        }
        if (this._modelVersion) {
            results.push({ name: 'version', value: this._modelVersion });
        }
        if (this._docString) {
            results.push({ name: 'description', value: this._docString });
        }
        var metadata = {};
        if (this._metadataProps)
        {
            this._metadataProps.forEach((metadataProp) => {
                metadata[metadataProp.key] = metadataProp.value;
            });
        }
        if (metadata.author) {
            results.push({ name: 'author', value: metadata.author });
        }
        if (metadata.company) {
            results.push({ name: 'company', value: metadata.company });
        }
        if (metadata.converted_from) {
            results.push({ name: 'source', value: metadata.converted_from });
        }
        var license = [];
        if (metadata.license && metadata.license.length > 0) {
            license.push(metadata.license);
        }
        if (metadata.license_url && metadata.license_url.length > 0) {
            license.push('<a href=\'' + metadata.license_url + '\'>' + metadata.license_url + '</a>');
        }
        if (license.length > 0) {
            results.push({ name: 'license', value: license.join(' ') });
        }

        return results;
    }

    get graphs() {
        if (this._model) {
            this._graphs = [];
            if (this._model.graph) {
                var metadata = new OnnxGraphOperatorMetadata(this._opsetImport);
                var graph = new OnnxGraph(metadata, this._model.graph, 0);
                this._graphs.push(graph);
            }
            delete this._model;
        }
        return this._graphs;
    }
}

class OnnxGraph {

    constructor(metadata, graph, index) {
        this._metadata = metadata;
        this._node = '';
        this._description = '';
        this._nodes = [];
        this._inputs = [];
        this._outputs = [];
        this._operators = {};

        if (graph) {
            this._name = graph.name || ('(' + index.toString() + ')');
            this._description = graph.docString || '';

            this._initializerMap = {};
            this._connectionMap = {};
            graph.initializer.forEach((tensor) => {
                this._initializerMap[tensor.name] = new OnnxTensor(tensor, tensor.name, 'Initializer');
            });
            graph.valueInfo.forEach((valueInfo) => {
                this._connection(valueInfo.name, valueInfo.type, valueInfo.docString);
            });

            var nodes = [];
            var outputCountMap = {};
            graph.node.forEach((node) => {
                this._operators[node.opType] = (this._operators[node.opType] || 0) + 1; 
                node.output.forEach((output) => {
                    outputCountMap[output] = (outputCountMap[output] || 0) + 1;
                });
            });
            graph.node.forEach((node) => {
                var initializerNode = false;
                if (node.opType == 'Constant' && node.output && node.output.length == 1) {
                    var name = node.output[0];
                    if (outputCountMap[name] == 1) {
                        var attribute = node.attribute.find((attribute) => { return attribute.name == 'value' && attribute.t; }); 
                        if (attribute) {
                            this._initializerMap[name] = new OnnxTensor(attribute.t, name, 'Constant');
                            initializerNode = true;
                        }
                    }
                }
                if (!initializerNode) {
                    nodes.push(node);
                }
            });

            graph.input.forEach((valueInfo) => {
                var connection = this._connection(valueInfo.name, valueInfo.type, valueInfo.docString);
                if (!this._initializerMap[valueInfo.name]) {
                    connection.name = valueInfo.name;
                    this._inputs.push(connection);
                }
            });
            graph.output.map((valueInfo) => {
                var connection = this._connection(valueInfo.name, valueInfo.type, valueInfo.docString);
                connection.name = valueInfo.name;
                this._outputs.push(connection);
            });
    
            nodes.forEach((node) => {
                var inputs = [];
                if (node.input) {
                    inputs = this._metadata.getInputs(node.opType, node.input);
                    inputs.forEach((input) => {
                        input.connections = input.connections.map((connection) => {
                            connection = this._connection(connection.id);
                            var initializer = this._initializerMap[connection.id];
                            if (initializer) {
                                connection.initializer = initializer;
                                connection.type = connection.type || initializer.type;
                            }
                            return connection;
                        });
                    });
                }
                var outputs = [];
                if (node.output) {
                    outputs = this._metadata.getOutputs(node.opType, node.output);
                    outputs.forEach((output) => {
                        output.connections = output.connections.map((connection) => {
                            return this._connection(connection.id);
                        });
                    });
                }
                this._nodes.push(new OnnxNode(this, node.opType, node.domain, node.name, node.docString, node.attribute, inputs, outputs));
            });

            delete this._initializerMap;
            delete this._connectionMap;
        }
    }

    get name() {
        return this._name;
    }

    get description() {
        return this._description;
    }

    get operators() {
        return this._operators;
    }

    get groups() {
        return false;
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

    get metadata() {
        return this._metadata;
    }

    _connection(name, type, docString) {
        var connection = this._connectionMap[name];
        if (!connection) {
            connection = {};
            connection.id = name;
            if (type) {
                connection.type = OnnxTensor._formatType(type);
            }
            if (docString) {
                connection.description = docString;
            }
            this._connectionMap[name] = connection;
        }
        return connection;
    }
}

class OnnxNode {

    constructor(graph, operator, domain, name, description, attributes, inputs, outputs) {
        this._graph = graph;
        this._operator = operator;
        if (domain) {
            this._domain = domain;
        }
        if (name) {
            this._name = name;
        }
        if (description) {
            this._description = description;
        }
        this._attributes = [];
        if (attributes && attributes.length > 0) {
            attributes.forEach((attribute) => { 
                this._attributes.push(new OnnxAttribute(this, attribute));
            });
        }            
        this._inputs = inputs;
        this._outputs = outputs;
    }

    get operator() {
        return this._operator;
    }

    get name() {
        return this._name || null;
    }

    get description() {
        return this._description || null;
    }

    get primitive() {
        return null;
    }

    get documentation() {
        return this._graph.metadata.getOperatorDocumentation(this._operator);
    }

    get domain() {
        return this._domain || null;
    }

    get category() {
        return this._graph.metadata.getOperatorCategory(this._operator);
    }

    get group() {
        return null;
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

    get dependencies() {
        return [];
    }

    get graph() {
        return this._graph;
    }
}

class OnnxAttribute {

    constructor(node, attribute) {
        this._node = node;
        this._attribute = attribute;
    }

    get name() {
        return this._attribute.name;
    }

    get type() {
        if (!this._attribute.hasOwnProperty('type')) { 
            return this._node.graph.metadata.getAttributeType(this._node.operator, this._attribute.name);
        }
        if (!OnnxAttribute._attributeTypeMap) {
            OnnxAttribute._attributeTypeMap = {};
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.UNDEFINED] = 'UNDEFINED';
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.FLOAT] = 'float';
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.INT] = 'int';
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.STRING] = 'string';
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.TENSOR] = 'tensor';
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.GRAPH] = 'graph';
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.FLOATS] = 'float';
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.INTS] = 'int[]';
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.STRINGS] = 'string[]';
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.TENSORS] = 'tensor[]';
            OnnxAttribute._attributeTypeMap[onnx.AttributeProto.AttributeType.GRAPHS] = 'graph[]';
        }
        var attributeType = OnnxAttribute._attributeTypeMap[this._attribute.type];
        if (attributeType) {
            return attributeType;
        }
        return OnnxTensor._attributeTypeMap[onnx.AttributeProto.AttributeType.UNDEFINED];
    }

    get value() {
        if (this._attribute.ints && this._attribute.ints.length > 0) {
            if (this._attribute.ints.length > 65536) {
                return "...";
            }
            return this._attribute.ints.map((v) => { return v.toString(); }).join(', '); 
        }
        else if (this._attribute.floats && this._attribute.floats.length > 0) {
            if (this._attribute.floats.length > 65536) {
                return "...";
            }
            return this._attribute.floats.map(v => v.toString()).join(', ');
        }
        else if (this._attribute.strings && this._attribute.strings.length > 0) {
            if (this._attribute.strings.length > 65536) {
                return "...";
            }
            return this._attribute.strings.map((s) => {
                if (s.filter(c => c <= 32 && c >= 128).length == 0) {
                    return '"' + String.fromCharCode.apply(null, s) + '"';
                }
                return s.map(v => v.toString()).join(', ');
            }).join(', ');
        }
        else if (this._attribute.s && this._attribute.s.length > 0) {
            if (this._attribute.s.filter(c => c <= 32 && c >= 128).length == 0) {
                return '"' + String.fromCharCode.apply(null, this._attribute.s) + '"';
            }
            return this._attribute.s.map(v => v.toString()).join(', ');
        }
        else if (this._attribute.hasOwnProperty('f')) {
            return this._attribute.f.toString();
        }
        else if (this._attribute.hasOwnProperty('i')) {
            return this._attribute.i.toString();
        }
        else if (this._attribute.hasOwnProperty('t')) {
            return new OnnxTensor(this._attribute.t).value;
        }
        // debugger;
        return '?';
    }

    get description() {
        return this._attribute.docString ? this._attribute.docString : null;
    }

    get visible() {
        return this._node.graph.metadata.getAttributeVisible(this._node.operator, this);
    }

    get tensor() {
        return this._attribute.hasOwnProperty('t');
    }
}

class OnnxTensor {

    constructor(tensor, id, kind) {
        this._tensor = tensor;
        this._id = id;
        this._kind = kind || null;
    }

    get id() {
        return this._id;
    }

    get name() {
        return this._tensor.name ? this._tensor.name : this._id; 
    }

    get kind() {
        return this._kind;
    }

    get type() {
        var result = '';
        if (this._tensor.hasOwnProperty('dataType')) {
            result = OnnxTensor._formatElementType(this._tensor.dataType);
            if (this._tensor.dims) { 
                result += '[' + this._tensor.dims.map(dimension => dimension.toString()).join(',') + ']';
            }
        }
        return result;
    }

    get value() { 
        if (!this._tensor.dataType) {
            return 'Tensor has no data type.';
        }
        if (!this._tensor.dims) {
            return 'Tensor has no dimensions.';
        }

        switch (this._tensor.dataType) {
            case onnx.TensorProto.DataType.FLOAT:
                if (this._tensor.floatData && this._tensor.floatData.length > 0) {
                    this._data = this._tensor.floatData;
                }
                else if (this._tensor.rawData && this._tensor.rawData.length > 0) {
                    this._rawData = new DataView(this._tensor.rawData.buffer, this._tensor.rawData.byteOffset, this._tensor.rawData.byteLength);
                }
                else {
                    return 'Tensor data is empty.';
                }
                break;
            case onnx.TensorProto.DataType.DOUBLE:
                if (this._tensor.doubleData && this._tensor.doubleData.length > 0) {
                    this._data = tensor.doubleData;
                }
                else if (this._tensor.rawData && this._tensor.rawData.length > 0) {
                    this._rawData = new DataView(this._tensor.rawData.buffer, this._tensor.rawData.byteOffset, this._tensor.rawData.byteLength);
                }
                else {
                    return 'Tensor data is empty.';
                }
                break;
            case onnx.TensorProto.DataType.INT32:
                if (this._tensor.int32Data && this._tensor.int32Data.length > 0) {
                    this._data = this._tensor.int32Data;
                }
                else if (this._tensor.rawData && this._tensor.rawData.length > 0) {
                    this._rawData = new DataView(this._tensor.rawData.buffer, this._tensor.rawData.byteOffset, this._tensor.rawData.byteLength);
                }
                else {
                    return 'Tensor data is empty.';
                }
                break;
            case onnx.TensorProto.DataType.UINT32:
                if (this._tensor.uint64Data && this._tensor.uint64Data.length > 0) {
                    this._data = this._tensor.uint64Data;
                }
                else if (this._tensor.rawData && this._tensor.rawData.length > 0) {
                    this._rawData = this._tensor.rawData;
                }
                else {
                    return 'Tensor data is empty.';
                }
                break;
            case onnx.TensorProto.DataType.INT64:
                if (this._tensor.int64Data && this._tensor.int64Data.length > 0) {
                    this._data = this._tensor.int64Data;
                }
                else if (this._tensor.rawData && this._tensor.rawData.length > 0) {
                    this._rawData = this._tensor.rawData;
                }
                else {
                    return 'Tensor data is empty.';
                }
                break;
            case onnx.TensorProto.DataType.UINT64:
                if (this._tensor.uint64Data && this._tensor.uint64Data.length > 0) {
                    this._data = this._tensor.uint64Data;
                }
                else if (this._tensor.rawData && this._tensor.rawData.length > 0) {
                    this._rawData = this._tensor.rawData;
                }
                else {
                    return 'Tensor data is empty.';
                }
                break;
            default:
                // debugger;
                return 'Tensor data type is not implemented.';
        }

        this._index = 0;
        this._count = 0;
        var result = this.read(0);
        delete this._index;
        delete this._count;
        delete this._data;
        delete this._rawData;

        return JSON.stringify(result, null, 4);
    }

    read(dimension) {
        var results = [];
        var size = this._tensor.dims[dimension];
        if (dimension == this._tensor.dims.length - 1) {
            for (var i = 0; i < size; i++) {
                if (this._count > 10000) {
                    results.push('...');
                    return results;
                }
                if (this._data) {
                    results.push(this._data[this._index++]);
                    this._count++;
                }
                else if (this._rawData) {
                    switch (this._tensor.dataType)
                    {
                        case onnx.TensorProto.DataType.FLOAT:
                            results.push(this._rawData.getFloat32(this._index, true));
                            this._index += 4;
                            this._count++;
                            break;
                        case onnx.TensorProto.DataType.DOUBLE:
                            results.push(this._rawData.getFloat64(this._index, true));
                            this._index += 8;
                            this._count++;
                            break;
                        case onnx.TensorProto.DataType.INT32:
                            results.push(this._rawData.getInt32(this._index, true));
                            this._index += 4;
                            this._count++;
                            break;
                        case onnx.TensorProto.DataType.UINT32:
                            results.push(this._rawData.getUint32(this._index, true));
                            this._index += 4;
                            this._count++;
                            break;
                        case onnx.TensorProto.DataType.INT64:
                            results.push(new Int64(this._rawData.subarray(this._index, 8)));
                            this._index += 8;
                            this._count++;
                            break;
                        case onnx.TensorProto.DataType.UINT64:
                            results.push(new Uint64(this._rawData.subarray(this._index, 8)));
                            this._index += 8;
                            this._count++;
                            break;
                    }
                }
            }
        }
        else {
            for (var j = 0; j < size; j++) {
                if (this._count > 10000) {
                    results.push('...');
                    return results;
                }
                results.push(this.read(dimension + 1));
            }
        }
        return results;
    }

    static _formatElementType(elementType) {
        if (!OnnxTensor._elementTypeMap) {
            var map = {};
            OnnxTensor._elementTypeMap = map;
            map[onnx.TensorProto.DataType.UNDEFINED] = 'UNDEFINED';
            map[onnx.TensorProto.DataType.FLOAT] = 'float';
            map[onnx.TensorProto.DataType.UINT8] = 'uint8';
            map[onnx.TensorProto.DataType.INT8] = 'int8';
            map[onnx.TensorProto.DataType.UINT16] = 'uint16';
            map[onnx.TensorProto.DataType.INT16] = 'int16';
            map[onnx.TensorProto.DataType.INT32] = 'int32';
            map[onnx.TensorProto.DataType.INT64] = 'int64';
            map[onnx.TensorProto.DataType.STRING] = 'string';
            map[onnx.TensorProto.DataType.BOOL] = 'bool';
            map[onnx.TensorProto.DataType.FLOAT16] = 'float16';
            map[onnx.TensorProto.DataType.DOUBLE] = 'double';
            map[onnx.TensorProto.DataType.UINT32] = 'uint32';
            map[onnx.TensorProto.DataType.UINT64] = 'uint64';
            map[onnx.TensorProto.DataType.COMPLEX64] = 'complex64';
            map[onnx.TensorProto.DataType.COMPLEX128] = 'complex128';    
        }
        var name = OnnxTensor._elementTypeMap[elementType];
        if (name) {
            return name;
        }
        return OnnxTensor._elementTypeMap[onnx.TensorProto.DataType.UNDEFINED];
    }

    static _formatType(type) {
        if (!type) {
            return '?';
        }
        var result = [];
        switch (type.denotation) {
            case 'TENSOR':
                result.push('Tensor');
                break;
            case 'IMAGE':
                result.push('Image');
                break;
            case 'AUDIO':
                result.push('Audio');
                break;
            case 'TEXT':
                result.push('Text');
                break;
        }
        switch (type.value) {
            case 'tensorType':
                var tensorType = type.tensorType;
                var text = OnnxTensor._formatElementType(tensorType.elemType); 
                if (tensorType.shape && tensorType.shape.dim) {
                    text += '[' + tensorType.shape.dim.map((dimension) => {
                        if (dimension.dimParam) {
                            return dimension.dimParam;
                        }
                        return dimension.dimValue.toString();
                    }).join(',') + ']';
                }
                result.push(text);
                break;
            case 'mapType':
                var mapType = type.mapType;
                result.push('<' + OnnxTensor._formatElementType(mapType.keyType) + ',' + OnnxTensor._formatType(mapType.valueType) + '>');
                break;
            case 'sequenceType':
                result.push('[?]');
                break;
            default:
                // debugger;
                return '?';
        }
        return result.join(' ');
    }
}

class OnnxGraphOperatorMetadata {

    constructor(opsetImport) {
        this._cache = {};
        this._imports = {};
        if (opsetImport) {
            opsetImport.forEach((opsetImport) => {
                var domain = opsetImport.domain || '';
                if (domain == 'ai.onnx') {
                    domain = '';
                }
                if (!this._imports[domain] || this._imports[domain] > opsetImport.version) {
                    this._imports[domain] = opsetImport.version;
                }
            });
        }
        if (Object.keys(this._imports).length == 0) {
            this._imports[''] = 1;
            this._imports['ai.onnx.ml'] = 1;
        }
    }

    getSchema(operator) {
        var schema = this._cache[operator];
        if (!schema) {
            schema = OnnxOperatorMetadata.operatorMetadata.getSchema(operator, this._imports);
            if (schema) {
                this._cache[operator] = schema;
            }
        }
        return schema;
    }

    getAttributeSchema(operator, name) {
        var schema = this.getSchema(operator);
        if (schema) {
            var attributeMap = schema.attributeMap;
            if (!attributeMap) {
                attributeMap = {};
                if (schema.attributes) {
                    schema.attributes.forEach((attribute) => {
                        attributeMap[attribute.name] = attribute;
                    });
                }
                schema.attributeMap = attributeMap;
            }
            var attributeSchema = attributeMap[name];
            if (attributeSchema) {
                return attributeSchema; 
            }
        }
        return null;
    }

    getInputs(operator, inputs) {
        var results = [];
        var index = 0;
        var schema = this.getSchema(operator);
        if (schema && schema.inputs) {
            schema.inputs.forEach((inputDef) => {
                if (index < inputs.length || inputDef.option != 'optional') {
                    var input = {};
                    input.name = inputDef.name;
                    input.type = inputDef.type;
                    var count = (inputDef.option == 'variadic') ? (inputs.length - index) : 1;
                    input.connections = [];
                    inputs.slice(index, index + count).forEach((id) => {
                        if (id != '' || inputDef.option != 'optional') {
                            input.connections.push({ id: id});
                        }
                    });
                    index += count;
                    results.push(input);
                }
            });
        }
        else {
            inputs.slice(index).forEach((input) => {
                results.push({
                    name: '(' + index.toString() + ')',
                    connections: [ { id: input } ]
                });
                index++;
            });

        }
        return results;
    }

    getOutputs(operator, outputs) {
        var results = [];
        var index = 0;
        var schema = this.getSchema(operator);
        if (schema && schema.outputs) {
            schema.outputs.forEach((outputDef) => {
                if (index < outputs.length || outputDef.option != 'optional') {
                    var output = {};
                    output.name = outputDef.name;
                    var count = (outputDef.option == 'variadic') ? (data.output.length - index) : 1;
                    output.connections = outputs.slice(index, index + count).map((id) => {
                        return { id: id };
                    });
                    index += count;
                    results.push(output);
                }
            });
        }
        else {
            outputs.slice(index).forEach((output) => {
                results.push({
                    name: '(' + index.toString() + ')',
                    connections: [ { id: output } ]
                });
                index++;
            });

        }
        return results;
    }

    getAttributeType(operator, name) {
        var schema = this.getAttributeSchema(operator, name);
        if (schema && schema.type) {
            return schema.type;
        }
        return '';
    }

    getAttributeVisible(operator, attribute) {
        var schema = this.getAttributeSchema(operator, attribute.name);
        if (schema && schema.hasOwnProperty('default') && schema.default) {
            if (attribute.value == schema.default.toString()) {
                return false;
            }
        }
        return true;     
    }

    getOperatorCategory(operator) {
        var schema = this.getSchema(operator);
        if (schema && schema.category) {
            return schema.category;
        }
        return null;
    }

    getOperatorDocumentation(operator) {
        var schema = this.getSchema(operator);
        if (schema) {
            schema = JSON.parse(JSON.stringify(schema));
            schema.name = operator;
            if (schema.description) {
                var input = schema.description.split('\n');
                var output = [];
                var lines = [];
                var code = true;
                while (input.length > 0) {
                    var line = input.shift();
                    if (line.length > 0)
                    {
                        code = code && line.startsWith('  ');
                        lines.push(line + "\n");
                    }
                    if (line.length == 0 || input.length == 0) {
                        if (lines.length > 0) {
                            if (code) {
                                lines = lines.map((text) => { return text.substring(2); });
                                output.push('<pre>' + lines.join('') + '</pre>');
                            }
                            else {
                                var text = lines.join('');
                                text = this.markdown(text);
                                output.push('<p>' + text + '</p>');
                            }
                        }
                        lines = [];
                        code = true;
                    }
                }
                schema.description = output.join('');
            }
            var formatRange = (value) => {
                return (value == 2147483647) ? '&#8734;' : value.toString();
            };
            if (schema.attributes) {
                schema.attributes.forEach((attribute) => {
                    if (attribute.description) {
                        attribute.description = this.markdown(attribute.description);
                    }
                });
            }
            if (schema.inputs) {
                schema.inputs.forEach((input) => {
                    if (input.description) {
                        input.description = this.markdown(input.description);
                    }
                });
            }
            if (schema.outputs) {
                schema.outputs.forEach((output) => {
                    if (output.description) {
                        output.description = this.markdown(output.description);
                    }
                });
            }
            if (schema.min_input != schema.max_input) {
                schema.inputs_range = formatRange(schema.min_input) + ' - ' + formatRange(schema.max_input);
            }
            if (schema.min_output != schema.max_output) {
                schema.outputs_range = formatRange(schema.min_output) + ' - ' + formatRange(schema.max_output);
            }
            if (schema.type_constraints) {
                schema.type_constraints.forEach((item) => {
                    if (item.allowed_type_strs) {
                        item.allowed_type_strs_display = item.allowed_type_strs.map((type) => { return type; }).join(', ');
                    }
                });
            }
            return schema;
        }
        return null;
    }

    markdown(text) {
        text = text.replace(/\`\`(.*?)\`\`/gm, (match, content) => '<code>' + content + '</code>');
        text = text.replace(/\`(.*?)\`/gm, (match, content) => '<code>' + content + '</code>');
        return text;
    }
}

class OnnxOperatorMetadata {

    static open(host, callback) {
        if (OnnxOperatorMetadata.operatorMetadata) {
            callback(null, OnnxOperatorMetadata.operatorMetadata);
        }
        else {
            host.request('/onnx-metadata.json', (err, data) => {
                OnnxOperatorMetadata.operatorMetadata = new OnnxOperatorMetadata(data);
                callback(null, OnnxOperatorMetadata.operatorMetadata);
            });
        }    
    }

    constructor(data) {
        this._map = {};
        if (data) {
            var items = JSON.parse(data);
            if (items) {
                items.forEach((item) => {
                    if (item.name && item.schema)
                    {
                        var name = item.name;
                        this._map[name] = this._map[name] || [];
                        this._map[name].push(item.schema);
                    }
                });
            }
        }
    }

    getSchema(operator, imports) {
        var result = null;
        var schemas = this._map[operator];
        if (schemas) {
            var version = -1;
            schemas.forEach((schema) => {
                var domain = schema.domain;
                if (domain == 'ai.onnx') {
                    domain = '';
                }
                var importVersion = imports[domain];
                var sinceVersion = schema.since_version;
                if (importVersion >= sinceVersion && version < sinceVersion) {
                    version = sinceVersion;
                    result = schema;
                }
            });
        }
        return result;
    }
}

class OnnxError extends Error {
    constructor(message) {
        super(message);
        this.name = 'Error loading ONNX model.';
    }
}
