using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using Dark.Core;

namespace Dark.Population
{
    internal sealed class SnapshotException : Exception
    {
        internal SnapshotException(string code) : base(code) { Code = code; }
        internal string Code { get; }
    }
    internal sealed class StoredInhabitantSnapshot
    {
        internal StoredInhabitantSnapshot(InhabitantSnapshot snapshot, long generation, string digest)
        { Snapshot = snapshot; Generation = generation; Digest = digest; }
        internal InhabitantSnapshot Snapshot { get; }
        internal long Generation { get; }
        internal string Digest { get; }
    }
    /// <summary>Schema 1: explicit big-endian bounded fields plus SHA-256. No runtime object deserializer.</summary>
    internal static class InhabitantSnapshotCodec
    {
        static readonly byte[] Magic = { 0x44, 0x41, 0x52, 0x4b, 0x4e, 0x50, 0x43, 0 };
        internal static void Validate(InhabitantSnapshot snapshot)
        {
            try
            {
                // Reuses the real actor's identity, personality and memory admission invariants.
                // It does not infer that a file supplied an authenticated observation.
                Inhabitant.Restore(snapshot);
            }
            catch (ArgumentException) { throw new SnapshotException("invalid_snapshot"); }
        }
        internal static byte[] Encode(InhabitantSnapshot snapshot, long generation)
        {
            Validate(snapshot);
            if (generation < 1) throw new SnapshotException("invalid_snapshot");
            using (var stream = new MemoryStream())
            {
                stream.Write(Magic, 0, Magic.Length); Write16(1); Write64(generation); Text(snapshot.Id);
                Write64(BitConverter.DoubleToInt64Bits(snapshot.Personality.Sociability));
                Write64(BitConverter.DoubleToInt64Bits(snapshot.Personality.Duty)); Text(snapshot.Task);
                Write16(snapshot.Observations.Count);
                foreach (var observation in snapshot.Observations)
                { Text(observation.EventId); Text(observation.ActorId); Text(observation.Act); Write64(observation.Tick); Text(observation.Cell); }
                byte[] payload = stream.ToArray();
                using (var hash = SHA256.Create())
                { byte[] checksum = hash.ComputeHash(payload); stream.Write(checksum, 0, checksum.Length); }
                if (stream.Length > FileInhabitantStore.MaximumFileBytes) throw new SnapshotException("snapshot_too_large");
                return stream.ToArray();
                void Write16(int value) { stream.WriteByte((byte)(value >> 8)); stream.WriteByte((byte)value); }
                void Write64(long value) { for (int i = 7; i >= 0; i--) stream.WriteByte((byte)((ulong)value >> (i * 8))); }
                void Text(string value)
                {
                    byte[] bytes = Canonical.Utf8.GetBytes(value);
                    if (bytes.Length < 1 || bytes.Length > 128) throw new SnapshotException("invalid_snapshot");
                    Write16(bytes.Length); stream.Write(bytes, 0, bytes.Length);
                }
            }
        }
        internal static string Receipt(byte[] encoded) => BitConverter.ToString(encoded, encoded.Length - 32, 32).Replace("-", "").ToLowerInvariant();
        internal static StoredInhabitantSnapshot Decode(byte[] encoded, string expectedId)
        {
            try
            {
                if (encoded.Length > FileInhabitantStore.MaximumFileBytes) throw new SnapshotException("snapshot_too_large");
                if (encoded.Length < 74) throw new SnapshotException("invalid_snapshot");
                int limit = encoded.Length - 32, position = 0;
                using (var hash = SHA256.Create())
                {
                    byte[] checksum = hash.ComputeHash(encoded, 0, limit); int difference = 0;
                    for (int i = 0; i < checksum.Length; i++) difference |= checksum[i] ^ encoded[limit + i];
                    if (difference != 0) throw new SnapshotException("checksum_mismatch");
                }
                foreach (byte b in Magic) if (Byte() != b) throw new SnapshotException("invalid_snapshot");
                if (Read16() != 1) throw new SnapshotException("unsupported_version");
                long generation = Read64(); if (generation < 1) throw new SnapshotException("invalid_snapshot");
                string id = Text(); if (id != expectedId) throw new SnapshotException("identity_mismatch");
                var personality = new Personality(BitConverter.Int64BitsToDouble(Read64()), BitConverter.Int64BitsToDouble(Read64()));
                string task = Text(); int count = Read16(); if (count > 256) throw new SnapshotException("invalid_snapshot");
                var observations = new List<Observation>(count);
                for (int i = 0; i < count; i++)
                {
                    string eventId = Text(), actorId = Text(), act = Text(); long tick = Read64(); string cell = Text();
                    observations.Add(new Observation(eventId, actorId, act, tick, cell));
                }
                if (position != limit) throw new SnapshotException("invalid_snapshot");
                var snapshot = new InhabitantSnapshot(id, personality, task, observations); Validate(snapshot);
                return new StoredInhabitantSnapshot(snapshot, generation, Receipt(encoded));
                byte Byte() { if (position >= limit) throw new SnapshotException("invalid_snapshot"); return encoded[position++]; }
                int Read16() => (Byte() << 8) | Byte();
                long Read64() { ulong value = 0; for (int i = 0; i < 8; i++) value = (value << 8) | Byte(); return unchecked((long)value); }
                string Text()
                {
                    int bytes = Read16();
                    if (bytes < 1 || bytes > 128 || position > limit - bytes) throw new SnapshotException("invalid_snapshot");
                    string text = Canonical.Utf8.GetString(encoded, position, bytes); position += bytes;
                    return Canonical.RequireId(text, "snapshotField");
                }
            }
            catch (ArgumentException) { throw new SnapshotException("invalid_snapshot"); }
            catch (OverflowException) { throw new SnapshotException("invalid_snapshot"); }
        }
    }
}
