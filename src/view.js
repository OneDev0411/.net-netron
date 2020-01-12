/* jshint esversion: 6 */
/* eslint "indent": [ "error", 4, { "SwitchCase": 1 } ] */

var view = view || {};

var zip = zip || require('./zip');
var gzip = gzip || require('./gzip');
var tar = tar || require('./tar');
var protobuf = protobuf || require('protobufjs');
var prototxt = prototxt || require('protobufjs/ext/prototxt');

var d3 = d3 || require('d3');
var dagre = dagre || require('dagre');

var sidebar = sidebar || require('./view-sidebar');
var grapher = grapher || require('./view-grapher');

view.View = class {

    constructor(host) {
        this._host = host;
        this._model = null;
        this._selection = [];
        this._sidebar = new sidebar.Sidebar(this._host);
        this._host.initialize(this);
        this._showAttributes = false;
        this._showInitializers = true;
        this._showNames = false;
        this._searchText = '';
        this._modelFactoryService = new view.ModelFactoryService(this._host);
        this._host.document.documentElement.style.overflow = 'hidden';
        this._host.document.body.scroll = 'no';
        this._host.document.getElementById('zoom-in-button').addEventListener('click', () => {
            this.zoomIn();
        });
        this._host.document.getElementById('zoom-out-button').addEventListener('click', () => {
            this.zoomOut();
        });
        this._host.document.getElementById('toolbar').addEventListener('mousewheel', (e) => {
            this._preventZoom(e);
        });
        this._host.document.getElementById('sidebar').addEventListener('mousewheel', (e) => {
            this._preventZoom(e);
        });
        this._host.document.addEventListener('keydown', () => {
            this.clearSelection();
        });
        if (this._host.environment('zoom') == 'scroll') {
            this._host.document.getElementById('graph-container').addEventListener('mousewheel', (e) => {
                this._mouseWheelHandler(e);
            });
            this._host.document.getElementById('graph-container').addEventListener('scroll', (e) => {
                this._scrollHandler(e);
            });
            this._host.document.getElementById('graph-container').addEventListener('gesturestart', (e) => {
                e.preventDefault();
                this._gestureStartZoom = this._zoom;
            }, false);
            this._host.document.getElementById('graph-container').addEventListener('gesturechange', (e) => {
                e.preventDefault();
                this._updateZoom(this._gestureStartZoom * e.scale, e);
            }, false);
            this._host.document.getElementById('graph-container').addEventListener('gestureend', (e) => {
                e.preventDefault();
                this._updateZoom(this._gestureStartZoom * e.scale, e);
            }, false);
        }
    }
    
    show(page) {

        if (!page) {
            page = (!this._model && !this._activeGraph) ? 'Welcome' : 'Graph';
        }

        this._host.screen(page);

        this._sidebar.close();

        let welcomeElement = this._host.document.getElementById('welcome');
        let openFileButton = this._host.document.getElementById('open-file-button');
        let spinnerElement = this._host.document.getElementById('spinner');
        let graphElement = this._host.document.getElementById('graph');
        let toolbarElement = this._host.document.getElementById('toolbar');
    
        if (page == 'Welcome') {
            this._host.document.body.style.cursor = 'default';
            welcomeElement.style.display = 'block';
            openFileButton.style.display = 'block';
            openFileButton.style.opacity = 1;
            spinnerElement.style.display = 'none';
            graphElement.style.display = 'none';
            graphElement.style.opacity = 0;
            toolbarElement.style.display = 'none';
        }

        if (page == 'Spinner') {
            this._host.document.body.style.cursor = 'wait';
            welcomeElement.style.display = 'block';
            spinnerElement.style.display = 'block';
            openFileButton.style.display = 'block';
            graphElement.style.display = 'block';
            graphElement.style.opacity = 0;
            toolbarElement.style.display = 'none';
        }

        if (page == 'Graph') {
            welcomeElement.style.display = 'none';
            openFileButton.style.display = 'none';
            openFileButton.style.opacity = 0;
            spinnerElement.style.display = 'none';
            graphElement.style.display = 'block';
            graphElement.style.opacity = 1;
            toolbarElement.style.display = 'block';
            this._host.document.body.style.cursor = 'default';
        }
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
            let graphElement = document.getElementById('graph');
            let view = new sidebar.FindSidebar(this._host, graphElement, this._activeGraph);
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

    _reload() {
        this.show('Spinner');
        if (this._model && this._activeGraph) {
            this._updateGraph(this._model, this._activeGraph).catch((error) => {
                if (error) {
                    this.error('Graph update failed.', error);
                }
            });
        }
    }

    _timeout(time) {
        return new Promise((resolve) => {
            setTimeout(() => { resolve(); }, time);
        });
    }

    zoomIn() {
        switch (this._host.environment('zoom')) {
            case 'scroll':
                this._updateZoom(this._zoom * 1.05);
                break;
            case 'd3':
                if (this._zoom) {
                    this._zoom.scaleBy(d3.select(this._host.document.getElementById('graph')), 1.2);
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
                    this._zoom.scaleBy(d3.select(this._host.document.getElementById('graph')), 0.8);
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
                    this._zoom.scaleTo(d3.select(this._host.document.getElementById('graph')), 1);
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

        let container = this._host.document.getElementById('graph-container');

        let min = Math.min(Math.max(container.clientHeight / this._height, 0.2), 1);

        zoom = Math.min(zoom, 2);
        zoom = Math.max(min, zoom);

        let scrollLeft = this._scrollLeft || container.scrollLeft;
        let scrollTop = this._scrollTop || container.scrollTop;

        let x = e ? e.pageX : (container.clientWidth / 2);
        let y = e ? e.pageY : (container.clientHeight / 2);

        x += scrollLeft;
        y += scrollTop;

        let graph = this._host.document.getElementById('graph');
        graph.style.width = zoom * this._width;
        graph.style.height = zoom * this._height

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
            let graphElement = this._host.document.getElementById('graph');
            let graphRect = graphElement.getBoundingClientRect();
            let x = 0;
            let y = 0;
            for (const element of selection) {
                element.classList.add('select');
                this._selection.push(element);
                let box = element.getBBox();
                let ex = box.x + (box.width / 2);
                let ey = box.y + (box.height / 2);
                let transform = element.transform.baseVal.consolidate();
                if (transform) {
                    ex = transform.matrix.e;
                    ey = transform.matrix.f;
                }
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
            let element = this._selection.pop();
            element.classList.remove('select');
        }
    }

    error(message, err) {
        this._sidebar.close();
        this._host.exception(err, false);
        this._host.error(message, err.toString());
        this.show('Welcome');
    }

    accept(file) {
        return this._modelFactoryService.accept(file);
    }

    open(context) {
        this._host.event('Model', 'Open', 'Size', context.buffer.length);
        this._sidebar.close();
        return this._timeout(2).then(() => {
            return this._modelFactoryService.open(context).then((model) => {
                let format = model.format;
                if (format) {
                    format = format + (model.producer ? ' (' + model.producer + ')' : '');
                    this._host.event('Model', 'Format', format);
                }
                return this._timeout(20).then(() => {
                    let graph = model.graphs.length > 0 ? model.graphs[0] : null;
                    return this._updateGraph(model, graph);
                });
            });
        });
    }

    _updateActiveGraph(name) {
        this._sidebar.close();
        if (this._model) {
            let model = this._model;
            let graph = model.graphs.filter(graph => name == graph.name).shift();
            if (graph) {
                this.show('Spinner');
                this._timeout(200).then(() => {
                    return this._updateGraph(model, graph).catch((error) => {
                        if (error) {
                            this.error('Graph update failed.', error);
                        }
                    });
                });
            }
        }
    }

    _updateGraph(model, graph) {
        return this._timeout(100).then(() => {
            if (graph && graph != this._activeGraph) {
                let nodes = graph.nodes;
                if (nodes.length > 1400) {
                    if (!this._host.confirm('Large model detected.', 'This graph contains a large number of nodes and might take a long time to render. Do you want to continue?')) {
                        this._host.event('Graph', 'Render', 'Skip', nodes.length);
                        this.show(null);
                        return null;
                    }  
                }
            }
            return this.renderGraph(graph).then(() => {
                this._model = model;
                this._activeGraph = graph;
                this.show('Graph');
                return this._model;
            }).catch((error) => {
                this.renderGraph(this._activeGraph).then(() => {
                    this.show('Graph');
                    throw error;
                }).catch(() => {
                    throw error;
                });
            });
        });
    }

    renderGraph(graph) {
        try {
            if (!graph) {
                return Promise.resolve();
            }
            else {
                let graphElement = this._host.document.getElementById('graph');
                while (graphElement.lastChild) {
                    graphElement.removeChild(graphElement.lastChild);
                }
    
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
    
                let groups = graph.groups;
    
                let graphOptions = {};
                graphOptions.nodesep = 25;
                graphOptions.ranksep = 20;

                let g = new dagre.graphlib.Graph({ compound: groups });
                g.setGraph(graphOptions);
                g.setDefaultEdgeLabel(() => { return {}; });
            
                let nodeId = 0;
                let edgeMap = {};
            
                let clusterMap = {};
                let clusterParentMap = {};
    
                let id = new Date().getTime();
                let nodes = graph.nodes;

                if (nodes.length > 1500) {
                    graphOptions.ranker = 'longest-path';
                }

                this._host.event('Graph', 'Render', 'Size', nodes.length);

                if (groups) {
                    for (const node of nodes) {
                        if (node.group) {
                            let path = node.group.split('/');
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
    
                    let element = new grapher.NodeElement(this._host.document);

                    const addNode = function(element, node, edges) {

                        let header =  element.block('header');
                        let styles = [ 'node-item-operator' ];
                        const category = node.category;
                        if (category) {
                            styles.push('node-item-operator-' + category.toLowerCase());
                        }
                        const content = self.showNames && node.name ? node.name : node.operator;
                        const tooltip = self.showNames && node.name ? node.operator : node.name;
                        header.add(null, styles, content, tooltip, () => { 
                            self.showNodeProperties(node, null);
                        });

                        if (node.function) {
                            header.add(null, [ 'node-item-function' ], '+', null, () => {
                                // debugger;
                            });
                        }

                        let initializers = [];
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
                        let attributes = [];
                        if (self.showAttributes && node.attributes) {
                            attributes = node.attributes.filter((attribute) => attribute.visible);
                        }
                        if (initializers.length > 0 || hiddenInitializers || attributes.length > 0) {
                            let block = element.block('list');
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
                                block.add('initializer-' + argument.id, initializer.name, shape, type ? type.toString() : '', separator);
                            }
                            if (hiddenInitializers) {
                                block.add(null, '\u3008' + '\u2026' + '\u3009', '', null, '');
                            }

                            for (const attribute of attributes) {
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
                                    if (argument.id != '' && !argument.initializer) {
                                        let tuple = edgeMap[argument.id];
                                        if (!tuple) {
                                            tuple = { from: null, to: [] };
                                            edgeMap[argument.id] = tuple;
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
                                    if (argument.id != '') {
                                        let tuple = edgeMap[argument.id];
                                        if (!tuple) {
                                            tuple = { from: null, to: [] };
                                            edgeMap[argument.id] = tuple;
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
                    }
    
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
                        g.setNode(nodeId, { label: element.format(graphElement), id: 'node-' + nodeName });
                    }
                    else {
                        g.setNode(nodeId, { label: element.format(graphElement), id: 'node-' + id.toString() });
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
                    }
    
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
                        let tuple = edgeMap[argument.id];
                        if (!tuple) {
                            tuple = { from: null, to: [] };
                            edgeMap[argument.id] = tuple;
                        }
                        tuple.from = { 
                            node: nodeId,
                            type: argument.type
                        };
                    }
                    let types = input.arguments.map((argument) => argument.type || '').join('\n');
                    let inputName = input.name || '';
                    if (inputName.length > 16) {
                        inputName = inputName.split('/').pop();
                    }
    
                    let inputElement = new grapher.NodeElement(this._host.document);
                    let inputHeader = inputElement.block('header');
                    inputHeader.add(null, [ 'graph-item-input' ], inputName, types, () => {
                        this.showModelProperties();
                    });
                    g.setNode(nodeId++, { label: inputElement.format(graphElement), class: 'graph-input' } ); 
                }
            
                for (const output of graph.outputs) {
                    for (const argument of output.arguments) {
                        let tuple = edgeMap[argument.id];
                        if (!tuple) {
                            tuple = { from: null, to: [] };
                            edgeMap[argument.id] = tuple;
                        }
                        tuple.to.push({ node: nodeId });
                    }
                    let outputTypes = output.arguments.map((argument) => argument.type || '').join('\n');
                    let outputName = output.name || '';
                    if (outputName.length > 16) {
                        outputName = outputName.split('/').pop();
                    }
            
                    let outputElement = new grapher.NodeElement(this._host.document);
                    let outputHeader = outputElement.block('header');
                    outputHeader.add(null, [ 'graph-item-output' ], outputName, outputTypes, () => {
                        this.showModelProperties();
                    });
                    g.setNode(nodeId++, { label: outputElement.format(graphElement) } ); 
                }

                for (const edge of Object.keys(edgeMap)) {
                    let tuple = edgeMap[edge];
                    if (tuple.from != null) {
                        for (const to of tuple.to) {
                            let text = '';
                            let type = tuple.from.type;
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
                let backgroundElement = this._host.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                backgroundElement.setAttribute('id', 'background');
                if (this._host.environment('zoom') == 'd3') {
                    backgroundElement.setAttribute('width', '100%');
                    backgroundElement.setAttribute('height', '100%');
                }
                backgroundElement.setAttribute('fill', 'none');
                backgroundElement.setAttribute('pointer-events', 'all');
                graphElement.appendChild(backgroundElement);

                let originElement = this._host.document.createElementNS('http://www.w3.org/2000/svg', 'g');
                originElement.setAttribute('id', 'origin');
                graphElement.appendChild(originElement);
            
                let svg = null;
                if (this._host.environment('zoom') == 'd3') {
                    svg = d3.select(graphElement);
                    this._zoom = d3.zoom();
                    this._zoom(svg);
                    this._zoom.scaleExtent([0.1, 2]);
                    this._zoom.on('zoom', () => {
                        originElement.setAttribute('transform', d3.event.transform.toString());
                    });
                    this._zoom.transform(svg, d3.zoomIdentity);
                }

                return this._timeout(20).then(() => {

                    let graphRenderer = new grapher.Renderer(this._host.document, originElement);
                    graphRenderer.render(g);

                    let inputElements = graphElement.getElementsByClassName('graph-input');

                    switch (this._host.environment('zoom')) {
                        case 'scroll': {
                            const size = graphElement.getBBox();
                            let margin = 100;
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
                            if (inputElements && inputElements.length > 0) {
                                // Center view based on input elements
                                for (let j = 0; j < inputElements.length; j++) {
                                    inputElements[j].scrollIntoView({ behavior: 'instant' });
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
                            if (inputElements && inputElements.length > 0) {
                                // Center view based on input elements
                                let xs = [];
                                let ys = [];
                                for (let i = 0; i < inputElements.length; i++) {
                                    const inputTransform = inputElements[i].transform.baseVal.consolidate().matrix;
                                    xs.push(inputTransform.e);
                                    ys.push(inputTransform.f);
                                }
                                let x = xs[0];
                                let y = ys[0];
                                if (ys.every(y => y == ys[0])) {
                                    x = xs.reduce((a,b) => { return a + b; }) / xs.length;
                                }
                                this._zoom.transform(svg, d3.zoomIdentity.translate((svgSize.width / 2) - x, (svgSize.height / 4) - y));
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
        let nodes = element.getElementsByTagName('*');
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
            const graphElement = this._host.document.getElementById('graph');
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
                this.showOperatorDocumentation(node);
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
                            let array = new numpy.Array();
                            array.shape = tensor.type.shape.dimensions;
                            array.data = tensor.value;
                            array.dataType = dataTypeMap.has(tensor.type.dataType) ? dataTypeMap.get(tensor.type.dataType) : tensor.type.dataType;
                            const blob = new Blob([ array.toBuffer() ], { type: 'application/octet-stream' });
                            this._host.export(file, blob);
                        }
                        catch (error) {
                            this.error('Error saving NumPy tensor.', error);
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

    showOperatorDocumentation(node) {
        let documentation = node.documentation;
        if (documentation) {
            const documentationSidebar = new sidebar.OperatorDocumentationSidebar(documentation);
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

    get text() {
        if (!this._text) {
            this._text = new TextDecoder('utf-8').decode(this.buffer);
        }
        return this._text;
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
                        entries = new tar.Archive(buffer).entries;
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

    tags(extension) {
        let tags = this._tags.get(extension);
        if (!tags) {
            tags = new Map();
            try {
                switch (extension) {
                    case 'pbtxt': {
                        const b = this.buffer;
                        const length = b.length;
                        const signature = 
                            (length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) ||
                            (length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0xfe && b[3] === 0xff) ||
                            (length >= 4 && b[0] === 0xff && b[1] === 0xfe && b[2] === 0x00 && b[3] === 0x00) ||
                            (length >= 4 && b[0] === 0x84 && b[1] === 0x31 && b[2] === 0x95 && b[3] === 0x33) ||
                            (length >= 2 && b[0] === 0xfe && b[1] === 0xff) ||
                            (length >= 2 && b[0] === 0xff && b[1] === 0xfe);
                        if (!signature && b.subarray(0, Math.min(1024, length)).some((c) => c < 7 || (c > 14 && c < 32))) {
                            break;
                        }
                        const reader = prototxt.TextReader.create(this.text);
                        reader.start(false);
                        while (!reader.end(false)) {
                            const tag = reader.tag();
                            tags.set(tag, true);
                            reader.skip();
                        }
                        break;
                    }
                    case 'pb': {
                        const reader = new protobuf.Reader.create(this.buffer);
                        while (reader.pos < reader.len) {
                            const tagType = reader.uint32();
                            tags.set(tagType >>> 3, tagType & 7);
                            try {
                                reader.skipType(tagType & 7);
                            }
                            catch (err) {
                                tags = new Map();
                                break;
                            }
                        }
                        break;
                    }
                }
            }
            catch (error) {
                tags = new Map();
            }
            this._tags.set(extension, tags);
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
                    let name = entry.name.substring(rootFolder.length);
                    if (identifier.length > 0 && identifier.indexOf('/') < 0) {
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
        this.register('./onnx', [ '.onnx', '.pb', '.pbtxt', '.prototxt' ]);
        this.register('./mxnet', [ '.mar', '.model', '.json', '.params' ]);
        this.register('./keras', [ '.h5', '.hd5', '.hdf5', '.keras', '.json', '.model' ]);
        this.register('./coreml', [ '.mlmodel' ]);
        this.register('./caffe', [ '.caffemodel', '.pbtxt', '.prototxt', '.pt' ]);
        this.register('./caffe2', [ '.pb', '.pbtxt', '.prototxt' ]);
        this.register('./pytorch', [ '.pt', '.pth', '.pt1', '.pkl', '.h5', '.t7', '.model', '.dms', '.pth.tar', '.ckpt', '.bin' ]);
        this.register('./torch', [ '.t7' ]);
        this.register('./tflite', [ '.tflite', '.lite', '.tfl', '.bin' ]);
        this.register('./tf', [ '.pb', '.meta', '.pbtxt', '.prototxt', '.json', '.index', '.ckpt' ]);
        this.register('./sklearn', [ '.pkl', '.joblib', '.model' ]);
        this.register('./cntk', [ '.model', '.cntk', '.cmf', '.dnn' ]);
        this.register('./paddle', [ '.paddle', '__model__' ]);
        this.register('./armnn', [ '.armnn' ]);
        this.register('./bigdl', [ '.model', '.bigdl' ]);
        this.register('./darknet', [ '.cfg' ]);
        this.register('./mnn', ['.mnn']);
        this.register('./ncnn', [ '.param', '.bin', '.cfg.ncnn', '.weights.ncnn' ]);
        this.register('./openvino', [ '.xml' ]);
        this.register('./flux', [ '.bson' ]);
        this.register('./chainer', [ '.npz', '.h5', '.hd5', '.hdf5' ]);
        this.register('./dl4j', [ '.zip' ]);
        this.register('./mlnet', [ '.zip' ]);
    }

    register(id, extensions) {
        for (const extension of extensions) {
            this._extensions.push({ extension: extension, id: id });
        }
    }
 
    open(context) {
        return this._openArchive(context).then((context) => {
            context = new ModelContext(context);
            const identifier = context.identifier;
            const extension = identifier.split('.').pop().toLowerCase();
            let modules = this._filter(context);
            if (modules.length == 0) {
                throw new ModelError("Unsupported file extension '." + extension + "'.");
            }
            let errors = [];
            let match = false;
            let nextModule = () => {
                if (modules.length > 0) {
                    let id = modules.shift();
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
                        'output_0.pb',
                        'object-detection.pbtxt',
                    ]);
                    let skip = knownUnsupportedIdentifiers.has(identifier);
                    if (!skip && extension === 'pbtxt') {
                        if (identifier.includes('label_map') || identifier.includes('labels_map') || identifier.includes('labelmap')) {
                            const tags = context.tags('pbtxt');
                            if (tags.size === 1 && (tags.has('item') || tags.has('entry'))) {
                                skip = true;
                            }
                        }
                    }
                    throw new ModelError("Unsupported file content for extension '." + extension + "' in '" + identifier + "'.", !skip);
                }
            };
            return nextModule();
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
                    let entry = archive.entries[0];
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
            let message = error && error.message ? error.message : error.toString();
            message = message.endsWith('.') ? message.substring(0, message.length - 1) : message;
            return Promise.reject(new ArchiveError(message + " in '" + identifier + "'."));
        }

        try {
            extension = identifier.split('.').pop().toLowerCase();
            switch (extension) {
                case 'tar': {
                    // handle .pth.tar
                    const torch = [ 0x8a, 0x0a, 0x6c, 0xfc, 0x9c, 0x46, 0xf9, 0x20, 0x6a, 0xa8, 0x50, 0x19 ];
                    if (!buffer || buffer.length < 14 || buffer[0] != 0x80 || !torch.every((v, i) => v == buffer[i + 2])) {
                        archive = new tar.Archive(buffer);
                    }
                    break;
                }
                case 'zip': {
                    archive = new zip.Archive(buffer);
                    break;
                }
            }
        }
        catch (error) {
            let message = error && error.message ? error.message : error.toString();
            message = message.endsWith('.') ? message.substring(0, message.length - 1) : message;
            return Promise.reject(new ArchiveError(message + " in '" + identifier + "'."));
        }

        if (!archive) {
            return Promise.resolve(context);
        }

        try {
            let folders = {};
            for (const entry of archive.entries) {
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
            let entries = archive.entries.slice();
            const sourceContext = context;
            const nextEntry = () => {
                if (entries.length > 0) {
                    const entry = entries.shift();
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
                        return Promise.resolve(sourceContext);
                        // return Promise.reject(new ArchiveError('Archive does not contain model file.'));
                    }
                    else if (matches.length > 1) {
                        if (matches.length == 2 &&
                            matches.some((e) => e.name.endsWith('.params')) &&
                            matches.some((e) => e.name.endsWith('-symbol.json'))) {
                            matches = matches.filter((e) => e.name.endsWith('.params'));
                        }
                        else {
                            return Promise.reject(new ArchiveError('Archive contains multiple model files.'));
                        }
                    }
                    const match = matches[0];
                    return Promise.resolve(new ModelContext(new ArchiveContext(archive.entries, rootFolder, match.name, match.data)));
                }
            };
            return nextEntry();
        }
        catch (error) {
            return Promise.reject(new ArchiveError(error.message));
        }
    }

    accept(identifier) {
        identifier = identifier.toLowerCase();
        for (const extension of this._extensions) {
            if (identifier.endsWith(extension.extension)) {
                return true;
            }
        }
        if (identifier.endsWith('.zip') ||
            identifier.endsWith('.tar') ||
            identifier.endsWith('.tar.gz') ||
            identifier.endsWith('.tgz')) {
            return true;
        }
        return false;
    }

    _filter(context) {
        let moduleList = [];
        let moduleMap = {};
        const identifier = context.identifier.toLowerCase();
        for (const extension of this._extensions) {
            if (identifier.endsWith(extension.extension)) {
                if (!moduleMap[extension.id]) {
                    moduleList.push(extension.id);
                    moduleMap[extension.id] = true;
                }
            }
        }
        return moduleList;
    }
};

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports.View = view.View;
    module.exports.ModelFactoryService = view.ModelFactoryService;
}
