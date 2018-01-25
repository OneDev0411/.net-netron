#!/usr/bin/env python

from __future__ import unicode_literals

import json
import io
import sys

from onnx import defs
from onnx.defs import OpSchema
from onnx.backend.test.case import collect_snippets

snippets = collect_snippets()

categories = {
    'Constant': 'Constant',

    'Conv': 'Layer',
    'ConvTranspose': 'Layer',
    'FC': 'Layer',
    'RNN': 'Layer',
    'LSTM': 'Layer',
    'GRU': 'Layer',

    'Dropout': 'Dropout',

    'Elu': 'Activation',
    'HardSigmoid': 'Activation',
    'LeakyRelu': 'Activation',
    'PRelu': 'Activation',
    'ThresholdedRelu': 'Activation',
    'Relu': 'Activation',
    'Selu': 'Activation',
    'Sigmoid': 'Activation',
    'Tanh': 'Activation',
    'LogSoftmax': 'Activation',
    'Softmax': 'Activation',
    'Softplus': 'Activation',
    'Softsign': 'Activation',

    'BatchNormalization': 'Normalization',
    'InstanceNormalization': 'Normalization',
    'LpNormalization': 'Normalization',
    'LRN': 'Normalization',

    'Flatten': 'Shape',
    'Reshape': 'Shape',
    'Transpose': 'Shape',

    'Xor': 'Logic',
    'Not': 'Logic',
    'Or': 'Logic',
    'Less': 'Logic',
    'And': 'Logic',
    'Greater': 'Logic',
    'Equal': 'Logic',

    'AveragePool': 'Pool',
    'GlobalAveragePool': 'Pool',
    'GlobalLpPool': 'Pool',
    'GlobalMaxPool': 'Pool',
    'LpPool': 'Pool',
    'MaxPool': 'Pool',
    'MaxRoiPool': 'Pool',

    'Concat': 'Tensor',
    'Slice': 'Tensor',
    'Split': 'Tensor',
    'Pad': 'Tensor',

    'ImageScaler': 'Data',
    'Crop': 'Data',

    # 'Gemm': '',
    # 'MatMul': '',
    # 'Hardmax':
    # 'Log':
    # 'Max':
    # 'Div': 'Basic',
    # 'Ceil': 'Basic',
    # 'Exp': 'Basic',
    # 'Floor': 'Basic',
    # 'Sqrt': 'Basic',
    # 'Sub': 'Basic',
    # 'Sum': 'Basic',
    # 'Min': 'Basic',
    # 'Mul': 'Basic',
    # 'Neg': 'Basic',
    # 'Abs': 'Basic',
    # 'Add': 'Basic',
    # 'Pow': 'Basic',
    # 'ArgMax':
    # 'ArgMin':
    # 'Cast':
    # 'Clip':
    # 'DepthToSpace':
    # 'Mean': 
    # 'Pad':
    # 'RandomNormal':
    # 'RandomNormalLike':
    # 'RandomUniform':
    # 'RandomUniformLike':
    # 'Reciprocal':
    # 'ReduceL1':
    # 'ReduceL2':
    # 'ReduceLogSum':
    # 'ReduceLogSumExp':
    # 'ReduceMax':
    # 'ReduceMean':
    # 'ReduceMin':
    # 'ReduceProd':
    # 'ReduceSum':
    # 'ReduceSumSquare':
    # 'SpaceToDepth':
    # 'Squeeze':
    # 'Tile':
    # 'Gather':
}

def generate_json_attr_type(type):
    assert isinstance(type, OpSchema.AttrType)
    s = str(type)
    s = s[s.rfind('.')+1:].lower()
    if s[-1] == 's':
        s = s[0:-1] + '[]'
    return s

def generate_json_support_level_name(support_level):
    assert isinstance(support_level, OpSchema.SupportType)
    s = str(support_level)
    return s[s.rfind('.')+1:].lower()

def generate_json_types(types):
    r = []
    for type in types:
        r.append(type)
    r = sorted(r)
    return r

def generate_json(schemas, json_file):
    json_root = []
    for schema in schemas:
        json_schema = {}
        if schema.domain:
            json_schema['domain'] = schema.domain
        else:
            json_schema['domain'] = 'ai.onnx'
        json_schema['since_version'] = schema.since_version
        json_schema['support_level'] = generate_json_support_level_name(schema.support_level)
        if schema.doc:
            json_schema['description'] = schema.doc.lstrip();
        if schema.inputs:
            json_schema['inputs'] = []
            for input in schema.inputs:
                json_input = {}
                json_input['name'] = input.name
                json_input['description'] = input.description
                json_input['type'] = input.typeStr
                if input.option == OpSchema.FormalParameterOption.Optional:
                    json_input['option'] = 'optional'
                elif input.option == OpSchema.FormalParameterOption.Variadic:
                    json_input['option'] = 'variadic'
                json_schema['inputs'].append(json_input)
        json_schema['min_input'] = schema.min_input;
        json_schema['max_input'] = schema.max_input;
        if schema.outputs:
            json_schema['outputs'] = []
            for output in schema.outputs:
                json_output = {}
                json_output['name'] = output.name
                json_output['description'] = output.description
                json_output['type'] = output.typeStr
                if output.option == OpSchema.FormalParameterOption.Optional:
                    json_output['option'] = 'optional'
                elif output.option == OpSchema.FormalParameterOption.Variadic:
                    json_output['option'] = 'variadic'
                json_schema['outputs'].append(json_output)
        json_schema['min_output'] = schema.min_output;
        json_schema['max_output'] = schema.max_output;
        if schema.attributes:
            json_schema['attributes'] = []
            for _, attribute in sorted(schema.attributes.items()):
                json_schema['attributes'].append({
                    'name' : attribute.name,
                    'description': attribute.description,
                    'type': generate_json_attr_type(attribute.type),
                    'required': attribute.required })
        if schema.type_constraints:
            json_schema['type_constraints'] = []
            for type_constraint in schema.type_constraints:
                json_schema['type_constraints'].append({
                    'description': type_constraint.description,
                    'type_param_str': type_constraint.type_param_str,
                    'allowed_type_strs': type_constraint.allowed_type_strs
                })
        if schema.name in snippets:
            json_schema['snippets'] = []
            for summary, code in sorted(snippets[schema.name]):
                json_schema['snippets'].append({
                    'summary': summary,
                    'code': code
                })
        if schema.name in categories:
            json_schema['category'] = categories[schema.name]
        json_root.append({
            'name': schema.name,
            'schema': json_schema 
        })
    with io.open(json_file, 'w', newline='') as fout:
        json_root = json.dumps(json_root, sort_keys=True, indent=2)
        for line in json_root.splitlines():
            line = line.rstrip()
            if sys.version_info[0] < 3:
                line = unicode(line)
            fout.write(line)
            fout.write('\n')

if __name__ == '__main__':
    schemas = sorted(defs.get_all_schemas_with_history(), key=lambda schema: schema.name)
    generate_json(schemas, '../src/onnx-operator.json')
