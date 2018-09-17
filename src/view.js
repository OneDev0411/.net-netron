/*jshint esversion: 6 */

class View {

    constructor(host) {
        this._host = host;
        this._model = null;
        this._selection = [];
        this._sidebar = new Sidebar();
        this._host.initialize(this);
        this._showDetails = true;
        this._showNames = false;
        this._searchText = '';
        document.documentElement.style.overflow = 'hidden';
        document.body.scroll = 'no';        
        document.getElementById('model-properties-button').addEventListener('click', (e) => {
            this.showModelProperties();
        });
        document.getElementById('zoom-in-button').addEventListener('click', (e) => {
            this.zoomIn();
        });
        document.getElementById('zoom-out-button').addEventListener('click', (e) => {
            this.zoomOut();
        });
        document.getElementById('toolbar').addEventListener('mousewheel', (e) => {
            this.preventZoom(e);
        });
        document.getElementById('sidebar').addEventListener('mousewheel', (e) => {
            this.preventZoom(e);
        });
        document.addEventListener('keydown', (e) => {
            this.clearSelection();
        });
    }
    
    show(page) {

        if (!page) {
            page = (!this._model && !this._activeGraph) ? 'Welcome' : 'Graph';
        }

        this._host.screen(page);

        this._sidebar.close();

        var welcomeElement = document.getElementById('welcome');
        var openFileButton = document.getElementById('open-file-button');
        var spinnerElement = document.getElementById('spinner');
        var graphElement = document.getElementById('graph');
        var toolbarElement = document.getElementById('toolbar');
    
        if (page == 'Welcome') {
            document.body.style.cursor = 'default';
            welcomeElement.style.display = 'block';
            openFileButton.style.display = 'block';
            openFileButton.style.opacity = 1;
            spinnerElement.style.display = 'none';
            graphElement.style.display = 'none';
            graphElement.style.opacity = 0;
            toolbarElement.style.display = 'none';
        }

        if (page == 'Spinner') {
            document.body.style.cursor = 'wait';
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
            spinnerElement.style.display = 'none';
            graphElement.style.display = 'block';
            graphElement.style.opacity = 1;
            toolbarElement.style.display = 'block';
            document.body.style.cursor = 'default';
        }
    }

    cut() {
        document.execCommand('cut');
    }

    copy() {
        document.execCommand('copy');
    }

    paste() {
        document.execCommand('paste');
    }

    selectAll() {
        document.execCommand('selectall');
    }

    find() {
        if (this._activeGraph) {
            this.clearSelection();
            var graphElement = document.getElementById('graph');
            var view = new FindView(graphElement, this._activeGraph);
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

    toggleDetails() {
        this._showDetails = !this._showDetails;
        this.show('Spinner');
        this.updateGraph(this._model, this._activeGraph, (err) => {
            if (err) {
                this.error('Graph update failed.', err);
            }
        });
    }

    get showDetails() {
        return this._showDetails;
    }

    toggleNames() {
        this._showNames = !this._showNames;
        this.show('Spinner');
        this.updateGraph(this._model, this._activeGraph, (err) => {
            if (err) {
                this.error('Graph update failed.', err);
            }
        });
    }

    get showNames() {
        return this._showNames;
    }

    zoomIn() {
        if (this._zoom) {
            this._zoom.scaleBy(d3.select(document.getElementById('graph')), 1.2);
        }
    }

    zoomOut() {
        if (this._zoom) {
            this._zoom.scaleBy(d3.select(document.getElementById('graph')), 0.8);
        }
    }

    resetZoom() { 
        if (this._zoom) {
            this._zoom.scaleTo(d3.select(document.getElementById('graph')), 1);
        }
    }

    preventZoom(e) {
        if (e.shiftKey || e.ctrlKey) {
            e.preventDefault();
        }
    }

    select(selection) {
        this.clearSelection();
        if (selection && selection.length > 0) {
            var graphElement = document.getElementById('graph');
            var graphRect = graphElement.getBoundingClientRect();
            var x = 0;
            var y = 0;
            selection.forEach((element) => {
                var classAttribute = element.getAttribute('class');
                var classList = classAttribute ? classAttribute.split(' ') : [];
                classList.push('select');
                element.setAttribute('class', classList.join(' '));
                this._selection.push(element);
                var box = element.getBBox();
                var ex = box.x + (box.width / 2);
                var ey = box.y + (box.height / 2);
                var transform = element.transform.baseVal.consolidate();
                if (transform) {
                    ex = transform.matrix.e;
                    ey = transform.matrix.f;
                }
                x += ex;
                y += ey;
            });
            x = x / selection.length;
            y = y / selection.length;
            this._zoom.transform(d3.select(graphElement), d3.zoomIdentity.translate((graphRect.width / 2) - x, (graphRect.height / 2) - y));        
        }
    }

    clearSelection() {
        while (this._selection.length > 0) {
            var element = this._selection.pop();
            var classes = element.getAttribute('class').split(' ');
            classes = classes.filter((className) => className != 'select');
            element.setAttribute('class', classes.join(' '));
        }
    }

    loadContext(context, callback) {
        var modelFactoryRegistry = [
            new OnnxModelFactory(),
            new MXNetModelFactory(),
            new KerasModelFactory(),
            new CoreMLModelFactory(),
            new CaffeModelFactory(),
            new Caffe2ModelFactory(), 
            new PyTorchModelFactory(),
            new TensorFlowLiteModelFactory(),
            new TensorFlowModelFactory(),
            new SklearnModelFactory()
        ];

        try {
            var extension;
            var archive;
            var entry;
    
            var identifier = context.identifier;
            var buffer = context.buffer;

            extension = identifier.split('.').pop();
            if (extension == 'gz' || extension == 'tgz') {
                archive = new gzip.Archive(buffer, this._host.inflateRaw);
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
    
            switch (identifier.split('.').pop()) {
                case 'tar':
                    archive = new tar.Archive(buffer);
                    break;
                case 'zip':
                    archive = new zip.Archive(buffer);
                    break;           
            }
    
            if (archive) {
                var folders = {};
                archive.entries.forEach((entry) => {
                    if (entry.name.indexOf('/') != -1) {
                        folders[entry.name.split('/').shift() + '/'] = true;
                    }
                    else {
                        folders['/'] = true;    
                    }
                });
                var rootFolder = Object.keys(folders).length == 1 ? Object.keys(folders)[0] : '';
                rootFolder = rootFolder == '/' ? '' : rootFolder;
                var entries = archive.entries.filter((entry) => {
                    if (entry.name.startsWith(rootFolder)) {
                        var identifier = entry.name.substring(rootFolder.length);
                        if (identifier.length > 0 && identifier.indexOf('/') < 0) {
                            return modelFactoryRegistry.some((factory) => factory.match(new ArchiveContext(null, rootFolder, identifier, entry.data)));
                        }
                    }
                    return false;
                });
                if (entries.length == 0) {
                    callback(new ArchiveError('Root does not contain model file.'), null);
                    return;
                }
                else if (entries.length > 1) {
                    callback(new ArchiveError('Root contains multiple model files.'), null);
                    return;
                }
                else {
                    entry = entries[0];
                    context = new ArchiveContext(entries, rootFolder, entry.name, entry.data);
                }
            }
        }
        catch (err) {
            callback(new ArchiveError(err.message), null);
            return;
        }

        var factoryList = modelFactoryRegistry.filter((factory) => factory.match(context));
        var next = () => {
            if (factoryList.length > 0) {
                var modelFactory = factoryList.shift();
                modelFactory.open(context, this._host, (err, model) => {
                    if (model || factoryList.length == 0) {
                        callback(err, model);
                    }
                    else {
                        next();
                    }
                });
            }
            else {
                var extension = context.identifier.split('.').pop();
                switch (extension) {
                    case 'json':
                    case 'pb':
                        callback(new Error('Unsupported file content for extension \'.' + extension + '\'.'), null);
                        break;
                    default:
                        callback(new Error('Unsupported file extension \'.' + extension + '\'.'), null);
                        break;
                }
            }
        };
        next();
    }

    error(message, err) {
        this._sidebar.close();
        this.exception(err, false);
        this._host.error(message, err.toString());
        this.show('Welcome');
    }

    openContext(context, callback) {
        this._host.event('Model', 'Open', 'Size', context.buffer.length);
        this._sidebar.close();
        setTimeout(() => {
            this.loadContext(context, (err, model) => {
                if (err) {
                    callback(err);
                }
                else {
                    var format = model.format;
                    if (format) {
                        format = format + (model.producer ? ' (' + model.producer + ')' : '');
                        this._host.event('Model', 'Format', format);
                    }

                    setTimeout(() => {
                        var graph = model.graphs.length > 0 ? model.graphs[0] : null;
                        this.updateGraph(model, graph, (err, model) => {
                            callback(err, model);
                        });
                    }, 20);   
                }
            });    
        }, 2);
    }

    updateActiveGraph(name) {
        this._sidebar.close();
        if (this._model) {
            var model = this._model;
            var graph = model.graphs.filter(graph => name == graph.name).shift();
            if (graph) {
                this.show('Spinner');
                setTimeout(() => {
                    this.updateGraph(model, graph, (err, model) => {
                        if (err) {
                            this.error('Graph update failed.', err);
                        }
                    });
                }, 200);
            }
        }
    }

    updateGraph(model, graph, callback) {
        setTimeout(() => {
            if (graph && graph != this._activeGraph) {
                var nodes = graph.nodes;
                if (nodes.length > 1500) {
                    if (!this._host.confirm('Large model detected.', 'This graph contains a large number of nodes and might take a long time to render. Do you want to continue?')) {
                        this._host.event('Graph', 'Render', 'Skip', nodes.length);
                        this.show(null);
                        callback(null, null);
                        return;
                    }  
                }
            }

            this.renderGraph(graph, (err) => {
                if (err) {
                    this.renderGraph(this._activeGraph, (nestedError) => {
                        if (nestedError) {
                            this._model = null;
                            this._activeGraph = null;
                            this.show('Welcome');
                        }
                        else {
                            this.show('Graph');
                        }
                        callback(err, this._model);
                    });
                }
                else {
                    this._model = model;
                    this._activeGraph = graph;
                    this.show('Graph');
                    callback(null, this._model);
                }
            });
        }, 100);
    }

    renderGraph(graph, callback) {
        try {
            if (!graph) {
                callback(null);
            }
            else {
                var graphElement = document.getElementById('graph');
                while (graphElement.lastChild) {
                    graphElement.removeChild(graphElement.lastChild);
                }
    
                this._zoom = null;
    
                var groups = graph.groups;
    
                var graphOptions = {};
                if (!this._showDetails) {
                    graphOptions.nodesep = 25;
                    graphOptions.ranksep = 25;
                }
    
                var g = new dagre.graphlib.Graph({ compound: groups });
                g.setGraph(graphOptions);
                g.setDefaultEdgeLabel(() => { return {}; });
            
                var nodeId = 0;
                var edgeMap = {};
            
                var clusterMap = {};
                var clusterParentMap = {};
    
                var id = new Date().getTime();
                var nodes = graph.nodes;
        
                this._host.event('Graph', 'Render', 'Size', nodes.length);

                if (groups) {
                    nodes.forEach((node) => {
                        if (node.group) {
                            var path = node.group.split('/');
                            while (path.length > 0) {
                                var name = path.join('/');
                                path.pop();
                                clusterParentMap[name] = path.join('/');
                            }
                        }
                    });
                }
    
                nodes.forEach((node) => {
    
                    var formatter = new NodeFormatter();

                    function addOperator(view, formatter, node) {
                        if (node) {
                            var styles = [ 'node-item-operator' ];
                            var category = node.category;
                            if (category) {
                                styles.push('node-item-operator-' + category.toLowerCase());
                            }
                            var text = view.showNames && node.name ? node.name : (node.primitive ? node.primitive : node.operator);
                            var title = view.showNames && node.name ? node.operator : node.name;
                            formatter.addItem(text, null, styles, title, () => { 
                                view.showNodeProperties(node, null);
                            });
                        }
                    }
    
                    addOperator(this, formatter, node);
                    addOperator(this, formatter, node.inner);
            
                    var primitive = node.primitive;
            
                    var hiddenInputs = false;
                    var hiddenInitializers = false;
            
                    node.inputs.forEach((input) => {
                        // TODO what about mixed input & initializer
                        if (input.connections.length > 0) {
                            var initializers = input.connections.filter(connection => connection.initializer);
                            var inputId = null;
                            var inputClass = 'node-item-input';
                            if (initializers.length == 0) {
                                inputClass = 'node-item-input';
                                if (!input.visible) {
                                    hiddenInputs = true;
                                }
                            }
                            else {
                                if (initializers.length == 1) {
                                    inputId = 'initializer-' + initializers[0].initializer.name;
                                }
                                if (initializers.length == input.connections.length) {
                                    inputClass = 'node-item-constant';
                                    if (!input.visible) {
                                        hiddenInitializers = true;
                                    }
                                }
                                else {
                                    inputClass = 'node-item-constant';
                                    if (!input.visible) {
                                        hiddenInputs = true;
                                    }
                                }
                            }
            
                            if (this._showDetails) {
                                if (input.visible) {
                                    var types = input.connections.map(connection => connection.type || '').join('\n');
                                    formatter.addItem(input.name, inputId, [ inputClass ], types, () => {
                                        this.showNodeProperties(node, input);
                                    });    
                                }
                            }
            
                            input.connections.forEach((connection) => {
                                if (!connection.initializer) {
                                    var tuple = edgeMap[connection.id];
                                    if (!tuple) {
                                        tuple = { from: null, to: [] };
                                        edgeMap[connection.id] = tuple;
                                    }
                                    tuple.to.push({ 
                                        node: nodeId, 
                                        name: input.name
                                    });
                                }
                            });    
                        }
                    });
            
                    if (this._showDetails) {
                        if (hiddenInputs) {
                            formatter.addItem('...', null, [ 'node-item-input' ], '', () => {
                                this.showNodeProperties(node, null);
                            });    
                        }
                        if (hiddenInitializers) {
                            formatter.addItem('...', null, [ 'node-item-constant' ], '', () => {
                                this.showNodeProperties(node, null);
                            });    
                        }
                    }
            
                    node.outputs.forEach((output) => {
                        output.connections.forEach((connection) => {
                            var tuple = edgeMap[connection.id];
                            if (!tuple) {
                                tuple = { from: null, to: [] };
                                edgeMap[connection.id] = tuple;
                            }
                            tuple.from = { 
                                node: nodeId,
                                name: output.name,
                                type: connection.type
                            };
                        });
                    });
            
                    var dependencies = node.dependencies;
                    if (dependencies && dependencies.length > 0) {
                        formatter.setControlDependencies();
                    }
            
                    if (this._showDetails) {
                        var attributes = node.attributes; 
                        if (attributes && !primitive) {
                            formatter.setAttributeHandler(() => { 
                                this.showNodeProperties(node, null);
                            });
                            attributes.forEach((attribute) => {
                                if (attribute.visible) {
                                    var attributeValue = '';
                                    if (attribute.tensor) {
                                        attributeValue = '[...]';
                                    }
                                    else {
                                        attributeValue = attribute.value;
                                        if (attributeValue && attributeValue.length > 25) {
                                            attributeValue = attributeValue.substring(0, 25) + '...';
                                        }
                                    }
                                    formatter.addAttribute(attribute.name, attributeValue, attribute.type);
                                }
                            });
                        }
                    }
    
                    var name = node.name;
                    if (name) {
                        g.setNode(nodeId, { label: formatter.format(graphElement), id: 'node-' + name });
                    }
                    else {
                        g.setNode(nodeId, { label: formatter.format(graphElement), id: 'node-' + id.toString() });
                        id++;
                    }
            
                    function createCluster(name) {
                        if (!clusterMap[name]) {
                            g.setNode(name, { rx: 5, ry: 5});
                            clusterMap[name] = true;
                            var parent = clusterParentMap[name];
                            if (parent) {
                                createCluster(parent);
                                g.setParent(name, parent);
                            }
                        }
                    }
    
                    if (groups) {
                        var groupName = node.group;
                        if (groupName && groupName.length > 0) {
                            if (!clusterParentMap.hasOwnProperty(groupName)) {
                                var lastIndex = groupName.lastIndexOf('/');
                                if (lastIndex != -1) {
                                    groupName = groupName.substring(0, lastIndex);
                                    if (!clusterParentMap.hasOwnProperty(groupName)) {
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
                });
            
                graph.inputs.forEach((input) => {
                    input.connections.forEach((connection) => {
                        var tuple = edgeMap[connection.id];
                        if (!tuple) {
                            tuple = { from: null, to: [] };
                            edgeMap[connection.id] = tuple;
                        }
                        tuple.from = { 
                            node: nodeId,
                            type: connection.type
                        };    
                    });
                    var types = input.connections.map(connection => connection.type || '').join('\n');
    
                    var formatter = new NodeFormatter();
                    formatter.addItem(input.name, null, [ 'graph-item-input' ], types, () => {
                        this.showModelProperties();
                    });
                    g.setNode(nodeId++, { label: formatter.format(graphElement), class: 'graph-input' } ); 
                });
            
                graph.outputs.forEach((output) => {
                    output.connections.forEach((connection) => {
                        var tuple = edgeMap[connection.id];
                        if (!tuple) {
                            tuple = { from: null, to: [] };
                            edgeMap[connection.id] = tuple;
                        }
                        tuple.to.push({ node: nodeId });
                    });
                    var types = output.connections.map(connection => connection.type || '').join('\n');
            
                    var formatter = new NodeFormatter();
                    formatter.addItem(output.name, null, [ 'graph-item-output' ], types, () => {
                        this.showModelProperties();
                    });
                    g.setNode(nodeId++, { label: formatter.format(graphElement) } ); 
                });
            
                Object.keys(edgeMap).forEach((edge) => {
                    var tuple = edgeMap[edge];
                    if (tuple.from != null) {
                        tuple.to.forEach((to) => {
                            var text = '';
                            if (tuple.from.type && tuple.from.type.shape && tuple.from.type.shape.length > 0) {
                                text = tuple.from.type.shape.join('\u00D7');
                            }
                            else if (tuple.from.name && to.name) {
                                text = tuple.from.name + ' \u21E8 ' + to.name;
                            }
                            else if (tuple.from.name) {
                                text = tuple.from.name;
                            }
                            else {
                                text = to.name;
                            }
            
                            if (this._showNames) {
                                text = edge.split('\n').shift(); // custom connection id
                            }
                            if (!this._showDetails) {
                                text = '';
                            }
    
                            if (to.dependency) { 
                                g.setEdge(tuple.from.node, to.node, { label: text, id: 'edge-' + edge, arrowhead: 'vee', class: 'edge-path-control' } );
                            }
                            else {
                                g.setEdge(tuple.from.node, to.node, { label: text, id: 'edge-' + edge, arrowhead: 'vee' } );
                            }
                        });
                    }
                });
            
                // Workaround for Safari background drag/zoom issue:
                // https://stackoverflow.com/questions/40887193/d3-js-zoom-is-not-working-with-mousewheel-in-safari
                var backgroundElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                backgroundElement.setAttribute('id', 'background');
                backgroundElement.setAttribute('width', '100%');
                backgroundElement.setAttribute('height', '100%');
                backgroundElement.setAttribute('fill', 'none');
                backgroundElement.setAttribute('pointer-events', 'all');
                graphElement.appendChild(backgroundElement);
            
                var originElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                originElement.setAttribute('id', 'origin');
                graphElement.appendChild(originElement);
            
                // Set up zoom support
                var svg = d3.select(graphElement);
                this._zoom = d3.zoom();
                this._zoom(svg);
                this._zoom.scaleExtent([0.1, 2]);
                this._zoom.on('zoom', (e) => {
                    originElement.setAttribute('transform', d3.event.transform.toString());
                });
                this._zoom.transform(svg, d3.zoomIdentity);

                setTimeout(() => {
                    try {
                        var graphRenderer = new GraphRenderer(originElement);
                        graphRenderer.render(g);
            
                        var svgSize = graphElement.getBoundingClientRect();
            
                        var inputElements = graphElement.getElementsByClassName('graph-input');
                        if (inputElements && inputElements.length > 0) {
                            // Center view based on input elements
                            var xs = [];
                            var ys = [];
                            for (var i = 0; i < inputElements.length; i++) {
                                var inputTransform = inputElements[i].transform.baseVal.consolidate().matrix;
                                xs.push(inputTransform.e);
                                ys.push(inputTransform.f);
                            }
                            var x = xs[0];
                            var y = ys[0];
                            if (ys.every(y => y == ys[0])) {
                                x = xs.reduce((a,b) => { return a + b; }) / xs.length;
                            }
                            this._zoom.transform(svg, d3.zoomIdentity.translate((svgSize.width / 2) - x, (svgSize.height / 4) - y));
                        }
                        else {
                            this._zoom.transform(svg, d3.zoomIdentity.translate((svgSize.width - g.graph().width) / 2, (svgSize.height - g.graph().height) / 2));
                        }

                        callback(null);
                    }
                    catch (err) {
                        callback(err);
                    }
                }, 20);
            }
        }
        catch (err) {
            callback(err);
        }
    }

    transferStyleSheet(element, name) {
        var styles = [];
        for (var styleSheet of document.styleSheets) {
            if (styleSheet && styleSheet.href && styleSheet.href.endsWith('/' + name)) {
                for (var rule of styleSheet.rules) {
                    styles.push(rule.cssText);
                }
            }
        }
        var defsElement = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defsElement.innerHTML = '<style type="text/css">' + styles.join('\n') + '\n</style>';
        element.insertBefore(defsElement, element.firstChild);
    }

    applyStyleSheet(element, name) {
        var rules = [];
        for (var styleSheet of document.styleSheets) {
            if (styleSheet && styleSheet.href && styleSheet.href.endsWith('/' + name)) {
                rules = styleSheet.rules;
            }
        }
        var nodes = element.getElementsByTagName('*');
        for (var node of nodes) {
            for (var rule of rules) {
                if (node.matches(rule.selectorText)) {
                    for (var k = 0; k < rule.style.length; k++) {
                        var item = rule.style.item(k);
                        node.style[item] = rule.style[item];
                    }
                }
            }
        }
    }

    export(file) {
        var extension = '';
        var lastIndex = file.lastIndexOf('.');
        if (lastIndex != -1) {
            extension = file.substring(lastIndex + 1);
        }
        if (extension == 'png' || extension == 'svg') {
            var graphElement = document.getElementById('graph');
            var exportElement = graphElement.cloneNode(true);
            switch (extension) {
                case 'png':
                    this.transferStyleSheet(exportElement, 'view-render.css');
                    break;
                case 'svg':
                    this.applyStyleSheet(exportElement, 'view-render.css');
                    break;
            }
            exportElement.setAttribute('id', 'export');
            exportElement.removeAttribute('width');
            exportElement.removeAttribute('height');
            exportElement.style.removeProperty('opacity');
            exportElement.style.removeProperty('display');
            var originElement = exportElement.getElementById('origin');
            originElement.setAttribute('transform', 'translate(0,0) scale(1)');
            var backgroundElement = exportElement.getElementById('background');
            backgroundElement.removeAttribute('width');
            backgroundElement.removeAttribute('height');
    
            var parentElement = graphElement.parentElement;
            parentElement.insertBefore(exportElement, graphElement);
            var size = exportElement.getBBox();
            parentElement.removeChild(exportElement);
            parentElement.removeChild(graphElement);
            parentElement.appendChild(graphElement);

            var delta = (Math.min(size.width, size.height) / 2.0) * 0.1;
            var width = Math.ceil(delta + size.width + delta);
            var height = Math.ceil(delta + size.height + delta);
            originElement.setAttribute('transform', 'translate(' + delta.toString() + ', ' + delta.toString() + ') scale(1)');
            exportElement.setAttribute('width', width);
            exportElement.setAttribute('height', height);
            backgroundElement.setAttribute('width', width);
            backgroundElement.setAttribute('height', height);
            backgroundElement.setAttribute('fill', '#fff');
    
            var data = new XMLSerializer().serializeToString(exportElement);
    
            if (extension == 'svg') {
                this._host.export(file, data, 'image/svg');
            }
    
            if (extension == 'png') {
                var imageElement = new Image();
                document.body.insertBefore(imageElement, document.body.firstChild);
                imageElement.onload = () => {
                    var max = Math.max(width, height);
                    var scale = ((max * 2.0) > 24000) ? (24000.0 / max) : 2.0;
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.ceil(width * scale);
                    canvas.height = Math.ceil(height * scale);    
                    var context = canvas.getContext('2d');
                    context.scale(scale, scale);
                    context.drawImage(imageElement, 0, 0);
                    document.body.removeChild(imageElement);
                    var pngBase64 = canvas.toDataURL('image/png');
                    this._host.export(file, pngBase64, 'image/png');
                };
                imageElement.src = 'data:image/svg+xml;base64,' + window.btoa(unescape(encodeURIComponent(data)));
            }
        }
    }

    showModelProperties() {
        if (this._model) {
            var view = new ModelView(this._model);
            view.on('update-active-graph', (sender, name) => {
                this.updateActiveGraph(name);
            });
            this._sidebar.open(view.elements, 'Model Properties');
        }
    }
    
    showNodeProperties(node, input) {
        if (node) {
            var view = new NodeView(node, this._host);
            view.on('show-documentation', (sender, e) => {
                this.showOperatorDocumentation(node);
            });
            view.on('export-tensor', (sender, tensor) => {
                this._host.require('numpy', (err) => {
                    if (!err) {
                        var defaultPath = tensor.name ? tensor.name.split('/').join('_').split(':').join('_').split('.').join('_') : 'tensor';
                        this._host.save('NumPy Array', 'npy', defaultPath, (file) => {
                            var array = new numpy.Array(tensor.value, tensor.type.dataType, tensor.type.shape);
                            this._host.export(file, array.toBuffer(), null);
                        });
                    }
                });
            });
            if (input) {
                view.toggleInput(input.name);
            }
            this._sidebar.open(view.elements, 'Node Properties');
        }
    }

    showOperatorDocumentation(node) {
        var documentation = node.documentation;
        if (documentation) {
            var view = new OperatorDocumentationView(documentation);
            view.on('navigate', (sender, e) => {
                this._host.openURL(e.link);
            });
            this._sidebar.open(view.elements, 'Documentation');
        }
    }
}

window.view = new View(window.host);

class Int64 {

    constructor(buffer) {
        this._buffer = buffer;
    }

    toString(radix) {
        var high = this._readInt32(4);
        var low = this._readInt32(0);
        var str = '';
        var sign = high & 0x80000000;
        if (sign) {
            high = ~high;
            low = 0x100000000 - low;
        }
        radix = radix || 10;
        while (true) {
            var mod = (high % radix) * 0x100000000 + low;
            high = Math.floor(high / radix);
            low = Math.floor(mod / radix);
            str = (mod % radix).toString(radix) + str;
            if (!high && !low) 
            {
                break;
            }
        }
        if (sign) {
            str = "-" + str;
        }
        return str;
    }

    toBuffer() {
        return this._buffer;
    }

    _readInt32(offset) {
      return (this._buffer[offset + 3] * 0x1000000) + (this._buffer[offset + 2] << 16) + (this._buffer[offset + 1] << 8) + this._buffer[offset + 0];
    }
}

class Uint64 {

    constructor(buffer) {
        this._buffer = buffer;
    }

    toString(radix) {
        var high = this._readInt32(4);
        var low = this._readInt32(0);
        var str = '';
        radix = radix || 10;
        while (true) {
            var mod = (high % radix) * 0x100000000 + low;
            high = Math.floor(high / radix);
            low = Math.floor(mod / radix);
            str = (mod % radix).toString(radix) + str;
            if (!high && !low) 
            {
                break;
            }
        }
        return str;
    }

    toBuffer() {
        return this._buffer;
    }

    _readInt32(offset) {
        return (this._buffer[offset + 3] * 0x1000000) + (this._buffer[offset + 2] << 16) + (this._buffer[offset + 1] << 8) + this._buffer[offset + 0];
    }
}

class ArchiveContext {

    constructor(entries, rootFolder, identifier, buffer) {
        this._entries = {};
        if (entries) {
            entries.forEach((entry) => {
                if (entry.name.startsWith(rootFolder)) {
                    var name = entry.name.substring(rootFolder.length);
                    if (identifier.length > 0 && identifier.indexOf('/') < 0) {
                        this._entries[name] = entry;
                    }
                }
            });
        }
        this._identifier = identifier;
        this._buffer = buffer;
    }

    request(file, encoding, callback) {
        var entry = this._entries[file];
        if (!entry) {
            callback(new Error('File not found.'), null);
            return;
        }
        var data = entry.data;
        if (type != null) {
            data = new TextDecoder(encoding).decode(data);
        }
        callback(null, data);
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
        this.name = "Error loading archive";
    }
}
