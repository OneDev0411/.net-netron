/*jshint esversion: 6 */

var cntk = null;

class CntkModelFactory {

    match(context, host) {
        if (!host.environment('CNTK')) {
            return false;
        }
        var extension = context.identifier.split('.').pop();
        if (extension == 'model') {
            var buffer = context.buffer;
            if (buffer && buffer.length > 2 && buffer[0] == 0x50 && buffer[1] == 0x4B) {
                return false;
            }
            return true;
        }
        return false;
    }

    open(context, host, callback) { 
        host.require('cntk', (err) => {
            if (err) {
                callback(err, null);
                return;
            }
            var version = 0;
            var obj = null;
            try {
                var buffer = context.buffer;
                if (buffer && buffer.length >= 8 && 
                    buffer[0] == 0x42 && buffer[1] == 0x00 && buffer[2] == 0x43 && buffer[3] == 0x00 &&
                    buffer[4] == 0x4E && buffer[5] == 0x00 && buffer[6] == 0x00 && buffer[7] == 0x00) {
                    obj = new ComputationNetwork(buffer);
                    version = 1;
                }
            }
            catch (error) {
                callback(new CntkError('File format is not CNTK v1 (' + error.message + ').'), null);
                return;
            }
            try {
                if (!obj) {
                    cntk = protobuf.roots.cntk.CNTK.proto;
                    var dictionary = cntk.Dictionary.decode(context.buffer);
                    obj = CntkModelFactory._convertDictionary(dictionary);
                    version = 2;
                }
            }
            catch (error) {
                callback(new CntkError('File format is not cntk.Dictionary (' + error.message + ').'), null);
                return;
            }
            CntkOperatorMetadata.open(host, (err, metadata) => {
                try {
                    var model = new CntkModel(version, obj);
                    callback(null, model);
                }
                catch (error) {
                    callback(new CntkError(error.message), null);
                }
            });
        });
    }

    static _convertDictionary(dictionary) {
        var target = {};
        Object.keys(dictionary.data).filter((key) => key != 'version').forEach((key) => {
            target[key] = CntkModelFactory._convertDictionaryValue(dictionary.data[key]);
        });
        return target;
    }

    static _convertDictionaryValue(dictionaryValue) {
        switch (dictionaryValue.value_type) {
            case cntk.DictionaryValue.Type.Bool:
                return dictionaryValue.bool_value;
            case cntk.DictionaryValue.Type.Int:
                return dictionaryValue.int_value;
            case cntk.DictionaryValue.Type.SizeT:
                return dictionaryValue.size_t_value;
            case cntk.DictionaryValue.Type.Float:
                return dictionaryValue.float_value;
            case cntk.DictionaryValue.Type.Double:
                return dictionaryValue.double_value;
            case cntk.DictionaryValue.Type.String:
                return dictionaryValue.string_value;
            case cntk.DictionaryValue.Type.Vector:
                return CntkModelFactory._convertVectorValue(dictionaryValue.vector_value);
            case cntk.DictionaryValue.Type.NDShape:
                return dictionaryValue.nd_shape_value;
            case cntk.DictionaryValue.Type.Axis:
                return dictionaryValue.axis_value;
            case cntk.DictionaryValue.Type.Dictionary:
                return CntkModelFactory._convertDictionary(dictionaryValue.dictionary_value);
            case cntk.DictionaryValue.Type.NDArrayView:
                return dictionaryValue.nd_array_view_value;
        }
        throw new CntkError("Unknown dictionary value type '" + dictionaryValue.value_type.toString() + "'.");
    }

    static _convertVectorValue(vectorValue) {
        var target = [];
        vectorValue.value.forEach((item) => {
            target.push(CntkModelFactory._convertDictionaryValue(item));
        });
        return target;
    }
}

class CntkModel {

    constructor(version, obj) {
        switch (version) {
            case 1:
                this._format = 'CNTK v1' + (obj.version ? ('.' + obj.version.toString()) : '');
                break;
            case 2:
                this._format = 'CNTK v2';
                break;
        }
        this._graphs = [];
        this._graphs.push(new CntkGraph(version, obj));
    }

    get graphs() {
        return this._graphs;
    }

    get format() {
        return this._format;
    }
}

class CntkGraph {

    constructor(version, obj) {
        this._nodes = [];
        this._inputs = [];
        this._outputs = [];
        var connections = {};

        if (version == 1) {

            var nodes = [];

            Object.keys(obj.nodes).forEach((name) => {
                var node = obj.nodes[name];
                switch (node.__type__) {
                    case 'InputValue':
                        this._inputs.push(new CntkArgument(node.name, [ 
                            new CntkConnection(version, node)
                        ]));
                        break;
                    case 'LearnableParameter':
                        connections[node.name] = new CntkConnection(version, node);
                        break;
                }
            });

            Object.keys(obj.nodes).forEach((name) => {
                var node = obj.nodes[name];
                if (node.__type__ != 'InputValue' && node.__type__ != 'LearnableParameter') {
                    this._nodes.push(new CntkNode(version, node, connections));
                }
            });

            if (obj.output) {
                obj.output.forEach((output) => {
                    this._outputs.push(new CntkArgument(output, [ 
                        new CntkConnection(version, output)
                    ]));
                });
            }
        }
        else if (version == 2) {
            var names = {};
            obj.inputs.forEach((input) => {
                var connection = new CntkConnection(version, input);
                connections[input.uid] = connection;
    
                if (input.kind == 0) {
                    this._inputs.push(new CntkArgument(input.name, [ connection ]));
                }
    
                if (input.name) {
                    names[input.uid] = input.name;
                }
            });
            obj.primitive_functions.forEach((node) => {
                this._nodes.push(new CntkNode(version, node, connections));
            });
        }
    }

    get nodes() {
        return this._nodes;
    }

    get inputs() {
        return this._inputs;
    }

    get outputs() {
        return this._outputs;
    }
}

class CntkArgument {
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
}

class CntkConnection {

    constructor(version, obj) {
        if (typeof obj === 'string') {
            this._id = obj;
        }
        else {
            switch (version) {
                case 1:
                    switch (obj.__type__) {
                        case 'InputValue':
                            this._id = obj.name;
                            this._type = new CntkTensorType(version, obj.precision, obj.sampleLayout);
                            this._initializer = null;
                            break;
                        case 'LearnableParameter':
                            this._id = obj.name;
                            this._type = null;
                            this._initializer = new CntkTensor(version, obj);
                            break;
                    }
                    break;
                case 2:
                    this._id = obj.uid;
                    if (obj.value) {
                        this._type = null;
                        this._initializer = new CntkTensor(version, obj);
                    }
                    else {
                        this._type = new CntkTensorType(version, obj.data_type, obj.shape);
                        this._initializer = null;
                    }    
                    break;
            }
        }
    }

    get id() {
        return this._id;
    }

    get type() {
        if (this._type) {
            return this._type;
        }
        if (this._initializer) {
            return this._initializer.type;
        }
        return null;
    }

    get description() {
        return null;
    }

    get initializer() {
        return this._initializer;
    }
}

class CntkNode { 

    constructor(version, obj, connections) {

        this._attributes = [];
        this._inputs = [];
        this._outputs = [];

        var inputs = [];
        var outputs = [];
        var initializers = [];

        switch (version) {
            case 1:
                this._operator = obj.__type__;
                this._name = obj.name;
                Object.keys(obj).forEach((key) => {
                    if (key != '__type__' && key != 'name' && key != 'inputs' && key != 'precision') {
                        this._attributes.push(new CntkAttribute(this._operator, key, obj[key]));
                    }
                });
                inputs = obj.inputs.map((input) => { 
                    if (connections[input]) {
                        return connections[input];
                    }
                    return new CntkConnection(version, input);
                });
                outputs = [ new CntkConnection(version, this._name) ];
                break;
            case 2:
                this._name = obj.name || null;
                var output = obj.uid;
                if (obj.op == 57) {
                    this._operator = 'Block';
                    debugger;
                }
                else {
                    this._operator = CntkOperatorMetadata.operatorMetadata.getOperatorName(obj.op);
                    if (this._operator == null) {
                        this._operator = node.op.toString();
                        debugger;
                    }                
                }
                if (obj.block_function_op_name) {
                    this._operator = '[' + obj.block_function_op_name + ']';
                }
                Object.keys(obj.attributes).forEach((key) => {
                    this._attributes.push(new CntkAttribute(this._operator, key, obj.attributes[key]));
                });
                obj.inputs.forEach((input) => {
                    var connection = connections[input];
                    if (connection) {
                        if (connection.initializer) {
                            initializers.push(connection);
                        }
                        else {
                            inputs.push(connection);
                        }
                    }
                    else {
                        inputs.push(new CntkConnection(version, input));
                    }
                });
                outputs.push(new CntkConnection(version, output + '_Output_0'));
                inputs = inputs.concat(initializers);
        }

        var inputIndex = 0;
        var schema = CntkOperatorMetadata.operatorMetadata.getSchema(this.operator);
        if (schema && schema.inputs) {
            schema.inputs.forEach((inputSchema) => {
                if (inputIndex < inputs.length || inputSchema.option != 'optional') {
                    var connections = [];
                    var input = {};
                    input.name = inputSchema.name;
                    var count = (inputSchema.option == 'variadic') ? (inputs.length - inputIndex) : 1;
                    inputs.slice(inputIndex, inputIndex + count).forEach((connection) => {
                        if (connection.id != '' || inputSchema.option != 'optional') {
                            connections.push(connection);
                        }
                    });
                    inputIndex += count;
                    this._inputs.push(new CntkArgument(inputSchema.name, connections));
                }
            });
        }
        else {
            inputs.slice(inputIndex).forEach((connection) => {
                this._inputs.push(new CntkArgument('(' + inputIndex.toString() + ')', [ connection ]));
                inputIndex++;
            });
        }

        var outputIndex = 0;
        if (schema && schema.outputs) {
            schema.outputs.forEach((outputSchema) => {
                if (outputIndex < outputs.length || outputSchema.option != 'optional') {
                    var count = (outputSchema.option == 'variadic') ? (outputs.length - outputIndex) : 1;
                    var connections = outputs.slice(outputIndex, outputIndex + count);
                    outputIndex += count;
                    this._outputs.push(new CntkArgument(outputSchema.name, connections));
                }
            });
        }
        else {
            outputs.slice(outputIndex).forEach((connection) => {
                this._outputs.push(new CntkArgument('(' + outputIndex.toString() + ')', [ connection ]));
                outputIndex++;
            });
        }
    }

    get name() {
        return this._name;
    }

    get operator() {
        return this._operator;
    }

    get category() {
        var schema = CntkOperatorMetadata.operatorMetadata.getSchema(this._operator);
        if (schema && schema.category) {
            return schema.category;
        }
        return null;
    }

    get documentation() { 
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
}

class CntkAttribute {

    constructor(operator, name, value) {
        this._name = name;
        this._value = value;
        if (this._value.constructor.name == 'NDShape') {
            this._value = value.shape_dim.map((dimension) => {
                if (dimension.low == -1 && dimension.high == -1 && dimension.unsigned == true) {
                    return -1;
                }
                if (dimension && dimension.__isLong__) {
                    return dimension.toNumber();
                }
                return dimension;
            });
        }
        if (this._value.constructor.name == 'Axis') {
            this._value = () => '\'' + value.name + '\', ' + value.static_axis_idx + ', ' + value.is_ordered_dynamic_axis.toString();
        }
        if (this._value instanceof ComputationNetwork.TensorShape) {
            this._value = value.dims;
        }

        var attributeSchema = CntkOperatorMetadata.operatorMetadata.getAttributeSchema(operator, name);
        if (attributeSchema) {
            if (attributeSchema.hasOwnProperty('visible') && !attributeSchema.visible) {
                this._visible = false;
            }
            else if (attributeSchema.hasOwnProperty('default')) {
                var defaultValue = attributeSchema.default;
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

    get value() {
        return this._value;
    }

    get visible() {
        return this._visible == false ? false : true;
    }
}

class CntkTensor {

    constructor(version, tensor) {
        switch (version) {
            case 1:
                if (tensor.__type__ == 'LearnableParameter') {
                    this._name = tensor.name || null;
                    this._type = new CntkTensorType(version, tensor.precision, tensor.sampleLayout);
                }
                break;
            case 2:
                this._name = tensor.uid || null;
                this._type = new CntkTensorType(version, tensor.data_type, tensor.shape);
                this._value = tensor.value;
                break;
        }
    }

    get name() {
        return this._name;
    }

    get type() {
        return this._type;
    }

    get state() {
        return this._context().state || null;
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
        context.index = 0;
        context.count = 0;
        context.state = null;

        if (this._type.dataType == '?') {
            context.state = 'Tensor has unknown data type.';
            return context;
        }
        if (!this._type.shape) {
            context.state = 'Tensor has no dimensions.';
            return context;
        }

        var value = this._value;
        if (!value) {
            context.state = 'Tensor data is empty.';
            return context;
        }

        switch (this._type.dataType) {
            case 'float32':
                if (value.float_values && value.float_values.value && value.float_values.value.length > 0) {
                    context.data = value.float_values.value;
                }
                else {
                    context.state = 'Tensor data is empty.';
                }
                break;
            default:
                // debugger;
                context.state = 'Tensor data type is not implemented.';
                break;
        }

        context.dataType = this._type.dataType;
        context.shape = this._type.shape;
        
        return context;
    }

    _decode(context, dimension) {
        var results = [];
        var size = context.shape[dimension];
        if (dimension == context.shape.length - 1) {
            for (var i = 0; i < size; i++) {
                if (context.count > context.limit) {
                    results.push('...');
                    return results;
                }
                results.push(context.data[context.index++]);
                context.count++;
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

}

class CntkTensorType {

    constructor(version, dataType, shape) {
        this._dataType = '?';
        switch (version) {
            case 1:
                switch (dataType) {
                    case 'float': this._dataType = 'float32'; break;
                    case 'double': this._dataType = 'float64'; break;
                    case 'half': this._dataType = 'float16'; break;
                    case '': this._dataType = 'float32'; break;
                }
                this._shape = shape.dims;
                break;
            case 2:
                switch (dataType.toNumber()) {
                    case 1: this._dataType = 'float32'; break;
                }
                this._shape = shape.shape_dim.map((dimension) => {
                    if (dimension && dimension.__isLong__) {
                        return dimension.toNumber();
                    }
                    return dimension;            
                });
                break;                
        }
    }

    get dataType() {
        return this._dataType;
    }

    get shape() {
        return this._shape;
    }

    toString() {
        return this.dataType + ((this._shape && this._shape.length) ? ('[' + this._shape.join(',') + ']') : '');
    }
}

class CntkOperatorMetadata 
{

    static open(host, callback) {
        if (CntkOperatorMetadata.operatorMetadata) {
            callback(null, CntkOperatorMetadata.operatorMetadata);
        }
        else {
            host.request(null, 'cntk-metadata.json', 'utf-8', (err, data) => {
                CntkOperatorMetadata.operatorMetadata = new CntkOperatorMetadata(data);
                callback(null, CntkOperatorMetadata.operatorMetadata);
            });
        }    
    }

    constructor(data) {
        this._map = {};
        this._operatorMap = {};
        if (data) {
            var items = JSON.parse(data);
            if (items) {
                items.forEach((item) => {
                    if (item.name && item.schema)
                    {
                        var name = item.name;
                        var schema = item.schema;
                        this._map[name] = schema;
                        if (schema.operator) {
                            this._operatorMap[schema.operator] = name;
                        }
                    }
                });
            }
        }
    }

    getOperatorName(code) {
        // cntk/Source/CNTKv2LibraryDll/API/Internals/PrimitiveOpType.h
        return this._operatorMap[code] || null;
    }

    getSchema(operator) {
        return this._map[operator] || null;
    }

    getAttributeSchema(operator, name) {
        var schema = this._map[operator];
        if (schema && schema.attributes && schema.attributes.length > 0) {
            if (!schema._attributesMap) {
                schema._attributesMap = {};
                schema.attributes.forEach((attribute) => {
                    schema._attributesMap[attribute.name] = attribute;
                });
            }
            return schema._attributesMap[name] || null;
        }
        return null;
    }
}

class ComputationNetwork {

    constructor(buffer) {
        var reader = new ComputationNetwork.Reader(buffer);
        reader.assert('BCN');
        reader.assert('BVersion');
        this.version = reader.uint64();
        reader.version = this.version;
        reader.assert('EVersion');
        var numNodes = reader.uint64();
        reader.assert('BNodeList');
        var op = {};
        op.Minus = function(reader) {};
        op.Plus = function(reader) {};
        op.GreaterEqual = function(reader) {};
        op.Equal = function(reader) {};
        op.NotEqual = function(reader) {};
        op.GreaterEqual = function(reader) {};
        op.Exp = function(reader) {};
        op.Log = function(reader) {};
        op.Reciprocal = function(reader) {};
        op.ElementTimes = function(reader) {};
        op.ClassificationError = function(reader) {};
        op.RectifiedLinear = function(reader) {};
        op.InputValue = function(reader) {
            this.rows = reader.uint64();
            this.cols = reader.uint64();
            this.sampleLayout = new ComputationNetwork.TensorShape(reader, true);
            this.dynamicAxisNodeName = '';
            if (reader.version >= 8) {
                var nrAxes = reader.uint32();
                if (nrAxes == 1) {
                    this.dynamicAxisNodeName = reader.string();
                }
            }
            this.learningRateMultiplier = 0;
            if (reader.version >= 10) {
                this.learningRateMultiplier = reader.float32();
            }
        };
        op.LearnableParameter = function(reader) {
            if (reader.version >= 3) {
                this.learningRateMultiplier = reader.float32();
                this.sampleLayout = new ComputationNetwork.TensorShape(reader);
            }
            else {
                throw new CntkError('LeanableParameter reader implemented.');
            }
            this.value = new ComputationNetwork.Matrix(reader);
        };
        op.CrossEntropyWithSoftmax = function(reader) {
            this.evalMode = reader.uint32();
            if (this.evalMode > 2) {
                this.evalMode = 0;
                reader.seek(-4);
            }
        };
        op.Times = function(reader) {
            this.outputRank = (reader.version >= 3) ? reader.uint64() : 1;
            this.inferInputRankToMap = (reader.version >= 12) ? reader.int32() : -1;
        };
        op.Dropout = function(reader) {
            if (reader.version >= 16) {
                var seed = (reader.version == 16) ? reader.uint32() : reader.uint64();
                var offset = reader.uint64();
            }
        };
        op.ConvolutionBase = function(reader) {
            if (reader.version >= 5)
            {
                this.kernelShape = new ComputationNetwork.TensorShape(reader);
                this.mapCount = new ComputationNetwork.TensorShape(reader);
                this.strides = new ComputationNetwork.TensorShape(reader);
                this.sharing = reader.bools(reader.uint64());
                this.autoPadding = reader.bools(reader.uint64());
                this.lowerPad = new ComputationNetwork.TensorShape(reader);
                this.upperPad = new ComputationNetwork.TensorShape(reader);
                this.poolKind = reader.uint32();
                this.imageLayout = reader.uint32();
                this.maxTempMemSizeInSamples = reader.uint64();
            }
            if (reader.version >= 9) {
                this.transpose = reader.bool();
            }
            if (reader.version >= 20) {
                this.outputShape = new ComputationNetwork.TensorShape(reader);
            }
            if (reader.version >= 21) {
                this.ceilOutDim = reader.bool();
            }
            if (reader.version >= 23) {
                this.includePad = reader.bool();
            }
        };
        op.Convolution = function(reader) {
            op.ConvolutionBase.apply(this, [ reader ]);
            if (reader.version < 5) {
                this.kernelShape = new ComputationNetwork.TensorShape([ reader.uint64(), reader.uint64(), 1 ]);
                this.strides = new ComputationNetwork.TensorShape([ reader.uint64(), reader.uint64(), 1 ]);
                this.mapCount = new ComputationNetwork.TensorShape([ reader.uint32() ]);
                this.imageLayout = reader.uint32();
                this.autoPadding = [ reader.bool() ];
                this.maxTempMemSizeInSamples = reader.uint64();
                this.poolKind = 'None'; // TODO
                this.convolution2D = true;
                this.sharing = [ true ];
                m_lowerPad = new ComputationNetwork.TensorShape([ 0 ]);
                m_upperPad = new ComputationNetwork.TensorShape([ 0 ]);
            }
            else {
                this.convolution2D = reader.bool();
                if (reader.version >= 18) {
                    this.dilation = new ComputationNetwork.TensorShape(reader);
                }
                else {
                    this.dilation = new ComputationNetwork.TensorShape([ 1 ]);
                }
            }
        };
        op.Pooling = function(reader) {
            op.ConvolutionBase.apply(this, [ reader ]);
        };
        op.PoolingBase = function(reader) {
            this.imageLayoutKind = reader.uint32();
            this.windowWidth = reader.uint32();
            this.windowHeight = reader.uint64();
            this.horizontalSubsample = reader.uint64();
            this.verticalSubsample = reader.uint64();
        };
        op.MaxPooling = function(reader) {
            op.PoolingBase.apply(this, [ reader ]);
        };
        op.ROIPooling = function(reader) {
            this.roiOutputShape = new ComputationNetwork.TensorShape(reader);
            this.poolKind = (reader.version < 26) ? 'Max' : reader.uint32();
            this.spatialScale = (reader.version < 26) ? 0.0625 : reader.float64();
        };
        op.Reshape = function(reader) {
            this.beginDimParameter = reader.uint32();
            this.endDimParameter = reader.uint32();
            this.replacementSampleLayout = new ComputationNetwork.TensorShape(reader);
        };
        op.ReduceElements = function(reader) {
            var num_axes = 1;
            if (reader.version >= 27) {
                num_axes = reader.uint32();
            }
            this.axes = [];
            for (var i = 0; i < num_axes; i++)
            {
                this.axes.push(reader.uint32());
            }
            this.operation = reader.string();
            if (reader.version >= 24) {
                this.keepDimensions = reader.bool();
            }
        };
        op.BatchNormalization = function(reader) {
            var mbCount = 0;
            if (reader.version >= 6)
            {
                this.spatial = reader.bool();
                this.normalizationTimeConstant = reader.float64();
                this.blendTimeConstant = reader.float64();
                this.imageLayoutKind = reader.int32();
                if (reader.version >= 13)
                {
                    if (reader.version != 19) {
                        this.runCountUntied = reader.uint64();
                    }
                    else
                    {
                        this.runCountUntied = reader.bool() ? 0 : 'SIZE_MAX'; // TODO
                    }
                }
                else {
                    mbCount = reader.uint64();
                }
                this.epsilon = reader.float64();
                this.useCntkEngine = reader.bool();
            }
            else
            {
                var verWritten = reader.int32();
                var verReadable = reader.int32();
                if (verReadable > verWritten || verWritten < 0x00010001 || verReadable > 0x00010004) {
                    throw new CntkError('BackNormalization version not supported.');
                }
                this.eval = reader.bool();
                this.spatial = reader.bool();
                if (verWritten >= 0x00010004) {
                    this.normalizationTimeConstant = reader.float64();
                }
                else {
                    reader.float64(); // expAvgFactor
                }
                if (verWritten >= 0x00010002) {
                    this.imageLayoutKind = reader.int32();
                    mbCount = reader.uint64();
                }
                if (verWritten >= 0x00010003) {
                    this.epsilon = reader.float64();
                    this.useCntkEngine = reader.bool();
                }
            }
            if (reader.version < 13)
            {
                this.runCountUntied = 16 * mbCount;
                this.convertRunningVariancePending = true;
            }
        };
        
        var nodes = [];
        this.nodes = {};
        for (var i = 0; i < numNodes; i++) {
            var precision = reader.version >= 7 ? reader.string() : '';
            if (precision != 'float' && precision != 'double' && precision != 'half' && precision != '') {
                throw new CntkError("Invalid precision format '" + precision + "'.");
            }
            var obj = { __type__: reader.string() };
            obj.name = reader.string();
            obj.precision = precision;
            var constructor = op[obj.__type__];
            if (!constructor) {
                throw new CntkError("Unknown operator '" + obj.__type__ + "'.");
            } 
            constructor.apply(obj, [ reader ]);
            nodes.push(obj);
            this.nodes[obj.name] = obj;
        }
        reader.assert('ENodeList');
        reader.assert('BRelation');
        for (var j = 0; j < numNodes; j++) {
            var nodeName = reader.string();
            var node = this.nodes[nodeName];
            var numChildren = reader.uint64();
            var children = [];
            for (var k = 0; k < numChildren; k++) {
                children.push(reader.string());
            }
            if (this.version < 19 && node.__type__ == 'BatchNormalization') {
                throw new CntkError('BatchNormalization handler not implemented.');
            }
            if (node.__type__ == 'Convolution' && children.length > 1) {
                children.splice(0, 0, children.pop());
            }
            node.inputs = children;
        }
        reader.assert('ERelation');
        reader.assert('BRootNodes');
        if (reader.match('BFeatureNodes')) {
            this.feature = reader.strings(reader.uint64());
            reader.assert('EFeatureNodes');
        }
        if (reader.match('BLabelNodes')) {
            this.label = reader.strings(reader.uint64());
            reader.assert('ELabelNodes');
        }
        if (reader.match('BCriterionNodes')) {
            this.criterion = reader.strings(reader.uint64());
            reader.assert('ECriterionNodes');
        }
        if (this.criterion.length == 0) {
            if (reader.match('BCriteriaNodes')) {
                this.criterion = reader.strings(reader.uint64());
                reader.assert('ECriteriaNodes');
            }
        }
        if (reader.match('BNodesReqMultiSeqHandling')) {
            reader.strings(reader.uint64());
            reader.assert('ENodesReqMultiSeqHandling');
        }
        if (reader.match('BEvalNodes')) {
            this.eval = reader.strings(reader.uint64());
            reader.assert('EEvalNodes');
        }
        if (reader.match('BOutputNodes')) {
            this.output = reader.strings(reader.uint64());
            reader.assert('EOutputNodes');
        }
        if (reader.match('BPairNodes')) {
            this.pair = reader.strings(reader.uint64());
            reader.assert('EPairNodes');
        }
        reader.assert('ERootNodes');
        reader.assert('ECN');
    }
}

ComputationNetwork.Reader = class {

    constructor(buffer) {
        this._buffer = buffer;
        this._dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        this._offset = 0;
    }

    set version(value) {
        this._version = value;
    }

    get version() {
        return this._version;
    }

    match(text) {
        var offset = this._offset;
        for (var i = 0; i < text.length; i++) {
            if (this.readUInt16() != text.charCodeAt(i)) {
                this._offset = offset;
                return false;
            }
        }
        if (this.readUInt16() != 0) {
            this._offset = offset;
            return false;
        }
        return true;
    }

    assert(text) {
        if (!this.match(text)) {
            throw new CntkError("Invalid '" + text + "' signature.");
        }
    }

    seek(offset) {
        this._offset += offset;
    }

    bool() {
        return this.byte() != 0 ? true : false;
    }

    bools(count) {
        var array = [];
        for (var i = 0; i < count; i++) {
            array.push(this.bool());
        }
        return array;
    }

    byte() {
        var value = this._dataView.getUint8(this._offset);
        this._offset++;
        return value;
    }

    bytes(count) {
        var data = this._buffer.subarray(this._offset, this._offset + count);
        this._offset += count;
        return data;
    }

    readUInt16() {
        var value = this._dataView.getUint16(this._offset, true);
        this._offset += 2;
        return value;
    }

    int32() {
        var value = this._dataView.getInt32(this._offset, true);
        this._offset += 4;
        return value;
    }

    uint32() {
        var value = this._dataView.getUint32(this._offset, true);
        this._offset += 4;
        return value;
    }

    uint64() {
        var low = this.uint32();
        var hi = this.uint32();
        if (hi > 65536) {
            throw new CntkError('Value not in 48-bit range.');
        }
        return (hi << 32) | low;
    }

    float32() {
        var value = this._dataView.getFloat32(this._offset, true);
        this._offset += 4;
        return value;
    }

    float64() {
        var value = this._dataView.getFloat64(this._offset, true);
        this._offset += 8;
        return value;
    }

    string() {
        var text = '';
        while (true) {
            var c = this.readUInt16();
            if (c == 0) {
                break;
            }
            text += String.fromCharCode(c);
        }
        return text;
    }

    strings(count) {
        var array = [];
        for (var i = 0; i < count; i++) {
            array.push(this.string());
        }
        return array;
    }
};

ComputationNetwork.TensorShape = class {
    constructor(reader, acceptLegacyFormat = false) {
        if (reader && Array.isArray(reader)) {
            this.dims = reader;
            return;
        }
        this.dims = [];
        var rank = reader.uint32();
        var dim0 = 0;
        if (rank > 0) {
            dim0 = reader.uint32();
        }
        if (!acceptLegacyFormat || dim0 != 0) {
            this.dims.push(dim0);
            for (var i = 1; i < rank; i++) {
                this.dims.push(reader.uint32());
            }
        }
        else {
            var dim = reader.uint32();
            this.dims.push(reader.uint32());
            this.dims.push(rank);
            this.dims.push(dim);
        }
    }
};

ComputationNetwork.Matrix = class {
    constructor(reader) {
        var type = reader.byte();
        switch (type) {
            case 100: // dense
                reader.assert('BMAT');
                var elsize = reader.uint64();
                this.name = reader.string();
                this.format = reader.uint32();
                this.rows = reader.uint64();
                this.columns = reader.uint64();
                reader.bytes(elsize * this.rows * this.columns);
                reader.assert('EMAT');
                break;
            case 115: // sparse
                throw new CntkError('Matrix sparse type not implemented.');
            default:
                throw new CntkError("Matrix type '" + type.toString() + "' not implemented.");
        }
    }
};


class CntkError extends Error {
    constructor(message) {
        super(message);
        this.name = 'Error loading CNTK model.';
    }
}