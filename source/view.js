/* jshint esversion: 6 */

var view = view || {};

var base = base || require('./base');
var zip = zip || require('./zip');
var gzip = gzip || require('./gzip');
var tar = tar || require('./tar');
var json = json || require('./json');
var protobuf = protobuf || require('./protobuf');

var d3 = d3 || require('d3');
var dagre = dagre || require('dagre');

var sidebar = sidebar || require('./view-sidebar');
var grapher = grapher || require('./view-grapher');

view.View = class {

    constructor(host, id) {
        this._host = host;
        this._id = id ? ('-' + id) : '';
        this._host.initialize(this).then(() => {
            this._model = null;
            this._selection = [];
            this._sidebar = new sidebar.Sidebar(this._host, id);
            this._showAttributes = false;
            this._showInitializers = true;
            this._showNames = false;
            this._showHorizontal = false;
            this._searchText = '';
            this._modelFactoryService = new view.ModelFactoryService(this._host);
            this._getElementById('zoom-in-button').addEventListener('click', () => {
                this.zoomIn();
            });
            this._getElementById('zoom-out-button').addEventListener('click', () => {
                this.zoomOut();
            });
            this._getElementById('toolbar').addEventListener('mousewheel', (e) => {
                this._preventZoom(e);
            });
            this._getElementById('sidebar').addEventListener('mousewheel', (e) => {
                this._preventZoom(e);
            });
            this._host.document.addEventListener('keydown', () => {
                this.clearSelection();
            });
            if (this._host.environment('zoom') == 'scroll') {
                this._getElementById('graph').addEventListener('mousewheel', (e) => {
                    this._mouseWheelHandler(e);
                });
                this._getElementById('graph').addEventListener('scroll', (e) => {
                    this._scrollHandler(e);
                });
                this._getElementById('graph').addEventListener('gesturestart', (e) => {
                    e.preventDefault();
                    this._gestureStartZoom = this._zoom;
                }, false);
                this._getElementById('graph').addEventListener('gesturechange', (e) => {
                    e.preventDefault();
                    this._updateZoom(this._gestureStartZoom * e.scale, e);
                }, false);
                this._getElementById('graph').addEventListener('gestureend', (e) => {
                    e.preventDefault();
                    this._updateZoom(this._gestureStartZoom * e.scale, e);
                }, false);
            }
            this._host.start();
        }).catch((err) => {
            this.error(err, null, null);
        });
    }

    show(page) {
        if (!page) {
            page = (!this._model && !this._activeGraph) ? 'welcome' : 'default';
        }
        this._host.screen(page);
        if (this._sidebar) {
            this._sidebar.close();
        }
        this._host.document.body.setAttribute('class', page);
    }

    cut() {
        this._host.document.execCommand('cut');
    }

    copy() {
        this._host.document.execCommand('copy');
    }

    paste() {
        this._host.document.execCommand('paste');
    }

    selectAll() {
        this._host.document.execCommand('selectall');
    }

    find() {
        if (this._activeGraph) {
            this.clearSelection();
            const graphElement = this._getElementById('canvas');
            const view = new sidebar.FindSidebar(this._host, graphElement, this._activeGraph);
            view.on('search-text-changed', (sender, text) => {
                this._searchText = text;
            });
            view.on('select', (sender, selection) => {
                this._sidebar.close();
                this.select(selection);
            });
            this._sidebar.open(view.content, 'Find');
            view.focus(this._searchText);
        }
    }

    toggleAttributes() {
        this._showAttributes = !this._showAttributes;
        this._reload();
    }

    get showAttributes() {
        return this._showAttributes;
    }

    toggleInitializers() {
        this._showInitializers = !this._showInitializers;
        this._reload();
    }

    get showInitializers() {
        return this._showInitializers;
    }

    toggleNames() {
        this._showNames = !this._showNames;
        this._reload();
    }

    get showNames() {
        return this._showNames;
    }

    toggleDirection() {
        this._showHorizontal = !this._showHorizontal;
        this._reload();
    }

    get showHorizontal() {
        return this._showHorizontal;
    }

    _reload() {
        this.show('welcome spinner');
        if (this._model && this._activeGraph) {
            this._updateGraph(this._model, this._activeGraph).catch((error) => {
                if (error) {
                    this.error(error, 'Graph update failed.', 'welcome');
                }
            });
        }
    }

    _timeout(time) {
        return new Promise((resolve) => {
            setTimeout(() => { resolve(); }, time);
        });
    }

    _getElementById(id) {
        return this._host.document.getElementById(id + this._id);
    }

    zoomIn() {
        switch (this._host.environment('zoom')) {
            case 'scroll':
                this._updateZoom(this._zoom * 1.05);
                break;
            case 'd3':
                if (this._zoom) {
                    this._zoom.scaleBy(d3.select(this._getElementById('canvas')), 1.2);
                }
                break;
        }
    }

    zoomOut() {
        switch (this._host.environment('zoom')) {
            case 'scroll':
                this._updateZoom(this._zoom * 0.95);
                break;
            case 'd3':
                if (this._zoom) {
                    this._zoom.scaleBy(d3.select(this._getElementById('canvas')), 0.8);
                }
                break;
        }
    }

    resetZoom() {
        switch (this._host.environment('zoom')) {
            case 'scroll':
                this._updateZoom(1);
                break;
            case 'd3':
                if (this._zoom) {
                    this._zoom.scaleTo(d3.select(this._getElementById('canvas')), 1);
                }
                break;
        }
    }

    _preventZoom(e) {
        if (e.shiftKey || e.ctrlKey) {
            e.preventDefault();
        }
    }

    _updateZoom(zoom, e) {

        const container = this._getElementById('graph');

        const min = Math.min(Math.max(container.clientHeight / this._height, 0.2), 1);

        zoom = Math.min(zoom, 2);
        zoom = Math.max(min, zoom);

        const scrollLeft = this._scrollLeft || container.scrollLeft;
        const scrollTop = this._scrollTop || container.scrollTop;

        const x = (e ? e.pageX : (container.clientWidth / 2)) + scrollLeft;
        const y = (e ? e.pageY : (container.clientHeight / 2)) + scrollTop;

        const graph = this._getElementById('canvas');
        graph.style.width = zoom * this._width;
        graph.style.height = zoom * this._height;

        this._scrollLeft = ((x * zoom) / this._zoom) - (x - scrollLeft);
        this._scrollTop = ((y * zoom) / this._zoom) - (y - scrollTop);
        this._scrollLeft = Math.max(0, this._scrollLeft);
        this._scrollTop = Math.max(0, this._scrollTop);
        container.scrollLeft = this._scrollLeft;
        container.scrollTop = this._scrollTop;

        this._zoom = zoom;
    }

    _mouseWheelHandler(e) {
        if (e.shiftKey || e.ctrlKey) {
            this._updateZoom(this._zoom + (e.wheelDelta * 1.0 / 4000.0), e);
            e.preventDefault();
        }
    }

    _scrollHandler(e) {

        if (this._scrollLeft && e.target.scrollLeft !== Math.floor(this._scrollLeft)) {
            delete this._scrollLeft;
        }
        if (this._scrollTop && e.target.scrollTop !== Math.floor(this._scrollTop)) {
            delete this._scrollTop;
        }
    }

    select(selection) {
        this.clearSelection();
        if (selection && selection.length > 0) {
            const graphElement = this._getElementById('canvas');
            const graphRect = graphElement.getBoundingClientRect();
            let x = 0;
            let y = 0;
            for (const element of selection) {
                element.classList.add('select');
                this._selection.push(element);
                const transform = element.transform.baseVal.consolidate();
                const box = element.getBBox();
                const ex = transform ? transform.matrix.e : box.x + (box.width / 2);
                const ey = transform ? transform.matrix.f : box.y + (box.height / 2);
                x += ex;
                y += ey;
            }
            x = x / selection.length;
            y = y / selection.length;
            this._zoom.transform(d3.select(graphElement), d3.zoomIdentity.translate((graphRect.width / 2) - x, (graphRect.height / 2) - y));
        }
    }

    clearSelection() {
        while (this._selection.length > 0) {
            const element = this._selection.pop();
            element.classList.remove('select');
        }
    }

    error(err, name, screen) {
        if (this._sidebar) {
            this._sidebar.close();
        }
        this._host.exception(err, false);

        const knowns = [
            { name: 'Error', message: /^EACCES: permission denied/, url: 'https://github.com/lutzroeder/netron/issues/504' },
            { name: 'Error loading Darknet model.', message: /^Cannot read property/, url: 'https://github.com/lutzroeder/netron/issues/539' },
            { name: 'Error loading Keras model.', message: /^Invalid argument identifier/, url: 'https://github.com/lutzroeder/netron/issues/540' },
            { name: 'Error loading Darknet model.', message: /^Invalid tensor shape/, url: 'https://github.com/lutzroeder/netron/issues/541' },
            { name: 'Error loading PyTorch model.', message: /^File does not contain root module or state dictionary/, url: 'https://github.com/lutzroeder/netron/issues/543' },
            { name: 'Error loading PyTorch model.', message: /^Module does not contain modules/, url: 'https://github.com/lutzroeder/netron/issues/544' },
            { name: 'Error loading PyTorch model.', message: /^Failed to resolve module/, url: 'https://github.com/lutzroeder/netron/issues/545' },
            { name: 'Error loading PyTorch model.', message: /^Unsupported function/, url: 'https://github.com/lutzroeder/netron/issues/546' },
            { name: 'Error loading PyTorch model.', message: /^Unsupported uninitialized argument/, url: 'https://github.com/lutzroeder/netron/issues/547' },
            { name: 'Error loading Keras model.', message: /^Unsupported data object header version/, url: 'https://github.com/lutzroeder/netron/issues/548' },
            { name: 'Error loading ONNX model.', message: /^File format is not onnx\.ModelProto/, url: 'https://github.com/lutzroeder/netron/issues/549' },
            { name: 'Error loading model.', message: /^Unsupported file content \(/, url: 'https://github.com/lutzroeder/netron/issues/550' },
            { name: 'Error', message: /^EPERM: operation not permitted/, url: 'https://github.com/lutzroeder/netron/issues/551' },
            { name: 'Error loading UFF model.', message: /^Unknown data type/, url: 'https://github.com/lutzroeder/netron/issues/561' },
            { name: 'RangeError', message: /^Offset is outside the bounds of the DataView/, url: 'https://github.com/lutzroeder/netron/issues/563' },
            { name: 'Error loading Caffe model.', message: /^File format is not caffe.NetParameter (Offset is outside the bounds of the DataView)/, url: 'https://github.com/lutzroeder/netron/issues/563' },
            { name: 'Error loading MNN model.', message: /^Offset is outside the bounds of the DataView/, url: 'https://github.com/lutzroeder/netron/issues/563' },
            { name: 'Error loading ONNX model.', message: /^File format is not onnx.ModelProto (Offset is outside the bounds of the DataView)/, url: 'https://github.com/lutzroeder/netron/issues/563' },
            { name: 'Error loading TensorFlow Lite model.', message: /^Offset is outside the bounds of the DataView/, url: 'https://github.com/lutzroeder/netron/issues/563' },
            { name: 'RangeError', message: /^start offset of Int32Array/, url: 'https://github.com/lutzroeder/netron/issues/565' },
            { name: 'Error loading model', message: /^Unsupported Protocol Buffers content/, url: 'https://github.com/lutzroeder/netron/issues/593' },
            { name: 'Error loading model', message: /^Unsupported Protocol Buffers text content/, url: 'https://github.com/lutzroeder/netron/issues/594' },
            { name: 'Error loading model', message: /^Unsupported JSON content/, url: 'https://github.com/lutzroeder/netron/issues/595' }
        ];
        const known = knowns.find((known) => err.name === known.name && err.message.match(known.message));
        const message = (name ? err.toString() : err.message) + (known ? '\n\nPlease provide information about this issue at ' + known.url + '.' : '');
        name = name || err.name;
        this._host.error(name, message);
        this.show(screen !== undefined ? screen : 'welcome');
        if (known) {
            this._host.openURL(known.url);
        }
    }

    accept(file) {
        return this._modelFactoryService.accept(file);
    }

    open(context) {
        this._host.event('Model', 'Open', 'Size', context.buffer.length);
        this._sidebar.close();
        return this._timeout(2).then(() => {
            return this._modelFactoryService.open(context).then((model) => {
                const format = model.format;
                if (format) {
                    this._host.event('Model', 'Format', format + (model.producer ? ' (' + model.producer + ')' : ''));
                }
                return this._timeout(20).then(() => {
                    const graph = model.graphs.length > 0 ? model.graphs[0] : null;
                    return this._updateGraph(model, graph);
                });
            });
        });
    }

    _updateActiveGraph(name) {
        this._sidebar.close();
        if (this._model) {
            const model = this._model;
            const graph = model.graphs.filter(graph => name == graph.name).shift();
            if (graph) {
                this.show('welcome spinner');
                this._timeout(200).then(() => {
                    return this._updateGraph(model, graph).catch((error) => {
                        if (error) {
                            this.error(error, 'Graph update failed.', 'welcome');
                        }
                    });
                });
            }
        }
    }

    _updateGraph(model, graph) {
        return this._timeout(100).then(() => {
            if (graph && graph != this._activeGraph) {
                const nodes = graph.nodes;
                if (nodes.length > 1400) {
                    if (!this._host.confirm('Large model detected.', 'This graph contains a large number of nodes and might take a long time to render. Do you want to continue?')) {
                        this._host.event('Graph', 'Render', 'Skip', nodes.length);
                        this.show(null);
                        return null;
                    }
                }
            }
            return this.renderGraph(model, graph).then(() => {
                this._model = model;
                this._activeGraph = graph;
                this.show('default');
                return this._model;
            }).catch((error) => {
                return this.renderGraph(this._model, this._activeGraph).then(() => {
                    this.show('default');
                    throw error;
                }).catch(() => {
                    throw error;
                });
            });
        });
    }

    renderGraph(model, graph) {
        try {
            const graphElement = this._getElementById('canvas');
            while (graphElement.lastChild) {
                graphElement.removeChild(graphElement.lastChild);
            }
            if (!graph) {
                return Promise.resolve();
            }
            else {
                switch (this._host.environment('zoom')) {
                    case 'scroll':
                        this._zoom = 0;
                        graphElement.style.position = 'static';
                        graphElement.style.margin = 'auto';
                        break;
                    case 'd3':
                        this._zoom = null;
                        graphElement.style.position = 'absolute';
                        graphElement.style.margin = '0';
                        break;
                }

                const groups = graph.groups;

                const graphOptions = {};
                graphOptions.nodesep = 25;
                graphOptions.ranksep = 20;

                const rotate = graph.nodes.every((node) => node.inputs.filter((input) => input.arguments.every((argument) => !argument.initializer)).length === 0 && node.outputs.length === 0);
                const showHorizontal = rotate ? !this._showHorizontal : this._showHorizontal;
                if (showHorizontal) {
                    graphOptions.rankdir = "LR";
                }

                const g = new dagre.graphlib.Graph({ compound: groups });
                g.setGraph(graphOptions);
                g.setDefaultEdgeLabel(() => { return {}; });

                let nodeId = 0;
                const edgeMap = {};
                const clusterMap = {};
                const clusterParentMap = {};
                let id = new Date().getTime();
                const nodes = graph.nodes;

                if (nodes.length > 1500) {
                    graphOptions.ranker = 'longest-path';
                }

                this._host.event('Graph', 'Render', 'Size', nodes.length);

                if (groups) {
                    for (const node of nodes) {
                        if (node.group) {
                            const path = node.group.split('/');
                            while (path.length > 0) {
                                const name = path.join('/');
                                path.pop();
                                clusterParentMap[name] = path.join('/');
                            }
                        }
                    }
                }

                const self = this;
                for (const node of nodes) {

                    const element = new grapher.NodeElement(this._host.document);

                    const addNode = function(element, node, edges) {

                        const header =  element.block('header');
                        const styles = [ 'node-item-type' ];
                        const metadata = node.metadata;
                        const category = metadata && metadata.category ? metadata.category : '';
                        if (category) {
                            styles.push('node-item-type-' + category.toLowerCase());
                        }
                        const type = node.type;
                        if (typeof type !== 'string' || !type.split) { // #416
                            throw new ModelError("Unknown node type '" + JSON.stringify(type) + "' in '" + model.format + "'.");
                        }
                        const content = self.showNames && (node.name || node.location) ? (node.name || node.location) : type.split('.').pop();
                        const tooltip = self.showNames && (node.name || node.location) ? type : (node.name || node.location);
                        header.add(null, styles, content, tooltip, () => {
                            self.showNodeProperties(node, null);
                        });

                        if (node.function) {
                            header.add(null, [ 'node-item-function' ], '+', null, () => {
                                // debugger;
                            });
                        }

                        const initializers = [];
                        let hiddenInitializers = false;
                        if (self._showInitializers) {
                            for (const input of node.inputs) {
                                if (input.visible && input.arguments.length == 1 && input.arguments[0].initializer != null) {
                                    initializers.push(input);
                                }
                                if ((!input.visible || input.arguments.length > 1) &&
                                    input.arguments.some((argument) => argument.initializer != null)) {
                                    hiddenInitializers = true;
                                }
                            }
                        }
                        let sortedAttributes = [];
                        const attributes = node.attributes;
                        if (self.showAttributes && attributes) {
                            sortedAttributes = attributes.filter((attribute) => attribute.visible).slice();
                            sortedAttributes.sort((a, b) => {
                                const au = a.name.toUpperCase();
                                const bu = b.name.toUpperCase();
                                return (au < bu) ? -1 : (au > bu) ? 1 : 0;
                            });
                        }
                        if (initializers.length > 0 || hiddenInitializers || sortedAttributes.length > 0) {
                            const block = element.block('list');
                            block.handler = () => {
                                self.showNodeProperties(node);
                            };
                            for (const initializer of initializers) {
                                const argument = initializer.arguments[0];
                                const type = argument.type;
                                let shape = '';
                                let separator = '';
                                if (type &&
                                    type.shape &&
                                    type.shape.dimensions &&
                                    Object.prototype.hasOwnProperty.call(type.shape.dimensions, 'length')) {
                                    shape = '\u3008' + type.shape.dimensions.map((d) => d ? d : '?').join('\u00D7') + '\u3009';
                                    if (type.shape.dimensions.length == 0 && argument.initializer && !argument.initializer.state) {
                                        shape = argument.initializer.toString();
                                        if (shape && shape.length > 10) {
                                            shape = shape.substring(0, 10) + '\u2026';
                                        }
                                        separator = ' = ';
                                    }
                                }
                                block.add('initializer-' + argument.name, initializer.name, shape, type ? type.toString() : '', separator);
                            }
                            if (hiddenInitializers) {
                                block.add(null, '\u3008' + '\u2026' + '\u3009', '', null, '');
                            }

                            for (const attribute of sortedAttributes) {
                                if (attribute.visible) {
                                    let attributeValue = sidebar.NodeSidebar.formatAttributeValue(attribute.value, attribute.type);
                                    if (attributeValue && attributeValue.length > 25) {
                                        attributeValue = attributeValue.substring(0, 25) + '\u2026';
                                    }
                                    block.add(null, attribute.name, attributeValue, attribute.type, ' = ');
                                }
                            }
                        }

                        if (edges) {
                            const inputs = node.inputs;
                            for (const input of inputs) {
                                for (const argument of input.arguments) {
                                    if (argument.name != '' && !argument.initializer) {
                                        let tuple = edgeMap[argument.name];
                                        if (!tuple) {
                                            tuple = { from: null, to: [] };
                                            edgeMap[argument.name] = tuple;
                                        }
                                        tuple.to.push({
                                            node: nodeId,
                                            name: input.name
                                        });
                                    }
                                }
                            }
                            let outputs = node.outputs;
                            if (node.chain && node.chain.length > 0) {
                                const chainOutputs = node.chain[node.chain.length - 1].outputs;
                                if (chainOutputs.length > 0) {
                                    outputs = chainOutputs;
                                }
                            }
                            for (const output of outputs) {
                                for (const argument of output.arguments) {
                                    if (argument.name != '') {
                                        let tuple = edgeMap[argument.name];
                                        if (!tuple) {
                                            tuple = { from: null, to: [] };
                                            edgeMap[argument.name] = tuple;
                                        }
                                        tuple.from = {
                                            node: nodeId,
                                            name: output.name,
                                            type: argument.type
                                        };
                                    }
                                }
                            }
                        }

                        if (node.chain && node.chain.length > 0) {
                            for (const innerNode of node.chain) {
                                addNode(element, innerNode, false);
                            }
                        }

                        if (node.inner) {
                            addNode(element, node.inner, false);
                        }
                    };

                    addNode(element, node, true);

                    if (node.controlDependencies && node.controlDependencies.length > 0) {
                        for (const controlDependency of node.controlDependencies) {
                            let tuple = edgeMap[controlDependency];
                            if (!tuple) {
                                tuple = { from: null, to: [] };
                                edgeMap[controlDependency] = tuple;
                            }
                            tuple.to.push({
                                node: nodeId,
                                name: controlDependency,
                                controlDependency: true
                            });
                        }
                    }

                    const nodeName = node.name;
                    if (nodeName) {
                        g.setNode(nodeId, { label: element.format(graphElement), id: 'node-' + nodeName, class: 'graph-node' });
                    }
                    else {
                        g.setNode(nodeId, { label: element.format(graphElement), id: 'node-' + id.toString(), class: 'graph-node' });
                        id++;
                    }

                    const createCluster = function(name) {
                        if (!clusterMap[name]) {
                            g.setNode(name, { rx: 5, ry: 5});
                            clusterMap[name] = true;
                            const parent = clusterParentMap[name];
                            if (parent) {
                                createCluster(parent);
                                g.setParent(name, parent);
                            }
                        }
                    };

                    if (groups) {
                        let groupName = node.group;
                        if (groupName && groupName.length > 0) {
                            if (!Object.prototype.hasOwnProperty.call(clusterParentMap, groupName)) {
                                const lastIndex = groupName.lastIndexOf('/');
                                if (lastIndex != -1) {
                                    groupName = groupName.substring(0, lastIndex);
                                    if (!Object.prototype.hasOwnProperty.call(clusterParentMap, groupName)) {
                                        groupName = null;
                                    }
                                }
                                else {
                                    groupName = null;
                                }
                            }
                            if (groupName) {
                                createCluster(groupName);
                                g.setParent(nodeId, groupName);
                            }
                        }
                    }

                    nodeId++;
                }

                for (const input of graph.inputs) {
                    for (const argument of input.arguments) {
                        let tuple = edgeMap[argument.name];
                        if (!tuple) {
                            tuple = { from: null, to: [] };
                            edgeMap[argument.name] = tuple;
                        }
                        tuple.from = {
                            node: nodeId,
                            type: argument.type
                        };
                    }
                    const types = input.arguments.map((argument) => argument.type || '').join('\n');
                    let inputName = input.name || '';
                    if (inputName.length > 16) {
                        inputName = inputName.split('/').pop();
                    }

                    const inputElement = new grapher.NodeElement(this._host.document);
                    const inputHeader = inputElement.block('header');
                    inputHeader.add(null, [ 'graph-item-input' ], inputName, types, () => {
                        this.showModelProperties();
                    });
                    g.setNode(nodeId++, { label: inputElement.format(graphElement), class: 'graph-input' } );
                }

                for (const output of graph.outputs) {
                    for (const argument of output.arguments) {
                        let tuple = edgeMap[argument.name];
                        if (!tuple) {
                            tuple = { from: null, to: [] };
                            edgeMap[argument.name] = tuple;
                        }
                        tuple.to.push({ node: nodeId });
                    }
                    const outputTypes = output.arguments.map((argument) => argument.type || '').join('\n');
                    let outputName = output.name || '';
                    if (outputName.length > 16) {
                        outputName = outputName.split('/').pop();
                    }

                    const outputElement = new grapher.NodeElement(this._host.document);
                    const outputHeader = outputElement.block('header');
                    outputHeader.add(null, [ 'graph-item-output' ], outputName, outputTypes, () => {
                        this.showModelProperties();
                    });
                    g.setNode(nodeId++, { label: outputElement.format(graphElement) } );
                }

                for (const edge of Object.keys(edgeMap)) {
                    const tuple = edgeMap[edge];
                    if (tuple.from != null) {
                        for (const to of tuple.to) {
                            let text = '';
                            const type = tuple.from.type;
                            if (type && type.shape && type.shape.dimensions && type.shape.dimensions.length > 0) {
                                text = type.shape.dimensions.join('\u00D7');
                            }

                            if (this._showNames) {
                                text = edge.split('\n').shift(); // custom argument id
                            }

                            if (to.controlDependency) {
                                g.setEdge(tuple.from.node, to.node, { label: text, id: 'edge-' + edge, arrowhead: 'vee', class: 'edge-path-control-dependency' } );
                            }
                            else {
                                g.setEdge(tuple.from.node, to.node, { label: text, id: 'edge-' + edge, arrowhead: 'vee' } );
                            }
                        }
                    }
                }

                // Workaround for Safari background drag/zoom issue:
                // https://stackoverflow.com/questions/40887193/d3-js-zoom-is-not-working-with-mousewheel-in-safari
                const backgroundElement = this._host.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                backgroundElement.setAttribute('id', 'background');
                if (this._host.environment('zoom') == 'd3') {
                    backgroundElement.setAttribute('width', '100%');
                    backgroundElement.setAttribute('height', '100%');
                }
                backgroundElement.setAttribute('fill', 'none');
                backgroundElement.setAttribute('pointer-events', 'all');
                graphElement.appendChild(backgroundElement);

                const originElement = this._host.document.createElementNS('http://www.w3.org/2000/svg', 'g');
                originElement.setAttribute('id', 'origin');
                graphElement.appendChild(originElement);

                let svg = null;
                if (this._host.environment('zoom') == 'd3') {
                    svg = d3.select(graphElement);
                    this._zoom = d3.zoom();
                    this._zoom(svg);
                    this._zoom.scaleExtent([0.1, 2]);
                    this._zoom.on('zoom', (event) => {
                        originElement.setAttribute('transform', event.transform.toString());
                    });
                    this._zoom.transform(svg, d3.zoomIdentity);
                }

                return this._timeout(20).then(() => {

                    const graphRenderer = new grapher.Renderer(this._host.document, originElement);
                    graphRenderer.render(g);

                    const originElements = Array.from(graphElement.getElementsByClassName('graph-input') || []);
                    if (originElements.length === 0) {
                        const nodeElements = Array.from(graphElement.getElementsByClassName('graph-node') || []);
                        if (nodeElements.length > 0) {
                            originElements.push(nodeElements[0]);
                        }
                    }

                    switch (this._host.environment('zoom')) {
                        case 'scroll': {
                            const size = graphElement.getBBox();
                            const margin = 100;
                            const width = Math.ceil(margin + size.width + margin);
                            const height = Math.ceil(margin + size.height + margin);
                            originElement.setAttribute('transform', 'translate(' + margin.toString() + ', ' + margin.toString() + ') scale(1)');
                            backgroundElement.setAttribute('width', width);
                            backgroundElement.setAttribute('height', height);
                            this._width = width;
                            this._height = height;
                            this._zoom = 1;
                            delete this._scrollLeft;
                            delete this._scrollRight;
                            graphElement.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
                            graphElement.setAttribute('width', width);
                            graphElement.setAttribute('height', height);
                            if (originElements && originElements.length > 0) {
                                // Center view based on input elements
                                for (let j = 0; j < originElements.length; j++) {
                                    originElements[j].scrollIntoView({ behavior: 'instant' });
                                    break;
                                }
                            }
                            else {
                                // this._zoom.transform(svg, d3.zoomIdentity.translate((svgSize.width - g.graph().width) / 2, (svgSize.height - g.graph().height) / 2));
                            }
                            break;
                        }
                        case 'd3': {
                            const svgSize = graphElement.getBoundingClientRect();
                            if (originElements && originElements.length > 0) {
                                // Center view based on input elements
                                const xs = [];
                                const ys = [];
                                for (let i = 0; i < originElements.length; i++) {
                                    const inputTransform = originElements[i].transform.baseVal.consolidate().matrix;
                                    xs.push(inputTransform.e);
                                    ys.push(inputTransform.f);
                                }
                                let x = xs[0];
                                const y = ys[0];
                                if (ys.every(y => y == ys[0])) {
                                    x = xs.reduce((a,b) => { return a + b; }) / xs.length;
                                }
                                const sx = (svgSize.width / (this._showHorizontal ? 4 : 2)) - x;
                                const sy = (svgSize.height / (this._showHorizontal ? 2 : 4)) - y;
                                this._zoom.transform(svg, d3.zoomIdentity.translate(sx, sy));
                            }
                            else {
                                this._zoom.transform(svg, d3.zoomIdentity.translate((svgSize.width - g.graph().width) / 2, (svgSize.height - g.graph().height) / 2));
                            }
                            break;
                        }
                    }
                    return;
                });
            }
        }
        catch (error) {
            return Promise.reject(error);
        }
    }

    applyStyleSheet(element, name) {
        let rules = [];
        for (let i = 0; i < this._host.document.styleSheets.length; i++) {
            const styleSheet = this._host.document.styleSheets[i];
            if (styleSheet && styleSheet.href && styleSheet.href.endsWith('/' + name)) {
                rules = styleSheet.cssRules;
                break;
            }
        }
        const nodes = element.getElementsByTagName('*');
        for (let j = 0; j < nodes.length; j++) {
            const node = nodes[j];
            for (let k = 0; k < rules.length; k++) {
                const rule = rules[k];
                if (node.matches(rule.selectorText)) {
                    for (let l = 0; l < rule.style.length; l++) {
                        const item = rule.style.item(l);
                        node.style[item] = rule.style[item];
                    }
                }
            }
        }
    }

    export(file) {
        const lastIndex = file.lastIndexOf('.');
        const extension = (lastIndex != -1) ? file.substring(lastIndex + 1) : '';
        if (this._activeGraph && (extension == 'png' || extension == 'svg')) {
            const graphElement = this._getElementById('canvas');
            const exportElement = graphElement.cloneNode(true);
            this.applyStyleSheet(exportElement, 'view-grapher.css');
            exportElement.setAttribute('id', 'export');
            exportElement.removeAttribute('width');
            exportElement.removeAttribute('height');
            exportElement.style.removeProperty('opacity');
            exportElement.style.removeProperty('display');
            const backgroundElement = exportElement.querySelector('#background');
            const originElement = exportElement.querySelector('#origin');
            originElement.setAttribute('transform', 'translate(0,0) scale(1)');
            backgroundElement.removeAttribute('width');
            backgroundElement.removeAttribute('height');

            const parentElement = graphElement.parentElement;
            parentElement.insertBefore(exportElement, graphElement);
            const size = exportElement.getBBox();
            parentElement.removeChild(exportElement);
            parentElement.removeChild(graphElement);
            parentElement.appendChild(graphElement);

            const delta = (Math.min(size.width, size.height) / 2.0) * 0.1;
            const width = Math.ceil(delta + size.width + delta);
            const height = Math.ceil(delta + size.height + delta);
            originElement.setAttribute('transform', 'translate(' + delta.toString() + ', ' + delta.toString() + ') scale(1)');
            exportElement.setAttribute('width', width);
            exportElement.setAttribute('height', height);
            backgroundElement.setAttribute('width', width);
            backgroundElement.setAttribute('height', height);
            backgroundElement.setAttribute('fill', '#fff');

            const data = new XMLSerializer().serializeToString(exportElement);

            if (extension == 'svg') {
                const blob = new Blob([ data ], { type: 'image/svg' });
                this._host.export(file, blob);
            }

            if (extension == 'png') {
                const imageElement = new Image();
                imageElement.onload = () => {
                    const max = Math.max(width, height);
                    const scale = ((max * 2.0) > 24000) ? (24000.0 / max) : 2.0;
                    const canvas = this._host.document.createElement('canvas');
                    canvas.width = Math.ceil(width * scale);
                    canvas.height = Math.ceil(height * scale);
                    const context = canvas.getContext('2d');
                    context.scale(scale, scale);
                    context.drawImage(imageElement, 0, 0);
                    this._host.document.body.removeChild(imageElement);
                    canvas.toBlob((blob) => {
                        if (blob) {
                            this._host.export(file, blob);
                        }
                        else {
                            const err = new Error();
                            err.name = 'Error exporting image.';
                            err.message = 'Image may be too large to render as PNG.';
                            this._host.exception(err, false);
                            this._host.error(err.name, err.message);
                        }
                    }, 'image/png');
                };
                imageElement.src = 'data:image/svg+xml;base64,' + window.btoa(unescape(encodeURIComponent(data)));
                this._host.document.body.insertBefore(imageElement, this._host.document.body.firstChild);
            }
        }
    }

    showModelProperties() {
        if (this._model) {
            const modelSidebar = new sidebar.ModelSidebar(this._host, this._model, this._activeGraph);
            modelSidebar.on('update-active-graph', (sender, name) => {
                this._updateActiveGraph(name);
            });
            this._sidebar.open(modelSidebar.render(), 'Model Properties');
        }
    }

    showNodeProperties(node, input) {
        if (node) {
            const nodeSidebar = new sidebar.NodeSidebar(this._host, node);
            nodeSidebar.on('show-documentation', (/* sender, e */) => {
                this.showNodeDocumentation(node);
            });
            nodeSidebar.on('export-tensor', (sender, tensor) => {
                this._host.require('./numpy').then((numpy) => {
                    const defaultPath = tensor.name ? tensor.name.split('/').join('_').split(':').join('_').split('.').join('_') : 'tensor';
                    this._host.save('NumPy Array', 'npy', defaultPath, (file) => {
                        try {
                            const dataTypeMap = new Map([
                                [ 'float16', 'f2' ], [ 'float32', 'f4' ], [ 'float64', 'f8' ],
                                [ 'int8', 'i1' ], [ 'int16', 'i2'], [ 'int32', 'i4' ], [ 'int64', 'i8' ],
                                [ 'uint8', 'u1' ], [ 'uint16', 'u2' ], [ 'uint32', 'u4' ], [ 'uint64', 'u8' ],
                                [ 'qint8', 'i1' ], [ 'qint16', 'i2' ],
                                [ 'quint8', 'u1' ], [ 'quint16', 'u2' ]
                            ]);
                            const array = new numpy.Array();
                            array.shape = tensor.type.shape.dimensions;
                            array.data = tensor.value;
                            array.dataType = dataTypeMap.has(tensor.type.dataType) ? dataTypeMap.get(tensor.type.dataType) : tensor.type.dataType;
                            const blob = new Blob([ array.toBuffer() ], { type: 'application/octet-stream' });
                            this._host.export(file, blob);
                        }
                        catch (error) {
                            this.error(error, 'Error saving NumPy tensor.', null);
                        }
                    });
                }).catch(() => {
                });
            });
            if (input) {
                nodeSidebar.toggleInput(input.name);
            }
            this._sidebar.open(nodeSidebar.render(), 'Node Properties');
        }
    }

    showNodeDocumentation(node) {
        const metadata = node.metadata;
        if (metadata) {
            const documentationSidebar = new sidebar.DocumentationSidebar(this._host, metadata);
            documentationSidebar.on('navigate', (sender, e) => {
                this._host.openURL(e.link);
            });
            this._sidebar.push(documentationSidebar.render(), 'Documentation');
        }
    }
};

class ModelError extends Error {

    constructor(message, telemetry) {
        super(message);
        this.name = 'Error loading model.';
        this.telemetry = telemetry;
        this.stack = undefined;
    }
}

class ModelContext {

    constructor(context) {
        this._context = context;
        this._tags = new Map();
        this._entries = new Map();
    }

    request(file, encoding) {
        return this._context.request(file, encoding);
    }

    get identifier() {
        return this._context.identifier;
    }

    get buffer() {
        return this._context.buffer;
    }

    entries(extension) {
        let entries = this._entries.get(extension);
        if (!entries) {
            entries = [];
            try {
                const buffer = this.buffer;
                switch (extension) {
                    case 'zip': {
                        if (buffer && buffer.length > 2 && buffer[0] == 0x50 && buffer[1] == 0x4B) {
                            entries = new zip.Archive(buffer).entries;
                        }
                        break;
                    }
                    case 'tar': {
                        if (buffer.length >= 512) {
                            let sum = 0;
                            for (let i = 0; i < 512; i++) {
                                sum += (i >= 148 && i < 156) ? 32 : buffer[i];
                            }
                            let checksum = '';
                            for (let i = 148; i < 156 && buffer[i] !== 0x00; i++) {
                                checksum += String.fromCharCode(buffer[i]);
                            }
                            checksum = parseInt(checksum, 8);
                            if (!isNaN(checksum) && sum == checksum) {
                                entries = new tar.Archive(buffer).entries;
                            }
                        }
                        break;
                    }
                }
            }
            catch (error) {
                entries = [];
            }
            this._entries.set(extension, entries);
        }
        return entries;
    }

    tags(type) {
        let tags = this._tags.get(type);
        if (!tags) {
            tags = new Map();
            try {
                switch (type) {
                    case 'pbtxt': {
                        const decoder = base.TextDecoder.create(this.buffer);
                        let count = 0;
                        for (let i = 0; i < 0x100; i++) {
                            const c = decoder.decode();
                            switch (c) {
                                case '\n': case '\r': case '\t': case '\0': break;
                                case undefined: i = 0x100; break;
                                default: count += c < ' ' ? 1 : 0; break;
                            }
                        }
                        if (count < 4) {
                            const reader = protobuf.TextReader.create(this.buffer);
                            reader.start(false);
                            while (!reader.end(false)) {
                                const tag = reader.tag();
                                tags.set(tag, true);
                                if (reader.token() === '{') {
                                    reader.start();
                                    while (!reader.end()) {
                                        const subtag = reader.tag();
                                        tags.set(tag + '.' + subtag, true);
                                        reader.skip();
                                    }
                                }
                                else {
                                    reader.skip();
                                }
                            }
                        }
                        break;
                    }
                    case 'pb': {
                        const reader = protobuf.Reader.create(this.buffer);
                        const end = reader.next();
                        while (reader.position < end) {
                            const tag = reader.uint32();
                            const number = tag >>> 3;
                            const type = tag & 7;
                            if (type > 5 || number === 0) {
                                tags = new Map();
                                break;
                            }
                            tags.set(number, type);
                            try {
                                reader.skipType(type);
                            }
                            catch (err) {
                                tags = new Map();
                                break;
                            }
                        }
                        break;
                    }
                    case 'json': {
                        const reader = json.TextReader.create(this.buffer);
                        const obj = reader.read();
                        if (!Array.isArray(obj)) {
                            for (const key in obj) {
                                tags.set(key, key === 'format' && obj[key] === 'graph-model' ? obj[key] : true);
                            }
                        }
                        else {
                            for (const item of obj) {
                                for (const key in item) {
                                    tags.set('[].' + key, true);
                                }
                            }
                        }
                    }
                }
            }
            catch (error) {
                tags = new Map();
            }
            this._tags.set(type, tags);
        }
        return tags;
    }
}

class ArchiveContext {

    constructor(entries, rootFolder, identifier, buffer) {
        this._entries = {};
        if (entries) {
            for (const entry of entries) {
                if (entry.name.startsWith(rootFolder)) {
                    const name = entry.name.substring(rootFolder.length);
                    if (name.length > 0 && name.indexOf('/') === -1) {
                        this._entries[name] = entry;
                    }
                }
            }
        }
        this._identifier = identifier.substring(rootFolder.length);
        this._buffer = buffer;
    }

    request(file, encoding) {
        const entry = this._entries[file];
        if (!entry) {
            return Promise.reject(new Error('File not found.'));
        }
        const data = encoding ? new TextDecoder(encoding).decode(entry.data) : entry.data;
        return Promise.resolve(data);
    }

    get identifier() {
        return this._identifier;
    }

    get buffer() {
        return this._buffer;
    }
}

class ArchiveError extends Error {

    constructor(message) {
        super(message);
        this.name = 'Error loading archive.';
    }
}

view.ModelFactoryService = class {

    constructor(host) {
        this._host = host;
        this._extensions = [];
        this.register('./onnx', [ '.onnx', '.pb', '.pbtxt', '.prototxt', '.model' ]);
        this.register('./mxnet', [ '.mar', '.model', '.json', '.params' ]);
        this.register('./pytorch', [ '.pt', '.pth', '.pt1', '.pkl', '.h5', '.t7', '.model', '.dms', '.tar', '.ckpt', '.chkpt', '.bin', '.pb', '.zip' ]);
        this.register('./keras', [ '.h5', '.hd5', '.hdf5', '.keras', '.json', '.cfg', '.model', '.pb', '.pth' ]);
        this.register('./coreml', [ '.mlmodel' ]);
        this.register('./caffe', [ '.caffemodel', '.pbtxt', '.prototxt', '.pt' ]);
        this.register('./caffe2', [ '.pb', '.pbtxt', '.prototxt' ]);
        this.register('./torch', [ '.t7' ]);
        this.register('./tflite', [ '.tflite', '.lite', '.tfl', '.bin', '.pb', '.tmfile', '.h5', '.model', '.json' ]);
        this.register('./tf', [ '.pb', '.meta', '.pbtxt', '.prototxt', '.pt', '.json', '.index', '.ckpt', '.graphdef', '.data-00000-of-00001' ]);
        this.register('./mediapipe', [ '.pbtxt' ]);
        this.register('./uff', [ '.uff', '.pb', '.pbtxt', '.uff.txt', '.trt', '.engine' ]);
        this.register('./sklearn', [ '.pkl', '.pickle', '.joblib', '.model', '.meta', '.pb', '.pt', '.h5' ]);
        this.register('./cntk', [ '.model', '.cntk', '.cmf', '.dnn' ]);
        this.register('./paddle', [ '.paddle', '.pdmodel', '__model__' ]);
        this.register('./bigdl', [ '.model', '.bigdl' ]);
        this.register('./darknet', [ '.cfg', '.model' ]);
        this.register('./armnn', [ '.armnn', '.json' ]);
        this.register('./mnn', ['.mnn']);
        this.register('./ncnn', [ '.param', '.bin', '.cfg.ncnn', '.weights.ncnn' ]);
        this.register('./tnn', [ '.tnnproto', '.tnnmodel' ]);
        this.register('./tengine', ['.tmfile']);
        this.register('./barracuda', [ '.nn' ]);
        this.register('./dnn', [ '.dnn' ]);
        this.register('./openvino', [ '.xml', '.bin' ]);
        this.register('./flux', [ '.bson' ]);
        this.register('./npz', [ '.npz', '.h5', '.hd5', '.hdf5' ]);
        this.register('./dl4j', [ '.zip' ]);
        this.register('./mlnet', [ '.zip' ]);
        this.register('./weka', [ '.model' ]);
    }

    register(id, extensions) {
        for (const extension of extensions) {
            this._extensions.push({ extension: extension, id: id });
        }
    }

    open(context) {
        return this._openSignature(context).then((context) => {
            return this._openArchive(context).then((context) => {
                context = new ModelContext(context);
                const identifier = context.identifier;
                const extension = identifier.split('.').pop().toLowerCase();
                const modules = this._filter(context).filter((module) => module && module.length > 0);
                if (modules.length == 0) {
                    throw new ModelError("Unsupported file extension '." + extension + "'.");
                }
                const errors = [];
                let match = false;
                const nextModule = () => {
                    if (modules.length > 0) {
                        const id = modules.shift();
                        return this._host.require(id).then((module) => {
                            if (!module.ModelFactory) {
                                throw new ModelError("Failed to load module '" + id + "'.");
                            }
                            const modelFactory = new module.ModelFactory();
                            if (!modelFactory.match(context)) {
                                return nextModule();
                            }
                            match++;
                            return modelFactory.open(context, this._host).then((model) => {
                                return model;
                            }).catch((error) => {
                                const text = " in '" + context.identifier + "'.";
                                if (error && !error.message.endsWith(text)) {
                                    error.message = error.message.replace(/\.$/, '') + text;
                                }
                                errors.push(error);
                                return nextModule();
                            });
                        });
                    }
                    else {
                        if (match) {
                            if (errors.length == 1) {
                                throw errors[0];
                            }
                            throw new ModelError(errors.map((err) => err.message).join('\n'));
                        }
                        const knownUnsupportedIdentifiers = new Set([
                            'natives_blob.bin',
                            'v8_context_snapshot.bin',
                            'snapshot_blob.bin',
                            'image_net_labels.json',
                            'package.json',
                            'models.json',
                            'LICENSE.meta',
                            'input_0.pb',
                            'output_0.pb'
                        ]);
                        const skip = knownUnsupportedIdentifiers.has(identifier);
                        const formats = [
                            { type: 'pb', name: 'Protocol Buffers' },
                            { type: 'pbtxt', name: 'Protocol Buffers text' },
                            { type: 'json', name: 'JSON' }
                        ];
                        for (const format of formats) {
                            const tags = context.tags(format.type);
                            if (tags.size > 0) {
                                const entries = [];
                                entries.push(...Array.from(tags).filter((pair) => pair[0].toString().indexOf('.') === -1));
                                entries.push(...Array.from(tags).filter((pair) => pair[0].toString().indexOf('.') !== -1));
                                const content = entries.map((pair) => pair[1] === true ? pair[0] : pair[0] + ':' + JSON.stringify(pair[1])).join(',');
                                throw new ModelError("Unsupported " + format.name + " content '" + (content.length > 64 ? content.substring(0, 100) + '...' : content) + "' for extension '." + extension + "' in '" + identifier + "'.", !skip);
                            }
                        }
                        const buffer = context.buffer;
                        const bytes = Array.from(buffer.subarray(0, Math.min(16, buffer.length))).map((c) => (c < 16 ? '0' : '') + c.toString(16)).join('');
                        const content = buffer.length > 268435456 ? '(' + bytes + ') [' + buffer.length.toString() + ']': '(' + bytes + ')';
                        throw new ModelError("Unsupported file content " + content + " for extension '." + extension + "' in '" + identifier + "'.", !skip);
                    }
                };
                return nextModule();
            });
        });
    }

    _openArchive(context) {
        let archive = null;
        let extension;
        let identifier = context.identifier;
        let buffer = context.buffer;

        try {
            extension = identifier.split('.').pop().toLowerCase();
            if (extension == 'gz' || extension == 'tgz') {
                archive = new gzip.Archive(buffer);
                if (archive.entries.length == 1) {
                    const entry = archive.entries[0];
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
        }
        catch (error) {
            const message = error && error.message ? error.message : error.toString();
            return Promise.reject(new ArchiveError(message.replace(/\.$/, '') + " in '" + identifier + "'."));
        }

        try {
            extension = identifier.split('.').pop().toLowerCase();
            switch (extension) {
                case 'tar': {
                    // handle .pth.tar
                    const torch = [ 0x8a, 0x0a, 0x6c, 0xfc, 0x9c, 0x46, 0xf9, 0x20, 0x6a, 0xa8, 0x50, 0x19 ];
                    if (buffer && buffer.length >= 14 && buffer[0] === 0x80 && torch.every((v, i) => v === buffer[i + 2])) {
                        break;
                    }
                    if (buffer && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
                        break;
                    }
                    archive = new tar.Archive(buffer);
                    break;
                }
                case 'zip': {
                    archive = new zip.Archive(buffer);
                    // PyTorch Zip archive
                    if (archive.entries.some((e) => e.name.split('/').pop().split('\\').pop() === 'version') &&
                        archive.entries.some((e) => e.name.split('/').pop().split('\\').pop() === 'data.pkl')) {
                        return Promise.resolve(context);
                    }
                    // dl4j
                    if (archive.entries.some((e) => e.name.split('/').pop().split('\\').pop() === 'coefficients.bin') &&
                        archive.entries.some((e) => e.name.split('/').pop().split('\\').pop() === 'configuration.json')) {
                        return Promise.resolve(context);
                    }
                    break;
                }
            }
        }
        catch (error) {
            const message = error && error.message ? error.message : error.toString();
            return Promise.reject(new ArchiveError(message.replace(/\.$/, '') + " in '" + identifier + "'."));
        }

        if (!archive) {
            return Promise.resolve(context);
        }

        try {
            const folders = {};
            const entries = archive.entries.filter((entry) => !entry.name.endsWith('/') && !entry.name.split('/').pop().startsWith('.')).slice();
            for (const entry of entries) {
                if (entry.name.indexOf('/') != -1) {
                    folders[entry.name.split('/').shift() + '/'] = true;
                }
                else {
                    folders['/'] = true;
                }
            }
            if (extension == 'tar') {
                delete folders['PaxHeader/'];
            }
            let rootFolder = Object.keys(folders).length == 1 ? Object.keys(folders)[0] : '';
            rootFolder = rootFolder == '/' ? '' : rootFolder;
            let matches = [];
            const queue = entries.slice(0);
            const nextEntry = () => {
                if (queue.length > 0) {
                    const entry = queue.shift();
                    if (entry.name.startsWith(rootFolder)) {
                        const identifier = entry.name.substring(rootFolder.length);
                        if (identifier.length > 0 && identifier.indexOf('/') < 0 && !identifier.startsWith('.')) {
                            const context = new ModelContext(new ArchiveContext(null, rootFolder, entry.name, entry.data));
                            let modules = this._filter(context);
                            const nextModule = () => {
                                if (modules.length > 0) {
                                    const id = modules.shift();
                                    return this._host.require(id).then((module) => {
                                        if (!module.ModelFactory) {
                                            throw new ArchiveError("Failed to load module '" + id + "'.", null);
                                        }
                                        const factory = new module.ModelFactory();
                                        if (factory.match(context)) {
                                            matches.push(entry);
                                            modules = [];
                                        }
                                        return nextModule();
                                    });
                                }
                                else {
                                    return nextEntry();
                                }
                            };
                            return nextModule();
                        }
                    }
                    return nextEntry();
                }
                else {
                    if (matches.length == 0) {
                        return Promise.resolve(context);
                    }
                    // MXNet
                    if (matches.length == 2 &&
                        matches.some((e) => e.name.toLowerCase().endsWith('.params')) &&
                        matches.some((e) => e.name.toLowerCase().endsWith('-symbol.json'))) {
                        matches = matches.filter((e) => e.name.toLowerCase().endsWith('.params'));
                    }
                    // TensorFlow Bundle
                    if (matches.length > 1 &&
                        matches.some((e) => e.name.toLowerCase().endsWith('.data-00000-of-00001'))) {
                        matches = matches.filter((e) => !e.name.toLowerCase().endsWith('.data-00000-of-00001'));
                    }
                    if (matches.length > 1) {
                        return Promise.reject(new ArchiveError('Archive contains multiple model files.'));
                    }
                    const match = matches[0];
                    return Promise.resolve(new ModelContext(new ArchiveContext(entries, rootFolder, match.name, match.data)));
                }
            };
            return nextEntry();
        }
        catch (error) {
            return Promise.reject(new ArchiveError(error.message));
        }
    }

    accept(identifier) {
        const extension = identifier.split('.').pop().toLowerCase();
        identifier = identifier.toLowerCase();
        for (const entry of this._extensions) {
            if (identifier.endsWith(entry.extension)) {
                this._host.event('File', 'Accept', extension, 1);
                return true;
            }
        }
        if (identifier.endsWith('.zip') ||
            identifier.endsWith('.tar') ||
            identifier.endsWith('.tar.gz') ||
            identifier.endsWith('.tgz')) {
            this._host.event('File', 'Accept', extension, 1);
            return true;
        }
        this._host.event('File', 'Reject', extension, 1);
        return false;
    }

    _filter(context) {
        const identifier = context.identifier.toLowerCase();
        const list = this._extensions.filter((entry) => identifier.endsWith(entry.extension)).map((extry) => extry.id);
        return Array.from(new Set(list));
    }

    _openSignature(context) {
        const buffer = context.buffer;
        if (context.buffer.length === 0) {
            return Promise.reject(new ModelError('File has no content.', true));
        }
        /* eslint-disable no-control-regex */
        const entries = [
            { name: 'ELF executable', value: /^\x7FELF/ },
            { name: 'Git LFS header', value: /^version https:\/\/git-lfs.github.com\/spec\/v1\n/ },
            { name: 'Git LFS header', value: /^oid sha256:/ },
            { name: 'HTML markup', value: /^\s*<html>/ },
            { name: 'HTML markup', value: /^\s*<!doctype html>/ },
            { name: 'HTML markup', value: /^\s*<!DOCTYPE html>/ },
            { name: 'HTML markup', value: /^\s*<!DOCTYPE HTML>/ },
            { name: 'Unity metadata', value: /^fileFormatVersion:/ },
            { name: 'Vulkan SwiftShader ICD manifest', value: /^{\s*"file_format_version":\s*"1.0.0"\s*,\s*"ICD":/ },
            { name: 'StringIntLabelMapProto data', value: /^(#.*\n)*item\s*{\r?\n\s*id:/ },
            { name: 'StringIntLabelMapProto data', value: /^(#.*\n)*item\s*{\r?\n\s*name:/ },
            { name: 'ImageNet LabelMap data', value: /^(#.*\n)*entry\s*{\r?\n\s*target_class/ },
            { name: 'Python source code', value: /^\s*import sys, types, os;/ },
            { name: 'undocumented TensorRT engine data', value: /^ptrt/ },
            { name: 'TSD header', value: /^%TSD-Header-###%/ },
            { name: 'Darkflow metadata', value: /^{"net":\s*{"type":/ },
            { name: 'keras-yolo2 configuation', value: /^{\s*"model"\s*:\s*{\s*"architecture"/ },
            { name: 'Triton Inference Server configuration', value: /^[\s\S]*name:\s*[\s\S]*platform:\s*[\s\S]*input\s*\[[\s\S]*\][\s\S]*output\s*\[[\s\S]*\]/ },
            { name: "TensorFlow Hub module", value: /^\x08\x03$/, identifier: 'tfhub_module.pb' },
        ];
        /* eslint-enable no-control-regex */
        const text = new TextDecoder().decode(buffer.subarray(0, Math.min(4096, buffer.length)));
        for (const entry of entries) {
            if (text.match(entry.value) && (!entry.identifier || entry.identifier === context.identifier)) {
                return Promise.reject(new ModelError("Invalid file content. File contains " + entry.name + ".", true));
            }
        }
        return Promise.resolve(context);
    }
};

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports.View = view.View;
    module.exports.ModelFactoryService = view.ModelFactoryService;
}
