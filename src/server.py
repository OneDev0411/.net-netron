
import codecs
import errno
import os
import platform
import sys
import threading
import webbrowser
import time

from .__version__ import __version__

if sys.version_info[0] > 2:
    from urllib.parse import urlparse
    from http.server import HTTPServer
    from http.server import BaseHTTPRequestHandler
    from socketserver import ThreadingMixIn
else:
    from urlparse import urlparse
    from BaseHTTPServer import HTTPServer
    from BaseHTTPServer import BaseHTTPRequestHandler
    from SocketServer import ThreadingMixIn

class HTTPRequestHandler(BaseHTTPRequestHandler):
    def handler(self):
        if not hasattr(self, 'mime_types_map'):
            self.mime_types_map = {
                '.html': 'text/html',
                '.js':   'text/javascript',
                '.css':  'text/css',
                '.png':  'image/png',
                '.gif':  'image/gif',
                '.jpg':  'image/jpeg',
                '.ico':  'image/x-icon',
                '.json': 'application/json',
                '.pb': 'application/octet-stream',
                '.ttf': 'font/truetype',
                '.otf': 'font/opentype',
                '.eot': 'application/vnd.ms-fontobject',
                '.woff': 'font/woff',
                '.woff2': 'application/font-woff2',
                '.svg': 'image/svg+xml'
            }
        pathname = urlparse(self.path).path
        folder = os.path.dirname(os.path.realpath(__file__))
        location = folder + pathname
        status_code = 0
        headers = {}
        buffer = None
        data = '/data/'
        if status_code == 0:
            if pathname == '/':
                meta = []
                meta.append("<meta name='type' content='Python' />")
                if __version__:
                    meta.append("<meta name='version' content='" + __version__ + "' />")
                if self.file:
                    meta.append("<meta name='file' content='/data/" + self.file + "' />")
                with codecs.open(location + 'view-browser.html', mode="r", encoding="utf-8") as open_file:
                    buffer = open_file.read()
                buffer = buffer.replace('<!-- meta -->', '\n'.join(meta))
                buffer = buffer.encode('utf-8')
                headers['Content-Type'] = 'text/html'
                headers['Content-Length'] = len(buffer)
                status_code = 200
            elif pathname.startswith(data):
                file = pathname[len(data):]
                if file == self.file and self.data:
                    buffer = self.data
                else:
                    file = self.folder + '/' + file
                    status_code = 404
                    if os.path.exists(file):
                        with open(file, 'rb') as binary:
                            buffer = binary.read()
                if buffer:
                    headers['Content-Type'] = 'application/octet-stream'
                    headers['Content-Length'] = len(buffer)
                    status_code = 200
            else:
                if os.path.exists(location) and not os.path.isdir(location):
                    extension = os.path.splitext(location)[1]
                    content_type = self.mime_types_map[extension]
                    if content_type:
                        with open(location, 'rb') as binary:
                            buffer = binary.read()
                        headers['Content-Type'] = content_type
                        headers['Content-Length'] = len(buffer)
                        status_code = 200
                else:
                    status_code = 404
        if self.verbose:
            sys.stdout.write(str(status_code) + ' ' + self.command + ' ' + self.path + '\n')
        sys.stdout.flush()
        self.send_response(status_code)
        for key in headers:
            self.send_header(key, headers[key])
        self.end_headers()
        if self.command != 'HEAD':
            if status_code == 404 and buffer is None:
                self.wfile.write(bytes(status_code))
            elif (status_code == 200 or status_code == 404) and buffer != None:
                self.wfile.write(buffer)
        return
    def do_GET(self):
        self.handler()
    def do_HEAD(self):
        self.handler()
    def log_message(self, format, *args):
        return

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):

class HTTPServerThread(threading.Thread):
    def __init__(self, data, file, verbose, browse, port, host):
        threading.Thread.__init__(self)
        self.port = port
        self.host = host
        self.file = file
        self.url = 'http://' + host + ':' + str(port)
        self.browse = browse
        self.server = ThreadedHTTPServer((host, port), HTTPRequestHandler)
        self.server.timeout = 0.25
        if file:
            self.server.RequestHandlerClass.folder = os.path.dirname(file) if os.path.dirname(file) else '.'
            self.server.RequestHandlerClass.file = os.path.basename(file)
        else:
            self.server.RequestHandlerClass.folder = ''
            self.server.RequestHandlerClass.file = ''
        self.server.RequestHandlerClass.data = data
        self.server.RequestHandlerClass.verbose = verbose
        self.terminate_event = threading.Event()
        self.terminate_event.set()
        self.stop_event = threading.Event()

    def run(self):
        self.terminate_event.clear()
        self.stop_event.clear()
        if self.file:
            sys.stdout.write("Serving '" + self.file + "' at " + self.url + "\n")
        else:
            sys.stdout.write("Serving at " + self.url + "\n")
        try:
            while not self.stop_event.is_set():
                if self.browse:
                    self.browse = False
                    threading.Timer(1, webbrowser.open, args=(self.url,)).start()
                sys.stdout.flush()
                self.server.handle_request()
        except Exception as e:
            pass
        self.terminate_event.set()
        self.stop_event.clear()

    def stop(self):
        if self.alive():
            sys.stdout.write("\nStopping " + self.url + "\n")
            self.stop_event.set()
            self.server.server_close()
            self.terminate_event.wait(1000)

    def alive(self):
        return not self.terminate_event.is_set()

thread_list = []

def stop(port=8080, host=''):
    '''Stop serving model at host:port.

    Args:
        port (int, optional): port to stop. Default: 8080
        host (string, optional): host to stop. Default: ''
    '''
    global thread_list
    for thread in thread_list:
        if port == thread.port and host == thread.host:
            thread.stop()
    thread_list = [ thread for thread in thread_list if thread.alive() ]

def wait():
    '''Wait for console exit and stop all model servers.'''
    global thread_list
    try:
        while len(thread_list) > 0:
            thread_list = [ thread for thread in thread_list if thread.alive() ]
            time.sleep(1000)
    except (KeyboardInterrupt, SystemExit):
        for thread in thread_list:
            thread.stop()
        thread_list = [ thread for thread in thread_list if thread.alive() ]

def serve(file, data, verbose=False, browse=False, port=8080, host=''):
    '''Start serving model from file or data buffer at host:port and open in web browser.
    
    Args:
        file (string): Model file to serve. Required to detect format.
        data (bytes): Model data to serve. None will load data from file.
        verbose (bool, optional): Log details to console. Default: False
        browse (bool, optional): Launch web browser, Default: True
        port (int, optional): Port to serve. Default: 8080
        host (string, optional): Host to serve. Default: ''
    '''
    global thread_list
    if not data and file and not os.path.exists(file):
        raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT), file)
    stop(port, host)
    thread = HTTPServerThread(data, file, verbose, browse, port, host)
    thread.start()
    thread_list.append(thread)
    thread_list = [ thread for thread in thread_list if thread.alive() ]

def start(file, verbose=False, browse=True, port=8080, host=''):
    '''Start serving model file at host:port and open in web browser
    
    Args:
        file (string): Model file to serve.
        verbose (bool, optional): Log details to console. Default: False
        browse (bool, optional): Launch web browser, Default: True
        port (int, optional): Port to serve. Default: 8080
        host (string, optional): Host to serve. Default: ''
    '''
    serve(file, None, verbose=verbose, browse=browse, port=port, host=host)
