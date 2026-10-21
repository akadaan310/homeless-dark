// HD-063..065, HD-087, HD-091. Bounded, immutable, boundary-edge replacement model.
// This kernel admits MATHEMATICAL snapshots only. It is not a physical-motion authority.
using System;
using System.Collections.Generic;
using System.Linq;
using Dark.Numerics;

namespace Dark.World
{
    public sealed class Plate
    {
        public string Id { get; }
        public Vector3d Center { get; }
        public double AngleDegrees { get; }
        public Plate(string id, Vector3d center, double angleDegrees)
        {
            Names.Check(id); Vector3d.Finite(angleDegrees, nameof(angleDegrees));
            if (center.Length > 1e6) throw new ArgumentOutOfRangeException(nameof(center), "Use a bounded local chart (center radius <=1000 km).");
            Id = id; Center = center; AngleDegrees = Normalize(angleDegrees);
        }
        internal static double Normalize(double angle) => ((angle % 360 + 540) % 360) - 180;
        internal Vector3d Place(Vector3d local, double additionalAngle = 0)
        {
            double radians = (AngleDegrees + additionalAngle) * Math.PI / 180;
            return Center + new Vector3d(local.X * Math.Cos(radians) - local.Z * Math.Sin(radians), local.Y,
                local.X * Math.Sin(radians) + local.Z * Math.Cos(radians));
        }
    }
    internal static class Names
    {
        internal static void Check(string id)
        {
            if (string.IsNullOrWhiteSpace(id) || id.Length > 128) throw new ArgumentException("Stable ID with 1..128 characters required.");
        }
    }
    public sealed class PlateNode
    {
        public string Id { get; }
        public string PlateId { get; }
        public Vector3d LocalPosition { get; }
        public PlateNode(string id, string plateId, Vector3d localPosition)
        {
            Names.Check(id); Names.Check(plateId);
            if (localPosition.Length > 10000) throw new ArgumentOutOfRangeException(nameof(localPosition), "Plate local radius exceeds 10 km.");
            Id = id; PlateId = plateId; LocalPosition = localPosition;
        }
    }
    /// <summary>Simple undirected typed node adjacency. No self-loop or parallel edge.</summary>
    public readonly struct Edge : IEquatable<Edge>
    {
        public string A { get; }
        public string B { get; }
        public Edge(string a, string b)
        {
            Names.Check(a); Names.Check(b);
            if (a == b) throw new ArgumentException("Self-loops unsupported.");
            bool ordered = StringComparer.Ordinal.Compare(a, b) < 0;
            A = ordered ? a : b; B = ordered ? b : a;
        }
        public bool Equals(Edge other) => A == other.A && B == other.B;
        public override bool Equals(object? obj) => obj is Edge e && Equals(e);
        public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(A ?? "") * 397 ^ StringComparer.Ordinal.GetHashCode(B ?? "");
    }
    /// <summary>Point occupant or attached object. Boundary straddlers are explicitly unsupported.</summary>
    public sealed class Occupant
    {
        public string Id { get; }
        public string NodeId { get; }
        public bool BoundaryStraddler { get; }
        public Occupant(string id, string nodeId, bool boundaryStraddler = false)
        { Names.Check(id); Names.Check(nodeId); Id = id; NodeId = nodeId; BoundaryStraddler = boundaryStraddler; }
    }
    public enum OccupantPolicy { RigidCarriage, WitnessedRelocation, RefuseWhileOccupied }
    public sealed class RewriteRequest
    {
        public long ExpectedRevision { get; }
        public string PlateId { get; }
        public Edge Remove { get; }
        public Edge Add { get; }
        public double RotationDegrees { get; }
        public OccupantPolicy Policy { get; }
        /// <summary>Provenance reference; caller must separately authenticate and admit effect authority.</summary>
        public string AuthorityWitnessId { get; }
        public long StartTick { get; }
        public long DurationTicks { get; }
        public int OperationBudget { get; }
        public IReadOnlyDictionary<string, string> Destinations { get; }
        public RewriteRequest(long expectedRevision, string plateId, Edge remove, Edge add, double rotationDegrees,
            OccupantPolicy policy, string authorityWitnessId, long startTick, long durationTicks, int operationBudget,
            IDictionary<string, string>? destinations = null)
        {
            Names.Check(plateId); Names.Check(authorityWitnessId);
            if (destinations != null && destinations.Count > 256) throw new ArgumentException("Relocation budget: 256 occupants.");
            ExpectedRevision = expectedRevision; PlateId = plateId; Remove = remove; Add = add;
            RotationDegrees = rotationDegrees; Policy = policy; AuthorityWitnessId = authorityWitnessId;
            StartTick = startTick; DurationTicks = durationTicks; OperationBudget = operationBudget;
            var copy = new Dictionary<string, string>(StringComparer.Ordinal);
            if (destinations != null) foreach (var kv in destinations) { Names.Check(kv.Key); Names.Check(kv.Value); copy.Add(kv.Key, kv.Value); }
            Destinations = new System.Collections.ObjectModel.ReadOnlyDictionary<string, string>(copy);
        }
    }
    /// <summary>Continuous mathematical carriage curve or declared relocation segment. Collision/velocity checks NOT_RUN.</summary>
    public sealed class TransportWitness
    {
        public string EntityId { get; }
        public string OriginNode { get; }
        public string DestinationNode { get; }
        public string AuthorityWitnessId { get; }
        public long StartTick { get; }
        public long EndTick { get; }
        public OccupantPolicy Policy { get; }
        private readonly Plate startPlate;
        private readonly Vector3d origin, destination, local;
        private readonly double rotation;
        internal TransportWitness(Occupant entity, string destinationNode, RewriteRequest request, Plate plate, Vector3d localPosition, Vector3d destinationPosition)
        {
            EntityId = entity.Id; OriginNode = entity.NodeId; DestinationNode = destinationNode;
            AuthorityWitnessId = request.AuthorityWitnessId; StartTick = request.StartTick;
            EndTick = checked(request.StartTick + request.DurationTicks); Policy = request.Policy;
            startPlate = plate; local = localPosition; rotation = request.RotationDegrees;
            origin = plate.Place(local); destination = destinationPosition;
        }
        public Vector3d At(double normalizedTime)
        {
            Vector3d.Finite(normalizedTime, nameof(normalizedTime));
            if (normalizedTime < 0 || normalizedTime > 1) throw new ArgumentOutOfRangeException(nameof(normalizedTime));
            if (Policy == OccupantPolicy.RigidCarriage) return startPlate.Place(local, rotation * normalizedTime);
            return new Vector3d(origin.X + (destination.X - origin.X) * normalizedTime,
                origin.Y + (destination.Y - origin.Y) * normalizedTime, origin.Z + (destination.Z - origin.Z) * normalizedTime);
        }
    }
    /// <summary>In-process retained state; persistence/physical adapters must serialize and validate their own transaction.</summary>
    public sealed class RewriteWitness
    {
        internal PlateWorld Before { get; }
        internal PlateWorld After { get; }
        public string Rule => "boundary-edge-replace/v1";
        public string Clause => "HD-063/064/065";
        public string Operation { get; }
        public bool ReachabilityChanged { get; }
        public bool EmbeddingChanged { get; }
        public string PhysicalValidation => "NOT_RUN";
        public int WorkBound { get; }
        public IReadOnlyList<TransportWitness> Transports { get; }
        internal RewriteWitness(PlateWorld before, PlateWorld after, bool connectivity, bool embedding, int workBound,
            IReadOnlyList<TransportWitness> transports, string operation)
        {
            Before = before; After = after; ReachabilityChanged = connectivity; EmbeddingChanged = embedding;
            WorkBound = workBound; Transports = Array.AsReadOnly(transports.ToArray()); Operation = operation;
        }
    }
    public sealed class RewriteResult
    {
        public bool Admitted { get; }
        public string Reason { get; }
        public PlateWorld State { get; }
        public RewriteWitness? Witness { get; }
        internal RewriteResult(PlateWorld state, string reason, RewriteWitness? witness = null)
        { State = state; Reason = reason; Witness = witness; Admitted = witness != null; }
    }
    public sealed class PlateWorld
    {
        public long Revision { get; }
        public IReadOnlyList<Plate> Plates { get; }
        public IReadOnlyList<PlateNode> Nodes { get; }
        public IReadOnlyList<Edge> Edges { get; }
        public IReadOnlyList<Occupant> Occupants { get; }
        private readonly Dictionary<string, PlateNode> nodes;
        private readonly Dictionary<string, Plate> plates;
        private readonly Dictionary<string, string[]> adjacency;
        public PlateWorld(long revision, IReadOnlyList<Plate> plates, IReadOnlyList<PlateNode> nodes,
            IReadOnlyList<Edge> edges, IReadOnlyList<Occupant> occupants)
        {
            if (revision < 0) throw new ArgumentOutOfRangeException(nameof(revision));
            if (plates == null || plates.Count != 2 || nodes == null || nodes.Count < 2 || nodes.Count > 256 ||
                edges == null || edges.Count > 512 || occupants == null || occupants.Count > 256) throw new ArgumentException("Two plates, 2..256 nodes, <=512 edges, <=256 occupants required.");
            if (plates.Select(p => p.Id).Distinct(StringComparer.Ordinal).Count() != plates.Count ||
                nodes.Select(n => n.Id).Distinct(StringComparer.Ordinal).Count() != nodes.Count ||
                occupants.Select(o => o.Id).Distinct(StringComparer.Ordinal).Count() != occupants.Count || edges.Distinct().Count() != edges.Count)
                throw new ArgumentException("Duplicate identity or edge.");
            this.plates = plates.ToDictionary(p => p.Id, StringComparer.Ordinal);
            this.nodes = nodes.ToDictionary(n => n.Id, StringComparer.Ordinal);
            if (nodes.Any(n => !this.plates.ContainsKey(n.PlateId)) || plates.Any(p => !nodes.Any(n => n.PlateId == p.Id)) ||
                edges.Any(e => e.A == null || e.B == null || !this.nodes.ContainsKey(e.A) || !this.nodes.ContainsKey(e.B)) ||
                occupants.Any(o => !this.nodes.ContainsKey(o.NodeId))) throw new ArgumentException("Dangling node, plate or occupant reference.");
            Revision = revision;
            Plates = Array.AsReadOnly(plates.OrderBy(p => p.Id, StringComparer.Ordinal).ToArray());
            Nodes = Array.AsReadOnly(nodes.OrderBy(n => n.Id, StringComparer.Ordinal).ToArray());
            Edges = Array.AsReadOnly(edges.OrderBy(e => e.A, StringComparer.Ordinal).ThenBy(e => e.B, StringComparer.Ordinal).ToArray());
            Occupants = Array.AsReadOnly(occupants.OrderBy(o => o.Id, StringComparer.Ordinal).ToArray());
            var lists = Nodes.ToDictionary(n => n.Id, n => new List<string>(), StringComparer.Ordinal);
            foreach (var edge in Edges) { lists[edge.A].Add(edge.B); lists[edge.B].Add(edge.A); }
            adjacency = lists.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray(), StringComparer.Ordinal);
        }
        public bool Reachable(string origin, string destination)
        {
            if (!nodes.ContainsKey(origin) || !nodes.ContainsKey(destination)) throw new ArgumentException("Unknown route endpoint.");
            var seen = new HashSet<string>(StringComparer.Ordinal) { origin }; var pending = new Queue<string>(); pending.Enqueue(origin);
            while (pending.Count != 0)
            {
                string here = pending.Dequeue(); if (here == destination) return true;
                foreach (string next in adjacency[here]) if (seen.Add(next)) pending.Enqueue(next);
            }
            return false;
        }
        private RewriteResult Refuse(string code) => new RewriteResult(this, code);
        private bool Boundary(Edge e, string plateId, out string external)
        {
            external = "";
            if (e.A == null || e.B == null || !nodes.TryGetValue(e.A, out PlateNode? a) || !nodes.TryGetValue(e.B, out PlateNode? b)) return false;
            bool aa = a.PlateId == plateId, bb = b.PlateId == plateId;
            if (aa == bb) return false;
            external = aa ? b.Id : a.Id; return true;
        }
        public RewriteResult Rewrite(RewriteRequest request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (request.ExpectedRevision != Revision) return Refuse("HD-064:stale-revision");
            if (Revision == long.MaxValue) return Refuse("HD-064:revision-exhausted");
            // Conservative admission work units, not a wall-clock/performance measurement.
            int work = Nodes.Count * Nodes.Count + Edges.Count * 4 + Occupants.Count * 8 + 40;
            if (request.OperationBudget < work || request.OperationBudget > 1000000) return Refuse("HD-064:work-budget");
            if (!plates.TryGetValue(request.PlateId, out Plate? moving)) return Refuse("HD-064:unknown-plate");
            if (double.IsNaN(request.RotationDegrees) || double.IsInfinity(request.RotationDegrees) || Math.Abs(request.RotationDegrees) > 360 ||
                request.StartTick < 0 || request.DurationTicks < 1 || request.DurationTicks > 1000000 || request.StartTick > long.MaxValue - request.DurationTicks)
                return Refuse("HD-065:invalid-motion-envelope");
            if (!Enum.IsDefined(typeof(OccupantPolicy), request.Policy)) return Refuse("HD-065:unsupported-policy");
            // Explicit preserved-node, fixed-external-boundary edge-replacement formalism.
            // There is no node deletion/identification, so no dangling-node condition can arise.
            if (!Edges.Contains(request.Remove) || Edges.Contains(request.Add) ||
                !Boundary(request.Remove, request.PlateId, out string beforeExternal) ||
                !Boundary(request.Add, request.PlateId, out string afterExternal) || beforeExternal != afterExternal)
                return Refuse("HD-064:boundary-match-failed");
            var affected = Occupants.Where(o => nodes[o.NodeId].PlateId == moving.Id).ToArray();
            // With two plates, a straddler based on either side may overlap the moving plate.
            if (Occupants.Any(o => o.BoundaryStraddler)) return Refuse("HD-065:boundary-straddler-unsupported");
            if (affected.Length > 0 && request.Policy == OccupantPolicy.RefuseWhileOccupied) return Refuse("HD-065:occupied");
            if (request.Policy == OccupantPolicy.WitnessedRelocation)
            {
                if (request.Destinations.Count != affected.Length || affected.Any(o => !request.Destinations.ContainsKey(o.Id) || !nodes.ContainsKey(request.Destinations[o.Id])))
                    return Refuse("HD-065:incomplete-or-invalid-destination");
            }
            else if (request.Destinations.Count != 0) return Refuse("HD-065:unexpected-destinations");
            var newPlate = new Plate(moving.Id, moving.Center, moving.AngleDegrees + request.RotationDegrees);
            var resultingPlates = Plates.Select(p => p.Id == moving.Id ? newPlate : p).ToArray();
            var newOccupants = Occupants.Select(o => request.Policy == OccupantPolicy.WitnessedRelocation && request.Destinations.TryGetValue(o.Id, out string? dest)
                ? new Occupant(o.Id, dest, o.BoundaryStraddler) : o).ToArray();
            var after = new PlateWorld(Revision + 1, resultingPlates, Nodes, Edges.Where(e => !e.Equals(request.Remove)).Concat(new[] { request.Add }).ToArray(), newOccupants);
            var transports = new List<TransportWitness>();
            foreach (var o in affected)
            {
                string destinationNode = request.Policy == OccupantPolicy.WitnessedRelocation ? request.Destinations[o.Id] : o.NodeId;
                var dn = nodes[destinationNode]; var dp = after.plates[dn.PlateId];
                transports.Add(new TransportWitness(o, destinationNode, request, moving, nodes[o.NodeId].LocalPosition, dp.Place(dn.LocalPosition)));
            }
            // Component labels allow complete pairwise reachability comparison in bounded space.
            var priorComponents = Components(); var afterComponents = after.Components(); bool changed = false;
            for (int i = 0; i < Nodes.Count; i++) for (int j = i + 1; j < Nodes.Count; j++)
                if ((priorComponents[Nodes[i].Id] == priorComponents[Nodes[j].Id]) != (afterComponents[Nodes[i].Id] == afterComponents[Nodes[j].Id])) changed = true;
            var witness = new RewriteWitness(this, after, changed, request.RotationDegrees % 360 != 0, work, transports, "forward");
            return new RewriteResult(after, "mathematical-snapshot-admitted; physical-validation-NOT_RUN", witness);
        }
        private Dictionary<string, int> Components()
        {
            var components = new Dictionary<string, int>(StringComparer.Ordinal); int label = 0;
            foreach (var node in Nodes)
            {
                if (components.ContainsKey(node.Id)) continue;
                var pending = new Queue<string>(); pending.Enqueue(node.Id); components.Add(node.Id, label++);
                while (pending.Count != 0)
                {
                    string here = pending.Dequeue();
                    foreach (string next in adjacency[here]) if (!components.ContainsKey(next)) { components.Add(next, components[here]); pending.Enqueue(next); }
                }
            }
            return components;
        }
        /// <summary>Retained-state mathematical inverse, admissible only on this exact resulting snapshot.
        /// No rollback of history, collision validation, physical transport or durable recovery is implied.</summary>
        public RewriteResult Invert(RewriteWitness witness)
        {
            if (witness == null) throw new ArgumentNullException(nameof(witness));
            if (!ReferenceEquals(this, witness.After)) return Refuse("HD-064:inverse-state-mismatch");
            if (Revision == long.MaxValue) return Refuse("HD-064:revision-exhausted");
            var before = witness.Before;
            var restored = new PlateWorld(Revision + 1, before.Plates, before.Nodes, before.Edges, before.Occupants);
            var inverse = new RewriteWitness(this, restored, witness.ReachabilityChanged, witness.EmbeddingChanged, witness.WorkBound,
                Array.Empty<TransportWitness>(), "retained-state-inverse; new-physical-transport-required");
            return new RewriteResult(restored, "mathematical-inverse-admitted; physical-validation-NOT_RUN", inverse);
        }
    }
}
