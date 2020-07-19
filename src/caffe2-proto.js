var $root = protobuf.get('caffe2');

$root.caffe2 = {};

$root.caffe2.ExternalDataProto = class ExternalDataProto {

    constructor() {
        this.strides = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.ExternalDataProto();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.source_type = reader.int32();
                    break;
                case 2:
                    message.record_id = reader.string();
                    break;
                case 5:
                    message.record_size = reader.uint64();
                    break;
                case 3:
                    message.offset = reader.int64();
                    break;
                case 4:
                    message.strides = reader.array(message.strides, () => reader.int64(), tag);
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.ExternalDataProto();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "source_type":
                    message.source_type = reader.enum($root.caffe2.ExternalDataProto.SourceType);
                    break;
                case "record_id":
                    message.record_id = reader.string();
                    break;
                case "record_size":
                    message.record_size = reader.integer();
                    break;
                case "offset":
                    message.offset = reader.integer();
                    break;
                case "strides":
                    reader.array(message.strides, () => reader.integer());
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.ExternalDataProto.prototype.source_type = 0;
$root.caffe2.ExternalDataProto.prototype.record_id = "";
$root.caffe2.ExternalDataProto.prototype.record_size = protobuf.Long ? protobuf.Long.fromBits(0, 0, true) : 0;
$root.caffe2.ExternalDataProto.prototype.offset = protobuf.Long ? protobuf.Long.fromBits(0, 0, false) : 0;

$root.caffe2.ExternalDataProto.SourceType = {
    "INLINE_CONTAINER": 0,
    "SIMPLE_FILE": 1
};

$root.caffe2.TensorProto = class TensorProto {

    constructor() {
        this.dims = [];
        this.float_data = [];
        this.int32_data = [];
        this.string_data = [];
        this.double_data = [];
        this.int64_data = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.TensorProto();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.dims = reader.array(message.dims, () => reader.int64(), tag);
                    break;
                case 2:
                    message.data_type = reader.int32();
                    break;
                case 12:
                    message.storage_type = reader.int32();
                    break;
                case 3:
                    message.float_data = reader.floats(message.float_data, tag);
                    break;
                case 4:
                    message.int32_data = reader.array(message.int32_data, () => reader.int32(), tag);
                    break;
                case 5:
                    message.byte_data = reader.bytes();
                    break;
                case 6:
                    message.string_data.push(reader.bytes());
                    break;
                case 9:
                    message.double_data = reader.doubles(message.double_data, tag);
                    break;
                case 10:
                    message.int64_data = reader.array(message.int64_data, () => reader.int64(), tag);
                    break;
                case 13:
                    message.raw_data = reader.bytes();
                    break;
                case 14:
                    message.external_data = $root.caffe2.ExternalDataProto.decode(reader, reader.uint32());
                    break;
                case 7:
                    message.name = reader.string();
                    break;
                case 8:
                    message.device_detail = $root.caffe2.DeviceOption.decode(reader, reader.uint32());
                    break;
                case 11:
                    message.segment = $root.caffe2.TensorProto.Segment.decode(reader, reader.uint32());
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.TensorProto();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "dims":
                    reader.array(message.dims, () => reader.integer());
                    break;
                case "data_type":
                    message.data_type = reader.enum($root.caffe2.TensorProto.DataType);
                    break;
                case "storage_type":
                    message.storage_type = reader.enum($root.caffe2.TensorProto.StorageType);
                    break;
                case "float_data":
                    reader.array(message.float_data, () => reader.float());
                    break;
                case "int32_data":
                    reader.array(message.int32_data, () => reader.integer());
                    break;
                case "byte_data":
                    message.byte_data = reader.bytes();
                    break;
                case "string_data":
                    reader.array(message.string_data, () => reader.bytes());
                    break;
                case "double_data":
                    reader.array(message.double_data, () => reader.float());
                    break;
                case "int64_data":
                    reader.array(message.int64_data, () => reader.integer());
                    break;
                case "raw_data":
                    message.raw_data = reader.bytes();
                    break;
                case "external_data":
                    message.external_data = $root.caffe2.ExternalDataProto.decodeText(reader, true);
                    break;
                case "name":
                    message.name = reader.string();
                    break;
                case "device_detail":
                    message.device_detail = $root.caffe2.DeviceOption.decodeText(reader, true);
                    break;
                case "segment":
                    message.segment = $root.caffe2.TensorProto.Segment.decodeText(reader, true);
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.TensorProto.prototype.data_type = 1;
$root.caffe2.TensorProto.prototype.storage_type = 1;
$root.caffe2.TensorProto.prototype.byte_data = new Uint8Array([]);
$root.caffe2.TensorProto.prototype.raw_data = new Uint8Array([]);
$root.caffe2.TensorProto.prototype.external_data = null;
$root.caffe2.TensorProto.prototype.name = "";
$root.caffe2.TensorProto.prototype.device_detail = null;
$root.caffe2.TensorProto.prototype.segment = null;

$root.caffe2.TensorProto.DataType = {
    "UNDEFINED": 0,
    "FLOAT": 1,
    "INT32": 2,
    "BYTE": 3,
    "STRING": 4,
    "BOOL": 5,
    "UINT8": 6,
    "INT8": 7,
    "UINT16": 8,
    "INT16": 9,
    "INT64": 10,
    "FLOAT16": 12,
    "DOUBLE": 13,
    "ZERO_COLLISION_HASH": 14
};

$root.caffe2.TensorProto.StorageType = {
    "TYPED": 1,
    "RAW": 2,
    "EXTERNAL": 3,
    "NO_CONTENT": 4
};

$root.caffe2.TensorProto.Segment = class Segment {

    constructor() {
    }

    static decode(reader, length) {
        const message = new $root.caffe2.TensorProto.Segment();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.begin = reader.int64();
                    break;
                case 2:
                    message.end = reader.int64();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'begin')) {
            throw new protobuf.Error("Excepted 'begin'.");
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'end')) {
            throw new protobuf.Error("Excepted 'end'.");
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.TensorProto.Segment();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "begin":
                    message.begin = reader.integer();
                    break;
                case "end":
                    message.end = reader.integer();
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        if (!Object.prototype.hasOwnProperty.call(message, "begin"))
            throw new protobuf.Error("Excepted 'begin'.");
        if (!Object.prototype.hasOwnProperty.call(message, "end"))
            throw new protobuf.Error("Excepted 'end'.");
        return message;
    }
};

$root.caffe2.TensorProto.Segment.prototype.begin = protobuf.Long ? protobuf.Long.fromBits(0, 0, false) : 0;
$root.caffe2.TensorProto.Segment.prototype.end = protobuf.Long ? protobuf.Long.fromBits(0, 0, false) : 0;

$root.caffe2.QTensorProto = class QTensorProto {

    constructor() {
        this.dims = [];
        this.data = [];
        this.scales = [];
        this.biases = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.QTensorProto();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.dims = reader.array(message.dims, () => reader.int64(), tag);
                    break;
                case 2:
                    message.precision = reader.int32();
                    break;
                case 3:
                    message.scale = reader.double();
                    break;
                case 4:
                    message.bias = reader.double();
                    break;
                case 5:
                    message.is_signed = reader.bool();
                    break;
                case 6:
                    message.data = reader.array(message.data, () => reader.int32(), tag);
                    break;
                case 7:
                    message.name = reader.string();
                    break;
                case 8:
                    message.data_type = reader.int32();
                    break;
                case 9:
                    message.scales = reader.doubles(message.scales, tag);
                    break;
                case 10:
                    message.biases = reader.doubles(message.biases, tag);
                    break;
                case 11:
                    message.axis = reader.int32();
                    break;
                case 12:
                    message.is_multiparam = reader.bool();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'precision')) {
            throw new protobuf.Error("Excepted 'precision'.");
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'scale')) {
            throw new protobuf.Error("Excepted 'scale'.");
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'bias')) {
            throw new protobuf.Error("Excepted 'bias'.");
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'is_signed')) {
            throw new protobuf.Error("Excepted 'is_signed'.");
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.QTensorProto();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "dims":
                    reader.array(message.dims, () => reader.integer());
                    break;
                case "precision":
                    message.precision = reader.integer();
                    break;
                case "scale":
                    message.scale = reader.float();
                    break;
                case "bias":
                    message.bias = reader.float();
                    break;
                case "is_signed":
                    message.is_signed = reader.boolean();
                    break;
                case "data":
                    reader.array(message.data, () => reader.integer());
                    break;
                case "name":
                    message.name = reader.string();
                    break;
                case "data_type":
                    message.data_type = reader.enum($root.caffe2.TensorProto.DataType);
                    break;
                case "scales":
                    reader.array(message.scales, () => reader.float());
                    break;
                case "biases":
                    reader.array(message.biases, () => reader.float());
                    break;
                case "axis":
                    message.axis = reader.integer();
                    break;
                case "is_multiparam":
                    message.is_multiparam = reader.boolean();
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        if (!Object.prototype.hasOwnProperty.call(message, "precision"))
            throw new protobuf.Error("Excepted 'precision'.");
        if (!Object.prototype.hasOwnProperty.call(message, "scale"))
            throw new protobuf.Error("Excepted 'scale'.");
        if (!Object.prototype.hasOwnProperty.call(message, "bias"))
            throw new protobuf.Error("Excepted 'bias'.");
        if (!Object.prototype.hasOwnProperty.call(message, "is_signed"))
            throw new protobuf.Error("Excepted 'is_signed'.");
        return message;
    }
};

$root.caffe2.QTensorProto.prototype.precision = 0;
$root.caffe2.QTensorProto.prototype.scale = 0;
$root.caffe2.QTensorProto.prototype.bias = 0;
$root.caffe2.QTensorProto.prototype.is_signed = false;
$root.caffe2.QTensorProto.prototype.name = "";
$root.caffe2.QTensorProto.prototype.data_type = 2;
$root.caffe2.QTensorProto.prototype.axis = 0;
$root.caffe2.QTensorProto.prototype.is_multiparam = false;

$root.caffe2.TensorProtos = class TensorProtos {

    constructor() {
        this.protos = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.TensorProtos();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.protos.push($root.caffe2.TensorProto.decode(reader, reader.uint32()));
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.TensorProtos();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "protos":
                    message.protos.push($root.caffe2.TensorProto.decodeText(reader, true));
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.TensorShape = class TensorShape {

    constructor() {
        this.dims = [];
        this.unknown_dims = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.TensorShape();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.dims = reader.array(message.dims, () => reader.int64(), tag);
                    break;
                case 2:
                    message.data_type = reader.int32();
                    break;
                case 3:
                    message.unknown_dims = reader.array(message.unknown_dims, () => reader.int32(), tag);
                    break;
                case 4:
                    message.unknown_shape = reader.bool();
                    break;
                case 5:
                    message.name = reader.string();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.TensorShape();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "dims":
                    reader.array(message.dims, () => reader.integer());
                    break;
                case "data_type":
                    message.data_type = reader.enum($root.caffe2.TensorProto.DataType);
                    break;
                case "unknown_dims":
                    reader.array(message.unknown_dims, () => reader.integer());
                    break;
                case "unknown_shape":
                    message.unknown_shape = reader.boolean();
                    break;
                case "name":
                    message.name = reader.string();
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.TensorShape.prototype.data_type = 1;
$root.caffe2.TensorShape.prototype.unknown_shape = false;
$root.caffe2.TensorShape.prototype.name = "";

$root.caffe2.TensorShapes = class TensorShapes {

    constructor() {
        this.shapes = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.TensorShapes();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.shapes.push($root.caffe2.TensorShape.decode(reader, reader.uint32()));
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.TensorShapes();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "shapes":
                    message.shapes.push($root.caffe2.TensorShape.decodeText(reader, true));
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.TensorBoundShape = class TensorBoundShape {

    constructor() {
        this.dim_type = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.TensorBoundShape();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.shape = $root.caffe2.TensorShape.decode(reader, reader.uint32());
                    break;
                case 2:
                    message.dim_type = reader.array(message.dim_type, () => reader.int32(), tag);
                    break;
                case 3:
                    message.name = reader.string();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.TensorBoundShape();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "shape":
                    message.shape = $root.caffe2.TensorShape.decodeText(reader, true);
                    break;
                case "dim_type":
                    reader.array(message.dim_type, () => reader.enum($root.caffe2.TensorBoundShape.DimType));
                    break;
                case "name":
                    message.name = reader.string();
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.TensorBoundShape.prototype.shape = null;
$root.caffe2.TensorBoundShape.prototype.name = "";

$root.caffe2.TensorBoundShape.DimType = {
    "UNKNOWN": 0,
    "CONSTANT": 1,
    "BATCH": 2,
    "BATCH_OF_FEATURE_MAX": 3,
    "BATCH_OF_FEATURE_MAX_DEFAULT": 4,
    "FEATURE_MAX": 5,
    "FEATURE_MAX_DEFAULT": 6
};

$root.caffe2.TensorBoundShapes = class TensorBoundShapes {

    constructor() {
        this.shapes = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.TensorBoundShapes();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.shapes.push($root.caffe2.TensorBoundShape.decode(reader, reader.uint32()));
                    break;
                case 2:
                    message.max_batch_size = reader.int64();
                    break;
                case 3:
                    message.max_feature_len = reader.int64();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.TensorBoundShapes();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "shapes":
                    message.shapes.push($root.caffe2.TensorBoundShape.decodeText(reader, true));
                    break;
                case "max_batch_size":
                    message.max_batch_size = reader.integer();
                    break;
                case "max_feature_len":
                    message.max_feature_len = reader.integer();
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.TensorBoundShapes.prototype.max_batch_size = protobuf.Long ? protobuf.Long.fromBits(0, 0, false) : 0;
$root.caffe2.TensorBoundShapes.prototype.max_feature_len = protobuf.Long ? protobuf.Long.fromBits(0, 0, false) : 0;

$root.caffe2.Argument = class Argument {

    constructor() {
        this.floats = [];
        this.ints = [];
        this.strings = [];
        this.tensors = [];
        this.nets = [];
        this.qtensors = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.Argument();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.name = reader.string();
                    break;
                case 2:
                    message.f = reader.float();
                    break;
                case 3:
                    message.i = reader.int64();
                    break;
                case 4:
                    message.s = reader.bytes();
                    break;
                case 10:
                    message.t = $root.caffe2.TensorProto.decode(reader, reader.uint32());
                    break;
                case 8:
                    message.n = $root.caffe2.NetDef.decode(reader, reader.uint32());
                    break;
                case 5:
                    message.floats = reader.floats(message.floats, tag);
                    break;
                case 6:
                    message.ints = reader.array(message.ints, () => reader.int64(), tag);
                    break;
                case 7:
                    message.strings.push(reader.bytes());
                    break;
                case 11:
                    message.tensors.push($root.caffe2.TensorProto.decode(reader, reader.uint32()));
                    break;
                case 9:
                    message.nets.push($root.caffe2.NetDef.decode(reader, reader.uint32()));
                    break;
                case 12:
                    message.qtensors.push($root.caffe2.QTensorProto.decode(reader, reader.uint32()));
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.Argument();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "name":
                    message.name = reader.string();
                    break;
                case "f":
                    message.f = reader.float();
                    break;
                case "i":
                    message.i = reader.integer();
                    break;
                case "s":
                    message.s = reader.bytes();
                    break;
                case "t":
                    message.t = $root.caffe2.TensorProto.decodeText(reader, true);
                    break;
                case "n":
                    message.n = $root.caffe2.NetDef.decodeText(reader, true);
                    break;
                case "floats":
                    reader.array(message.floats, () => reader.float());
                    break;
                case "ints":
                    reader.array(message.ints, () => reader.integer());
                    break;
                case "strings":
                    reader.array(message.strings, () => reader.bytes());
                    break;
                case "tensors":
                    message.tensors.push($root.caffe2.TensorProto.decodeText(reader, true));
                    break;
                case "nets":
                    message.nets.push($root.caffe2.NetDef.decodeText(reader, true));
                    break;
                case "qtensors":
                    message.qtensors.push($root.caffe2.QTensorProto.decodeText(reader, true));
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.Argument.prototype.name = "";
$root.caffe2.Argument.prototype.f = 0;
$root.caffe2.Argument.prototype.i = protobuf.Long ? protobuf.Long.fromBits(0, 0, false) : 0;
$root.caffe2.Argument.prototype.s = new Uint8Array([]);
$root.caffe2.Argument.prototype.t = null;
$root.caffe2.Argument.prototype.n = null;

$root.caffe2.DeviceTypeProto = {
    "PROTO_CPU": 0,
    "PROTO_CUDA": 1,
    "PROTO_MKLDNN": 2,
    "PROTO_OPENGL": 3,
    "PROTO_OPENCL": 4,
    "PROTO_IDEEP": 5,
    "PROTO_HIP": 6,
    "PROTO_FPGA": 7,
    "PROTO_MSNPU": 8,
    "PROTO_XLA": 9,
    "PROTO_COMPILE_TIME_MAX_DEVICE_TYPES": 10,
    "PROTO_ONLY_FOR_TEST": 20901
};

$root.caffe2.DeviceOption = class DeviceOption {

    constructor() {
        this.extra_info = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.DeviceOption();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.device_type = reader.int32();
                    break;
                case 2:
                    message.device_id = reader.int32();
                    break;
                case 3:
                    message.random_seed = reader.uint32();
                    break;
                case 4:
                    message.node_name = reader.string();
                    break;
                case 5:
                    message.numa_node_id = reader.int32();
                    break;
                case 6:
                    message.extra_info.push(reader.string());
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.DeviceOption();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "device_type":
                    message.device_type = reader.integer();
                    break;
                case "device_id":
                    message.device_id = reader.integer();
                    break;
                case "random_seed":
                    message.random_seed = reader.integer();
                    break;
                case "node_name":
                    message.node_name = reader.string();
                    break;
                case "numa_node_id":
                    message.numa_node_id = reader.integer();
                    break;
                case "extra_info":
                    reader.array(message.extra_info, () => reader.string());
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.DeviceOption.prototype.device_type = 0;
$root.caffe2.DeviceOption.prototype.device_id = 0;
$root.caffe2.DeviceOption.prototype.random_seed = 0;
$root.caffe2.DeviceOption.prototype.node_name = "";
$root.caffe2.DeviceOption.prototype.numa_node_id = 0;

$root.caffe2.OperatorDef = class OperatorDef {

    constructor() {
        this.input = [];
        this.output = [];
        this.arg = [];
        this.control_input = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.OperatorDef();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.input.push(reader.string());
                    break;
                case 2:
                    message.output.push(reader.string());
                    break;
                case 3:
                    message.name = reader.string();
                    break;
                case 4:
                    message.type = reader.string();
                    break;
                case 5:
                    message.arg.push($root.caffe2.Argument.decode(reader, reader.uint32()));
                    break;
                case 6:
                    message.device_option = $root.caffe2.DeviceOption.decode(reader, reader.uint32());
                    break;
                case 7:
                    message.engine = reader.string();
                    break;
                case 8:
                    message.control_input.push(reader.string());
                    break;
                case 9:
                    message.is_gradient_op = reader.bool();
                    break;
                case 10:
                    message.debug_info = reader.string();
                    break;
                case 11:
                    message.domain = reader.string();
                    break;
                case 12:
                    message.op_version = reader.int64();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.OperatorDef();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "input":
                    reader.array(message.input, () => reader.string());
                    break;
                case "output":
                    reader.array(message.output, () => reader.string());
                    break;
                case "name":
                    message.name = reader.string();
                    break;
                case "type":
                    message.type = reader.string();
                    break;
                case "arg":
                    message.arg.push($root.caffe2.Argument.decodeText(reader, true));
                    break;
                case "device_option":
                    message.device_option = $root.caffe2.DeviceOption.decodeText(reader, true);
                    break;
                case "engine":
                    message.engine = reader.string();
                    break;
                case "control_input":
                    reader.array(message.control_input, () => reader.string());
                    break;
                case "is_gradient_op":
                    message.is_gradient_op = reader.boolean();
                    break;
                case "debug_info":
                    message.debug_info = reader.string();
                    break;
                case "domain":
                    message.domain = reader.string();
                    break;
                case "op_version":
                    message.op_version = reader.integer();
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.OperatorDef.prototype.name = "";
$root.caffe2.OperatorDef.prototype.type = "";
$root.caffe2.OperatorDef.prototype.device_option = null;
$root.caffe2.OperatorDef.prototype.engine = "";
$root.caffe2.OperatorDef.prototype.is_gradient_op = false;
$root.caffe2.OperatorDef.prototype.debug_info = "";
$root.caffe2.OperatorDef.prototype.domain = "";
$root.caffe2.OperatorDef.prototype.op_version = protobuf.Long ? protobuf.Long.fromBits(0, 0, false) : 0;

$root.caffe2.MapFieldEntry = class MapFieldEntry {

    constructor() {
    }

    static decode(reader, length) {
        const message = new $root.caffe2.MapFieldEntry();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.key = reader.string();
                    break;
                case 2:
                    message.val = reader.string();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'key')) {
            throw new protobuf.Error("Excepted 'key'.");
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'val')) {
            throw new protobuf.Error("Excepted 'val'.");
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.MapFieldEntry();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "key":
                    message.key = reader.string();
                    break;
                case "val":
                    message.val = reader.string();
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        if (!Object.prototype.hasOwnProperty.call(message, "key"))
            throw new protobuf.Error("Excepted 'key'.");
        if (!Object.prototype.hasOwnProperty.call(message, "val"))
            throw new protobuf.Error("Excepted 'val'.");
        return message;
    }
};

$root.caffe2.MapFieldEntry.prototype.key = "";
$root.caffe2.MapFieldEntry.prototype.val = "";

$root.caffe2.BackendOptions = class BackendOptions {

    constructor() {
        this.option = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.BackendOptions();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.backend_name = reader.string();
                    break;
                case 2:
                    message.option.push($root.caffe2.MapFieldEntry.decode(reader, reader.uint32()));
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'backend_name')) {
            throw new protobuf.Error("Excepted 'backend_name'.");
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.BackendOptions();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "backend_name":
                    message.backend_name = reader.string();
                    break;
                case "option":
                    message.option.push($root.caffe2.MapFieldEntry.decodeText(reader, true));
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        if (!Object.prototype.hasOwnProperty.call(message, "backend_name"))
            throw new protobuf.Error("Excepted 'backend_name'.");
        return message;
    }
};

$root.caffe2.BackendOptions.prototype.backend_name = "";

$root.caffe2.PartitionInfo = class PartitionInfo {

    constructor() {
        this.device_id = [];
        this.backend_options = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.PartitionInfo();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.name = reader.string();
                    break;
                case 2:
                    message.device_id = reader.array(message.device_id, () => reader.int32(), tag);
                    break;
                case 3:
                    message.extra_info = reader.string();
                    break;
                case 4:
                    message.backend_options.push($root.caffe2.BackendOptions.decode(reader, reader.uint32()));
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'name')) {
            throw new protobuf.Error("Excepted 'name'.");
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.PartitionInfo();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "name":
                    message.name = reader.string();
                    break;
                case "device_id":
                    reader.array(message.device_id, () => reader.integer());
                    break;
                case "extra_info":
                    message.extra_info = reader.string();
                    break;
                case "backend_options":
                    message.backend_options.push($root.caffe2.BackendOptions.decodeText(reader, true));
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        if (!Object.prototype.hasOwnProperty.call(message, "name"))
            throw new protobuf.Error("Excepted 'name'.");
        return message;
    }
};

$root.caffe2.PartitionInfo.prototype.name = "";
$root.caffe2.PartitionInfo.prototype.extra_info = "";

$root.caffe2.NetDef = class NetDef {

    constructor() {
        this.op = [];
        this.arg = [];
        this.external_input = [];
        this.external_output = [];
        this.partition_info = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.NetDef();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.name = reader.string();
                    break;
                case 2:
                    message.op.push($root.caffe2.OperatorDef.decode(reader, reader.uint32()));
                    break;
                case 3:
                    message.type = reader.string();
                    break;
                case 4:
                    message.num_workers = reader.int32();
                    break;
                case 5:
                    message.device_option = $root.caffe2.DeviceOption.decode(reader, reader.uint32());
                    break;
                case 6:
                    message.arg.push($root.caffe2.Argument.decode(reader, reader.uint32()));
                    break;
                case 7:
                    message.external_input.push(reader.string());
                    break;
                case 8:
                    message.external_output.push(reader.string());
                    break;
                case 9:
                    message.partition_info.push($root.caffe2.PartitionInfo.decode(reader, reader.uint32()));
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.NetDef();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "name":
                    message.name = reader.string();
                    break;
                case "op":
                    message.op.push($root.caffe2.OperatorDef.decodeText(reader, true));
                    break;
                case "type":
                    message.type = reader.string();
                    break;
                case "num_workers":
                    message.num_workers = reader.integer();
                    break;
                case "device_option":
                    message.device_option = $root.caffe2.DeviceOption.decodeText(reader, true);
                    break;
                case "arg":
                    message.arg.push($root.caffe2.Argument.decodeText(reader, true));
                    break;
                case "external_input":
                    reader.array(message.external_input, () => reader.string());
                    break;
                case "external_output":
                    reader.array(message.external_output, () => reader.string());
                    break;
                case "partition_info":
                    message.partition_info.push($root.caffe2.PartitionInfo.decodeText(reader, true));
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.NetDef.prototype.name = "";
$root.caffe2.NetDef.prototype.type = "";
$root.caffe2.NetDef.prototype.num_workers = 0;
$root.caffe2.NetDef.prototype.device_option = null;

$root.caffe2.ExecutionStep = class ExecutionStep {

    constructor() {
        this.substep = [];
        this.network = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.ExecutionStep();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.name = reader.string();
                    break;
                case 2:
                    message.substep.push($root.caffe2.ExecutionStep.decode(reader, reader.uint32()));
                    break;
                case 3:
                    message.network.push(reader.string());
                    break;
                case 4:
                    message.num_iter = reader.int64();
                    break;
                case 5:
                    message.criteria_network = reader.string();
                    break;
                case 7:
                    message.report_net = reader.string();
                    break;
                case 8:
                    message.report_interval = reader.int32();
                    break;
                case 11:
                    message.run_every_ms = reader.int64();
                    break;
                case 6:
                    message.concurrent_substeps = reader.bool();
                    break;
                case 9:
                    message.should_stop_blob = reader.string();
                    break;
                case 10:
                    message.only_once = reader.bool();
                    break;
                case 12:
                    message.create_workspace = reader.bool();
                    break;
                case 13:
                    message.num_concurrent_instances = reader.int32();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.ExecutionStep();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "name":
                    message.name = reader.string();
                    break;
                case "substep":
                    message.substep.push($root.caffe2.ExecutionStep.decodeText(reader, true));
                    break;
                case "network":
                    reader.array(message.network, () => reader.string());
                    break;
                case "num_iter":
                    message.num_iter = reader.integer();
                    break;
                case "criteria_network":
                    message.criteria_network = reader.string();
                    break;
                case "report_net":
                    message.report_net = reader.string();
                    break;
                case "report_interval":
                    message.report_interval = reader.integer();
                    break;
                case "run_every_ms":
                    message.run_every_ms = reader.integer();
                    break;
                case "concurrent_substeps":
                    message.concurrent_substeps = reader.boolean();
                    break;
                case "should_stop_blob":
                    message.should_stop_blob = reader.string();
                    break;
                case "only_once":
                    message.only_once = reader.boolean();
                    break;
                case "create_workspace":
                    message.create_workspace = reader.boolean();
                    break;
                case "num_concurrent_instances":
                    message.num_concurrent_instances = reader.integer();
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.ExecutionStep.prototype.name = "";
$root.caffe2.ExecutionStep.prototype.num_iter = protobuf.Long ? protobuf.Long.fromBits(0, 0, false) : 0;
$root.caffe2.ExecutionStep.prototype.criteria_network = "";
$root.caffe2.ExecutionStep.prototype.report_net = "";
$root.caffe2.ExecutionStep.prototype.report_interval = 0;
$root.caffe2.ExecutionStep.prototype.run_every_ms = protobuf.Long ? protobuf.Long.fromBits(0, 0, false) : 0;
$root.caffe2.ExecutionStep.prototype.concurrent_substeps = false;
$root.caffe2.ExecutionStep.prototype.should_stop_blob = "";
$root.caffe2.ExecutionStep.prototype.only_once = false;
$root.caffe2.ExecutionStep.prototype.create_workspace = false;
$root.caffe2.ExecutionStep.prototype.num_concurrent_instances = 0;

$root.caffe2.PlanDef = class PlanDef {

    constructor() {
        this.network = [];
        this.execution_step = [];
    }

    static decode(reader, length) {
        const message = new $root.caffe2.PlanDef();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.name = reader.string();
                    break;
                case 2:
                    message.network.push($root.caffe2.NetDef.decode(reader, reader.uint32()));
                    break;
                case 3:
                    message.execution_step.push($root.caffe2.ExecutionStep.decode(reader, reader.uint32()));
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.PlanDef();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "name":
                    message.name = reader.string();
                    break;
                case "network":
                    message.network.push($root.caffe2.NetDef.decodeText(reader, true));
                    break;
                case "execution_step":
                    message.execution_step.push($root.caffe2.ExecutionStep.decodeText(reader, true));
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.PlanDef.prototype.name = "";

$root.caffe2.BlobProto = class BlobProto {

    constructor() {
    }

    static decode(reader, length) {
        const message = new $root.caffe2.BlobProto();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.name = reader.string();
                    break;
                case 2:
                    message.type = reader.string();
                    break;
                case 3:
                    message.tensor = $root.caffe2.TensorProto.decode(reader, reader.uint32());
                    break;
                case 4:
                    message.content = reader.bytes();
                    break;
                case 5:
                    message.qtensor = $root.caffe2.QTensorProto.decode(reader, reader.uint32());
                    break;
                case 6:
                    message.content_num_chunks = reader.int32();
                    break;
                case 7:
                    message.content_chunk_id = reader.int32();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.BlobProto();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "name":
                    message.name = reader.string();
                    break;
                case "type":
                    message.type = reader.string();
                    break;
                case "tensor":
                    message.tensor = $root.caffe2.TensorProto.decodeText(reader, true);
                    break;
                case "content":
                    message.content = reader.bytes();
                    break;
                case "qtensor":
                    message.qtensor = $root.caffe2.QTensorProto.decodeText(reader, true);
                    break;
                case "content_num_chunks":
                    message.content_num_chunks = reader.integer();
                    break;
                case "content_chunk_id":
                    message.content_chunk_id = reader.integer();
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.BlobProto.prototype.name = "";
$root.caffe2.BlobProto.prototype.type = "";
$root.caffe2.BlobProto.prototype.tensor = null;
$root.caffe2.BlobProto.prototype.content = new Uint8Array([]);
$root.caffe2.BlobProto.prototype.qtensor = null;
$root.caffe2.BlobProto.prototype.content_num_chunks = 0;
$root.caffe2.BlobProto.prototype.content_chunk_id = 0;

$root.caffe2.DBReaderProto = class DBReaderProto {

    constructor() {
    }

    static decode(reader, length) {
        const message = new $root.caffe2.DBReaderProto();
        const end = reader.next(length);
        while (reader.end(end)) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    message.name = reader.string();
                    break;
                case 2:
                    message.source = reader.string();
                    break;
                case 3:
                    message.db_type = reader.string();
                    break;
                case 4:
                    message.key = reader.string();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
            }
        }
        return message;
    }

    static decodeText(reader) {
        const message = new $root.caffe2.DBReaderProto();
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            switch (tag) {
                case "name":
                    message.name = reader.string();
                    break;
                case "source":
                    message.source = reader.string();
                    break;
                case "db_type":
                    message.db_type = reader.string();
                    break;
                case "key":
                    message.key = reader.string();
                    break;
                default:
                    reader.field(tag, message);
                    break;
            }
        }
        return message;
    }
};

$root.caffe2.DBReaderProto.prototype.name = "";
$root.caffe2.DBReaderProto.prototype.source = "";
$root.caffe2.DBReaderProto.prototype.db_type = "";
$root.caffe2.DBReaderProto.prototype.key = "";
