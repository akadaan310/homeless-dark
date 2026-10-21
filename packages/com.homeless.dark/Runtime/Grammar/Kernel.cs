// HD-056, HD-058, HD-059, HD-087. Project cells/lifts; standard relational converses.
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Numerics;

namespace Dark.Grammar
{
    public enum CellKind { Value, Zero, Missing, Forbidden, Foreign }
    public sealed class NumberCell
    {
        public CellKind Kind { get; }
        public string Evidence { get; }
        private readonly decimal number;
        private NumberCell(CellKind kind, decimal number, string evidence) { Kind = kind; this.number = number; Evidence = evidence; }
        public decimal Number => Kind == CellKind.Value || Kind == CellKind.Zero ? number : throw new InvalidOperationException("Cell has no numeric value: " + Kind);
        public static NumberCell Value(decimal number) => new NumberCell(number == 0 ? CellKind.Zero : CellKind.Value, number, "exact decimal");
        public static NumberCell NonValue(CellKind kind, string evidence)
        {
            if (kind != CellKind.Missing && kind != CellKind.Forbidden && kind != CellKind.Foreign) throw new ArgumentException("Nonvalue kind required.", nameof(kind));
            if (string.IsNullOrWhiteSpace(evidence)) throw new ArgumentException("Evidence required.", nameof(evidence));
            return new NumberCell(kind, 0, evidence);
        }
    }

    public enum InverseKind { ImageFailure, Unique, KernelFailure }
    public sealed class InverseResult
    {
        public InverseKind Kind { get; }
        public string Carrier { get; }
        public string Equation { get; }
        public string Description { get; }
        /// <summary>Complete finite list, or empty for an infinite solution set described by Description.</summary>
        public IReadOnlyList<BigInteger> Solutions { get; }
        public bool InfiniteSolutions { get; }
        internal InverseResult(string carrier, string equation, IReadOnlyList<BigInteger> solutions, bool infinite = false)
        {
            Carrier = carrier; Equation = equation; Solutions = Array.AsReadOnly(solutions.ToArray()); InfiniteSolutions = infinite;
            Kind = infinite || solutions.Count > 1 ? InverseKind.KernelFailure : solutions.Count == 1 ? InverseKind.Unique : InverseKind.ImageFailure;
            Description = infinite ? "Every integer is a preimage; no branch selected." : Kind == InverseKind.ImageFailure ? "No preimage in declared carrier." : Kind == InverseKind.Unique ? "Exactly one preimage." : "Multiple preimages; no branch selected.";
        }
        public BigInteger UniqueValue => Kind == InverseKind.Unique ? Solutions[0] : throw new InvalidOperationException(Description);
    }
    public static class IntegerConverse
    {
        /// <summary>Solutions c of b*c=a over Z, not floating point division or a chosen branch.</summary>
        public static InverseResult Divide(BigInteger a, BigInteger b)
        {
            if (a.ToByteArray().Length > 512 || b.ToByteArray().Length > 512) throw new ArgumentOutOfRangeException(nameof(a), "Integer operand budget: 4095 signed bits.");
            string eq = b + " * c = " + a;
            if (b.IsZero) return new InverseResult("Z", eq, Array.Empty<BigInteger>(), a.IsZero);
            BigInteger q = BigInteger.DivRem(a, b, out BigInteger remainder);
            return new InverseResult("Z", eq, remainder.IsZero ? new[] { q } : Array.Empty<BigInteger>());
        }
        /// <summary>Complete bounded exhaustive relation over Z/n, 1 &lt;= n &lt;= 4096.</summary>
        public static InverseResult DivideMod(int a, int b, int n)
        {
            if (n < 1 || n > 4096) throw new ArgumentOutOfRangeException(nameof(n));
            long aa = ((long)a % n + n) % n, bb = ((long)b % n + n) % n;
            var solutions = new List<BigInteger>();
            for (int c = 0; c < n; c++) if (bb * c % n == aa) solutions.Add(c);
            return new InverseResult("Z/" + n, b + " * c = " + a + " (mod " + n + ")", solutions);
        }
    }

    public enum LiftStatus { Unique, Ambiguous, Unreadable }
    /// <summary>A declared fiber member with exact identity and an explicit finite context read set.</summary>
    public sealed class Reading
    {
        public string Id { get; }
        public string SkeletonId { get; }
        public int StructuralLevel { get; }
        public int Rank { get; }
        public IReadOnlyDictionary<string, string> RequiredContext { get; }
        public Reading(string id, string skeletonId, int structuralLevel, IDictionary<string, string> requiredContext, int rank)
        {
            CheckId(id); CheckId(skeletonId);
            if (structuralLevel < 0 || structuralLevel > 64) throw new ArgumentOutOfRangeException(nameof(structuralLevel));
            if (requiredContext == null || requiredContext.Count > 32) throw new ArgumentException("At most 32 context reads.", nameof(requiredContext));
            var copy = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var kv in requiredContext) { CheckId(kv.Key); CheckId(kv.Value); copy.Add(kv.Key, kv.Value); }
            Id = id; SkeletonId = skeletonId; StructuralLevel = structuralLevel; Rank = rank;
            RequiredContext = new ReadOnlyDictionary<string, string>(copy);
        }
        internal static void CheckId(string id)
        {
            if (string.IsNullOrWhiteSpace(id) || id.Length > 256) throw new ArgumentException("Nonempty ID/context token with at most 256 characters required.");
        }
    }
    public sealed class LiftResult
    {
        public LiftStatus Status => Candidates.Count == 0 ? LiftStatus.Unreadable : Candidates.Count == 1 ? LiftStatus.Unique : LiftStatus.Ambiguous;
        public IReadOnlyList<Reading> Candidates { get; }
        internal LiftResult(IEnumerable<Reading> candidates) { Candidates = Array.AsReadOnly(candidates.ToArray()); }
        /// <summary>Explicit pointing in the same structural level. Never chooses an ambiguous branch implicitly.</summary>
        public Reading Select(string readingId) => Candidates.FirstOrDefault(r => r.Id == readingId) ?? throw new InvalidOperationException("Reading not admitted by the current context.");
    }
    public sealed class TashkilResolver
    {
        private readonly IReadOnlyList<Reading> readings;
        public string SkeletonId { get; }
        public int StructuralLevel { get; }
        public TashkilResolver(string skeletonId, int structuralLevel, IReadOnlyList<Reading> readings)
        {
            Reading.CheckId(skeletonId);
            if (structuralLevel < 0 || structuralLevel > 64) throw new ArgumentOutOfRangeException(nameof(structuralLevel));
            if (readings == null || readings.Count > 256) throw new ArgumentException("At most 256 declared fiber members.", nameof(readings));
            if (readings.Any(r => r.SkeletonId != skeletonId || r.StructuralLevel != structuralLevel)) throw new ArgumentException("All lifts must project to this skeleton and structural level.");
            if (readings.Select(r => r.Id).Distinct(StringComparer.Ordinal).Count() != readings.Count) throw new ArgumentException("Duplicate reading identity.");
            SkeletonId = skeletonId; StructuralLevel = structuralLevel;
            this.readings = Array.AsReadOnly(readings.OrderByDescending(r => r.Rank).ThenBy(r => r.Id, StringComparer.Ordinal).ToArray());
        }
        public LiftResult Resolve(IReadOnlyDictionary<string, string> observations)
        {
            if (observations == null || observations.Count > 128) throw new ArgumentException("At most 128 observations.", nameof(observations));
            // Absence is unknown, not false. Complementary observations can refine this set.
            return new LiftResult(readings.Where(r => r.RequiredContext.All(kv => !observations.TryGetValue(kv.Key, out string? seen) || seen == kv.Value)));
        }
    }
}
