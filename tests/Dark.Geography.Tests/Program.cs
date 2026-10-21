using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Dark.Numerics;
using Dark.World;

// Executes the existing production math kernel on pinned OSM-derived data.
// Every physical/native status remains separate from these console assertions.
internal static class Program
{
    const string FixtureHash = "8abae87f2866dd3a43106c9c77f8f65613245c691d2111949b1b53339ec6bfef";
    const string SourceHash = "55bd28406a5cf22063eba5d456e46f4cd7f1b590c9288bc4808ad9ff1a27e86a";
    const string Anchor = "osm/node/1603574189", West = "osm/node/2057042478", East = "osm/node/4520926406";
    const string Moving = "fictional/tampa/spruce-branches", Fixed = "fictional/tampa/fixed";
    static int passed, failed;
    static readonly List<object> cases = new List<object>();
    static readonly List<object> observations = new List<object>();

    static int Main()
    {
        try
        {
            using var fixtureDoc = LoadPinned("tampa-two-plate-fixture.json", FixtureHash, 37169);
            using var sourceDoc = LoadPinned("tampa-dale-mabry-spruce.osm.json", SourceHash, 467198);
            var fixture = fixtureDoc.RootElement;
            var source = sourceDoc.RootElement;
            Run("Pinned OSM node, ordered-way-segment and shared-junction provenance", () => SourceMembership(fixture, source));
            Run("Python local chart agrees with C# WGS84 ENU under explicit zero-height assumption", () => LocalChart(fixture));
            Run("C# source graph connected; fictional before graph has literal 14/3 components", () => BeforeConnectivity(fixture));
            Run("RigidCarriage actual kernel result and transport witnesses", () => AdmittedPolicy(fixture, OccupantPolicy.RigidCarriage));
            Run("WitnessedRelocation actual kernel result and transport witnesses", () => AdmittedPolicy(fixture, OccupantPolicy.WitnessedRelocation));
            Run("RefuseWhileOccupied is atomic with no witness", () => OccupiedRefusal(fixture));
            Run("Both admitted policies invert exact state at new revision, with no physical rewind", () => Inverses(fixture));
            Run("Deterministic independent replay and stale repeated request refusal", () => Replay(fixture));
            Run("Incomplete relocation, fixed-side straddler and insufficient budget refuse atomically", () => InvalidCases(fixture));
            Run("Physical/native acceptance stays NOT_RUN and pinned files remain unchanged", () => Limits(fixture));
        }
        catch (Exception ex)
        {
            failed++;
            cases.Add(new { name = "fixture load/setup", status = "FAIL", error = ex.ToString() });
            Console.WriteLine("FAIL fixture load/setup: " + ex);
        }
        Console.WriteLine($"TOTAL {passed} PASS, {failed} FAIL");
        Console.WriteLine("RESULTS " + JsonSerializer.Serialize(new {
            passed, failed, cases, observations,
            fixture_sha256 = FixtureHash, source_sha256 = SourceHash,
            scope = "Actual Dark.World mathematical kernel execution only",
            native_unity = "NOT_RUN", physical_validation = "NOT_RUN", hd_091_acceptance = "NOT_ACCEPTED"
        }));
        return failed == 0 ? 0 : 1;
    }

    static JsonDocument LoadPinned(string name, string expectedHash, int expectedBytes)
    {
        string path = Path.Combine(AppContext.BaseDirectory, "Fixtures", name);
        using var stream = File.OpenRead(path);
        if (stream.Length != expectedBytes || stream.Length > 1024 * 1024) throw new InvalidDataException("Pinned fixture size mismatch or >1 MiB");
        var bytes = new byte[expectedBytes];
        stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1) throw new InvalidDataException("Pinned fixture grew during read");
        Equal(Hash(bytes), expectedHash, name + " SHA256");
        return JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 32, AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow });
    }

    static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    static string S(JsonElement e, string key) => e.GetProperty(key).GetString() ?? throw new InvalidDataException("Null string " + key);
    static JsonElement[] A(JsonElement e, string key) => e.GetProperty(key).EnumerateArray().ToArray();
    static Vector3d V(JsonElement e)
    {
        if (e.GetArrayLength() != 3) throw new InvalidDataException("XYZ must have three components");
        return new Vector3d(e[0].GetDouble(), e[1].GetDouble(), e[2].GetDouble());
    }
    static Edge E(JsonElement e) => new Edge(S(e, "a"), S(e, "b"));
    static string NodeId(long id) => "osm/node/" + id;
    static JsonElement PolicyCase(JsonElement f, OccupantPolicy p) => A(f, "policy_cases").Single(c => S(c, "policy") == p.ToString());
    static PlateWorld World(JsonElement f)
    {
        var w = f.GetProperty("plate_world");
        return new PlateWorld(w.GetProperty("revision").GetInt64(),
            A(w, "plates").Select(p => new Plate(S(p, "id"), V(p.GetProperty("center_xyz_m")), p.GetProperty("angle_degrees").GetDouble())).ToArray(),
            A(w, "nodes").Select(n => new PlateNode(S(n, "id"), S(n, "plate_id"), V(n.GetProperty("local_xyz_m")))).ToArray(),
            A(w, "edges").Select(E).ToArray(),
            A(w, "occupants").Select(o => new Occupant(S(o, "id"), S(o, "node_id"), o.GetProperty("boundary_straddler").GetBoolean())).ToArray());
    }
    static RewriteRequest Request(JsonElement f, OccupantPolicy p, IDictionary<string, string>? destinations = null, int? budget = null)
    {
        var r = f.GetProperty("rewrite_request");
        var d = destinations ?? PolicyCase(f, p).GetProperty("destinations").EnumerateObject().ToDictionary(x => x.Name, x => x.Value.GetString()!);
        return new RewriteRequest(r.GetProperty("expected_revision").GetInt64(), S(r, "plate_id"), E(r.GetProperty("remove")), E(r.GetProperty("add")),
            r.GetProperty("rotation_degrees").GetDouble(), p, S(r, "authority_witness_id"), r.GetProperty("start_tick").GetInt64(),
            r.GetProperty("duration_ticks").GetInt64(), budget ?? r.GetProperty("operation_budget").GetInt32(), d);
    }

    static void SourceMembership(JsonElement f, JsonElement source)
    {
        Equal(S(f, "schema_version"), "homeless.tampa-two-plate/v1", "schema");
        var provenance = f.GetProperty("provenance");
        Equal(S(provenance, "source_sha256"), SourceHash, "provenance hash");
        Equal(S(provenance, "source_license"), "ODbL-1.0", "source license");
        Equal(S(provenance, "source_snapshot_requested"), "2026-10-20T00:00:00Z", "snapshot request");
        var nodes = A(source, "elements").Where(e => S(e, "type") == "node").ToDictionary(e => e.GetProperty("id").GetInt64());
        var ways = A(source, "elements").Where(e => S(e, "type") == "way").ToDictionary(e => e.GetProperty("id").GetInt64());
        var graph = f.GetProperty("source_graph");
        Equal(A(graph, "nodes").Length, 17, "real source node count");
        Equal(A(graph, "edges").Length, 16, "real source edge count");
        foreach (var node in A(graph, "nodes"))
        {
            long id = node.GetProperty("osm_node_id").GetInt64();
            Equal(S(node, "id"), NodeId(id), "stable source ID");
            Near(node.GetProperty("latitude_deg").GetDouble(), nodes[id].GetProperty("lat").GetDouble(), 0);
            Near(node.GetProperty("longitude_deg").GetDouble(), nodes[id].GetProperty("lon").GetDouble(), 0);
            Equal(node.GetProperty("ellipsoid_height_m").ValueKind, JsonValueKind.Null, "unknown source height");
        }
        int segmentCount = 0;
        foreach (var edge in A(graph, "edges"))
        {
            var segments = A(edge, "source_segments");
            Check(segments.Length > 0, "source segment required");
            foreach (var segment in segments)
            {
                var way = ways[segment.GetProperty("osm_way_id").GetInt64()];
                long from = segment.GetProperty("from_osm_node_id").GetInt64(), to = segment.GetProperty("to_osm_node_id").GetInt64();
                var refs = A(way, "nodes").Select(n => n.GetInt64()).ToArray();
                Check(Enumerable.Range(0, refs.Length - 1).Any(i => refs[i] == from && refs[i + 1] == to), "ordered consecutive OSM pair");
                Equal(E(edge), new Edge(NodeId(from), NodeId(to)), "source pair endpoints");
                var actualTags = segment.GetProperty("tags").EnumerateObject().ToDictionary(t => t.Name, t => t.Value.GetString());
                var sourceTags = way.GetProperty("tags").EnumerateObject().ToDictionary(t => t.Name, t => t.Value.GetString());
                Check(actualTags.OrderBy(t => t.Key, StringComparer.Ordinal).SequenceEqual(sourceTags.OrderBy(t => t.Key, StringComparer.Ordinal)), "way tags preserved");
                segmentCount++;
            }
        }
        Equal(segmentCount, 16, "ordered source segment count");
        foreach (var anchor in A(f, "geographic_anchors"))
        {
            long id = anchor.GetProperty("osm_node_id").GetInt64();
            Check(id == 1603574189 || id == 2057042478, "literal junction identity");
            foreach (var name in new[] { "North Dale Mabry Highway", "West Spruce Street" })
                Check(ways.Values.Any(w => A(w, "nodes").Any(n => n.GetInt64() == id) && w.GetProperty("tags").TryGetProperty("name", out var tag) && tag.GetString() == name), "junction shared by " + name);
        }
        observations.Add(new { source_nodes = 17, source_edges = 16, source_segments_checked = segmentCount, source_hash_verified = true });
    }

    static void LocalChart(JsonElement f)
    {
        var frame = new LocalEnuFrame(new Geodetic(27.9594638, -82.5054865, 0), 10000);
        var world = World(f);
        foreach (var n in A(f.GetProperty("source_graph"), "nodes"))
        {
            var g = new Geodetic(n.GetProperty("latitude_deg").GetDouble(), n.GetProperty("longitude_deg").GetDouble(), 0);
            var enu = frame.ToEnu(Geodesy.ToEcef(g));
            NearVec(world.Nodes.Single(x => x.Id == S(n, "id")).LocalPosition, new Vector3d(enu.X, enu.Z, enu.Y), 0.000001);
        }
        NearVec(world.Nodes.Single(n => n.Id == Anchor).LocalPosition, new Vector3d(0, 0, 0), 0);
        Near(world.Nodes.Single(n => n.Id == West).LocalPosition.X, -16.35, .1);
        Near(world.Nodes.Single(n => n.Id == East).LocalPosition.X, 17.79, .1);
        Equal(S(f.GetProperty("embedding"), "ground_height_validity"), "UNKNOWN", "chart is not terrain");
    }

    static void BeforeConnectivity(JsonElement f)
    {
        var before = World(f);
        Equal(before.Nodes.Count, 17, "kernel nodes"); Equal(before.Edges.Count, 15, "fictional edges");
        var source = new PlateWorld(0, before.Plates, before.Nodes, A(f.GetProperty("source_graph"), "edges").Select(E).ToArray(), Array.Empty<Occupant>());
        foreach (var a in source.Nodes) foreach (var b in source.Nodes) Check(source.Reachable(a.Id, b.Id), "source connected pair");
        Check(before.Reachable(Anchor, West), "west initially reachable"); Check(!before.Reachable(Anchor, East), "east initially disconnected");
        Equal(before.Nodes.Count(n => before.Reachable(Anchor, n.Id)), 14, "before anchor component");
        Equal(before.Nodes.Count(n => before.Reachable(East, n.Id)), 3, "before east component");
        CheckAgainstOracle(before, A(f.GetProperty("plate_world"), "edges").Select(E).ToArray());
    }

    static void AdmittedPolicy(JsonElement f, OccupantPolicy policy)
    {
        var before = World(f); var original = Snapshot(before, true); var request = Request(f, policy);
        var result = before.Rewrite(request);
        Check(result.Admitted, result.Reason); Equal(result.Admitted, PolicyCase(f, policy).GetProperty("expected_mathematical_admission").GetBoolean(), "fixture admission oracle");
        Equal(result.State.Revision, 1L, "forward revision"); Equal(Snapshot(before, true), original, "prior snapshot immutable");
        var oracle = f.GetProperty("topology_reference");
        Equal(result.State.Revision, oracle.GetProperty("after_revision").GetInt64(), "Python revision oracle");
        Check(result.State.Edges.SequenceEqual(A(oracle, "after_edges").Select(E)), "Python edge-set oracle");
        CheckAgainstOracle(result.State, A(oracle, "after_edges").Select(E).ToArray());
        Equal(result.State.Nodes.Count(n => result.State.Reachable(Anchor, n.Id)), 10, "after anchor component");
        Equal(result.State.Nodes.Count(n => result.State.Reachable(West, n.Id)), 7, "after west component");
        Check(!result.State.Reachable(Anchor, West) && result.State.Reachable(Anchor, East), "literal reachability swap");
        Near(result.State.Plates.Single(p => p.Id == Moving).AngleDegrees, 90, 0);
        Near(result.State.Plates.Single(p => p.Id == Fixed).AngleDegrees, 0, 0);
        foreach (var expected in PolicyCase(f, policy).GetProperty("expected_occupant_nodes").EnumerateObject())
            Equal(result.State.Occupants.Single(o => o.Id == expected.Name).NodeId, expected.Value.GetString(), "fixture occupant oracle");
        Equal(result.State.Occupants.Single(o => o.Id == "fixture/person-fixed").NodeId, Anchor, "fixed occupant unchanged");
        foreach (var id in new[] { "fixture/person-west", "fixture/point-object-west" })
            Equal(result.State.Occupants.Single(o => o.Id == id).NodeId, policy == OccupantPolicy.RigidCarriage ? West : Anchor, "literal affected occupant result");
        var witness = result.Witness!;
        Equal(witness.Rule, "boundary-edge-replace/v1", "rule"); Equal(witness.Clause, "HD-063/064/065", "clauses");
        Equal(witness.Operation, "forward", "operation"); Equal(witness.WorkBound, 413, "literal work bound");
        Check(witness.ReachabilityChanged && witness.EmbeddingChanged, "both changes witnessed"); Equal(witness.PhysicalValidation, "NOT_RUN", "physical validation");
        Equal(witness.Transports.Count, 2, "only moving occupants transported");
        Check(witness.Transports.Select(t => t.EntityId).OrderBy(x => x).SequenceEqual(new[] { "fixture/person-west", "fixture/point-object-west" }), "transport identities");
        var origin = before.Nodes.Single(n => n.Id == West).LocalPosition;
        var endpoint = policy == OccupantPolicy.RigidCarriage ? new Vector3d(-origin.Z, origin.Y, origin.X) : new Vector3d(0, 0, 0);
        var midpoint = policy == OccupantPolicy.RigidCarriage ? new Vector3d((origin.X-origin.Z)*Math.Sqrt(.5), origin.Y, (origin.X+origin.Z)*Math.Sqrt(.5)) : new Vector3d(origin.X/2, origin.Y/2, origin.Z/2);
        foreach (var transport in witness.Transports)
        {
            Equal(transport.OriginNode, West, "origin node"); Equal(transport.DestinationNode, policy == OccupantPolicy.RigidCarriage ? West : Anchor, "destination node");
            Equal(transport.Policy, policy, "transport policy"); Equal(transport.StartTick, 100L, "start tick"); Equal(transport.EndTick, 220L, "end tick");
            Equal(transport.AuthorityWitnessId, "fixture-only/not-an-authority-grant", "provenance string, not an authority grant");
            NearVec(transport.At(0), origin, 1e-12); NearVec(transport.At(.5), midpoint, 1e-12); NearVec(transport.At(1), endpoint, 1e-12);
        }
        observations.Add(new {
            policy = policy.ToString(), result.Admitted, result.Reason, revision = result.State.Revision,
            graph_edges = result.State.Edges.Count, reachable_from_anchor = result.State.Nodes.Count(n => result.State.Reachable(Anchor, n.Id)),
            state_sha256 = Snapshot(result.State, true), physical_validation = witness.PhysicalValidation,
            transports = witness.Transports.Select(t => new { t.EntityId, t.OriginNode, t.DestinationNode, t.StartTick, t.EndTick,
                start_xyz = XYZ(t.At(0)), midpoint_xyz = XYZ(t.At(.5)), end_xyz = XYZ(t.At(1)) }).ToArray()
        });
    }

    static void OccupiedRefusal(JsonElement f)
    {
        var before = World(f); var result = before.Rewrite(Request(f, OccupantPolicy.RefuseWhileOccupied));
        Check(!result.Admitted, "occupied refusal"); Check(ReferenceEquals(before, result.State), "same refused snapshot");
        Equal(result.Reason, "HD-065:occupied", "literal refusal"); Equal(result.Reason, S(PolicyCase(f, OccupantPolicy.RefuseWhileOccupied), "expected_refusal"), "fixture refusal");
        Check(result.Witness == null, "refusal has no witness"); Equal(result.State.Revision, 0L, "refused revision unchanged");
        observations.Add(new { policy = "RefuseWhileOccupied", result.Admitted, result.Reason, revision = result.State.Revision, state_unchanged_by_reference = true });
    }

    static void Inverses(JsonElement f)
    {
        foreach (var policy in new[] { OccupantPolicy.RigidCarriage, OccupantPolicy.WitnessedRelocation })
        {
            var before = World(f); var forward = before.Rewrite(Request(f, policy)); Check(forward.Admitted, forward.Reason);
            var inverse = forward.State.Invert(forward.Witness!); Check(inverse.Admitted, inverse.Reason);
            Equal(inverse.State.Revision, 2L, "inverse is a new revision");
            Equal(Snapshot(inverse.State, false), Snapshot(before, false), "exact plates/nodes/edges/occupants restored");
            Check(inverse.State.Reachable(Anchor, West) && !inverse.State.Reachable(Anchor, East), "inverse connectivity restored");
            Equal(inverse.Witness!.PhysicalValidation, "NOT_RUN", "inverse is mathematical only");
            Equal(inverse.Witness.Operation, "retained-state-inverse; new-physical-transport-required", "inverse does not rewind physical transport");
            Equal(inverse.Witness.Transports.Count, 0, "inverse supplies no physical transport");
            foreach (var invalidState in new[] { inverse.State, World(f) })
            {
                var denied = invalidState.Invert(forward.Witness!);
                Check(!denied.Admitted && ReferenceEquals(denied.State, invalidState), "inverse tied to exact after snapshot");
                Equal(denied.Reason, "HD-064:inverse-state-mismatch", "inverse replay/foreign-state reason");
            }
            observations.Add(new { inverse_of_policy = policy.ToString(), inverse_revision = inverse.State.Revision,
                restored_content_sha256 = Snapshot(inverse.State, false), before_content_sha256 = Snapshot(before, false),
                inverse_operation = inverse.Witness.Operation, physical_validation = inverse.Witness.PhysicalValidation });
        }
    }

    static void Replay(JsonElement f)
    {
        foreach (var policy in new[] { OccupantPolicy.RigidCarriage, OccupantPolicy.WitnessedRelocation })
        {
            var a = World(f).Rewrite(Request(f, policy)); var b = World(f).Rewrite(Request(f, policy));
            Check(a.Admitted && b.Admitted, "independent replay admitted"); Equal(Snapshot(a.State, true), Snapshot(b.State, true), "deterministic semantic state");
            for (int i = 0; i < a.Witness!.Transports.Count; i++)
                foreach (double t in new[] { 0.0, .25, .5, .75, 1.0 }) NearVec(a.Witness.Transports[i].At(t), b.Witness!.Transports[i].At(t), 0);
            var stale = a.State.Rewrite(Request(f, policy));
            Check(!stale.Admitted && ReferenceEquals(stale.State, a.State), "repeat request refused without mutation");
            Equal(stale.Reason, "HD-064:stale-revision", "actual C# stale revision reason"); Check(stale.Witness == null, "stale request no witness");
            Equal(stale.State.Revision, 1L, "stale refusal preserves revision");
        }
    }

    static void InvalidCases(JsonElement f)
    {
        var before = World(f);
        var incomplete = before.Rewrite(Request(f, OccupantPolicy.WitnessedRelocation, new Dictionary<string, string> { { "fixture/person-west", Anchor } }));
        Refused(before, incomplete, "HD-065:incomplete-or-invalid-destination");
        var occupants = before.Occupants.Select(o => new Occupant(o.Id, o.NodeId, o.Id == "fixture/person-fixed")).ToArray();
        var straddler = new PlateWorld(0, before.Plates, before.Nodes, before.Edges, occupants);
        Refused(straddler, straddler.Rewrite(Request(f, OccupantPolicy.RigidCarriage)), "HD-065:boundary-straddler-unsupported");
        Refused(before, before.Rewrite(Request(f, OccupantPolicy.RigidCarriage, budget: 412)), "HD-064:work-budget");
    }

    static void Limits(JsonElement f)
    {
        foreach (string key in new[] { "native_unity", "collision", "spawn_safety", "walkability", "vehicle_clearance", "occupied_physical_transport" })
            Equal(S(f.GetProperty("physical_semantics"), key), "NOT_RUN", "not promoted by a console test: " + key);
        Equal(S(f.GetProperty("physical_semantics"), "hd_091_acceptance"), "NOT_ACCEPTED", "native acceptance separate");
        using var unchangedFixture = LoadPinned("tampa-two-plate-fixture.json", FixtureHash, 37169);
        using var unchangedSource = LoadPinned("tampa-dale-mabry-spruce.osm.json", SourceHash, 467198);
    }

    static void Refused(PlateWorld before, RewriteResult r, string reason)
    { Check(!r.Admitted && ReferenceEquals(before, r.State) && r.Witness == null, "atomic refusal"); Equal(r.Reason, reason, "refusal code"); }

    // Independent BFS over Python's exported edge set; all 17x17 pairs are compared.
    static void CheckAgainstOracle(PlateWorld world, Edge[] oracle)
    {
        foreach (var origin in world.Nodes)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal) { origin.Id }; bool changed;
            do
            {
                changed = false;
                foreach (var edge in oracle)
                    if (seen.Contains(edge.A) || seen.Contains(edge.B)) { changed |= seen.Add(edge.A); changed |= seen.Add(edge.B); }
            } while (changed);
            foreach (var destination in world.Nodes) Equal(world.Reachable(origin.Id, destination.Id), seen.Contains(destination.Id), "oracle pair reachability");
        }
    }

    static double[] XYZ(Vector3d v) => new[] { v.X, v.Y, v.Z };
    static string Snapshot(PlateWorld w, bool revision) => Hash(JsonSerializer.SerializeToUtf8Bytes(new {
        revision = revision ? w.Revision : 0,
        plates = w.Plates.Select(p => new { p.Id, center = XYZ(p.Center), p.AngleDegrees }),
        nodes = w.Nodes.Select(n => new { n.Id, n.PlateId, local = XYZ(n.LocalPosition) }),
        edges = w.Edges.Select(e => new { e.A, e.B }),
        occupants = w.Occupants.Select(o => new { o.Id, o.NodeId, o.BoundaryStraddler })
    }));
    static void Run(string name, Action test)
    {
        try { test(); passed++; cases.Add(new { name, status = "PASS" }); Console.WriteLine("PASS " + name); }
        catch (Exception ex) { failed++; cases.Add(new { name, status = "FAIL", error = ex.ToString() }); Console.WriteLine("FAIL " + name + ": " + ex); }
    }
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static void Equal<T>(T actual, T expected, string message)
    { if (!EqualityComparer<T>.Default.Equals(actual, expected)) throw new Exception(message + $": expected {expected}, actual {actual}"); }
    static void Near(double actual, double expected, double tolerance)
    { if (double.IsNaN(actual) || double.IsInfinity(actual) || Math.Abs(actual-expected)>tolerance) throw new Exception($"Expected {expected:R} +/- {tolerance:R}, actual {actual:R}"); }
    static void NearVec(Vector3d actual, Vector3d expected, double tolerance)
    { Near(actual.X, expected.X, tolerance); Near(actual.Y, expected.Y, tolerance); Near(actual.Z, expected.Z, tolerance); }
}
