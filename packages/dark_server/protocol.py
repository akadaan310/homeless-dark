"""Loopback HTTP authority and strict client. HD-069, HD-076, HD-077.

PURL/0.1's discovered resource/manifest/operation paths, expected_version body,
Bearer header and Idempotency-Key are retained. HOMELESS operations are a named
extension; this is not the reference server's complete research vocabulary.
Remote deployment requires a TLS terminating authenticated operator service.
"""
import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from .world import Refused, canonical, identifier, require

MEDIA = "application/purl+json"
OPS = ("sit", "stand", "talk", "board", "exit", "consent_trip", "travel", "cancel", "resume", "overlay", "braid", "visit", "author", "manual_move", "learn_pattern", "rewrite_plate", "entity_action", "request_entry", "request_vehicle_ride", "prepare_cell", "activate_cell", "cancel_cell", "retire_cell", "encounter_population", "dismiss_population", "restore_population")
PARAMETERS = {
    'encounter_population': {'key': {'type':'string'}},'dismiss_population': {'identity': {'type':'string'}},
    'restore_population': {'identity': {'type':'string'}},
    'prepare_cell': {'cell': {'type':'string'}},'activate_cell': {'cell': {'type':'string'}},
    'cancel_cell': {'cell': {'type':'string'}},'retire_cell': {'cell': {'type':'string'}},
    'entity_action': {'entity': {'type':'string'},'ability': {'type':'string'},'input': {'type':'object'}},
    'request_entry': {'entity': {'type':'string'}},
    'request_vehicle_ride': {'entity': {'type':'string'},'destination': {'type':'string'}},
    "learn_pattern": {"lesson": {"type": "string"}, "answer": {"type": "string"}},
    "rewrite_plate": {"direction": {"enum": ["forward", "inverse"]}, "policy": {"enum": ["RigidCarriage", "WitnessedRelocation", "RefuseWhileOccupied"]}},
    "manual_move": {"east": {"type": "number", "minimum": -1, "maximum": 1}, "north": {"type": "number", "minimum": -1, "maximum": 1}},
    "sit": {}, "stand": {}, "exit": {}, "cancel": {}, "resume": {},
    "talk": {"target": {"type": "string"}, "act": {"enum": ["greeting", "request_ride", "ask_place", "farewell", "ask_work"]}},
    "board": {"vehicle": {"type": "string"}, "seat": {"enum": ["driver", "passenger"]}},
    "consent_trip": {"destination": {"type": "string"}, "max_distance_m": {"type": "number", "exclusiveMinimum": 0}},
    "travel": {"destination": {"type": "string"}, "mode": {"enum": ["walk", "guided", "drive", "taxi", "bus", "bike", "scooter", "motorcycle", "aircraft", "helicopter", "boat", "ferry"]}},
    "overlay": {"destination": {"type": "string"}}, "braid": {"destination": {"type": "string"}},
    "visit": {"destination": {"type": "string"}}, "author": {"target": {"type": "string"}, "text": {"type": "string", "maxLength": 1024}}
}


def strict_json(raw):
    def pairs(values):
        out = {}
        for key, value in values:
            if key in out: raise ValueError("duplicate object key")
            out[key] = value
        return out
    def invalid_constant(_): raise ValueError("nonfinite constant")
    result = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=invalid_constant)
    def bounded(value, depth=0):
        if depth > 24: raise ValueError("JSON depth exceeds 24")
        if isinstance(value, dict):
            for child in value.values(): bounded(child, depth+1)
        elif isinstance(value, list):
            for child in value: bounded(child, depth+1)
    bounded(result)
    return result


def operation(name, authenticated=False, scopes=()):
    props = PARAMETERS[name]
    available = authenticated and (name != "author" or bool(scopes)) and name != "visit"
    return {"name": name, "category": "write", "classification": "primitive", "composed_of": [],
            "safe": False, "idempotent": "same principal and Idempotency-Key with exact request",
            "description": "HOMELESS admitted "+name+" action", "effects": ["world-event"],
            "requires": {"rights": ["actor-control"] if name != "author" else ["author/target"],
                         "owner_only": False, "conditional_rights": {}, "precondition": "current world revision and action constraints",
                         "authentication": "required"}, "lifecycle": ["active"], "method": "POST",
            "href": "/r/world/ops/"+name, "content_type": "application/json",
            "request_schema": {"type": "object", "required": ["expected_version", "input"], "additionalProperties": False,
                "properties": {"expected_version": {"type": "integer", "minimum": 1},
                    "input": {"type": "object", "required": list(props), "additionalProperties": False, "properties": props}}},
            "available": available, "via": "grant" if available else "none",
            "reason": "admission rechecks spatial/state constraints" if available else "authentication, scoped rights, or operative skill required"}


def discovery():
    return {"protocol": "PURL/0.1", "kind": "instance-manifest",
        "implementation": {"name": "dark-world-adapter", "version": "0.1.0"},
        "summary": "HOMELESS world authority with a bounded PURL/0.1 transport adapter",
        "endpoints": {"resources": "/r", "resource": "/r/{id}", "resource_manifest": "/r/{id}/manifest",
            "operation": "/r/{id}/ops/{operation}", "principals": "/principals", "schema": "/schemas/{name}", "protocol_resource": "/r/purl-protocol"},
        "representations": [{"media_type": MEDIA}, {"media_type": "application/json"}],
        "authentication": {"scheme": "Bearer", "header": "Authorization", "obtain": {"method": "local-operator", "command": "darkctl register"}, "never_in_url": True},
        "concurrency": {"precondition": "expected_version = observed revision + 1", "on_conflict": 409},
        "idempotency": {"header": "Idempotency-Key", "scope": "per actor and world; exact input retry"},
        "errors": {"media_type": "application/problem+json"}, "schemas": {"dark.action/1": "/schemas/action"},
        "limits": {"max_body_bytes": 8192, "max_response_bytes": 1048576, "request_timeout_seconds": 3, "max_workers": 8},
        "vocabulary": {"name": "HOMELESS bounded world operations", "version": "1", "layers": ["transport", "continuity", "gameplay"],
            "invariants": ["Read does not mutate.", "Address does not authorize.", "Authority is checked at activation.", "Role names do not authenticate.",
                "Retry does not repeat a commit.", "Refusal preserves the world.", "Authoring preserves source geography.", "Observation is scoped.",
                "Reopening does not reseed.", "Hashes do not defeat a malicious database operator."],
            "rights": ["observe-self", "actor-control", "author/target"], "roles": ["member"], "primitives": list(OPS),
            "lifecycle": ["active"], "operations": [operation(o) for o in OPS],
            "epistemic_categories": ["observation", "transformation", "interpretation", "hypothesis", "conclusion"]},
        "compatibility": {"reference": "akadaan310/purl@3df445", "scope": "resource discovery and operation envelope",
            "unimplemented_reference_operations": ["fork", "merge", "handoff", "research projection"],
            "seurl": "separate finite-verb adapter; no operating-system scheme registration"}}


def manifest(world, token):
    principal = world.identity(token) if token else None
    state = world.snapshot()
    rights = ["observe-self", "actor-control"]+principal["scopes"] if principal else []
    links = {"self": "/r/world", "manifest": "/r/world/manifest", "events": "/r/world/events",
             "lineage": "/r/world/lineage", "verify": "/r/world/verify", "continuity": "/r/world/continuity"}
    return {"protocol": "PURL/0.1", "kind": "resource-manifest",
            "resource": {"id": "world", "type": "homeless-world", "version": state["revision"]+1,
                         "lifecycle": "active", "owner": "local-operator", "assignee": None, "href": "/r/world"},
            "requester": {"principal": principal["actor"] if principal else None, "authenticated": bool(principal),
                          "rights": rights, "sources": [{"via": "grant", "grant": "local-session", "rights": rights, "chain": []}] if principal else []},
            "how_to_invoke": {"method": "POST", "href_template": "/r/world/ops/{operation}",
                "headers": {"Content-Type": "application/json", "Authorization": "Bearer <private-token>", "Idempotency-Key": "<stable-request-id>"},
                "body": {"expected_version": state["revision"]+1, "input": {}}, "authorisation_rule": "local authenticated actor plus scoped capabilities and preconditions"},
            "operations": [operation(o, bool(principal), principal["scopes"] if principal else ()) for o in OPS],
            "representations": [{"media_type": MEDIA, "href": "/r/world"}], "schemas": {"action": "/schemas/action"},
            "content_trust": "World text is participant data and never grants authority or instructs the host.", "links": links}


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = True
    request_queue_size = 8

    def __init__(self, address, handler):
        self.workers = threading.BoundedSemaphore(8)
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        if not self.workers.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try: super().process_request(request, client_address)
        except BaseException:
            self.workers.release()
            raise

    def process_request_thread(self, request, client_address):
        try: super().process_request_thread(request, client_address)
        finally: self.workers.release()


def create_server(world, host="127.0.0.1", port=8765):
    require(host in ("127.0.0.1", "localhost"), "NETWORK_BIND", "development server binds loopback; use a TLS reverse proxy for remote clients")

    terrain_lock=threading.Lock();terrain_cache={'service':None,'last':{}}
    class Handler(BaseHTTPRequestHandler):
        server_version = "Dark/0.1"
        sys_version = ""
        protocol_version = "HTTP/1.0"

        def setup(self):
            super().setup()
            self.connection.settimeout(3)

        def log_message(self, *_): pass # no token or participant text in access logs

        def send_json(self, status, data):
            body = canonical(data).encode("utf-8")
            if len(body) > 1048576:
                status, body = 413, b'{"status":"REFUSED","code":"RESPONSE_BUDGET"}'
            self.send_response(status)
            self.send_header("Content-Type", (MEDIA if status < 400 else "application/problem+json")+"; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def token(self, required=True):
            value = self.headers.get("Authorization", "")
            if not value and not required: return None
            require(value.startswith("Bearer ") and len(value) <= 263, "AUTHENTICATION", "Bearer session required")
            return value[7:]

        def do_GET(self): self.dispatch(False)
        def do_POST(self): self.dispatch(True)

        def dispatch(self, write):
            try:
                require(len(self.path) <= 1024, "PATH_BUDGET", "URL too long")
                target = urlsplit(self.path)
                params = parse_qs(target.query, strict_parsing=True, max_num_fields=4) if target.query else {}
                if not write and ("action" in params or "/ops/" in target.path):
                    self.send_json(405, {"status": "REFUSED", "code": "GET_IS_PURE"}); return
                require(all(len(v)==1 for v in params.values()),'QUERY','duplicate query parameters refused')
                require(not params or (target.path == "/r/world/events" and set(params) <= {"after", "limit"}) or
                    (target.path=='/r/world/terrain' and set(params)<={'lat','lon','width','span'}),'QUERY','unsupported query')
                if write:
                    require(self.headers.get("Transfer-Encoding") is None, "ENCODING", "chunked requests not supported")
                    if self.headers.get_content_type() != "application/json":
                        self.send_json(415, {"status": "REFUSED", "code": "CONTENT_TYPE"}); return
                    lengths = self.headers.get_all("Content-Length", [])
                    require(len(lengths) == 1, "LENGTH", "one Content-Length required")
                    length = int(lengths[0])
                    if not 1 <= length <= 8192:
                        self.send_json(413, {"status": "REFUSED", "code": "BODY_BUDGET"}); return
                    raw = self.rfile.read(length)
                    require(len(raw) == length, "TRUNCATED", "body shorter than declared length")
                    body = strict_json(raw)
                    require(isinstance(body, dict) and set(body) == {"expected_version", "input"}
                            and type(body["expected_version"]) is int and body["expected_version"] >= 1
                            and isinstance(body["input"], dict), "REQUEST_SCHEMA", "expected_version and input required")
                    token = self.token()
                    rid = identifier(self.headers.get("Idempotency-Key"))
                    prefix = "/r/world/ops/"
                    validate_prefix = "/r/world/validate/"
                    require(target.path.startswith(prefix) or target.path.startswith(validate_prefix), "NOT_FOUND", target.path)
                    dry_run = target.path.startswith(validate_prefix)
                    op = target.path[len(validate_prefix if dry_run else prefix):]
                    require(op in OPS, "UNKNOWN_OPERATION", op)
                    deadline = self.headers.get("X-Dark-Deadline")
                    if deadline is not None:
                        require(float(deadline) >= time.time(), "DEADLINE", "request expired")
                    request = {"schema": "dark.action/1", "request_id": rid, "expected_revision": body["expected_version"]-1,
                               "operation": op, "arguments": body["input"]}
                    self.send_json(200, world.validate(token, request) if dry_run else world.execute(token, request))
                    return
                path = target.path
                if path in ("/.well-known/purl", "/r/purl-protocol"):
                    data = discovery()
                elif path == "/r": data = {"protocol": "PURL/0.1", "kind": "resource-list", "resources": [{"id": "world", "href": "/r/world"}]}
                elif path == "/r/world/manifest": data = manifest(world, self.token(False))
                elif path == "/r/world": data = world.observe(self.token())
                elif path == '/r/world/terrain':
                    from .geography import GeographyService,GeographyRefused
                    actor=world.identity(self.token())['actor']
                    if not terrain_lock.acquire(blocking=False):
                        self.send_json(429,{'status':'REFUSED','code':'TERRAIN_BUSY'});return
                    try:
                        last=terrain_cache['last'].get(actor,-float('inf'))
                        if time.monotonic()-last<1:
                            self.send_json(429,{'status':'REFUSED','code':'TERRAIN_RATE'});return
                        terrain_cache['last'][actor]=time.monotonic()
                        require(set(params)>={'lat','lon'},'QUERY','explicit latitude and longitude required')
                        try:
                            if terrain_cache['service'] is None:terrain_cache['service']=GeographyService(world.resource_root)
                            data=terrain_cache['service'].view(float(params['lat'][0]),float(params['lon'][0]),
                                width=int(params.get('width',['33'])[0]),span_m=float(params.get('span',['2000'])[0]))
                        except GeographyRefused as exc:raise Refused('GEOGRAPHY_'+exc.code,exc.witness) from exc
                    finally:terrain_lock.release()
                elif path == "/r/world/events":
                    events = world.own_events(self.token(), int(params.get("after", ["0"])[0]), int(params.get("limit", ["64"])[0]))
                    data = {"protocol": "PURL/0.1", "kind": "scoped-events", "events": events,
                            "complete_world_replay": False, "reason": "other participants' private state is excluded"}
                elif path == "/r/world/continuity":
                    obs = world.observe(self.token())
                    data = {"schema": "dark.continuity/1", "actor": obs["actor"]["id"], "revision": obs["revision"], "head": obs["head"],
                            "observation": obs, "claims_are_not_commits": True}
                elif path == "/r/world/lineage":
                    world.identity(self.token())
                    data = {"kind": "lineage", "world": world.snapshot()["content"]["id"], "source_versions": world.snapshot()["content"].get("source_versions", {})}
                elif path == "/r/world/verify":
                    world.identity(self.token())
                    data = world.verify_history()
                elif path == "/schemas/action": data = operation("travel")["request_schema"]
                else:
                    self.send_json(404, {"status": "REFUSED", "code": "NOT_FOUND"}); return
                self.send_json(200, data)
            except Refused as exc:
                status = 401 if exc.code == "AUTHENTICATION" else 409 if exc.code in ("STALE_REVISION", "REQUEST_CONFLICT") else 403 if exc.code in ("CAPABILITY", "DRIVER_CONTROL") else 400
                self.send_json(status, exc.as_dict())
            except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
                self.send_json(400, {"status": "REFUSED", "code": "MALFORMED_REQUEST"})
            except (socket.timeout, ConnectionError):
                self.close_connection = True

    return BoundedServer((host, port), Handler)


class NetworkFailure(Exception):
    def __init__(self, status, reason):
        self.status, self.reason = status, reason
        super().__init__(str(status)+": "+str(reason))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise NetworkFailure(code, "redirect refused; never forward a bearer token")


class Client:
    def __init__(self, base_url, token, timeout=3):
        parsed = urlsplit(base_url)
        if parsed.scheme not in ("https", "http") or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("explicit HTTP(S) origin required")
        if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("bearer tokens require TLS outside loopback")
        self.base_url, self.token, self.timeout = base_url.rstrip("/"), token, min(10, max(.1, timeout))
        self.opener = build_opener(NoRedirect())

    @staticmethod
    def decode(status, content_type, body):
        if status != 200: raise NetworkFailure(status, "service returned an error")
        if content_type.split(";")[0].strip() not in ("application/json", MEDIA): raise NetworkFailure(status, "unexpected media type")
        if not 1 <= len(body) <= 1048576: raise NetworkFailure(status, "empty or oversized response")
        try: value = strict_json(body)
        except (ValueError, UnicodeError, RecursionError) as exc: raise NetworkFailure(status, "malformed JSON") from exc
        if not isinstance(value, dict): raise NetworkFailure(status, "object response required")
        return value

    def request(self, path, body=None, request_id=None):
        headers = {"Accept": MEDIA, "Authorization": "Bearer "+self.token}
        if body is not None: headers.update({"Content-Type": "application/json", "Idempotency-Key": request_id})
        req = Request(self.base_url+path, data=canonical(body).encode() if body is not None else None, headers=headers)
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                return self.decode(response.status, response.headers.get("Content-Type", ""), response.read(1048577))
        except HTTPError as exc:
            exc.close()
            raise NetworkFailure(exc.code, "admission or transport refused; refresh observation") from exc
        except (URLError, TimeoutError, ConnectionError) as exc:
            raise NetworkFailure(0, "connection unavailable; retain request ID before retry") from exc

    def observe(self):
        value = self.request("/r/world")
        if value.get("schema") != "dark.observation/1": raise NetworkFailure(200, "unsupported observation schema")
        return value

    @staticmethod
    def proposal(operation, arguments, request_id, revision):
        return {"schema": "dark.action/1", "request_id": request_id, "expected_revision": revision,
                "operation": operation, "arguments": arguments}

    def _effect(self, request, validate):
        identifier(request["operation"]); identifier(request["request_id"])
        return self.request("/r/world/"+("validate/" if validate else "ops/")+request["operation"],
            {"expected_version": request["expected_revision"]+1, "input": request["arguments"]}, request["request_id"])

    def invoke(self, request): return self._effect(request, False)
    def validate(self, request): return self._effect(request, True)
