
const electron = require('electron');
const fs = require('fs');
const path = require('path');

var hostService = new ElectronHostService();

function ElectronHostService()
{
    var self = this;

    electron.ipcRenderer.on('open-file', function(event, data) {
        var file = data['file'];
        if (file) {
            updateView('clock');
            self.openBuffer(file);
        }
    });

    window.addEventListener('load', function(e) {

        var openFileButton = document.getElementById('open-file-button');
        if (openFileButton) {
            openFileButton.style.opacity = 1;
            openFileButton.addEventListener('click', function(e) {
                openFileButton.style.opacity = 0;
                electron.ipcRenderer.send('open-file-dialog', {});
            });
        }

        var propertiesButton = document.getElementById('properties-button');
        if (propertiesButton) {
            propertiesButton.addEventListener('click', function(e) {
                showModelProperties(modelService.activeModel);
            });
        }

        document.addEventListener('dragover', function(e) {
            e.preventDefault();
        });
        document.addEventListener('drop', function(e) {
            e.preventDefault();
        });
        document.body.addEventListener('drop', function(e) { 
            e.preventDefault();
            var files = e.dataTransfer.files;
            for (var i = 0; i < files.length; i++) {
                self.openFile(files[i].path, i == 0);
            }
            return false;
        });
    });
}

ElectronHostService.prototype.openFile = function(file, drop) {
    var data = {};
    data['file'] = file;
    if (drop) {
        data['window'] = electron.remote.getCurrentWindow().id;
    } 
    electron.ipcRenderer.send('open-file', data);
}

ElectronHostService.prototype.showError = function(message) {
    electron.remote.dialog.showErrorBox(electron.remote.app.getName(), message);
}

ElectronHostService.prototype.getResource = function(file, callback) {
    var file = path.join(__dirname, file);
    if (fs.existsSync(file)) {
        var data = fs.readFileSync(file);
        if (data) {
            callback(null, data);
            return;
        }
    }
    // TOOD error
}

ElectronHostService.prototype.registerCallback = function(callback) {
    this.callback = callback;
}

ElectronHostService.prototype.openBuffer = function(file) {
    var self = this;
    fs.exists(file, function(exists) {
        if (exists) {
            fs.stat(file, function(err, stats) {
                if (err) {
                    self.callback(err, null, null);
                }
                else {
                    var size = stats.size;
                    var buffer = new Uint8Array(size);
                    fs.open(file, 'r', function(err, fd) {
                        if (err) {
                            self.callback(err, null, null);
                        }
                        else {
                            fs.read(fd, buffer, 0, size, 0, function(err, bytesRead, buffer) {
                                if (err) {
                                    self.callback(err, null, null);
                                }
                                else {
                                    fs.close(fd, function(err) {
                                        if (err) {
                                            self.callback(err, null);
                                        }
                                        else {
                                            self.callback(null, buffer, path.basename(file));
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
            });
        }
    });
}
