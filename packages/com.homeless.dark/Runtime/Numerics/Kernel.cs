// HD-015, HD-016, HD-025, HD-087. Established WGS84 and Hamilton allocation.
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Numerics;

namespace Dark.Numerics
{
    public readonly struct Vector3d
    {
        public double X { get; }
        public double Y { get; }
        public double Z { get; }
        public Vector3d(double x, double y, double z)
        {
            Finite(x, nameof(x)); Finite(y, nameof(y)); Finite(z, nameof(z));
            X = x; Y = y; Z = z;
        }
        internal static void Finite(double value, string name)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) throw new ArgumentOutOfRangeException(name, "Finite value required.");
        }
        public double Length => Math.Sqrt(X * X + Y * Y + Z * Z);
        public static Vector3d operator +(Vector3d a, Vector3d b) => new Vector3d(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        public static Vector3d operator -(Vector3d a, Vector3d b) => new Vector3d(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
    }

    /// <summary>Degrees and meters above WGS84 ellipsoid, never orthometric height.</summary>
    public readonly struct Geodetic
    {
        public double LatitudeDegrees { get; }
        public double LongitudeDegrees { get; }
        public double EllipsoidHeightMeters { get; }
        public Geodetic(double latitudeDegrees, double longitudeDegrees, double ellipsoidHeightMeters)
        {
            Vector3d.Finite(latitudeDegrees, nameof(latitudeDegrees));
            Vector3d.Finite(longitudeDegrees, nameof(longitudeDegrees));
            Vector3d.Finite(ellipsoidHeightMeters, nameof(ellipsoidHeightMeters));
            if (latitudeDegrees < -90 || latitudeDegrees > 90) throw new ArgumentOutOfRangeException(nameof(latitudeDegrees));
            if (ellipsoidHeightMeters < -100000 || ellipsoidHeightMeters > 1e9) throw new ArgumentOutOfRangeException(nameof(ellipsoidHeightMeters), "Supported ellipsoid height: -100 km to 1 million km.");
            LatitudeDegrees = latitudeDegrees;
            LongitudeDegrees = ((longitudeDegrees % 360 + 540) % 360) - 180;
            EllipsoidHeightMeters = ellipsoidHeightMeters;
        }
    }

    public static class Geodesy
    {
        public const double SemiMajorAxisMeters = 6378137;
        public const double Flattening = 1.0 / 298.257223563;
        private const double E2 = Flattening * (2 - Flattening);
        internal const double Radians = Math.PI / 180;

        public static Vector3d ToEcef(Geodetic g)
        {
            double lat = g.LatitudeDegrees * Radians, lon = g.LongitudeDegrees * Radians;
            double s = Math.Sin(lat), c = Math.Cos(lat), n = SemiMajorAxisMeters / Math.Sqrt(1 - E2 * s * s);
            return new Vector3d((n + g.EllipsoidHeightMeters) * c * Math.Cos(lon),
                (n + g.EllipsoidHeightMeters) * c * Math.Sin(lon),
                (n * (1 - E2) + g.EllipsoidHeightMeters) * s);
        }

        public static Geodetic FromEcef(Vector3d v)
        {
            if (v.Length < SemiMajorAxisMeters * (1 - Flattening) - 100000 - 1e-6 || v.Length > 1.01e9)
                throw new ArgumentOutOfRangeException(nameof(v), "ECEF outside supported near-Earth/orbital shell.");
            double p = Math.Sqrt(v.X * v.X + v.Y * v.Y);
            if (p < 1e-9)
                return new Geodetic(v.Z >= 0 ? 90 : -90, 0, Math.Abs(v.Z) - SemiMajorAxisMeters * (1 - Flattening));
            double lat = Math.Atan2(v.Z, p * (1 - E2));
            bool converged = false;
            for (int i = 0; i < 16; i++)
            {
                double s = Math.Sin(lat), n = SemiMajorAxisMeters / Math.Sqrt(1 - E2 * s * s);
                double next = Math.Atan2(v.Z + E2 * n * s, p);
                if (Math.Abs(next - lat) < 1e-14) { lat = next; converged = true; break; }
                lat = next;
            }
            if (!converged) throw new InvalidOperationException("WGS84 inversion did not converge within 16 iterations.");
            // Projection onto ellipsoid normal remains stable at poles.
            double sin = Math.Sin(lat), height = p * Math.Cos(lat) + v.Z * sin - SemiMajorAxisMeters * Math.Sqrt(1 - E2 * sin * sin);
            // Roundoff at the closed domain endpoints must not reject their own forward image.
            if (height < -100000 && height >= -100000 - 1e-6) height = -100000;
            if (height > 1e9 && height <= 1e9 + 1e-6) height = 1e9;
            return new Geodetic(lat / Radians, Math.Atan2(v.Y, v.X) / Radians, height);
        }
    }

    /// <summary>Double precision East/North/Up frame with a caller-declared local radius.</summary>
    public sealed class LocalEnuFrame
    {
        private readonly Vector3d origin;
        private readonly double sl, cl, sp, cp, radius;
        public LocalEnuFrame(Geodetic anchor, double maximumLocalRadiusMeters)
        {
            Vector3d.Finite(maximumLocalRadiusMeters, nameof(maximumLocalRadiusMeters));
            if (maximumLocalRadiusMeters <= 0 || maximumLocalRadiusMeters > 1e6) throw new ArgumentOutOfRangeException(nameof(maximumLocalRadiusMeters));
            origin = Geodesy.ToEcef(anchor); radius = maximumLocalRadiusMeters;
            sl = Math.Sin(anchor.LongitudeDegrees * Geodesy.Radians); cl = Math.Cos(anchor.LongitudeDegrees * Geodesy.Radians);
            sp = Math.Sin(anchor.LatitudeDegrees * Geodesy.Radians); cp = Math.Cos(anchor.LatitudeDegrees * Geodesy.Radians);
        }
        private Vector3d Bound(Vector3d v)
        {
            if (v.Length > radius) throw new ArgumentOutOfRangeException(nameof(v), "Origin shift required outside local frame radius.");
            return v;
        }
        public Vector3d ToEnu(Vector3d ecef)
        {
            var d = ecef - origin;
            return Bound(new Vector3d(-sl * d.X + cl * d.Y, -sp * cl * d.X - sp * sl * d.Y + cp * d.Z,
                cp * cl * d.X + cp * sl * d.Y + sp * d.Z));
        }
        public Vector3d ToEcef(Vector3d enu)
        {
            Bound(enu);
            return origin + new Vector3d(-sl * enu.X - sp * cl * enu.Y + cp * cl * enu.Z,
                cl * enu.X - sp * sl * enu.Y + cp * sl * enu.Z, cp * enu.Y + sp * enu.Z);
        }
    }

    public sealed class PopulationWeight
    {
        public string Id { get; }
        public ulong Weight { get; }
        public PopulationWeight(string id, ulong weight)
        {
            if (string.IsNullOrWhiteSpace(id) || id.Length > 128) throw new ArgumentException("Stable shard ID required.", nameof(id));
            Id = id; Weight = weight;
        }
    }

    /// <summary>Hamilton/largest remainder with exact integer weights; ordinal IDs break ties.</summary>
    public static class IntegerApportionment
    {
        public static IReadOnlyDictionary<string, ulong> Allocate(ulong total, IReadOnlyList<PopulationWeight> weights)
        {
            if (weights == null || weights.Count == 0 || weights.Count > 4096) throw new ArgumentException("1..4096 shard weights required.", nameof(weights));
            var sorted = weights.OrderBy(w => w.Id, StringComparer.Ordinal).ToArray();
            if (sorted.Select(w => w.Id).Distinct(StringComparer.Ordinal).Count() != sorted.Length) throw new ArgumentException("Duplicate shard ID.", nameof(weights));
            BigInteger sum = sorted.Aggregate(BigInteger.Zero, (s, w) => s + w.Weight);
            if (sum.IsZero) throw new ArgumentException("Positive total weight required.", nameof(weights));
            var result = new Dictionary<string, ulong>(StringComparer.Ordinal);
            var remainders = new List<(string Id, BigInteger Remainder)>();
            BigInteger allocated = 0;
            foreach (var w in sorted)
            {
                BigInteger q = BigInteger.DivRem(new BigInteger(total) * w.Weight, sum, out BigInteger rem);
                result.Add(w.Id, (ulong)q); allocated += q; remainders.Add((w.Id, rem));
            }
            int remaining = (int)(new BigInteger(total) - allocated); // Strictly less than shard count.
            foreach (var r in remainders.OrderByDescending(r => r.Remainder).ThenBy(r => r.Id, StringComparer.Ordinal).Take(remaining))
                result[r.Id] = checked(result[r.Id] + 1);
            return new ReadOnlyDictionary<string, ulong>(result);
        }
    }
}
