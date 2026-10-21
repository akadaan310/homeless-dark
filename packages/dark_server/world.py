"""Transactional gameplay authority. HD-021–34, 41–48, 63–70, 83–86.

This service simulates admitted journeys over explicit route edges. It does not
claim tire, aerodynamic, hydrodynamic, or native Unity collision validation.
The SQLite database and its operator are trusted; hashes detect corruption, not
an adversary replacing the entire database and its trust anchors.
"""
import copy
from contextlib import contextmanager
import hashlib
import heapq
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time

from . import mechanics, entities, streaming, behavior, inhabitants


class Refused(Exception):
    def __init__(self, code, witness, clause="HD-05.1"):
        self.code, self.witness, self.clause = code, str(witness), clause
        super().__init__(code + ": " + self.witness)

    def as_dict(self):
        return {"status": "REFUSED", "code": self.code, "clause": self.clause,
                "witness": self.witness}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def require(condition, code, witness, clause="HD-05.1"):
    if not condition:
        raise Refused(code, witness, clause)


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", value),
            "IDENTIFIER", "expected 1–128 ASCII letters, digits, dot, colon, underscore or hyphen")
    return value


def finite(value):
    if type(value) not in (int,float):return False
    try:return math.isfinite(value)
    except OverflowError:return False


def position(value):
    require(isinstance(value, dict) and finite(value.get("lat")) and finite(value.get("lon"))
            and -90 <= value["lat"] <= 90 and -180 <= value["lon"] <= 180
            and finite(value.get("alt", 0)), "POSITION", "finite geographic coordinate required")
    return {"lat": float(value["lat"]), "lon": float(value["lon"]),
            "alt": float(value.get("alt", 0))}


def distance_m(a, b):
    """Mean-radius great-circle distance; not a surveyed road distance."""
    p, q = math.radians(a["lat"]), math.radians(b["lat"])
    u, v = q-p, math.radians(b["lon"]-a["lon"])
    h = math.sin(u/2)**2 + math.cos(p)*math.cos(q)*math.sin(v/2)**2
    return 6371008.8 * 2 * math.atan2(math.sqrt(min(1, h)), math.sqrt(max(0, 1-h)))


def interpolate(a, b, t):
    """Shortest great circle, including date-line crossings, with linear altitude."""
    if t <= 0: return position(a)
    if t >= 1: return position(b)
    def vector(p):
        lat, lon = math.radians(p["lat"]), math.radians(p["lon"])
        return (math.cos(lat)*math.cos(lon), math.cos(lat)*math.sin(lon), math.sin(lat))
    u, v = vector(a), vector(b)
    omega = math.acos(max(-1, min(1, sum(x*y for x, y in zip(u, v)))))
    require(omega < math.pi - 1e-7, "AMBIGUOUS_ROUTE", "antipodal route needs an intermediate waypoint")
    if omega < 1e-10: return position(a)
    c, d = math.sin((1-t)*omega)/math.sin(omega), math.sin(t*omega)/math.sin(omega)
    x, y, z = [c*u[i]+d*v[i] for i in range(3)]
    return {"lat": math.degrees(math.atan2(z, math.hypot(x, y))),
            "lon": math.degrees(math.atan2(y, x)), "alt": a.get("alt", 0)*(1-t)+b.get("alt", 0)*t}


SPEEDS = {"walk": 1.4, "guided": 1.3, "drive": 12., "taxi": 12., "bus": 9.,
          "bike": 5., "scooter": 6., "motorcycle": 12., "aircraft": 190.,
          "helicopter": 55., "boat": 6., "ferry": 8.}
PEDESTRIAN = {"walk", "guided"}


def actor_record(actor_id, definition, nodes, role="member"):
    node = definition["node"]
    require(node in nodes, "ACTOR_NODE", node)
    actor={"id": actor_id, "role": role, "controller": definition.get("controller", "human"),
            "node": node, "position": position(nodes[node]), "vehicle": None,
            "stance": "standing", "sociability": definition.get("sociability", .5),
            "duty": definition.get("duty", .5), "goal": definition.get("goal", "explore"),
            "decisions": 0, "needs": {"rest": 0., "company": 0.}, "memories": [],
            "skills": [], "views": [], "consent": None, "knowledge": [node], "commitments": [], "manual": None}
    behavior.initialize(actor,definition,nodes)
    return actor


def initial_state(content,resource_root=None):
    require(content.get("schema") == "dark.world-content/1", "CONTENT_SCHEMA", "dark.world-content/1")
    require(isinstance(content.get("nodes"), dict) and 1 <= len(content["nodes"]) <= 10000,
            "CONTENT_BUDGET", "1–10000 local route nodes")
    content = copy.deepcopy(content)
    nodes = content["nodes"]
    for key, node in nodes.items():
        identifier(key); position(node)
        require(type(node.get("ready")) is bool, "CONTENT_READY", key)
    require(content.get("spawn") in nodes and nodes[content["spawn"]]["ready"], "SPAWN", "ready node required")
    require(isinstance(content.get("walk_regions", []), list) and len(content.get("walk_regions", [])) <= 64,
            "WALK_REGION_BUDGET", "maximum 64 authored navigation regions")
    for region in content.get("walk_regions", []):
        require(region.get("anchor") in nodes and region.get("synthetic") is True, "WALK_REGION", "explicit fictional navigation layer required")
        rects = [region.get("bounds")]+region.get("blockers", [])+region.get('free_rects',[])
        require(len(rects) <= 193 and all(isinstance(r, list) and len(r) == 4 and all(finite(v) and abs(v) <= 10000 for v in r)
                and r[0] < r[2] and r[1] < r[3] for r in rects), "WALK_REGION", "bounded east/north rectangles required")
        require('corridor_width_m' not in region or finite(region['corridor_width_m']) and .5<=region['corridor_width_m']<=10,'WALK_REGION','bounded authored corridor width')
    edges = content.get("edges", [])
    require(isinstance(edges, list) and len(edges) <= 50000, "EDGE_BUDGET", "maximum 50000 edges")
    seen = set()
    for e in edges:
        identifier(e["id"])
        require(e["id"] not in seen and e["a"] in nodes and e["b"] in nodes and e["a"] != e["b"], "EDGE", e["id"])
        require(isinstance(e["modes"], list) and e["modes"] and set(e["modes"]) <= SPEEDS.keys(), "EDGE_MODE", e["id"])
        require(distance_m(nodes[e["a"]], nodes[e["b"]]) < math.pi*6371008.8-1,
                "AMBIGUOUS_ROUTE", "split antipodal edges")
        seen.add(e["id"])
    actors, vehicles = {}, {}
    require(len(content.get("actors", {})) <= 256 and len(content.get("vehicles", {})) <= 256,
            "ACTIVE_BUDGET", "maximum 256 actors and vehicles in this active cell")
    for key, definition in content.get("actors", {}).items():
        identifier(key)
        require(key not in ("system", "founder_dark", "Obex_Den") and key not in content.get("vehicles", {}),
                "IDENTITY_COLLISION", "actor and vehicle namespaces must be disjoint; reserved identities cannot be seeded")
        require(definition.get("controller") == "npc", "CONTENT_ACTOR", "only ordinary NPCs may be seeded")
        for trait in ("duty", "sociability"):
            require(finite(definition.get(trait, .5)) and 0 <= definition.get(trait, .5) <= 1, "TRAIT", trait)
        actors[key] = actor_record(key, definition, nodes)
    for key, definition in content.get("vehicles", {}).items():
        identifier(key)
        require(key not in ("system", "founder_dark", "Obex_Den"), "RESERVED_IDENTITY", key)
        require(definition.get("node") in nodes and definition.get("mode") in SPEEDS
                and definition["mode"] not in PEDESTRIAN, "VEHICLE", key)
        require(type(definition.get("capacity")) is int and 1 <= definition["capacity"] <= 100
                and type(definition.get("autonomous")) is bool, "VEHICLE_CAPACITY", key)
        vehicles[key] = dict(definition, id=key, position=position(nodes[definition["node"]]), driver=None, passengers=[])
    state = {"schema": "dark.world-state/1", "revision": 0, "tick": 0,
            "content": content, "actors": actors, "vehicles": vehicles,
            "journeys": {}, "signs": {}, "speech": [], "contributions": [], "portals": {}}
    state.update(mechanics.initialize(content))
    state.update(entities.initialize(content))
    state.update(streaming.initialize(resource_root or Path(__file__).resolve().parents[2],content))
    state.update(inhabitants.initialize(content))
    return state


class World:
    SCHEMA = 1

    def __init__(self, path, resource_root=None):
        self.path = Path(path).resolve()
        self.resource_root=Path(resource_root or Path(__file__).resolve().parents[2]).resolve()
        self._population_geography=None
        require(self.path.is_file(), "WORLD_MISSING", "explicit creation is required; reopening never seeds")

    @classmethod
    def create(cls, path, content, resource_root=None):
        state = initial_state(content,resource_root)
        path = Path(path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        world = cls(path,resource_root)
        with world._connection() as c:
            c.executescript("""
              CREATE TABLE world(id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL,
                state_hash TEXT NOT NULL, head TEXT NOT NULL, schema_version INTEGER NOT NULL);
              CREATE TABLE genesis(id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, hash TEXT NOT NULL);
              CREATE TABLE principals(actor TEXT PRIMARY KEY, role TEXT NOT NULL, scopes TEXT NOT NULL, controller TEXT NOT NULL);
              CREATE UNIQUE INDEX unique_founder ON principals(role) WHERE role='founder_dark';
              CREATE TABLE sessions(hash TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES principals(actor),
                issued INTEGER NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
              CREATE TABLE events(seq INTEGER PRIMARY KEY, actor TEXT NOT NULL, request_id TEXT NOT NULL,
                command TEXT NOT NULL, response TEXT NOT NULL, previous TEXT NOT NULL,
                state TEXT NOT NULL, state_hash TEXT NOT NULL, hash TEXT NOT NULL,
                UNIQUE(actor,request_id));
            """)
            h = digest(state)
            c.execute("INSERT INTO world VALUES(1,?,?,?,?)", (canonical(state), h, h, cls.SCHEMA))
            c.execute("INSERT INTO genesis VALUES(1,?,?)", (canonical(state), h))
        return world

    @contextmanager
    def _connection(self):
        c = sqlite3.connect("file:"+str(self.path)+"?mode=rw", uri=True, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=FULL")
        try:
            with c:
                yield c
        finally:
            c.close()

    def _state(self, c):
        row = c.execute("SELECT * FROM world WHERE id=1").fetchone()
        require(row is not None and row["schema_version"] == self.SCHEMA, "WORLD_SCHEMA", "migration required")
        try:
            state = json.loads(row["state"])
            require(digest(state) == row["state_hash"], "STATE_CORRUPT", "snapshot hash mismatch")
            last = c.execute("SELECT seq,hash,state_hash FROM events ORDER BY seq DESC LIMIT 1").fetchone()
            anchor = c.execute("SELECT hash FROM genesis WHERE id=1").fetchone()
            require(last is not None or anchor is not None, "HISTORY_CORRUPT", "missing genesis")
            require((last["hash"] if last else anchor["hash"]) == row["head"]
                    and (last["seq"] if last else 0) == state["revision"]
                    and (last["state_hash"] if last else anchor["hash"]) == row["state_hash"],
                    "HISTORY_CORRUPT", "snapshot/history mismatch")
            return state, row["head"]
        except (ValueError, KeyError, TypeError) as exc:
            raise Refused("STATE_CORRUPT", str(exc)) from exc

    def snapshot(self):
        with self._connection() as c:
            c.execute("BEGIN")
            return self._state(c)[0]

    def head(self):
        with self._connection() as c:
            c.execute("BEGIN")
            return self._state(c)[1]

    def register(self, actor_id, scopes=(), now=None, controller="human"):
        """Local operator provisioning; never exposed through the public HTTP API."""
        identifier(actor_id)
        require(actor_id not in ("founder_dark", "Obex_Den", "system"), "RESERVED_IDENTITY", actor_id, "HD-02")
        require(controller in ("human", "external_ai"), "CONTROLLER", "human or external_ai")
        require(isinstance(scopes, (list, tuple)) and len(scopes) <= 32 and
                all(isinstance(s, str) and re.fullmatch(r"author/[A-Za-z0-9_.:-]{1,128}", s) for s in scopes),
                "SCOPES", "bounded author scopes required")
        stamp = self._now(now)
        token = secrets.token_urlsafe(32)
        with self._connection() as c:
            c.execute("BEGIN IMMEDIATE")
            state, _ = self._state(c)
            require(actor_id not in state["actors"] and actor_id not in state["vehicles"], "IDENTITY_EXISTS", actor_id)
            require(c.execute("SELECT count(*) FROM principals").fetchone()[0] < 256,
                    "PRINCIPAL_BUDGET", "active cell supports 256 principals")
            try:
                c.execute("INSERT INTO principals VALUES(?,?,?,?)", (actor_id, "member", canonical(list(scopes)), controller))
                c.execute("INSERT INTO sessions(hash,actor,issued,expires) VALUES(?,?,?,?)", (self._token_hash(token), actor_id, stamp, stamp+86400))
            except sqlite3.IntegrityError as exc:
                raise Refused("IDENTITY_EXISTS", actor_id) from exc
        return token

    @staticmethod
    def _now(now):
        value = int(time.time()) if now is None else now
        require(type(value) is int and value >= 0, "CLOCK", "trusted nonnegative integer wall clock")
        return value

    @staticmethod
    def _token_hash(token):
        require(isinstance(token, str) and 32 <= len(token) <= 256, "AUTHENTICATION", "opaque current session required", "HD-02")
        return hashlib.sha256(token.encode()).hexdigest()

    def _auth(self, c, token, now):
        stamp = self._now(now)
        row = c.execute("SELECT p.* FROM sessions s JOIN principals p ON s.actor=p.actor WHERE s.hash=? AND s.revoked=0 AND s.issued<=? AND s.expires>?",
                        (self._token_hash(token), stamp, stamp)).fetchone()
        require(row is not None, "AUTHENTICATION", "unknown, expired or revoked session", "HD-02")
        return dict(row)

    def revoke(self, token):
        with self._connection() as c:
            c.execute("UPDATE sessions SET revoked=1 WHERE hash=?", (self._token_hash(token),))

    def join(self, token, request_id, now=None):
        self._token_hash(token)
        identifier(request_id)
        request = {"operation": "join", "request_id": request_id}
        return self._transaction(token, request, now)

    def _validate_envelope(self, request):
        require(isinstance(request, dict) and set(request) == {"schema", "request_id", "expected_revision", "operation", "arguments"},
                "REQUEST_SCHEMA", "exact dark.action/1 fields required")
        require(request["schema"] == "dark.action/1" and type(request["expected_revision"]) is int
                and request["expected_revision"] >= 0 and isinstance(request["arguments"], dict), "REQUEST_SCHEMA", "invalid schema or revision")
        identifier(request["request_id"]); identifier(request["operation"])
        try:
            require(len(canonical(request).encode()) <= 8192, "REQUEST_BUDGET", "maximum 8192 UTF-8 bytes")
        except (ValueError, TypeError, UnicodeError) as exc:
            raise Refused("REQUEST_ENCODING", "finite UTF-8 JSON required") from exc
        # Entity inputs have their own exact typed Life grammar. Other actions
        # retain scalar argument validation; arbitrary nested effects are refused.
        for key, value in request["arguments"].items():
            require(isinstance(key, str), "ARGUMENTS", "string argument key required")
            if request['operation']=='entity_action' and key=='input':
                require(isinstance(value,dict),'ARGUMENT_TYPE','Life input must be an object')
                continue
            require(finite(value) if key in ("max_distance_m", "east", "north") else isinstance(value, str),
                    "ARGUMENT_TYPE", key+" has the wrong type")

    def execute(self, token, request, now=None):
        self._token_hash(token)
        self._validate_envelope(request)
        return self._transaction(token, request, now)

    def validate(self, token, request, now=None):
        """Use exactly the admission path, rolling back all proposed effects."""
        # Admission mutates only the freshly decoded in-memory snapshot.
        self._token_hash(token)
        self._validate_envelope(request)
        return self._transaction(token, request, now, dry_run=True)

    def advance(self, ticks, request_id):
        """Simulation operator interface; unavailable as a player action."""
        require(type(ticks) is int and 1 <= ticks <= 3600, "TICK_BUDGET", "1–3600 fixed seconds per admission")
        identifier(request_id)
        return self._transaction(None, {"operation": "advance", "request_id": request_id, "ticks": ticks}, None)

    def _transaction(self, token, request, now, dry_run=False):
        with self._connection() as c:
            c.execute("BEGIN IMMEDIATE")
            principal = self._auth(c, token, now) if token is not None else {"actor": "system", "role": "operator", "scopes": "[]"}
            actor_id = principal["actor"]
            state, previous = self._state(c)
            old = c.execute("SELECT command,response FROM events WHERE actor=? AND request_id=?", (actor_id, request["request_id"])).fetchone()
            if old:
                require(old["command"] == canonical(request), "REQUEST_CONFLICT", "request ID already committed with different input")
                return json.loads(old["response"])
            op = request["operation"]
            if op == "join":
                require(actor_id not in state["actors"], "ALREADY_JOINED", actor_id)
                require(len(state["actors"]) < 256, "ACTIVE_BUDGET", "active actor limit")
                state["actors"][actor_id] = actor_record(actor_id, {"node": state["content"]["spawn"], "controller": principal["controller"]}, state["content"]["nodes"], principal["role"])
                data = {"actor": actor_id}
            elif op == "advance" and token is None:
                self._advance(state, request["ticks"])
                data = {"tick": state["tick"]}
            else:
                require(request.get("expected_revision") == state["revision"], "STALE_REVISION", "refresh observation before changing the world")
                require(actor_id in state["actors"], "NOT_JOINED", actor_id)
                data = self._act(state, principal, op, request["arguments"])
            state["revision"] += 1
            response = {"status": "COMMITTED", "revision": state["revision"], "tick": state["tick"], "data": data}
            state_text = canonical(state)
            require(len(state_text.encode()) <= 8*1024*1024, "WORLD_BUDGET", "active snapshot maximum 8 MiB")
            if dry_run:
                return {"status": "VALID", "proposed": response, "base_head": previous,
                        "activation_requires_revalidation": True}
            event = {"seq": state["revision"], "actor": actor_id, "request_id": request["request_id"],
                     "command": request, "response": response, "previous": previous, "state_hash": digest(state)}
            head = digest(event)
            c.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)", (event["seq"], actor_id, request["request_id"], canonical(request), canonical(response), previous, state_text, event["state_hash"], head))
            c.execute("UPDATE world SET state=?,state_hash=?,head=? WHERE id=1", (state_text, event["state_hash"], head))
            return response

    def identity(self, token, now=None):
        with self._connection() as c:
            principal = self._auth(c, token, now)
            principal["scopes"] = json.loads(principal["scopes"])
            return principal

    def own_events(self, token, after=0, limit=64, now=None):
        require(type(after) is int and after >= 0 and type(limit) is int and 1 <= limit <= 128,
                "HISTORY_BUDGET", "nonnegative cursor, limit 1–128")
        with self._connection() as c:
            c.execute("BEGIN")
            principal = self._auth(c, token, now)
            self._state(c)
            rows = c.execute("SELECT seq,command,response,previous,hash,state_hash FROM events WHERE actor=? AND seq>? ORDER BY seq LIMIT ?",
                             (principal["actor"], after, limit)).fetchall()
            return [{"seq": r["seq"], "command": json.loads(r["command"]), "response": json.loads(r["response"]),
                     "previous": r["previous"], "hash": r["hash"], "state_hash": r["state_hash"]} for r in rows]

    def observe(self, token, now=None):
        with self._connection() as c:
            c.execute("BEGIN")
            principal = self._auth(c, token, now)
            state, head = self._state(c)
            require(principal["actor"] in state["actors"], "NOT_JOINED", principal["actor"])
            actor = state["actors"][principal["actor"]]
            chart_nodes = mechanics.nodes(state)
            nearby = {key: {k: a[k] for k in ("id", "node", "position", "stance", "vehicle")}
                      for key, a in state["actors"].items() if key != actor["id"] and distance_m(actor["position"], a["position"]) <= 60}
            return {"schema": "dark.observation/1", "revision": state["revision"], "tick": state["tick"],
                    "head": head, "actor": actor, "nearby": nearby,
                    "vehicles": {k: v for k, v in state["vehicles"].items() if distance_m(actor["position"], v["position"]) <= 60},
                    "speech": [e for e in state["speech"] if actor["id"] in e["audience"]],
                    "signs": {k: v for k, v in state["signs"].items() if distance_m(actor["position"], chart_nodes[k]) <= 60},
                    "journey": state["journeys"].get(actor["vehicle"] or actor["id"]),
                    "mechanics": mechanics.observation(state),
                    "entities": entities.observe(state,actor),
                    "streaming": streaming.observe(state,actor),
                    "population": inhabitants.observe(state),
                    "destinations": [{"id": key, "label": node.get("label", key), "ready": node["ready"], "position": position(node)}
                                     for key,node in sorted(chart_nodes.items(),
                                         key=lambda pair: (distance_m(actor["position"], pair[1]), pair[0]))
                                     if node.get("public", True)][:32],
                    "source_versions": state["content"].get("source_versions", {}),
                    "physical_validation": state["content"].get("physical_validation", "NOT_RUN")}

    def verify_history(self):
        with self._connection() as c:
            c.execute("BEGIN")
            state, head = self._state(c)
            first = c.execute("SELECT * FROM genesis WHERE id=1").fetchone()
            require(first is not None and digest(json.loads(first["state"])) == first["hash"], "HISTORY_CORRUPT", "genesis mismatch")
            previous, count = first["hash"], 0
            for row in c.execute("SELECT * FROM events ORDER BY seq"):
                count += 1
                event = {k: row[k] for k in ("seq", "actor", "request_id", "previous", "state_hash")}
                event.update(command=json.loads(row["command"]), response=json.loads(row["response"]))
                require(row["seq"] == count and row["previous"] == previous and digest(event) == row["hash"]
                        and digest(json.loads(row["state"])) == row["state_hash"], "HISTORY_CORRUPT", "event "+str(count))
                previous = row["hash"]
            require(previous == head and count == state["revision"], "HISTORY_CORRUPT", "head mismatch")
            return {"events": count, "head": head, "state_hash": digest(state), "trust_boundary": "local SQLite operator"}

    @staticmethod
    def _fields(args, required=(), optional=()):
        require(set(required) <= args.keys() and args.keys() <= set(required)|set(optional), "ARGUMENTS", "unexpected or missing arguments")

    def _route(self, state, start, destination, mode):
        nodes = mechanics.nodes(state)
        require(destination in nodes and nodes[destination]["ready"], "DESTINATION_UNREADY", str(destination), "HD-48")
        require(start in nodes, "BETWEEN_NODES", "resume or finish the current segment before rerouting")
        graph = {key: [] for key in nodes}
        for edge in mechanics.edges(state):
            if mode in edge["modes"] and nodes[edge["a"]]["ready"] and nodes[edge["b"]]["ready"]:
                length = distance_m(nodes[edge["a"]], nodes[edge["b"]])
                graph[edge["a"]].append((edge["b"], length))
                if not edge.get("one_way", False): graph[edge["b"]].append((edge["a"], length))
        queue, seen = [(0., start, [start])], set()
        while queue:
            length, node, route = heapq.heappop(queue)
            if node in seen: continue
            seen.add(node)
            if node == destination: return route, length
            for nxt, segment in sorted(graph[node]):
                if nxt not in seen: heapq.heappush(queue, (length+segment, nxt, route+[nxt]))
        raise Refused("NO_ROUTE", mode+" has no admitted route to "+destination, "HD-48")

    def _act(self, state, principal, op, args):
        actor = state["actors"][principal["actor"]]
        moving_id = actor["vehicle"] or actor["id"]
        journey = state["journeys"].get(moving_id)
        if op in ('entity_action','request_entry','request_vehicle_ride'):
            return entities.act(state,principal,op,args)
        if op in ('prepare_cell','activate_cell','cancel_cell','retire_cell'):
            return streaming.act(self.resource_root,state,principal,op,args)
        if op in ('encounter_population','dismiss_population','restore_population'):
            return inhabitants.act(self,state,principal,op,args)
        if op in ("travel", "manual_move", "board", "exit", "visit"):
            require(not state.get("plate_transition"), "TRANSITION_BUSY", "wait for the admitted transport to finish")
        if op == "learn_pattern": return mechanics.learn(state, actor, args)
        if op == "rewrite_plate": return mechanics.rewrite(state, actor, args)
        if op == "manual_move":
            self._fields(args, ("east", "north"))
            require(not actor["vehicle"] and not journey and actor["stance"] != "sitting", "FOOT_CONTROL", "standing unattached pedestrian required")
            require(all(abs(args[k]) <= 1 for k in ("east", "north")), "INPUT_BUDGET", "input axes must be in [-1,1]")
            require(self._walkable(state, actor["position"]), "COLLISION_UNREADY", "no admitted authored walking region at current position")
            norm = max(1., math.hypot(args["east"], args["north"]))
            actor["manual"] = {"east": args["east"]/norm, "north": args["north"]/norm, "expires": state["tick"]+3}
            actor["stance"] = "walking" if args["east"] or args["north"] else "standing"
            return {"intent": actor["manual"], "speed_limit_m_s": 1.4, "physical_validation": "authored 2D clearance only"}
        if op in ("sit", "stand"):
            self._fields(args)
            require(not journey and not actor["vehicle"], "ATTACHED", "stance requires stationary pedestrian")
            actor["stance"] = "sitting" if op == "sit" else "standing"
            actor["manual"] = None
            return {"stance": actor["stance"]}
        if op == "talk":
            self._fields(args, ("target", "act"))
            target = state["actors"].get(args["target"])
            require(target is not None and target["controller"] == "npc" and distance_m(actor["position"], target["position"]) <= 25,
                    "NOT_AUDIBLE", "an NPC within 25 metres is required", "HD-31")
            require(args["act"] in ("greeting", "request_ride", "ask_place", "farewell", "ask_work"), "SPEECH_ACT", "unregistered speech act")
            response = {"greeting": "greeting", "ask_place": "describe_place", "farewell": "farewell", "ask_work": "describe_work"}.get(args["act"])
            decision=None
            if args["act"] == "request_ride":
                decision=behavior.propose(self,state,target,{'id':'ride:'+str(state['revision']), 'kind':'ride_request','partner':actor['id']})
                response='offer_ride' if decision['action'].get('decision')=='offer' else 'decline_ride'
            event = self._say(state, target, response, actor["id"])
            result={"response_act": response, "speech_id": event["id"], "caption": event["caption"]}
            if decision:result['decision_witness']=decision['witness']
            return result
        if op == "board":
            self._fields(args, ("vehicle", "seat"))
            vehicle = state["vehicles"].get(args["vehicle"])
            require(vehicle is not None and not actor["vehicle"] and not journey and vehicle["id"] not in state["journeys"]
                    and distance_m(actor["position"], vehicle["position"]) <= 3, "BOARDING", "stationary unoccupied actor must be within 3 metres")
            require(args["seat"] in ("driver", "passenger"), "SEAT", "driver or passenger")
            require(len(vehicle["passengers"])+(1 if vehicle["driver"] else 0) < vehicle["capacity"], "CAPACITY", "vehicle full")
            if args["seat"] == "driver":
                require(not vehicle["driver"] and not vehicle["autonomous"], "DRIVER", "driver seat unavailable")
                vehicle["driver"] = actor["id"]
            else: vehicle["passengers"].append(actor["id"])
            actor.update(vehicle=vehicle["id"], stance="seated", position=copy.deepcopy(vehicle["position"]), node=vehicle["node"])
            actor["manual"] = None
            return {"vehicle": vehicle["id"], "seat": args["seat"]}
        if op == "exit":
            self._fields(args)
            require(actor["vehicle"] and not journey, "EXIT_UNSAFE", "exit requires a vehicle stopped at a route node")
            vehicle = state["vehicles"][actor["vehicle"]]
            require(vehicle["node"] is not None, "EXIT_UNSAFE", "not at a boarding node")
            if vehicle["driver"] == actor["id"]: vehicle["driver"] = None
            else: vehicle["passengers"].remove(actor["id"])
            actor.update(vehicle=None, stance="standing", consent=None)
            return {"node": actor["node"]}
        if op == "consent_trip":
            self._fields(args, ("destination", "max_distance_m"))
            require(actor["vehicle"] and state["vehicles"][actor["vehicle"]]["autonomous"], "CONSENT", "autonomous vehicle required")
            require(finite(args["max_distance_m"]) and 0 < args["max_distance_m"] <= 50000000, "CONSENT_BUDGET", "positive finite trip limit")
            vehicle = state["vehicles"][actor["vehicle"]]
            _, length = self._route(state, vehicle["node"], args["destination"], vehicle["mode"])
            require(length <= args["max_distance_m"], "CONSENT_DISTANCE", "route exceeds consent")
            actor["consent"] = dict(args)
            return dict(args)
        if op == "travel":
            self._fields(args, ("destination", "mode"))
            mode = args["mode"]
            require(isinstance(mode, str) and mode in SPEEDS and not journey, "TRAVEL_MODE", "known mode and no pending journey required")
            mover = actor
            if actor["vehicle"]:
                mover = state["vehicles"][actor["vehicle"]]
                require(mode == mover["mode"], "VEHICLE_MODE", "mode must match boarded vehicle")
                if mover["autonomous"]:
                    for rider in mover["passengers"]:
                        consent = state["actors"][rider]["consent"]
                        require(consent is not None and consent["destination"] == args["destination"], "TRIP_CONSENT", "every rider must explicitly consent")
                else: require(mover["driver"] == actor["id"], "DRIVER_CONTROL", "only current driver may control this vehicle")
            else: require(mode in PEDESTRIAN, "VEHICLE_REQUIRED", "board a matching vehicle first")
            origin=mover['node'];approach=None
            if origin is None and mode in PEDESTRIAN:
                chart=mechanics.nodes(state)
                close=sorted((distance_m(mover['position'],p),key) for key,p in chart.items() if p['ready'] and distance_m(mover['position'],p)<=3)
                for distance,node in close:
                    if all(self._walkable(state,interpolate(mover['position'],chart[node],i/16)) for i in range(17)):
                        origin=node;approach={'from':copy.deepcopy(mover['position']),'distance':distance,'progress':0.};break
            route, length = self._route(state, origin, args["destination"], mode)
            require(len(route) > 1 or approach is not None and approach['distance']>1e-6, "ALREADY_THERE", "destination equals origin")
            if actor["vehicle"] and mover["autonomous"]:
                require(all(length <= state["actors"][r]["consent"]["max_distance_m"] for r in mover["passengers"]), "CONSENT_DISTANCE", "route exceeds rider consent")
            state["journeys"][moving_id] = {"mover": moving_id, "owner": actor["id"], "route": route,
                "mode": mode, "segment": 0, "segment_progress": 0., "distance": length, "progress": 0., "paused": False}
            if approach:
                state['journeys'][moving_id]['approach']=approach
                state['journeys'][moving_id]['distance']+=approach['distance']
            if not actor["vehicle"]: actor["stance"] = "walking"
            actor["manual"] = None
            return {"route": route, "distance_m": state['journeys'][moving_id]['distance'], "mode": mode}
        if op in ("cancel", "resume"):
            self._fields(args)
            require(journey is not None and journey["owner"] == actor["id"], "JOURNEY_CONTROL", "only initiating actor may pause or resume")
            journey["paused"] = op == "cancel"
            return {"paused": journey["paused"], "position": actor["position"]}
        if op in ("overlay", "braid"):
            self._fields(args, ("destination",))
            require(args["destination"] in state["content"]["nodes"], "DESTINATION", "unknown place")
            actor["views"] = (actor["views"] + [{"kind": op, "destination": args["destination"], "tick": state["tick"]}])[-8:]
            return {"view": actor["views"][-1], "physical_position_unchanged": True}
        if op == "visit":
            self._fields(args, ("destination",))
            require("portal" in actor["skills"], "UNLEARNED", "learn the operative portal grammar before use", "HD-63")
            portal = state["portals"].get(actor["node"]+":"+args["destination"])
            require(portal is not None and portal.get("admitted"), "PORTAL_ABSENT", "explicit witnessed portal required")
            raise Refused("PORTAL_NOT_IMPLEMENTED", "native exit support validation required")
        if op == "author":
            self._fields(args, ("target", "text"))
            target, text = args["target"], args["text"]
            require(isinstance(target, str) and "author/"+target in json.loads(principal["scopes"]), "CAPABILITY", "author scope required", "HD-05.1")
            require(target in state["content"]["nodes"] and distance_m(actor["position"], mechanics.nodes(state)[target]) <= 25,
                    "AUTHOR_RANGE", "contribute at a nearby fictional place")
            require(isinstance(text, str) and 1 <= len(text.encode("utf-8")) <= 1024 and "\x00" not in text, "TEXT_BUDGET", "1–1024 UTF-8 bytes")
            state["signs"][target] = {"text": text, "author": actor["id"], "tick": state["tick"], "revision": state["revision"]+1, "fictional": True}
            state["contributions"] = (state["contributions"] + [{"target": target, "author": actor["id"], "revision": state["revision"]+1}])[-256:]
            return state["signs"][target]
        raise Refused("UNKNOWN_OPERATION", op)

    @staticmethod
    def _walkable(state, point):
        # Conservative 0.3 m pedestrian radius in authored local regions. This
        # is authority-side broad-phase clearance, not Unity collider evidence.
        for region in state["content"].get("walk_regions", []):
            anchor = state["content"]["nodes"][region["anchor"]]
            east = math.radians((point["lon"]-anchor["lon"]+180)%360-180)*6371008.8*math.cos(math.radians(anchor["lat"]))
            north = math.radians(point["lat"]-anchor["lat"])*6371008.8
            x0,y0,x1,y1 = region["bounds"]
            if not (x0+.3 <= east <= x1-.3 and y0+.3 <= north <= y1-.3): continue
            if any(b[0]-.3 <= east <= b[2]+.3 and b[1]-.3 <= north <= b[3]+.3 for b in region.get("blockers", [])): continue
            if 'corridor_width_m' in region:
                if any(b[0]+.3<=east<=b[2]-.3 and b[1]+.3<=north<=b[3]-.3 for b in region.get('free_rects',[])):return True
                chart=mechanics.nodes(state);width=region['corridor_width_m']-.3
                def xy(p):return (math.radians((p['lon']-anchor['lon']+180)%360-180)*6371008.8*math.cos(math.radians(anchor['lat'])),math.radians(p['lat']-anchor['lat'])*6371008.8)
                for edge in mechanics.edges(state):
                    if 'walk' not in edge['modes']:continue
                    ax,ay=xy(chart[edge['a']]);bx,by=xy(chart[edge['b']]);dx,dy=bx-ax,by-ay
                    squared=dx*dx+dy*dy;t=max(0,min(1,((east-ax)*dx+(north-ay)*dy)/squared)) if squared else 0
                    if math.hypot(east-ax-t*dx,north-ay-t*dy)<=width:return True
                continue
            return True
        return False

    def _say(self, state, speaker, act, addressee=None):
        captions = {"greeting": "Hello. Good to see you.", "offer_ride": "I can help arrange a ride. Where are you going?",
            "decline_ride": "I need to get to work. I cannot offer a ride now.",
            "describe_place": "We are near "+str(speaker["node"])+".", "farewell": "Take care. See you around.",
            "describe_work": "I am heading to work." if speaker["goal"] == "work" else "I am taking some time to talk.",
            "work": "Time to get back to work.", "socialize": "It is good to have some company.", "rest": "I could use a rest."}
        event = {"id": "speech:"+str(state["revision"]+1)+":"+str(state["tick"])+":"+speaker["id"]+":"+act,
                 "tick": state["tick"], "speaker": speaker["id"], "act": act, "addressee": addressee,
                 "caption": captions[act], "position": copy.deepcopy(speaker["position"]), "audience": []}
        for actor in state["actors"].values():
            if distance_m(actor["position"], speaker["position"]) <= 25:
                event["audience"].append(actor["id"])
                actor["memories"] = (actor["memories"] + [{"id": event["id"], "tick": state["tick"],
                    "speaker": speaker["id"], "fact": act, "source": "heard", "confidence": 1.}])[-64:]
        state["speech"] = (state["speech"] + [event])[-128:]
        return event

    def _advance(self, state, ticks):
        # Every second is a simulation step. Rendering/interpolation is a client concern.
        nodes = mechanics.nodes(state)
        for _ in range(ticks):
            state["tick"] += 1
            changing_chart=bool(state.get('plate_transition'))
            mechanics.advance(state)
            if changing_chart:nodes=mechanics.nodes(state)
            streaming.expire(self.resource_root,state)
            for actor in state["actors"].values():
                intent = actor.get("manual")
                if not intent: continue
                if state["tick"] > intent["expires"]:
                    actor["manual"] = None; actor["stance"] = "standing"; continue
                for _substep in range(7):
                    point = actor["position"]
                    lat = point["lat"]+math.degrees(intent["north"]*.2/6371008.8)
                    cosine = math.cos(math.radians(point["lat"]))
                    if abs(cosine) < 1e-6:
                        actor["manual"] = None; break
                    lon = (point["lon"]+math.degrees(intent["east"]*.2/(6371008.8*cosine))+180)%360-180
                    proposed = {"lat": lat, "lon": lon, "alt": point["alt"]}
                    if not self._walkable(state, proposed):
                        actor["manual"] = None; actor["stance"] = "standing"; break
                    actor["position"] = proposed
                    actor["node"] = next((k for k,n in nodes.items() if distance_m(n, proposed) < .25), None)
            for key, trip in list(state["journeys"].items()):
                if trip["paused"]: continue
                mover = state["vehicles"].get(key) or state["actors"][key]
                remaining = SPEEDS[trip["mode"]]
                approach=trip.get('approach')
                if approach:
                    step=min(remaining,max(0,approach['distance']-approach['progress']))
                    approach['progress']+=step;trip['progress']+=step;remaining-=step
                    fraction=approach['progress']/approach['distance'] if approach['distance'] else 1
                    mover['position']=interpolate(approach['from'],nodes[trip['route'][0]],fraction)
                    if fraction>=1-1e-12:mover['node']=trip['route'][0];del trip['approach']
                while remaining > 0 and trip["segment"] < len(trip["route"])-1:
                    a, b = nodes[trip["route"][trip["segment"]]], nodes[trip["route"][trip["segment"]+1]]
                    length = distance_m(a, b)
                    step = min(remaining, max(0, length-trip["segment_progress"]))
                    trip["segment_progress"] += step; trip["progress"] += step; remaining -= step
                    fraction = trip["segment_progress"]/length if length > 0 else 1.
                    mover["position"] = interpolate(a, b, fraction)
                    mover["node"] = None
                    if trip["mode"] in ("aircraft", "helicopter"):
                        cruise = 10000 if trip["mode"] == "aircraft" else 300
                        mover["position"]["alt"] += min(cruise, trip["progress"]*.08, max(0, trip["distance"]-trip["progress"])*.08)
                    if fraction >= 1-1e-12:
                        trip["segment"] += 1; trip["segment_progress"] = 0.
                    else: break
                if trip["segment"] == len(trip["route"])-1 and not trip.get('approach'):
                    mover["node"] = trip["route"][-1]; mover["position"] = position(nodes[mover["node"]])
                    del state["journeys"][key]
                    if key in state["actors"]: mover["stance"] = "standing"
                if key in state["vehicles"]:
                    for actor_id in ([mover["driver"]] if mover["driver"] else [])+mover["passengers"]:
                        state["actors"][actor_id].update(position=copy.deepcopy(mover["position"]), node=mover["node"])
                        if mover["node"] and mover["node"] not in state["actors"][actor_id]["knowledge"]:
                            state["actors"][actor_id]["knowledge"].append(mover["node"])
                elif mover["node"] and mover["node"] not in mover["knowledge"]: mover["knowledge"].append(mover["node"])
            if state["tick"] % 60 == 0:
                for actor in state["actors"].values():
                    if actor["controller"] != "npc": continue
                    behavior.propose(self,state,actor)
