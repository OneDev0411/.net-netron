/* jshint esversion: 6 */

var host = host || {};

const electron = require('electron');
const fs = require('fs');
const http = require('http');
const https = require('https');
const process = require('process');
const path = require('path');
const querystring = require('querystring');

host.ElectronHost = class {

    constructor() {
        process.on('uncaughtException', (err) => {
            this.exception(err, true);
        });
        window.eval = global.eval = () => {
            throw new Error('window.eval() not supported.');
        };
        this._version = electron.remote.app.getVersion();
    }

    get document() {
        return window.document;
    }

    get version() {
        return this._version;
    }

    get type() {
        return 'Electron';
    }

    get browser() {
        return false;
    }

    initialize(view) {
        this._view = view;
        return new Promise((resolve /*, reject */) => {
            const accept = () => {
                if (electron.remote.app.isPackaged) {
                    this._telemetry = new host.Telemetry('UA-54146-13', this._getConfiguration('userId'), navigator.userAgent, this.type, this.version);
                }
                resolve();
            };
            const request = () => {
                this._view.show('welcome consent');
                const acceptButton = this.document.getElementById('consent-accept-button');
                if (acceptButton) {
                    acceptButton.addEventListener('click', () => {
                        this._setConfiguration('consent', Date.now());
                        accept();
                    });
                }
            };
            const time = this._getConfiguration('consent');
            if (time && (Date.now() - time) < 30 * 24 * 60 * 60 * 1000) {
                accept();
            }
            else {
                this._request('https://ipinfo.io/json', { 'Content-Type': 'application/json' }, 'utf-8', 2000).then((text) => {
                    try {
                        const json = JSON.parse(text);
                        const countries = ['AT', 'BE', 'BG', 'HR', 'CZ', 'CY', 'DK', 'EE', 'FI', 'FR', 'DE', 'EL', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'SK', 'ES', 'SE', 'GB', 'UK', 'GR', 'EU', 'RO'];
                        if (json && json.country && !countries.indexOf(json.country) !== -1) {
                            this._setConfiguration('consent', Date.now());
                            accept();
                        }
                        else {
                            request();
                        }
                    }
                    catch (err) {
                        request();
                    }
                }).catch(() => {
                    request();
                });
            }
        });
    }

    start() {
        this._view.show('welcome');

        electron.ipcRenderer.on('open', (_, data) => {
            if (this._view.accept(data.file)) {
                this._openFile(data.file);
            }
        });
        electron.ipcRenderer.on('export', (_, data) => {
            this._view.export(data.file);
        });
        electron.ipcRenderer.on('cut', () => {
            this._view.cut();
        });
        electron.ipcRenderer.on('copy', () => {
            this._view.copy();
        });
        electron.ipcRenderer.on('paste', () => {
            this._view.paste();
        });
        electron.ipcRenderer.on('selectall', () => {
            this._view.selectAll();
        });
        electron.ipcRenderer.on('toggle-attributes', () => {
            this._view.toggleAttributes();
            this._update('show-attributes', this._view.showAttributes);
        });
        electron.ipcRenderer.on('toggle-initializers', () => {
            this._view.toggleInitializers();
            this._update('show-initializers', this._view.showInitializers);
        });
        electron.ipcRenderer.on('toggle-names', () => {
            this._view.toggleNames();
            this._update('show-names', this._view.showNames);
        });
        electron.ipcRenderer.on('toggle-direction', () => {
            this._view.toggleDirection();
            this._update('show-horizontal', this._view.showHorizontal);
        });
        electron.ipcRenderer.on('zoom-in', () => {
            this.document.getElementById('zoom-in-button').click();
        });
        electron.ipcRenderer.on('zoom-out', () => {
            this.document.getElementById('zoom-out-button').click();
        });
        electron.ipcRenderer.on('reset-zoom', () => {
            this._view.resetZoom();
        });
        electron.ipcRenderer.on('show-properties', () => {
            this.document.getElementById('menu-button').click();
        });
        electron.ipcRenderer.on('find', () => {
            this._view.find();
        });
        this.document.getElementById('menu-button').addEventListener('click', () => {
            this._view.showModelProperties();
        });

        const openFileButton = this.document.getElementById('open-file-button');
        if (openFileButton) {
            openFileButton.style.opacity = 1;
            openFileButton.addEventListener('click', () => {
                electron.ipcRenderer.send('open-file-dialog', {});
            });
        }

        this.document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        this.document.addEventListener('drop', (e) => {
            e.preventDefault();
        });
        this.document.body.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files).map(((file) => file.path));
            if (files.length > 0) {
                electron.ipcRenderer.send('drop-files', { files: files });
            }
            return false;
        });
    }

    environment(name) {
        if (name == 'zoom') {
            return 'd3';
        }
        return null;
    }

    error(message, detail) {
        const owner = electron.remote.getCurrentWindow();
        const options = {
            type: 'error',
            message: message,
            detail: detail,
        };
        electron.remote.dialog.showMessageBoxSync(owner, options);
    }

    confirm(message, detail) {
        const owner = electron.remote.getCurrentWindow();
        const options = {
            type: 'question',
            message: message,
            detail: detail,
            buttons: ['Yes', 'No'],
            defaultId: 0,
            cancelId: 1
        };
        const result = electron.remote.dialog.showMessageBoxSync(owner, options);
        return result == 0;
    }

    require(id) {
        try {
            return Promise.resolve(require(id));
        }
        catch (error) {
            return Promise.reject(error);
        }
    }

    save(name, extension, defaultPath, callback) {
        const owner = electron.remote.BrowserWindow.getFocusedWindow();
        const showSaveDialogOptions = {
            title: 'Export Tensor',
            defaultPath: defaultPath,
            buttonLabel: 'Export',
            filters: [ { name: name, extensions: [ extension ] } ]
        };
        const selectedFile = electron.remote.dialog.showSaveDialogSync(owner, showSaveDialogOptions);
        if (selectedFile) {
            callback(selectedFile);
        }
    }

    export(file, blob) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            fs.writeFile(file, data, null, (err) => {
                if (err) {
                    this.exception(err, false);
                    this.error('Error writing file.', err.message);
                }
            });
        };

        let err = null;
        if (!blob) {
            err = new Error("Export blob is '" + JSON.stringify(blob) + "'.");
        }
        else if (!(blob instanceof Blob)) {
            err = new Error("Export blob type is '" + (typeof blob) + "'.");
        }

        if (err) {
            this.exception(err, false);
            this.error('Error exporting image.', err.message);
        }
        else {
            reader.readAsArrayBuffer(blob);
        }
    }

    request(base, file, encoding) {
        return new Promise((resolve, reject) => {
            const pathname = path.join(base || __dirname, file);
            fs.exists(pathname, (exists) => {
                if (!exists) {
                    reject(new Error("File not found '" + file + "'."));
                }
                else {
                    fs.readFile(pathname, encoding, (err, data) => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            resolve(data);
                        }
                    });
                }
            });
        });
    }

    openURL(url) {
        electron.shell.openExternal(url);
    }

    exception(error, fatal) {
        if (this._telemetry && error && error.telemetry !== false) {
            try {
                const description = [];
                description.push((error && error.name ? (error.name + ': ') : '') + (error && error.message ? error.message : '(null)'));
                if (error.stack) {
                    const match = error.stack.match(/\n {4}at (.*)\((.*)\)/);
                    if (match) {
                        description.push(match[1] + '(' + match[2].split('/').pop().split('\\').pop() + ')');
                    }
                }
                this._telemetry.exception(description.join(' @ '), fatal);
            }
            catch (e) {
                // continue regardless of error
            }
        }
    }

    screen(name) {
        if (this._telemetry) {
            try {
                this._telemetry.screenview(name);
            }
            catch (e) {
                // continue regardless of error
            }
        }
    }

    event(category, action, label, value) {
        if (this._telemetry) {
            try {
                this._telemetry.event(category, action, label, value);
            }
            catch (e) {
                // continue regardless of error
            }
        }
    }

    _openFile(file) {
        if (file) {
            this._view.show('welcome spinner');
            this._readFile(file).then((buffer) => {
                const context = new host.ElectronHost.ElectonContext(this, path.dirname(file), path.basename(file), buffer);
                this._view.open(context).then((model) => {
                    this._view.show(null);
                    if (model) {
                        this._update('path', file);
                    }
                    this._update('show-attributes', this._view.showAttributes);
                    this._update('show-initializers', this._view.showInitializers);
                    this._update('show-names', this._view.showNames);
                }).catch((error) => {
                    if (error) {
                        this._view.error(error, null, null);
                        this._update('path', null);
                    }
                    this._update('show-attributes', this._view.showAttributes);
                    this._update('show-initializers', this._view.showInitializers);
                    this._update('show-names', this._view.showNames);
                });
            }).catch((error) => {
                this._view.error(error, 'Error while reading file.', null);
                this._update('path', null);
            });
        }
    }

    _readFile(file) {
        return new Promise((resolve, reject) => {
            fs.exists(file, (exists) => {
                if (!exists) {
                    reject(new Error('The file \'' + file + '\' does not exist.'));
                }
                else {
                    fs.readFile(file, null, (err, buffer) => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            resolve(buffer);
                        }
                    });
                }
            });
        });
    }

    _request(url, headers, encoding, timeout) {
        return new Promise((resolve, reject) => {
            const httpModule = url.split(':').shift() === 'https' ? https : http;
            const options = {
                headers: headers
            };
            const request = httpModule.get(url, options, (response) => {
                if (response.statusCode !== 200) {
                    const err = new Error("The web request failed with status code " + response.statusCode + " at '" + url + "'.");
                    err.type = 'error';
                    err.url = url;
                    err.status = response.statusCode;
                    reject(err);
                }
                else {
                    let data = '';
                    response.on('data', (chunk) => {
                        data += chunk;
                    });
                    response.on('err', (err) => {
                        reject(err);
                    });
                    response.on('end', () => {
                        resolve(data);
                    });
                }
            }).on("error", (err) => {
                reject(err);
            });
            if (timeout) {
                request.setTimeout(timeout, () => {
                    request.abort();
                    const err = new Error("The web request timed out at '" + url + "'.");
                    err.type = 'timeout';
                    err.url = url;
                    reject(err);
                });
            }
        });
    }

    _getConfiguration(name) {
        const configuration = electron.remote.getGlobal('global').application.service('configuration');
        return configuration && configuration.has(name) ? configuration.get(name) : undefined;
    }

    _setConfiguration(name, value) {
        const configuration = electron.remote.getGlobal('global').application.service('configuration');
        if (configuration) {
            configuration.set(name, value);
        }
    }

    _update(name, value) {
        electron.ipcRenderer.send('update', { name: name, value: value });
    }
};

host.Telemetry = class {

    constructor(trackingId, clientId, userAgent, applicationName, applicationVersion) {
        this._params = {
            aip: '1', // anonymizeIp
            tid: trackingId,
            cid: clientId,
            ua: userAgent,
            an: applicationName,
            av: applicationVersion
        };
    }

    screenview(screenName) {
        const params = Object.assign({}, this._params);
        params.cd = screenName;
        this._send('screenview', params);
    }

    event(category, action, label, value) {
        const params = Object.assign({}, this._params);
        params.ec = category;
        params.ea = action;
        params.el = label;
        params.ev = value;
        this._send('event', params);
    }

    exception(description, fatal) {
        const params = Object.assign({}, this._params);
        params.exd = description;
        if (fatal) {
            params.exf = '1';
        }
        this._send('exception', params);
    }

    _send(type, params) {
        params.t = type;
        params.v = '1';
        for (const param in params) {
            if (params[param] === null || params[param] === undefined) {
                delete params[param];
            }
        }
        const body = querystring.stringify(params);
        const options = {
            method: 'POST',
            host: 'www.google-analytics.com',
            path: '/collect',
            headers: { 'Content-Length': Buffer.byteLength(body) }
        };
        const request = https.request(options, () => {});
        request.setTimeout(5000, () => {
            request.abort();
        });
        request.write(body);
        request.end();
    }
};

host.ElectronHost.ElectonContext = class {

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
};

window.addEventListener('load', () => {
    global.protobuf = require('./protobuf');
    global.flatbuffers = require('./flatbuffers');
    const view = require('./view');
    window.__view__ = new view.View(new host.ElectronHost());
});
