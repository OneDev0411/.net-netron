/*jshint esversion: 6 */

const fs = require('fs');
const path = require('path');
const process = require('process');
const child_process = require('child_process');
const vm = require('vm');
const http = require('http');
const https = require('https');
const url = require('url');
const protobuf = require('protobufjs');
const view = require('../src/view.js');
const zip = require('../src/zip');
const gzip = require('../src/gzip');
const tar = require('../src/tar');

global.protobuf = protobuf;

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

var models = JSON.parse(fs.readFileSync(__dirname + '/models.json', 'utf-8'));
var dataFolder = __dirname + '/data';

class TestHost {

    constructor() {
        this._exceptions = [];
        this.document = new HTMLDocument();
    }

    initialize(view) {
    }

    environment(name) {
        if (name == 'zoom') {
            return 'none';
        }
        return null;
    }

    screen(name) {
    }

    require(id, callback) {
        try {
            var file = path.join(path.join(__dirname, '../src'), id + '.js');
            callback(null, require(file));
            return;
        }
        catch (err) {
            callback(err, null);
            return;
        }
    }

    request(base, file, encoding, callback) {
        var pathname = path.join(base || path.join(__dirname, '../src'), file);
        fs.exists(pathname, (exists) => {
            if (!exists) {
                callback(new Error('File not found.'), null);
                return;
            }
            fs.readFile(pathname, encoding, (err, data) => {
                if (err) {
                    callback(err, null);
                    return;
                }
                callback(null, data);
                return;
            });
        });
    }

    event(category, action, label, value) {
    }

    exception(err, fatal) {
        this._exceptions.push(err);
    }

    get exceptions() {
        return this._exceptions;
    }
}

class HTMLDocument {

    constructor() {
        this._elements = {};
        this.documentElement = new HTMLHtmlElement();
        this.body = new HTMLBodyElement();
    }

    createElementNS(namespace, name) {
        return new HTMLHtmlElement();
    }

    createTextNode(text) {
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

    addEventListener(event, callback) {
    }

    removeEventListener(event, callback) {
    }
}

class HTMLHtmlElement {

    constructor() {
        this.style = new CSSStyleDeclaration();
    }

    appendChild(node) {
    }

    setAttribute(name, value) {
    }

    getBBox() {
        return { x: 0, y: 0, width: 10, height: 10 };
    }
    
    getElementsByClassName(name) {
        return null;
    }

    addEventListener(event, callback) {
    }

    removeEventListener(event, callback) {
    }
}

class HTMLBodyElement {

    constructor() {
        this.style = new CSSStyleDeclaration();
    }

    addEventListener(event, callback) {
    }
}

class CSSStyleDeclaration {

    setProperty(name, value) {
    }
}

class SVGElement {
}

class TestContext {

    constructor(host, folder, identifier, buffer) {
        this._tags = {};
        this._host = host;
        this._folder = folder;
        this._identifier = identifier;
        this._buffer = buffer;
    }

    request(file, encoding, callback) {
        this._host.request(this._folder, file, encoding, (err, buffer) => {
            callback(err, buffer);
        });
    }

    get identifier() {
        return this._identifier;
    }

    get buffer() {
        return this._buffer;
    }

    get text() {
        if (!this._text) {
            var decoder = new TextDecoder('utf-8');
            this._text = decoder.decode(this._buffer);
        }
        return this._text;
    }

    tags(extension) {
        var tags = this._tags[extension];
        if (!tags) {
            tags = {};
            try {
                var reader = null;
                switch (extension) {
                    case 'pbtxt':
                        reader = protobuf.TextReader.create(this.text);
                        reader.start(false);
                        while (!reader.end(false)) {
                            var tag = reader.tag();
                            tags[tag] = true;
                            reader.skip();
                        }
                        break;
                    case 'pb':
                        reader = new protobuf.Reader.create(this.buffer);
                        while (reader.pos < reader.len) {
                            var tagType = reader.uint32();
                            tags[tagType >>> 3] = tagType & 7;
                            try {
                                reader.skipType(tagType & 7);
                            }
                            catch (err) {
                                tags = {};
                                break;
                            }
                        }
                        break;
                }
            }
            catch (error) {
                tags = {};
            }
            this._tags[extension] = tags;
        }
        return tags;
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
    extension = identifier.split('.').pop().toLowerCase();
    if (extension == 'gz' || extension == 'tgz') {
        archive = new gzip.Archive(buffer);
        if (archive.entries.length == 1) {
            entry = archive.entries[0];
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
            archive = null;
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

function request(location, cookie, callback) {
    var data = [];
    var position = 0;
    var protocol = url.parse(location).protocol;
    var httpModules = { 'http:': http, 'https:': https };
    var httpModule = httpModules[protocol];
    var httpRequest = httpModule.request(location, {
        rejectUnauthorized: false
    });
    if (cookie.length > 0) {
        httpRequest.setHeader('Cookie', cookie);
    }
    httpRequest.on('response', (response) => {
        if (response.statusCode == 200 && url.parse(location).hostname == 'drive.google.com' && 
            response.headers['set-cookie'].some((cookie) => cookie.startsWith('download_warning_'))) {
            cookie = response.headers['set-cookie'];
            var download = cookie.filter((cookie) => cookie.startsWith('download_warning_')).shift();
            var confirmToken = download.split(';').shift().split('=').pop();
            location = location + '&confirm=' + confirmToken;
            request(location, cookie, callback);
            return;
        }
        if (response.statusCode == 301 || response.statusCode == 302) {
            if (url.parse(response.headers.location).hostname) {
                location = response.headers.location;
            }
            else {
                location = url.parse(location).protocol + '//' + url.parse(location).hostname + response.headers.location;
            }
            request(location, cookie, callback);
            return;
        }
        if (response.statusCode != 200) {
            callback(new Error(response.statusCode.toString() + ' ' + location), null);
            return;
        }
        var length = response.headers['content-length'] ? Number(response.headers['content-length']) : -1;
        response.on("data", (chunk) => {
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
        response.on("end", () => {
            callback(null, Buffer.concat(data));
        });
        response.on("error", (err) => {
            callback(err, null);
        });
    });
    httpRequest.on('error', (err) => {
        callback(err, null);
    });
    httpRequest.end();
}

function download(folder, targets, sources, completed, callback) {
    if (targets.every((file) => fs.existsSync(folder + '/' + file))) {
        targets.forEach((target) => completed.push(target));
        callback(null, completed);
        return;
    }
    if (!sources) {
        callback(new Error('Download source not specified.'), null);
        return;
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
    targets.forEach((target) => {
        makeDir(path.dirname(folder + '/' + target));
    });
    request(source, [], (err, data) => {
        if (err) {
            callback(err, null);
            return;
        }
        if (sourceFiles.length > 0) {
            if (process.stdout.clearLine) {
                process.stdout.clearLine();
            }
            process.stdout.write('  decompress...\r');
            var archive = decompress(data, source.split('/').pop());
            // console.log(archive);
            sourceFiles.forEach((file, index) => {
                if (process.stdout.clearLine) {
                    process.stdout.clearLine();
                }
                process.stdout.write('  write ' + file + '\n');
                var entry = archive.entries.filter((entry) => entry.name == file)[0];
                if (!entry) {
                    callback(new Error("Entry not found '" + file + '. Archive contains entries: ' + JSON.stringify(archive.entries.map((entry) => entry.name)) + " ."), null);
                }
                var target = targets.shift();
                fs.writeFileSync(folder + '/' + target, entry.data, null);
                completed.push(target);
            });
        }
        else {
            var target = targets.shift();
            if (process.stdout.clearLine) {
                process.stdout.clearLine();
            }
            process.stdout.write('  write ' + target + '\r');
            fs.writeFileSync(folder + '/' + target, data, null);
            completed.push(target);
        }
        if (process.stdout.clearLine) {
            process.stdout.clearLine();
        }
        if (sources.length > 0) {
            download(folder, targets, sources, completed, callback);
            return;
        }
        callback(null, completed);
    });
}

function loadModel(target, item, callback) {
    var host = new TestHost();
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
    modelFactoryService.open(context, (err, model) => {
        if (opened) {
            callback(new Error("Model opened more than once '" + target + "'."), null);
            process.exit();
            return;
        }
        opened = true;
        if (err) {
            callback(err, null);
            return;
        }
        if (!model.format || (item.format && model.format != item.format)) {
            callback(new Error("Invalid model format '" + model.format + "'."), null);
            return;
        }
        if (item.producer && model.producer != item.producer) {
            callback(new Error("Invalid producer '" + model.producer + "'."), null);
            return;
        }
        try {
            model.graphs.forEach((graph) => {
                graph.inputs.forEach((input) => {
                    input.connections.forEach((connection) => {
                        if (connection.type) {
                            connection.type.toString();
                        }
                    });
                });
                graph.outputs.forEach((output) => {
                    output.connections.forEach((connection) => {
                        if (connection.type) {
                            connection.type.toString();
                        }
                    });
                });
                graph.nodes.forEach((node) => {
                    var documentation = node.documentation;
                    var category = node.category;
                    node.attributes.forEach((attribute) => {
                        var value = view.View.formatAttributeValue(attribute.value, attribute.type)
                        if (value && value.length > 1000) {
                            value = value.substring(0, 1000) + '...';
                        }
                        value = value.split('<');
                    });
                    node.inputs.forEach((input) => {
                        input.connections.forEach((connection) => {
                            if (connection.type) {
                                connection.type.toString();
                            }
                            if (connection.initializer) {
                                var value = connection.initializer.toString();
                            }
                        });
                    });
                    node.outputs.forEach((output) => {
                        output.connections.forEach((connection) => {
                            if (connection.type) {
                                connection.type.toString();
                            }
                        });
                    });
                });
            });
        }
        catch (error) {
            callback(error, null);
            return;
        }
        if (host.exceptions.length > 0) {
            callback(host.exceptions[0], null);
            return;
        }
        callback(null, model);
        return;
    });
}

function render(model, callback) {
    var host = new TestHost();
    var currentView = new view.View(host);
    if (!currentView.showAttributes) {
        currentView.toggleAttributes();
    }
    if (!currentView.showInitializers) {
        currentView.toggleInitializers();
    }
    currentView.renderGraph(model.graphs[0], (err) => {
        callback(err);
    });
}

function next() {
    if (models.length == 0) {
        return;
    }
    var item = models.shift();
    if (type && item.type != type) {
        next();
        return;
    }
    var targets = item.target.split(',');
    if (process.stdout.clearLine) {
        process.stdout.clearLine();
    }
    var folder = dataFolder + '/' + item.type;
    process.stdout.write(item.type + '/' + targets[0] + '\n');
    var sources = item.source;
    download(folder, targets, sources, [], (err, completed) => {
        if (err) {
            if (item.script) {
                try {
                    var root = path.dirname(__dirname);
                    var command = item.script[0].replace('${root}', root);
                    var args = item.script[1].replace('${root}', root);
                    console.log('  ' + command + ' ' + args);
                    child_process.execSync(command + ' ' + args, { stdio: [ 0, 1 , 2] });
                    completed = targets;
                }
                catch (err) {
                    console.log(err);
                    return;
                }
            }
            else {
                console.log(err);
                return;
            }
        }
        loadModel(folder + '/' + completed[0], item, (err, model) => {
            if (err) {
                if (!item.error && item.error != err.message) {
                    console.log(err);
                    return;
                }
                next();
            }
            else {
                if (item.render != 'skip') {
                    render(model, (err) => {
                        if (err) {
                            if (!item.error && item.error != err.message) {
                                console.log(err);
                                return;
                            }
                        }
                        next();
                    });
                }
                else {
                    next();
                }
            }
        });
    });
}

next();
