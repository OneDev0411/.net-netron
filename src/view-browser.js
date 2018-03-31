/*jshint esversion: 6 */

class BrowserHost {

    constructor() {
    }

    get name() {
        return 'Netron';
    }

    initialize(view) {
        this._view = view;

        var fileElement = Array.from(document.getElementsByTagName('meta')).filter(e => e.name == 'file').shift();
        if (fileElement && fileElement.content && fileElement.content.length > 0) {
            this.openModel('/data', fileElement.content.split('/').pop());
            return;
        }

        var urlParam = this.getQueryParameter('url');
        if (urlParam && urlParam.length > 0) {
            this.openModel(urlParam, urlParam.split('/').pop());
            return;
        }

        var modelParam = this.getQueryParameter('model');
        if (modelParam && modelParam.length > 0) {
            this.openModel(modelParam, modelParam.split('/').pop());
            return;
        }
        
        this._view.show('welcome');
        var openFileButton = document.getElementById('open-file-button');
        var openFileDialog = document.getElementById('open-file-dialog');
        if (openFileButton && openFileDialog) {
            openFileButton.addEventListener('click', (e) => {
                openFileDialog.value = '';
                openFileDialog.click();
            });
            openFileDialog.addEventListener('change', (e) => {
                if (e.target && e.target.files && e.target.files.length == 1) {
                    this.openFile(e.target.files[0]);
                }
            });
        }
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
        });
        document.body.addEventListener('drop', (e) => { 
            e.preventDefault();
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length == 1) {
                this.openFile(e.dataTransfer.files[0]);
            }
            return false;
        });
    }
    
    showError(message) {
        alert(message);
    }
    
    import(file, callback) {
        var url = this.url(file);
        var script = document.createElement('script');
        script.onload = () => {
            callback(null);
        };
        script.onerror = (e) => {
            callback(new Error('The script \'' + e.target.src + '\' failed to load.'));
        };
        script.setAttribute('type', 'text/javascript');
        script.setAttribute('src', url);
        document.head.appendChild(script);
    }

    request(file, callback) {
        var url = this.url(file);
        var request = new XMLHttpRequest();
        if (file.endsWith('.pb')) {
            request.responseType = 'arraybuffer';
        }
        request.onload = () => {
            if (request.status == 200) {
                if (request.responseType == 'arraybuffer') {
                    callback(null, new Uint8Array(request.response));
                }
                else {
                    callback(null, request.responseText);
                }
            }
            else {
                callback(request.status, null);
            }
        };
        request.onerror = () => {
            callback(request.status, null);
        };
        request.open('GET', url, true);
        request.send();
    }

    url(file) {
        var url = file;
        if (window && window.location && window.location.href) {
            var location = window.location.href.split('?').shift();
            if (location.endsWith('/')) {
                location = location.slice(0, -1);
            }
            url = location + file;
        }
        return url;        
    }

    getQueryParameter(name) {
        var url = window.location.href;
        name = name.replace(/[\[\]]/g, "\\$&");
        var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)");
        var results = regex.exec(url);
        if (!results) {
            return null;
        }
        if (!results[2]) {
            return '';
        }
        return decodeURIComponent(results[2].replace(/\+/g, " "));
    }

    openModel(url, file) {
        this._view.show('spinner');
        var request = new XMLHttpRequest();
        request.responseType = 'arraybuffer';
        request.onload = () => {
            if (request.status == 200) {
                var buffer = new Uint8Array(request.response);
                this._view.openBuffer(buffer, file, (err) => {
                    if (err) {
                        this.showError(err.toString());
                        this._view.show(null);
                    }
                    else {
                        document.title = file;
                    }
                });
            }
            else {
                this._view.showError(request.status);
            }
        };
        request.onerror = () => {
            this._view.showError(request.status);
        };
        request.open('GET', url, true);
        request.send();
    }

    openURL(url) {
        window.open(url, '_target');
    }

    openFile(file) {
        this._view.show('spinner');
        this.openBuffer(file, (err) => {
            if (err) {
                this.showError(err.toString());
                this._view.show(null);
                return;
            }
            document.title = file.name;
        });
    }

    openBuffer(file, callback) {
        var size = file.size;
        var reader = new FileReader();
        reader.onloadend = () => {
            if (reader.error) {
                callback(reader.error);
                return;
            }
            var buffer = new Uint8Array(reader.result);
            this._view.openBuffer(buffer, file.name, (err) => {
                callback(err);
            });
        };
        reader.readAsArrayBuffer(file);
    }
}

if (!window.TextDecoder) {
    window.TextDecoder = class {
        constructor(encoding) {
            this._encoding = encoding;
        }
        decode(buffer) {
            var result = '';
            var length = buffer.length;
            var i = 0
            switch (this._encoding) {
                case 'utf-8':
                    while (i < length) {
                        var c = buffer[i++];
                        switch(c >> 4)
                        { 
                            case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
                                result += String.fromCharCode(c);
                                break;
                            case 12: case 13:
                                c2 = buffer[i++];
                                result += String.fromCharCode(((c & 0x1F) << 6) | (c2 & 0x3F));
                                break;
                            case 14:
                                var c2 = buffer[i++];
                                var c3 = buffer[i++];
                                result += String.fromCharCode(((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | ((c3 & 0x3F) << 0));
                                break;
                        }
                    }
                    break;
                case 'ascii':
                    while (i < length) {
                        result += String.fromCharCode(buffer[i++]);
                    }
                    break;
            }
            return result;
        }
    }
}

window.host = new BrowserHost();
