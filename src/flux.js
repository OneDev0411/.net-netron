/* jshint esversion: 6 */
/* eslint "indent": [ "error", 4, { "SwitchCase": 1 } ] */

// Experimental

var flux = flux || {};
var marked = marked || require('marked');

flux.ModelFactory = class {

    match(context) {
        let identifier = context.identifier; 
        let extension = identifier.split('.').pop().toLowerCase();
        if (extension === 'bson') {
            return true;
        }
        return false;
    }

    open(context, host) {
        return host.require('./bson').then((bson) => {
            let model = null;
            let identifier = context.identifier;
            try {
                let reader = new bson.Reader(context.buffer);
                let root = reader.read();
                root = flux.ModelFactory._backref(root, root);
                model = root.model;
                if (!model) {
                    throw new flux.Error('File does not contain Flux model.');
                }
            }
            catch (error) {
                let message = error && error.message ? error.message : error.toString();
                message = message.endsWith('.') ? message.substring(0, message.length - 1) : message;
                throw new flux.Error(message + " in '" + identifier + "'.");
            }

            return flux.Metadata.open(host).then((metadata) => {
                let identifier = context.identifier;
                try {
                    return new flux.Model(metadata, model);
                }
                catch (error) {
                    let message = error && error.message ? error.message : error.toString();
                    message = message.endsWith('.') ? message.substring(0, message.length - 1) : message;
                    throw new flux.Error(message + " in '" + identifier + "'.");
                }
            });
        });
    }

    static _backref(obj, root) {
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                obj[i] = flux.ModelFactory._backref(obj[i], root);
            }
        }
        else if (obj === Object(obj)) {
            if (obj.tag == 'backref' && obj.ref) {
                if (!root._backrefs[obj.ref - 1]) {
                    throw new flux.Error("Invalid backref '" + obj.ref + "'.");
                }
                obj = root._backrefs[obj.ref - 1];
            }
            for (let key of Object.keys(obj)) {
                if (obj !== root || key !== '_backrefs') {
                    obj[key] = flux.ModelFactory._backref(obj[key], root);
                }
            }
        }
        return obj;
    }
}

flux.Model = class {

    constructor(/* root */) {
        // debugger;
        this._format = 'Flux';
        this._graphs = [];
    }

    get format() {
        return this._format;
    }

    get graphs() {
        return this._graphs;
    }
}

flux.Metadata = class {

    static open(host) {
        if (flux.Metadata._metadata) {
            return Promise.resolve(flux.Metadata._metadata);
        }
        return host.request(null, 'flux-metadata.json', 'utf-8').then((data) => {
            flux.Metadata._metadata = new flux.Metadata(data);
            return flux.Metadata._metadata;
        }).catch(() => {
            flux.Metadata._metadata = new flux.Metadata(null);
            return flux.Metadata._metadatas;
        });
    }

    constructor(data) {
        this._map = {};
        this._attributeCache = {};
        if (data) {
            let items = JSON.parse(data);
            if (items) {
                for (let item of items) {
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
        let map = this._attributeCache[operator];
        if (!map) {
            map = {};
            let schema = this.getSchema(operator);
            if (schema && schema.attributes && schema.attributes.length > 0) {
                for (let attribute of schema.attributes) {
                    map[attribute.name] = attribute;
                }
            }
            this._attributeCache[operator] = map;
        }
        return map[name] || null;
    }
};

flux.Error = class extends Error {

    constructor(message) {
        super(message);
        this.name = 'Flux Error';
    }
};

if (module && module.exports) {
    module.exports.ModelFactory = flux.ModelFactory;
}