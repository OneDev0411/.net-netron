/* jshint esversion: 6 */
/* eslint "indent": [ "error", 4, { "SwitchCase": 1 } ] */
/* eslint "no-console": off */

const fs = require('fs');
const path = require('path');
const process = require('process');
const child_process = require('child_process');
const http = require('http');
const https = require('https');
const url = require('url');
const protobuf = require('protobufjs');
const sidebar = require('../src/view-sidebar.js');
const view = require('../src/view.js');
const zip = require('../src/zip');
const gzip = require('../src/gzip');
const tar = require('../src/tar');
const xmldom = require('xmldom');

global.protobuf = protobuf;
global.DOMParser = xmldom.DOMParser;
global.TextDecoder = class {

    constructor(encoding) {
        global.TextDecoder._TextDecoder = global.TextDecoder._TextDecoder || require('util').TextDecoder;
        if (encoding !== 'ascii') {
            this._textDecoder = new global.TextDecoder._TextDecoder(encoding);
        }
    }

    decode(data) {
        if (this._textDecoder) {
            return this._textDecoder.decode(data);
        }

        if (data.length < 32) {
            return String.fromCharCode.apply(null, data);
        }

        var buffer = [];
        var start = 0;
        do {
            var end = start + 32;
            if (end > data.length) {
                end = data.length;
            }
            buffer.push(String.fromCharCode.apply(null, data.subarray(start, end)));
            start = end;
        }
        while (start < data.length);
        return buffer.join('');
    }
};

var type = process.argv.length > 2 ? process.argv[2] : null;

var items = JSON.parse(fs.readFileSync(__dirname + '/models.json', 'utf-8'));
var dataFolder = __dirname + '/data';

class TestHost {

    constructor() {
        this._document = new HTMLDocument();
    }

    get document() {
        return this._document;
    }

    initialize(/* view */) {
    }

    environment(name) {
        if (name == 'zoom') {
            return 'none';
        }
        return null;
    }

    screen(/* name */) {
    }

    require(id) {
        try {
            var file = path.join(path.join(__dirname, '../src'), id + '.js');
            return Promise.resolve(require(file));
        }
        catch (error) {
            return Promise.reject(error);
        }
    }

    request(base, file, encoding) {
        var pathname = path.join(base || path.join(__dirname, '../src'), file);
        if (!fs.existsSync(pathname)) {
            return Promise.reject(new Error("File not found '" + file + "'."));
        }
        return Promise.resolve(fs.readFileSync(pathname, encoding));
    }

    event(/* category, action, label, value */) {
    }

    exception(err /*, fatal */) {
        this._raise('exception', { exception: err });
    }

    on(event, callback) {
        this._events = this._events || {};
        this._events[event] = this._events[event] || [];
        this._events[event].push(callback);
    }

    _raise(event, data) {
        if (this._events && this._events[event]) {
            for (var callback of this._events[event]) {
                callback(this, data);
            }
        }
    }
}

class TestContext {

    constructor(host, folder, identifier, buffer) {
        this._host = host;
        this._folder = folder;
        this._identifier = identifier;
        this._buffer = buffer;
    }

    request(file, encoding) {
        return this._host.request(this._folder, file, encoding);
    }

    get identifier() {
        return this._identifier;
    }

    get buffer() {
        return this._buffer;
    }
}

class HTMLDocument {

    constructor() {
        this._elements = {};
        this.documentElement = new HTMLHtmlElement();
        this.body = new HTMLBodyElement();
    }

    createElementNS(/* namespace, name */) {
        return new HTMLHtmlElement();
    }

    createTextNode(/* text */) {
        return new HTMLHtmlElement();
    }

    getElementById(id) {
        var element = this._elements[id];
        if (!element) {
            element = new HTMLHtmlElement();
            this._elements[id] = element;
        }
        return element;
    }

    addEventListener(/* event, callback */) {
    }

    removeEventListener(/* event, callback */) {
    }
}

class HTMLHtmlElement {

    constructor() {
        this._attributes = {};
        this.style = new CSSStyleDeclaration();
    }

    appendChild(/* node */) {
    }

    setAttribute(name, value) {
        this._attributes[name] = value;
    }

    getBBox() {
        return { x: 0, y: 0, width: 10, height: 10 };
    }
    
    getElementsByClassName(/* name */) {
        return null;
    }

    addEventListener(/* event, callback */) {
    }

    removeEventListener(/* event, callback */) {
    }
}

class HTMLBodyElement {

    constructor() {
        this.style = new CSSStyleDeclaration();
    }

    addEventListener(/* event, callback */) {
    }
}

class CSSStyleDeclaration {

    constructor() {
        this._properties = {};
    }

    setProperty(name, value) {
        this._properties[name] = value;
    }
}

function makeDir(dir) {
    if (!fs.existsSync(dir)){
        makeDir(path.dirname(dir));
        fs.mkdirSync(dir);
    }
}

function decompress(buffer, identifier) {
    var archive = null;
    var extension = identifier.split('.').pop().toLowerCase();
    if (extension == 'gz' || extension == 'tgz') {
        archive = new gzip.Archive(buffer);
        if (archive.entries.length == 1) {
            var entry = archive.entries[0];
            if (entry.name) {
                identifier = entry.name;
            }
            else {
                identifier = identifier.substring(0, identifier.lastIndexOf('.'));
                if (extension == 'tgz') {
                    identifier += '.tar';
                }
            }
            buffer = entry.data;
        }
    }

    switch (identifier.split('.').pop().toLowerCase()) {
        case 'tar':
            archive = new tar.Archive(buffer);
            break;
        case 'zip':
            archive = new zip.Archive(buffer);
            break;
    }
    return archive;
}

function request(location, cookie) {
    var options = { rejectUnauthorized: false };
    var httpRequest = null;
    switch (url.parse(location).protocol) {
        case 'http:': 
            httpRequest = http.request(location, options);
            break;
        case 'https:':
            httpRequest = https.request(location, options);
            break;
    }
    if (cookie && cookie.length > 0) {
        httpRequest.setHeader('Cookie', cookie);
    }
    return new Promise((resolve, reject) => {
        httpRequest.on('response', (response) => {
            resolve(response);
        });
        httpRequest.on('error', (error) => {
            reject(error);
        });
        httpRequest.end();
    });
}

function downloadFile(location, cookie) {
    var data = [];
    var position = 0;
    return request(location, cookie).then((response) => {
        if (response.statusCode == 200 &&
            url.parse(location).hostname == 'drive.google.com' && 
            response.headers['set-cookie'].some((cookie) => cookie.startsWith('download_warning_'))) {
            cookie = response.headers['set-cookie'];
            var download = cookie.filter((cookie) => cookie.startsWith('download_warning_')).shift();
            var confirm = download.split(';').shift().split('=').pop();
            location = location + '&confirm=' + confirm;
            return downloadFile(location, cookie);
        }
        if (response.statusCode == 301 || response.statusCode == 302) {
            location = url.parse(response.headers.location).hostname ?
                response.headers.location : 
                url.parse(location).protocol + '//' + url.parse(location).hostname + response.headers.location;
            return downloadFile(location, cookie);
        }
        if (response.statusCode != 200) {
            throw new Error(response.statusCode.toString() + ' ' + location);
        }
        return new Promise((resolve, reject) => {
            var length = response.headers['content-length'] ? Number(response.headers['content-length']) : -1;
            response.on('data', (chunk) => {
                position += chunk.length;
                if (length >= 0) {
                    var label = location.length > 70 ? location.substring(0, 66) + '...' : location; 
                    process.stdout.write('  (' + ('  ' + Math.floor(100 * (position / length))).slice(-3) + '%) ' + label + '\r');
                }
                else {
                    process.stdout.write('  ' + position + ' bytes\r');
                }
                data.push(chunk);
            });
            response.on('end', () => {
                resolve(Buffer.concat(data));
            });
            response.on('error', (error) => {
                reject(error);
            });
        });
    });
}

function download(folder, targets, sources) {
    if (targets.every((file) => fs.existsSync(folder + '/' + file))) {
        return Promise.resolve();
    }
    if (!sources) {
        return Promise.reject(new Error('Download source not specified.'));
    }
    var source = '';
    var sourceFiles = [];
    var startIndex = sources.indexOf('[');
    var endIndex = sources.indexOf(']');
    if (startIndex != -1 && endIndex != -1 && endIndex > startIndex) {
        sourceFiles = sources.substring(startIndex + 1, endIndex).split(',').map((sourceFile) => sourceFile.trim());
        source = sources.substring(0, startIndex);
        sources = sources.substring(endIndex + 1);
        if (sources.startsWith(',')) {
            sources = sources.substring(1);
        }
    }
    else {
        var commaIndex = sources.indexOf(',');
        if (commaIndex != -1) {
            source = sources.substring(0, commaIndex);
            sources = sources.substring(commaIndex + 1);
        }
        else {
            source = sources;
            sources = '';
        }
    }
    var target;
    for (target of targets) {
        makeDir(path.dirname(folder + '/' + target));
    }
    return downloadFile(source).then((data) => {
        if (sourceFiles.length > 0) {
            if (process.stdout.clearLine) {
                process.stdout.clearLine();
            }
            process.stdout.write('  decompress...\r');
            var archive = decompress(data, source.split('?').shift().split('/').pop());
            for (var file of sourceFiles) {
                if (process.stdout.clearLine) {
                    process.stdout.clearLine();
                }
                process.stdout.write('  write ' + file + '\n');
                var entry = archive.entries.filter((entry) => entry.name == file)[0];
                if (!entry) {
                    throw new Error("Entry not found '" + file + '. Archive contains entries: ' + JSON.stringify(archive.entries.map((entry) => entry.name)) + " .");
                }
                var target = targets.shift();
                fs.writeFileSync(folder + '/' + target, entry.data, null);
            }
        }
        else {
            target = targets.shift();
            if (process.stdout.clearLine) {
                process.stdout.clearLine();
            }
            process.stdout.write('  write ' + target + '\r');
            fs.writeFileSync(folder + '/' + target, data, null);
        }
        if (process.stdout.clearLine) {
            process.stdout.clearLine();
        }
        if (sources.length > 0) {
            return download(folder, targets, sources);
        }
        return;
    });
}

function script(folder, targets, command, args) {
    if (targets.every((file) => fs.existsSync(folder + '/' + file))) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        try {
            console.log('  ' + command + ' ' + args);
            child_process.execSync(command + ' ' + args, { stdio: [ 0, 1 , 2] });
            resolve();
        }
        catch (error) {
            reject(error);
        }
    });
}

function loadModel(target, item) {
    var host = new TestHost();
    var exceptions = [];
    host.on('exception', (_, data) => {
        exceptions.push(data.exception);
    });
    var folder = path.dirname(target);
    var identifier = path.basename(target);
    var size = fs.statSync(target).size;
    var buffer = new Uint8Array(size);
    var fd = fs.openSync(target, 'r');
    fs.readSync(fd, buffer, 0, size, 0);
    fs.closeSync(fd);
    var context = new TestContext(host, folder, identifier, buffer);
    var modelFactoryService = new view.ModelFactoryService(host);
    var opened = false;
    return modelFactoryService.open(context).then((model) => {
        if (opened) {
            throw new Error("Model opened more than once '" + target + "'.");
        }
        opened = true;
        if (!model.format || (item.format && model.format != item.format)) {
            throw new Error("Invalid model format '" + model.format + "'.");
        }
        if (item.producer && model.producer != item.producer) {
            throw new Error("Invalid producer '" + model.producer + "'.");
        }
        if (item.runtime && model.runtime != item.runtime) {
            throw new Error("Invalid runtime '" + model.runtime + "'.");
        }
        model.version;
        model.description;
        model.author;
        model.license;
        for (var graph of model.graphs) {
            var input;
            var argument;
            for (input of graph.inputs) {
                input.name.toString();
                input.name.length;
                for (argument of input.arguments) {
                    argument.id.toString();
                    argument.id.length;
                    if (argument.type) {
                        argument.type.toString();
                    }
                }
            }
            var output;
            for (output of graph.outputs) {
                output.name.toString();
                output.name.length;
                for (argument of output.arguments) {
                    argument.id.toString();
                    if (argument.type) {
                        argument.type.toString();
                    }
                }
            }
            for (var node of graph.nodes) {
                node.name.toString();
                node.name.length;
                node.description;
                node.documentation.toString();
                node.category.toString();
                for (var attribute of node.attributes) {
                    attribute.name.toString();
                    attribute.name.length;
                    var value = sidebar.NodeSidebar.formatAttributeValue(attribute.value, attribute.type)
                    if (value && value.length > 1000) {
                        value = value.substring(0, 1000) + '...';
                    }
                    value = value.split('<');
                }
                for (input of node.inputs) {
                    input.name.toString();
                    input.name.length;
                    for (argument of input.arguments) {
                        argument.id.toString();
                        argument.id.length;
                        argument.description;
                        if (argument.type) {
                            argument.type.toString();
                        }
                        if (argument.initializer) {
                            argument.initializer.toString();
                            argument.initializer.type.toString();
                        }
                    }
                }
                for (output of node.outputs) {
                    output.name.toString();
                    output.name.length;
                    for (argument of output.arguments) {
                        argument.id.toString();
                        argument.id.length;
                        if (argument.type) {
                            argument.type.toString();
                        }
                    }
                }
                if (node.chain) {
                    for (var chain of node.chain) {
                        chain.name.toString();
                        chain.name.length;
                    }
                }
            }
        }
        if (exceptions.length > 0) {
            throw exceptions[0];
        }
        return model;
    });
}

function render(model) {
    try {
        var host = new TestHost();
        var currentView = new view.View(host);
        if (!currentView.showAttributes) {
            currentView.toggleAttributes();
        }
        if (!currentView.showInitializers) {
            currentView.toggleInitializers();
        }
        return currentView.renderGraph(model.graphs[0]);
    }
    catch (error) {
        return Promise.reject(error);
    }
}

function next() {
    if (items.length == 0) {
        return;
    }
    var item = items.shift();
    if (!item.type) {
        console.error("Property 'type' is required for item '" + JSON.stringify(item) + "'.");
        return;
    }
    if (type && item.type != type) {
        next();
        return;
    }
    if (process.stdout.clearLine) {
        process.stdout.clearLine();
    }
    var targets = item.target.split(',');
    var target = targets[0];
    var folder = dataFolder + '/' + item.type;
    process.stdout.write(item.type + '/' + target + '\n');

    var promise = null;
    if (item.script) {
        var root = path.dirname(__dirname);
        var command = item.script[0].replace('${root}', root);
        var args = item.script[1].replace('${root}', root);
        promise = script(folder, targets, command, args);
    }
    else {
        var sources = item.source;
        promise = download(folder, targets, sources);
    }
    return promise.then(() => {
        return loadModel(folder + '/' + target, item).then((model) => {
            var promise = null;
            if (item.render == 'skip') {
                promise = Promise.resolve();
            }
            else {
                promise = render(model);
            }
            return promise.then(() => {
                if (item.error) {
                    console.error('Expected error.');
                }
                else {
                    return next();
                }
            });
        });
    }).catch((error) => {
        if (!item.error || item.error != error.message) {
            console.error(error);
        }
        else {
            return next();
        }
    });
}

next();
